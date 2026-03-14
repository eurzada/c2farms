import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';
import { fiscalToCalendar } from '../utils/fiscalYear.js';
import ExcelJS from 'exceljs';
import { getFontPaths } from '../utils/fontPaths.js';

const log = createLogger('enterprise-journal');

function round2(v) { return Math.round((v || 0) * 100) / 100; }

// Normalize deduction category from various AI-extracted values
function normalizeCategory(cat, name) {
  if (cat) {
    const c = cat.toLowerCase();
    if (['checkoff', 'levy'].includes(c)) return 'checkoff';
    if (c === 'drying') return 'drying';
    if (c === 'quality') return 'quality';
    if (c === 'freight') return 'freight';
    if (c === 'storage') return 'storage';
    if (c === 'commission') return 'commission';
    if (c === 'premium') return 'premium';
  }
  // Infer from name
  if (name) {
    const n = name.toLowerCase();
    if (n.includes('checkoff') || n.includes('dev comm') || n.includes('development') || n.includes('levy') || n.includes('swdc')) return 'checkoff';
    if (n.includes('drying') || n.includes('dry')) return 'drying';
    if (n.includes('quality') || n.includes('spread') || n.includes('property') || n.includes('split') || n.includes('premium') || n.includes('discount')) return 'quality';
    if (n.includes('freight') || n.includes('trucking')) return 'freight';
    if (n.includes('storage') || n.includes('stor')) return 'storage';
    if (n.includes('gst')) return 'gst';
    if (n.includes('pst')) return 'pst';
  }
  return 'other';
}

// Category display names for reports
const CATEGORY_LABELS = {
  checkoff: 'Commodity Checkoff Levies',
  drying: 'Drying Charges/Adjustments',
  quality: 'Quality Discounts/Premiums',
  freight: 'Freight & Trucking',
  storage: 'Storage Charges',
  commission: 'Commissions',
  premium: 'Premiums',
  gst: 'GST',
  pst: 'PST',
  other: 'Other Adjustments',
};

// QBO account mapping suggestions
const CATEGORY_QBO_ACCOUNTS = {
  checkoff: 'Checkoff Expense',
  drying: 'Drying Expense',
  quality: 'Quality Discount',
  freight: 'Freight Expense',
  storage: 'Storage Expense',
  commission: 'Commission Expense',
  premium: 'Grain Revenue - Premiums',
  gst: 'GST Paid on Purchases',
  pst: 'PST Paid on Purchases',
  other: 'Other Grain Adjustments',
};

/**
 * Build deduction breakdown for a settlement, falling back to per-line data if summary is null.
 */
function getDeductions(settlement) {
  // Prefer settlement-level summary
  if (settlement.deductions_summary && Array.isArray(settlement.deductions_summary) && settlement.deductions_summary.length > 0) {
    return settlement.deductions_summary.map(d => ({
      name: d.name,
      amount: d.amount || 0,
      gst: d.gst || null,
      pst: d.pst || null,
      category: normalizeCategory(d.category, d.name),
    }));
  }

  // Fallback: aggregate per-line deductions
  const lineDeductions = {};
  for (const line of (settlement.lines || [])) {
    const deds = line.deductions_json;
    if (!Array.isArray(deds)) continue;
    for (const d of deds) {
      const name = d.name || 'Unknown';
      if (!lineDeductions[name]) lineDeductions[name] = { name, amount: 0, gst: null, pst: null };
      lineDeductions[name].amount += d.amount || 0;
    }
  }
  return Object.values(lineDeductions).map(d => ({
    ...d,
    category: normalizeCategory(null, d.name),
  }));
}

/**
 * Get gross amount for a settlement, falling back to sum of line_gross.
 */
function getGross(settlement) {
  if (settlement.settlement_gross) return settlement.settlement_gross;
  // Fallback: try extraction_json
  if (settlement.extraction_json?.total_gross_amount) return settlement.extraction_json.total_gross_amount;
  // Fallback: sum line_gross
  const lineSum = (settlement.lines || []).reduce((s, l) => s + (l.line_gross || 0), 0);
  return lineSum || settlement.total_amount || 0;
}

/**
 * Enterprise Settlement Journal report.
 * All approved settlements in a fiscal year, grouped by buyer, with deduction breakdown and location split.
 */
