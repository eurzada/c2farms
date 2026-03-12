import ExcelJS from 'exceljs';
import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';
import { fiscalToCalendar } from '../utils/fiscalYear.js';

const log = createLogger('recon-gap-report');

// Build a date range for fiscal year (Nov-Oct) with optional single-month filter
function buildDateRange(fiscalYear, month) {
  if (fiscalYear && month) {
    // Single month: first day to last day of that month
    const start = fiscalToCalendar(fiscalYear, month);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return { gte: start, lt: end };
  }
  if (fiscalYear) {
    // Full fiscal year: Nov of prior year through Oct of fiscal year
    const start = fiscalToCalendar(fiscalYear, 'Nov'); // Nov of FY-1
    const end = new Date(fiscalYear, 10, 1); // Nov 1 of FY (exclusive)
    return { gte: start, lt: end };
  }
  return null;
}

function fmtMT(v) {
  return v != null ? Math.round(v * 100) / 100 : null;
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-CA');
}

function fmtDollar(v) {
  if (v == null) return '';
  return `$${Number(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Section 1: Tickets not matched to any settlement
// Cross-reference with settlements that share the same contract number
async function getShippedNoSettlement(farmId, dateRange) {
  const where = {
    farm_id: farmId,
    settlement_lines: { none: {} },
  };
  if (dateRange) where.delivery_date = dateRange;
  const tickets = await prisma.deliveryTicket.findMany({
    where,
    include: {
      commodity: { select: { name: true, code: true } },
    },
    orderBy: { contract_number: 'asc' },
  });

  // Find settlements that reference the same contract numbers (for cross-reference)
  const allSettlements = await prisma.settlement.findMany({
    where: { farm_id: farmId },
    select: { settlement_number: true, extraction_json: true, marketing_contract: { select: { contract_number: true } } },
  });
  const settlementsByContract = new Map();
  for (const s of allSettlements) {
    const cn = s.marketing_contract?.contract_number || s.extraction_json?.contract_number;
    if (!cn) continue;
    const key = String(cn).trim();
    if (!settlementsByContract.has(key)) settlementsByContract.set(key, []);
    settlementsByContract.get(key).push(s.settlement_number);
  }

  const groups = new Map();
  for (const t of tickets) {
    const key = t.contract_number || '__no_contract__';
    if (!groups.has(key)) {
      const relatedSettlements = t.contract_number ? settlementsByContract.get(t.contract_number) || [] : [];
      groups.set(key, {
        contract_number: t.contract_number || null,
        buyer_name: t.buyer_name || 'Unknown',
        commodity: t.commodity?.name || 'Unknown',
        ticket_count: 0,
        total_mt: 0,
        related_settlements: [...new Set(relatedSettlements)],
      });
    }
    const g = groups.get(key);
    g.ticket_count++;
    g.total_mt += t.net_weight_mt || 0;
  }

  const rows = Array.from(groups.values())
    .map(g => ({ ...g, total_mt: fmtMT(g.total_mt) }))
    .sort((a, b) => (a.contract_number || '').localeCompare(b.contract_number || ''));

  return rows;
}

// Section 2: Settlements referencing contracts not in MarketingContract
async function getSettledNoContract(farmId, dateRange) {
  const where = { farm_id: farmId, marketing_contract_id: null };
  if (dateRange) where.settlement_date = dateRange;
  const settlements = await prisma.settlement.findMany({
    where,
    include: {
      counterparty: { select: { name: true } },
    },
  });

  const groups = new Map();
  for (const s of settlements) {
    const contractNum = s.extraction_json?.contract_number;
    if (!contractNum) continue;
    const key = String(contractNum).trim();
    if (!groups.has(key)) {
      groups.set(key, {
        contract_number: key,
        buyer: s.counterparty?.name || s.extraction_json?.buyer || 'Unknown',
        commodity: s.extraction_json?.commodity || 'Unknown',
        settlement_count: 0,
        total_amount: 0,
      });
    }
    const g = groups.get(key);
    g.settlement_count++;
    g.total_amount += s.total_amount || 0;
  }

  return Array.from(groups.values())
    .map(g => ({ ...g, total_amount: fmtMT(g.total_amount) }))
    .sort((a, b) => a.contract_number.localeCompare(b.contract_number));
}

// Section 3: Settlement lines with ticket numbers that don't exist
async function getMissingTicketLines(farmId, dateRange) {
  const settlementWhere = { farm_id: farmId };
  if (dateRange) settlementWhere.settlement_date = dateRange;
  const lines = await prisma.settlementLine.findMany({
    where: {
      match_status: 'exception',
      exception_reason: { contains: 'ticket_not_found' },
      settlement: settlementWhere,
    },
    include: {
      settlement: {
        include: {
          counterparty: { select: { name: true } },
          marketing_contract: { select: { contract_number: true } },
        },
      },
    },
    orderBy: [{ settlement_id: 'asc' }, { line_number: 'asc' }],
  });

  return lines.map(l => ({
    settlement_number: l.settlement.settlement_number,
    contract_number: l.settlement.marketing_contract?.contract_number || l.settlement.extraction_json?.contract_number || '',
    buyer: l.settlement.counterparty?.name || 'Unknown',
    ticket_number_on_settlement: l.ticket_number_on_settlement || '',
    net_weight_mt: fmtMT(l.net_weight_mt),
    delivery_date: fmtDate(l.delivery_date),
  }));
}

// Section 4: Tickets with no contract reference and not settled
async function getShippedNoContractRef(farmId, dateRange) {
  const where = {
    farm_id: farmId,
    OR: [{ contract_number: null }, { contract_number: '' }],
    settlement_lines: { none: {} },
  };
  if (dateRange) where.delivery_date = dateRange;
  const tickets = await prisma.deliveryTicket.findMany({
    where,
    include: {
      commodity: { select: { name: true } },
    },
  });

  const groups = new Map();
  for (const t of tickets) {
    const key = t.buyer_name || 'Unknown';
    if (!groups.has(key)) {
      groups.set(key, {
        buyer_name: key,
        commodity: t.commodity?.name || 'Unknown',
        ticket_count: 0,
        total_mt: 0,
      });
    }
    const g = groups.get(key);
    g.ticket_count++;
    g.total_mt += t.net_weight_mt || 0;
  }

  return Array.from(groups.values())
    .map(g => ({ ...g, total_mt: fmtMT(g.total_mt) }))
    .sort((a, b) => a.buyer_name.localeCompare(b.buyer_name));
}

// Section 5: Contracts with no tickets and no settlements
async function getContractsNoActivity(farmId, dateRange) {
  const where = {
    farm_id: farmId,
    delivery_tickets: { none: {} },
    settlements: { none: {} },
  };
  // For contracts, filter by delivery window overlapping the date range
  if (dateRange) {
    where.OR = [
      { delivery_start: dateRange },
      { delivery_end: dateRange },
      // Contract spans the range (starts before, ends after)
      { AND: [{ delivery_start: { lt: dateRange.gte } }, { delivery_end: { gte: dateRange.gte } }] },
    ];
  }
  const contracts = await prisma.marketingContract.findMany({
    where,
    include: {
      counterparty: { select: { name: true } },
      commodity: { select: { name: true } },
    },
    orderBy: { contract_number: 'asc' },
  });

  return contracts.map(c => {
    const now = new Date();
    const end = c.delivery_end ? new Date(c.delivery_end) : null;
    let urgency = '';
    if (end) {
      const daysLeft = Math.round((end - now) / (1000 * 60 * 60 * 24));
      if (daysLeft < 0) urgency = 'OVERDUE';
      else if (daysLeft <= 30) urgency = 'Due soon';
      else urgency = `${daysLeft} days`;
    }
    return {
      contract_number: c.contract_number,
      counterparty: c.counterparty?.name || 'Unknown',
      commodity: c.commodity?.name || 'Unknown',
      contracted_mt: fmtMT(c.contracted_mt),
      delivery_start: fmtDate(c.delivery_start),
      delivery_end: fmtDate(c.delivery_end),
      urgency,
      status: c.status,
    };
  });
}

export async function generateReconGapData(farmId, { fiscalYear, month } = {}) {
  const fy = fiscalYear ? parseInt(fiscalYear, 10) : null;
  const dateRange = buildDateRange(fy, month);
  log.info('Generating recon gap data', { farmId, fiscalYear: fy, month, hasDateRange: !!dateRange });

  const [shippedNoSettlement, settledNoContract, missingTicketLines, shippedNoContractRef, contractsNoActivity] =
    await Promise.all([
      getShippedNoSettlement(farmId, dateRange),
      getSettledNoContract(farmId, dateRange),
      getMissingTicketLines(farmId, dateRange),
      getShippedNoContractRef(farmId, dateRange),
      getContractsNoActivity(farmId, dateRange),
    ]);

  const summary = {
    shipped_no_settlement: shippedNoSettlement.length,
    settled_no_contract: settledNoContract.length,
    missing_ticket_lines: missingTicketLines.length,
    shipped_no_contract_ref: shippedNoContractRef.length,
    contracts_no_activity: contractsNoActivity.length,
  };

  return {
    generated_at: new Date().toISOString(),
    fiscal_year: fy || null,
    month: month || null,
    summary,
    sections: {
      shipped_no_settlement: shippedNoSettlement,
      settled_no_contract: settledNoContract,
      missing_ticket_lines: missingTicketLines,
      shipped_no_contract_ref: shippedNoContractRef,
      contracts_no_activity: contractsNoActivity,
    },
  };
}

// ─── Excel Export ────────────────────────────────────────────────────

export async function generateReconGapExcel(farmId, opts) {
  const data = await generateReconGapData(farmId, opts);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'C2 Farms';
  wb.created = new Date();

  const headerStyle = { font: { bold: true, size: 11 }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } } };
  const mtFormat = '#,##0.00';
  const dollarFormat = '$#,##0.00';

  function autoWidth(ws) {
    ws.columns.forEach(col => {
      let max = col.header?.length || 10;
      col.eachCell({ includeEmpty: false }, cell => {
        const len = String(cell.value ?? '').length;
        if (len > max) max = len;
      });
      col.width = Math.min(max + 2, 40);
    });
  }

  // Summary sheet
  const sumWs = wb.addWorksheet('Summary');
  sumWs.addRow(['Reconciliation Gap Report']);
  sumWs.getRow(1).font = { bold: true, size: 14 };
  const periodLabel = data.fiscal_year ? (data.month ? `FY${data.fiscal_year} — ${data.month}` : `FY${data.fiscal_year}`) : 'All Time';
  sumWs.addRow([`Period: ${periodLabel}`]);
  sumWs.addRow([`Generated: ${new Date().toLocaleString('en-CA')}`]);
  sumWs.addRow([]);
  sumWs.addRow(['Section', 'Count']);
  sumWs.getRow(4).eachCell(c => { Object.assign(c, headerStyle); });
  sumWs.addRow(['Shipped, No Settlement — Retrieve settlement from buyer portal or marketer', data.summary.shipped_no_settlement]);
  sumWs.addRow(['Settled, No Contract in System — Retrieve contract from SharePoint, marketer, or buyer', data.summary.settled_no_contract]);
  sumWs.addRow(['Settlement Lines, Missing Tickets — Retrieve tickets from Traction Ag or ticketing system', data.summary.missing_ticket_lines]);
  sumWs.addRow(['Shipped, No Contract Reference — Tickets missing contract # assignment', data.summary.shipped_no_contract_ref]);
  sumWs.addRow(['Contracts with No Activity — Verify delivery schedule, may need to start shipping', data.summary.contracts_no_activity]);
  autoWidth(sumWs);

  // Section 1
  const ws1 = wb.addWorksheet('Shipped No Settle');
  ws1.columns = [
    { header: 'Contract #', key: 'contract_number' },
    { header: 'Buyer', key: 'buyer_name' },
    { header: 'Commodity', key: 'commodity' },
    { header: 'Tickets', key: 'ticket_count' },
    { header: 'Total MT', key: 'total_mt' },
    { header: 'Related Settlement #s', key: 'related_settlements' },
  ];
  ws1.getRow(1).eachCell(c => { Object.assign(c, headerStyle); });
  for (const r of data.sections.shipped_no_settlement) {
    ws1.addRow({ ...r, related_settlements: r.related_settlements?.join(', ') || '' });
  }
  ws1.getColumn('total_mt').numFmt = mtFormat;
  autoWidth(ws1);

  // Section 2
  const ws2 = wb.addWorksheet('Settled No Contract');
  ws2.columns = [
    { header: 'Contract #', key: 'contract_number' },
    { header: 'Buyer', key: 'buyer' },
    { header: 'Commodity', key: 'commodity' },
    { header: 'Settlements', key: 'settlement_count' },
    { header: 'Total Amount', key: 'total_amount' },
  ];
  ws2.getRow(1).eachCell(c => { Object.assign(c, headerStyle); });
  for (const r of data.sections.settled_no_contract) {
    ws2.addRow(r);
  }
  ws2.getColumn('total_amount').numFmt = dollarFormat;
  autoWidth(ws2);

  // Section 3
  const ws3 = wb.addWorksheet('Missing Tickets');
  ws3.columns = [
    { header: 'Settlement #', key: 'settlement_number' },
    { header: 'Contract #', key: 'contract_number' },
    { header: 'Buyer', key: 'buyer' },
    { header: 'Ticket # on Settlement', key: 'ticket_number_on_settlement' },
    { header: 'Net MT', key: 'net_weight_mt' },
    { header: 'Delivery Date', key: 'delivery_date' },
  ];
  ws3.getRow(1).eachCell(c => { Object.assign(c, headerStyle); });
  for (const r of data.sections.missing_ticket_lines) {
    ws3.addRow(r);
  }
  ws3.getColumn('net_weight_mt').numFmt = mtFormat;
  autoWidth(ws3);

  // Section 4
  const ws4 = wb.addWorksheet('No Contract Ref');
  ws4.columns = [
    { header: 'Buyer', key: 'buyer_name' },
    { header: 'Commodity', key: 'commodity' },
    { header: 'Tickets', key: 'ticket_count' },
    { header: 'Total MT', key: 'total_mt' },
  ];
  ws4.getRow(1).eachCell(c => { Object.assign(c, headerStyle); });
  for (const r of data.sections.shipped_no_contract_ref) {
    ws4.addRow(r);
  }
  ws4.getColumn('total_mt').numFmt = mtFormat;
  autoWidth(ws4);

  // Section 5
  const ws5 = wb.addWorksheet('No Activity');
  ws5.columns = [
    { header: 'Contract #', key: 'contract_number' },
    { header: 'Counterparty', key: 'counterparty' },
    { header: 'Commodity', key: 'commodity' },
    { header: 'Contracted MT', key: 'contracted_mt' },
    { header: 'Delivery Start', key: 'delivery_start' },
    { header: 'Delivery End', key: 'delivery_end' },
    { header: 'Urgency', key: 'urgency' },
    { header: 'Status', key: 'status' },
  ];
  ws5.getRow(1).eachCell(c => { Object.assign(c, headerStyle); });
  for (const r of data.sections.contracts_no_activity) {
    ws5.addRow(r);
  }
  ws5.getColumn('contracted_mt').numFmt = mtFormat;
  autoWidth(ws5);

  log.info('Excel workbook generated');
  return wb;
}

// ─── PDF Export ──────────────────────────────────────────────────────

export async function generateReconGapPdf(farmId, opts) {
  const data = await generateReconGapData(farmId, opts);

  function sectionTable(title, headers, rows) {
    if (rows.length === 0) {
      return [
        { text: title, style: 'sectionHeader', margin: [0, 15, 0, 5] },
        { text: 'No items.', italics: true, color: '#888', margin: [0, 0, 0, 10] },
      ];
    }
    const widths = headers.map(() => '*');
    return [
      { text: title, style: 'sectionHeader', margin: [0, 15, 0, 5] },
      {
        table: {
          headerRows: 1,
          widths,
          body: [
            headers.map(h => ({ text: h, style: 'tableHeader' })),
            ...rows,
          ],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 10],
      },
    ];
  }

  const content = [
    { text: 'Reconciliation Gap Report', style: 'title' },
    { text: `Period: ${data.fiscal_year ? (data.month ? `FY${data.fiscal_year} — ${data.month}` : `FY${data.fiscal_year}`) : 'All Time'}`, style: 'subtitle' },
    { text: `Generated: ${new Date().toLocaleString('en-CA')}`, style: 'subtitle', margin: [0, 0, 0, 15] },

    // Summary
    {
      table: {
        headerRows: 1,
        widths: ['*', 'auto'],
        body: [
          [{ text: 'Section', style: 'tableHeader' }, { text: 'Count', style: 'tableHeader' }],
          ['Shipped, No Settlement — Retrieve from buyer/marketer', String(data.summary.shipped_no_settlement)],
          ['Settled, No Contract — Retrieve from SharePoint/marketer/buyer', String(data.summary.settled_no_contract)],
          ['Missing Tickets — Retrieve from ticketing system', String(data.summary.missing_ticket_lines)],
          ['No Contract Reference — Assign contract # to tickets', String(data.summary.shipped_no_contract_ref)],
          ['No Activity — Verify delivery schedule', String(data.summary.contracts_no_activity)],
        ],
      },
      layout: 'lightHorizontalLines',
    },

    // Section 1
    ...sectionTable(
      '1. Shipped, No Settlement — Retrieve settlement from buyer portal or marketer',
      ['Contract #', 'Buyer', 'Commodity', 'Tickets', 'Total MT', 'Related Settlement #s'],
      data.sections.shipped_no_settlement.map(r => [
        r.contract_number || '(none)', r.buyer_name, r.commodity, String(r.ticket_count), String(r.total_mt),
        r.related_settlements?.join(', ') || '',
      ]),
    ),

    // Section 2
    ...sectionTable(
      '2. Settled, No Contract in System — Retrieve contract from SharePoint, marketer, or buyer portal',
      ['Contract #', 'Buyer', 'Commodity', 'Settlements', 'Total Amount'],
      data.sections.settled_no_contract.map(r => [
        r.contract_number, r.buyer, r.commodity, String(r.settlement_count), fmtDollar(r.total_amount),
      ]),
    ),

    // Section 3
    ...sectionTable(
      '3. Settlement Lines, Missing Tickets — Retrieve tickets from Traction Ag or ticketing system',
      ['Settlement #', 'Contract #', 'Buyer', 'Ticket #', 'Net MT', 'Date'],
      data.sections.missing_ticket_lines.map(r => [
        r.settlement_number, r.contract_number, r.buyer, r.ticket_number_on_settlement, String(r.net_weight_mt ?? ''), r.delivery_date,
      ]),
    ),

    // Section 4
    ...sectionTable(
      '4. Shipped, No Contract Reference — Assign contract # to these tickets',
      ['Buyer', 'Commodity', 'Tickets', 'Total MT'],
      data.sections.shipped_no_contract_ref.map(r => [
        r.buyer_name, r.commodity, String(r.ticket_count), String(r.total_mt),
      ]),
    ),

    // Section 5
    ...sectionTable(
      '5. Contracts with No Activity — Verify delivery schedule, begin shipping or confirm future-dated',
      ['Contract #', 'Counterparty', 'Commodity', 'Contracted MT', 'Delivery Start', 'Delivery End', 'Urgency', 'Status'],
      data.sections.contracts_no_activity.map(r => [
        r.contract_number, r.counterparty, r.commodity, String(r.contracted_mt),
        r.delivery_start, r.delivery_end, r.urgency, r.status,
      ]),
    ),
  ];

  return {
    pageSize: 'LETTER',
    pageOrientation: 'landscape',
    pageMargins: [40, 40, 40, 40],
    content,
    styles: {
      title: { fontSize: 16, bold: true },
      subtitle: { fontSize: 10, color: '#666' },
      sectionHeader: { fontSize: 12, bold: true },
      tableHeader: { bold: true, fontSize: 9, fillColor: '#e8e8e8' },
    },
    defaultStyle: { fontSize: 9 },
  };
}

// ─── CSV Export (flat format) ────────────────────────────────────────

export async function generateReconGapCsv(farmId, opts) {
  const data = await generateReconGapData(farmId, opts);
  const rows = [['Section', 'Action Required', 'Contract #', 'Buyer', 'Commodity', 'Count', 'Total MT/Amount', 'Related Settlements', 'Delivery Start', 'Delivery End', 'Urgency', 'Status']];

  for (const r of data.sections.shipped_no_settlement) {
    rows.push(['Shipped No Settlement', 'Retrieve settlement from buyer portal or marketer', r.contract_number || '', r.buyer_name, r.commodity, String(r.ticket_count), String(r.total_mt), r.related_settlements?.join(', ') || '', '', '', '', '']);
  }
  for (const r of data.sections.settled_no_contract) {
    rows.push(['Settled No Contract', 'Retrieve contract from SharePoint/marketer/buyer', r.contract_number, r.buyer, r.commodity, String(r.settlement_count), fmtDollar(r.total_amount), '', '', '', '', '']);
  }
  for (const r of data.sections.missing_ticket_lines) {
    rows.push(['Missing Tickets', 'Retrieve ticket from Traction Ag or ticketing system', r.contract_number, r.buyer, '', r.ticket_number_on_settlement, String(r.net_weight_mt ?? ''), r.settlement_number, '', '', '', r.delivery_date]);
  }
  for (const r of data.sections.shipped_no_contract_ref) {
    rows.push(['No Contract Reference', 'Assign contract # to tickets', '', r.buyer_name, r.commodity, String(r.ticket_count), String(r.total_mt), '', '', '', '', '']);
  }
  for (const r of data.sections.contracts_no_activity) {
    rows.push(['No Activity', 'Verify delivery schedule, begin shipping', r.contract_number, r.counterparty, r.commodity, '', String(r.contracted_mt), '', r.delivery_start, r.delivery_end, r.urgency, r.status]);
  }

  return rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
}