export async function getEnterpriseJournal(farmId, fiscalYear) {
  const fy = parseInt(fiscalYear, 10);
  const fyStart = fiscalToCalendar(fy, 'Nov');
  const fyEnd = new Date(fy, 10, 1);

  log.info('Enterprise journal report', { farmId, fiscalYear: fy });

  const settlements = await prisma.settlement.findMany({
    where: {
      farm_id: farmId,
      status: 'approved',
      settlement_date: { gte: fyStart, lt: fyEnd },
    },
    include: {
      counterparty: { select: { name: true, short_code: true } },
      marketing_contract: { select: { contract_number: true, commodity: { select: { name: true } } } },
      lines: {
        include: {
          delivery_ticket: {
            select: {
              ticket_number: true,
              net_weight_mt: true,
              location: { select: { name: true } },
              commodity: { select: { name: true } },
            },
          },
        },
        orderBy: { line_number: 'asc' },
      },
    },
    orderBy: [{ settlement_date: 'asc' }],
  });

  // Group by buyer
  const buyerMap = {};
  const grandDeductions = {};
  let grandGross = 0;
  let grandNet = 0;
  let grandLineCount = 0;

  for (const s of settlements) {
    const buyer = s.counterparty?.name || s.buyer_format?.toUpperCase() || 'Unknown';
    if (!buyerMap[buyer]) buyerMap[buyer] = { buyer, short_code: s.counterparty?.short_code || null, settlements: [], subtotal_gross: 0, subtotal_net: 0, subtotal_lines: 0 };

    const gross = round2(getGross(s));
    const net = round2(s.total_amount || 0);
    const deductions = getDeductions(s);
    const totalDeductions = round2(deductions.reduce((sum, d) => sum + d.amount, 0));

    // Location breakdown from matched tickets
    const locationMap = {};
    let matchedMt = 0;
    for (const line of s.lines) {
      const loc = line.delivery_ticket?.location?.name || 'Unmatched';
      if (!locationMap[loc]) locationMap[loc] = { name: loc, ticket_count: 0, mt: 0, line_count: 0 };
      locationMap[loc].line_count++;
      if (line.delivery_ticket) {
        locationMap[loc].ticket_count++;
        locationMap[loc].mt += line.net_weight_mt || line.delivery_ticket.net_weight_mt || 0;
        matchedMt += line.net_weight_mt || line.delivery_ticket.net_weight_mt || 0;
      }
    }
    // Proportional $ allocation by MT
    const locations = Object.values(locationMap).map(loc => ({
      ...loc,
      mt: round2(loc.mt),
      amount: matchedMt > 0 ? round2(net * (loc.mt / matchedMt)) : 0,
    }));
    locations.sort((a, b) => b.mt - a.mt);

    const commodity = s.marketing_contract?.commodity?.name || s.extraction_json?.commodity || '';
    const contractNum = s.marketing_contract?.contract_number || s.extraction_json?.contract_number || '';

    buyerMap[buyer].settlements.push({
      id: s.id,
      settlement_number: s.settlement_number,
      date: s.settlement_date,
      contract_number: contractNum,
      commodity,
      gross,
      deductions,
      total_deductions: totalDeductions,
      net,
      line_count: s.lines.length,
      locations,
    });

    buyerMap[buyer].subtotal_gross += gross;
    buyerMap[buyer].subtotal_net += net;
    buyerMap[buyer].subtotal_lines += s.lines.length;

    grandGross += gross;
    grandNet += net;
    grandLineCount += s.lines.length;

    // Aggregate deductions by category
    for (const d of deductions) {
      if (!grandDeductions[d.category]) grandDeductions[d.category] = { category: d.category, label: CATEGORY_LABELS[d.category] || d.category, total: 0, gst: 0, pst: 0, count: 0 };
      grandDeductions[d.category].total += d.amount;
      grandDeductions[d.category].gst += d.gst || 0;
      grandDeductions[d.category].pst += d.pst || 0;
      grandDeductions[d.category].count++;
    }
  }

  // Finalize
  const byBuyer = Object.values(buyerMap).map(b => ({
    ...b,
    subtotal_gross: round2(b.subtotal_gross),
    subtotal_net: round2(b.subtotal_net),
  }));
  byBuyer.sort((a, b) => b.subtotal_net - a.subtotal_net);

  const deductionCategories = Object.values(grandDeductions).map(d => ({
    ...d,
    total: round2(d.total),
    gst: round2(d.gst),
    pst: round2(d.pst),
    qbo_account: CATEGORY_QBO_ACCOUNTS[d.category] || 'Other',
  }));
  deductionCategories.sort((a, b) => a.total - b.total); // most negative first

  return {
    fiscal_year: fy,
    period: `Nov ${fy - 1} – Oct ${fy}`,
    summary: {
      total_gross: round2(grandGross),
      total_deductions: round2(grandGross - grandNet),
      total_net: round2(grandNet),
      settlement_count: settlements.length,
      line_count: grandLineCount,
      buyer_count: byBuyer.length,
      deduction_categories: deductionCategories,
    },
    by_buyer: byBuyer,
  };
}

/**
 * Generate QBO-importable CSV for journal entries.
 */
export async function generateEnterpriseJournalCsv(farmId, fiscalYear) {
  const data = await getEnterpriseJournal(farmId, fiscalYear);

  const rows = [['Date', 'Settlement #', 'Buyer', 'Contract #', 'Commodity', 'Location', 'Account', 'Debit', 'Credit', 'Memo']];

  for (const buyer of data.by_buyer) {
    for (const s of buyer.settlements) {
      const date = s.date ? new Date(s.date).toISOString().slice(0, 10) : '';
      const memo = `Settlement #${s.settlement_number}`;

      // Revenue line (credit)
      rows.push([date, s.settlement_number, buyer.buyer, s.contract_number, s.commodity, '', 'Grain Revenue', '', s.gross.toFixed(2), memo]);

      // Deduction lines (debit = reduce revenue, so if amount is negative it's a debit reducing the payment)
      for (const d of s.deductions) {
        if (d.amount === 0) continue;
        const account = CATEGORY_QBO_ACCOUNTS[d.category] || 'Other Grain Adjustments';
        if (d.amount < 0) {
          rows.push([date, s.settlement_number, buyer.buyer, s.contract_number, s.commodity, '', account, Math.abs(d.amount).toFixed(2), '', `${memo} — ${d.name}`]);
        } else {
          rows.push([date, s.settlement_number, buyer.buyer, s.contract_number, s.commodity, '', account, '', d.amount.toFixed(2), `${memo} — ${d.name}`]);
        }
        // GST line if applicable
        if (d.gst && d.gst !== 0) {
          rows.push([date, s.settlement_number, buyer.buyer, s.contract_number, s.commodity, '', 'GST Paid on Purchases', Math.abs(d.gst).toFixed(2), '', `${memo} — GST on ${d.name}`]);
        }
      }

      // Cash/AR line (debit = money received)
      rows.push([date, s.settlement_number, buyer.buyer, s.contract_number, s.commodity, '', 'Accounts Receivable', s.net.toFixed(2), '', memo]);

      // Location breakdown lines (informational — for allocation)
      for (const loc of s.locations) {
        if (loc.name === 'Unmatched') continue;
        rows.push([date, s.settlement_number, buyer.buyer, s.contract_number, s.commodity, loc.name, 'Location Allocation', '', '', `${loc.ticket_count} tickets | ${loc.mt} MT | $${loc.amount.toFixed(2)}`]);
      }

      // Blank separator row
      rows.push([]);
    }
  }

  return rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}

/**
 * Generate Excel workbook for Enterprise Settlement Journal.
 */
export async function generateEnterpriseJournalExcel(farmId, fiscalYear) {
  const data = await getEnterpriseJournal(farmId, fiscalYear);
  const wb = new ExcelJS.Workbook();

  // --- Summary sheet ---
  const summary = wb.addWorksheet('Summary');
  summary.addRow(['Enterprise Settlement Journal']);
  summary.getRow(1).font = { bold: true, size: 14 };
  summary.addRow([`Period: ${data.period}`]);
  summary.addRow([`Generated: ${new Date().toISOString().slice(0, 10)}`]);
  summary.addRow([]);

  summary.addRow(['Total Gross Revenue', data.summary.total_gross]);
  summary.addRow(['Total Deductions', -data.summary.total_deductions]);
  summary.addRow(['Total Net Received', data.summary.total_net]);
  summary.addRow(['Settlements', data.summary.settlement_count]);
  summary.addRow(['Lines', data.summary.line_count]);
  summary.addRow([]);

  summary.addRow(['Deduction Category', 'Total', 'GST', 'QBO Account']);
  summary.getRow(summary.rowCount).font = { bold: true };
  for (const d of data.summary.deduction_categories) {
    summary.addRow([d.label, d.total, d.gst, d.qbo_account]);
  }

  summary.getColumn(2).numFmt = '$#,##0.00';
  summary.getColumn(3).numFmt = '$#,##0.00';
  summary.getColumn(1).width = 30;
  summary.getColumn(2).width = 16;
  summary.getColumn(4).width = 25;

  // --- By Buyer sheet ---
  const buyerSheet = wb.addWorksheet('By Buyer');
  buyerSheet.columns = [
    { header: 'Buyer', key: 'buyer', width: 22 },
    { header: 'Settlement #', key: 'settlement_number', width: 18 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Contract #', key: 'contract_number', width: 18 },
    { header: 'Commodity', key: 'commodity', width: 16 },
    { header: 'Gross', key: 'gross', width: 14 },
    { header: 'Deductions', key: 'deductions', width: 14 },
    { header: 'Net', key: 'net', width: 14 },
    { header: 'Lines', key: 'lines', width: 8 },
    { header: 'Locations', key: 'locations', width: 30 },
  ];
  buyerSheet.getRow(1).font = { bold: true };

  for (const buyer of data.by_buyer) {
    for (const s of buyer.settlements) {
      buyerSheet.addRow({
        buyer: buyer.buyer,
        settlement_number: s.settlement_number,
        date: s.date ? new Date(s.date).toISOString().slice(0, 10) : '',
        contract_number: s.contract_number,
        commodity: s.commodity,
        gross: s.gross,
        deductions: s.total_deductions,
        net: s.net,
        lines: s.line_count,
        locations: s.locations.filter(l => l.name !== 'Unmatched').map(l => `${l.name}: ${l.mt} MT`).join(', '),
      });
    }
    // Buyer subtotal row
    const row = buyerSheet.addRow({
      buyer: `${buyer.buyer} TOTAL`,
      gross: buyer.subtotal_gross,
      deductions: round2(buyer.subtotal_gross - buyer.subtotal_net),
      net: buyer.subtotal_net,
      lines: buyer.subtotal_lines,
    });
    row.font = { bold: true };
    buyerSheet.addRow({});
  }

  buyerSheet.getColumn('gross').numFmt = '$#,##0.00';
  buyerSheet.getColumn('deductions').numFmt = '$#,##0.00';
  buyerSheet.getColumn('net').numFmt = '$#,##0.00';

  // --- QBO Journal sheet ---
  const qboSheet = wb.addWorksheet('QBO Journal');
  qboSheet.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Settlement #', key: 'settlement', width: 16 },
    { header: 'Buyer', key: 'buyer', width: 20 },
    { header: 'Contract #', key: 'contract', width: 16 },
    { header: 'Commodity', key: 'commodity', width: 14 },
    { header: 'Location', key: 'location', width: 16 },
    { header: 'Account', key: 'account', width: 25 },
    { header: 'Debit', key: 'debit', width: 14 },
    { header: 'Credit', key: 'credit', width: 14 },
    { header: 'Memo', key: 'memo', width: 30 },
  ];
  qboSheet.getRow(1).font = { bold: true };

  for (const buyer of data.by_buyer) {
    for (const s of buyer.settlements) {
      const date = s.date ? new Date(s.date).toISOString().slice(0, 10) : '';
      const memo = `Settlement #${s.settlement_number}`;

      qboSheet.addRow({ date, settlement: s.settlement_number, buyer: buyer.buyer, contract: s.contract_number, commodity: s.commodity, account: 'Grain Revenue', credit: s.gross, memo });

      for (const d of s.deductions) {
        if (d.amount === 0) continue;
        const account = CATEGORY_QBO_ACCOUNTS[d.category] || 'Other Grain Adjustments';
        if (d.amount < 0) {
          qboSheet.addRow({ date, settlement: s.settlement_number, buyer: buyer.buyer, contract: s.contract_number, commodity: s.commodity, account, debit: Math.abs(d.amount), memo: `${d.name}` });
        } else {
          qboSheet.addRow({ date, settlement: s.settlement_number, buyer: buyer.buyer, contract: s.contract_number, commodity: s.commodity, account, credit: d.amount, memo: `${d.name}` });
        }
        if (d.gst && d.gst !== 0) {
          qboSheet.addRow({ date, settlement: s.settlement_number, buyer: buyer.buyer, account: 'GST Paid on Purchases', debit: Math.abs(d.gst), memo: `GST on ${d.name}` });
        }
      }

      qboSheet.addRow({ date, settlement: s.settlement_number, buyer: buyer.buyer, contract: s.contract_number, commodity: s.commodity, account: 'Accounts Receivable', debit: s.net, memo });
      qboSheet.addRow({});
    }
  }

  qboSheet.getColumn('debit').numFmt = '$#,##0.00';
  qboSheet.getColumn('credit').numFmt = '$#,##0.00';

  return wb;
}

/**
 * Generate PDF doc definition for pdfmake.
 */
export async function generateEnterpriseJournalPdf(farmId, fiscalYear) {
  const data = await getEnterpriseJournal(farmId, fiscalYear);

  const fmtD = (v) => v != null ? `$${Number(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
  const fmtN = (v) => v != null ? Number(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

  const content = [];

  // Title
  content.push({ text: 'Enterprise Settlement Journal', style: 'title' });
  content.push({ text: `Period: ${data.period}  |  Generated: ${new Date().toISOString().slice(0, 10)}`, style: 'subtitle', margin: [0, 0, 0, 10] });

  // Summary
  content.push({
    table: {
      widths: ['*', 'auto'],
      body: [
        [{ text: 'Total Gross Revenue', bold: true }, { text: fmtD(data.summary.total_gross), alignment: 'right' }],
        [{ text: 'Total Deductions', bold: true }, { text: fmtD(-data.summary.total_deductions), alignment: 'right', color: 'red' }],
        [{ text: 'Total Net Received', bold: true }, { text: fmtD(data.summary.total_net), alignment: 'right', bold: true }],
        [{ text: 'Settlements / Lines', bold: true }, { text: `${data.summary.settlement_count} / ${data.summary.line_count}`, alignment: 'right' }],
      ],
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 10],
  });

  // Deduction breakdown
  if (data.summary.deduction_categories.length > 0) {
    content.push({ text: 'Deduction Breakdown', style: 'sectionHeader' });
    const dedBody = [[
      { text: 'Category', bold: true },
      { text: 'Total', bold: true, alignment: 'right' },
      { text: 'GST', bold: true, alignment: 'right' },
    ]];
    for (const d of data.summary.deduction_categories) {
      dedBody.push([d.label, { text: fmtD(d.total), alignment: 'right' }, { text: d.gst ? fmtD(d.gst) : '—', alignment: 'right' }]);
    }
    content.push({ table: { widths: ['*', 80, 60], body: dedBody }, layout: 'lightHorizontalLines', margin: [0, 0, 0, 15] });
  }

  // By buyer
  for (const buyer of data.by_buyer) {
    content.push({ text: buyer.buyer, style: 'buyerHeader' });
    content.push({ text: `${buyer.settlements.length} settlement(s)  |  Gross: ${fmtD(buyer.subtotal_gross)}  |  Net: ${fmtD(buyer.subtotal_net)}`, style: 'buyerSubtotal', margin: [0, 0, 0, 5] });

    const body = [[
      { text: 'Settlement #', bold: true },
      { text: 'Date', bold: true },
      { text: 'Contract', bold: true },
      { text: 'Commodity', bold: true },
      { text: 'Gross', bold: true, alignment: 'right' },
      { text: 'Deductions', bold: true, alignment: 'right' },
      { text: 'Net', bold: true, alignment: 'right' },
      { text: 'Locations', bold: true },
    ]];

    for (const s of buyer.settlements) {
      const locStr = s.locations.filter(l => l.name !== 'Unmatched').map(l => `${l.name}: ${fmtN(l.mt)} MT`).join('\n');
      body.push([
        s.settlement_number,
        s.date ? new Date(s.date).toISOString().slice(0, 10) : '—',
        s.contract_number || '—',
        s.commodity || '—',
        { text: fmtD(s.gross), alignment: 'right' },
        { text: fmtD(s.total_deductions), alignment: 'right', color: s.total_deductions < 0 ? 'red' : undefined },
        { text: fmtD(s.net), alignment: 'right', bold: true },
        { text: locStr, fontSize: 7 },
      ]);

      // Deduction detail rows
      if (s.deductions.length > 0) {
        for (const d of s.deductions) {
          if (d.amount === 0) continue;
          body.push([
            '',
            '',
            { text: `  ${d.name}`, fontSize: 7, colSpan: 3, color: '#666' }, {}, {},
            { text: fmtD(d.amount), alignment: 'right', fontSize: 7, color: d.amount < 0 ? 'red' : 'green' },
            '',
            '',
          ]);
        }
      }
    }

    content.push({
      table: { widths: [80, 55, 65, 55, 60, 60, 60, '*'], body },
      layout: 'lightHorizontalLines',
      fontSize: 8,
      margin: [0, 0, 0, 15],
    });
  }

  return {
    pageSize: 'LETTER',
    pageOrientation: 'landscape',
    pageMargins: [30, 30, 30, 30],
    content,
    styles: {
      title: { fontSize: 16, bold: true },
      subtitle: { fontSize: 9, color: '#666' },
      sectionHeader: { fontSize: 11, bold: true, margin: [0, 5, 0, 3] },
      buyerHeader: { fontSize: 12, bold: true, margin: [0, 10, 0, 2], color: '#1565c0' },
      buyerSubtotal: { fontSize: 8, color: '#666' },
    },
    defaultStyle: { fontSize: 8 },
  };
}
