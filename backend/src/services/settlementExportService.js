import ExcelJS from 'exceljs';
import prisma from '../config/database.js';

/**
 * Fetch settlement with all data needed for reporting.
 */
async function fetchSettlementForExport(settlementId, farmId) {
  const settlement = await prisma.settlement.findFirst({
    where: { id: settlementId, farm_id: farmId },
    include: {
      counterparty: true,
      marketing_contract: {
        include: { commodity: true, counterparty: true },
      },
      lines: {
        include: {
          delivery_ticket: {
            include: {
              commodity: { select: { name: true } },
              location: { select: { name: true } },
              marketing_contract: { select: { contract_number: true } },
            },
          },
        },
        orderBy: { line_number: 'asc' },
      },
    },
  });
  if (!settlement) throw new Error('Settlement not found');
  return settlement;
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-CA'); // YYYY-MM-DD
}

function fmtMT(v) {
  return v != null ? Math.round(v * 100) / 100 : null;
}

function parseExceptionType(reason) {
  if (!reason) return 'Unknown';
  const lower = reason.toLowerCase();
  if (lower.includes('missing_ticket') || lower.includes('no_matching_ticket')) return 'Missing Ticket';
  if (lower.includes('date_mismatch') || lower.includes('date')) return 'Date Mismatch';
  if (lower.includes('weight_mismatch') || lower.includes('weight_diff')) return 'Weight Discrepancy';
  if (lower.includes('commodity_mismatch') || lower.includes('commodity')) return 'Commodity Mismatch';
  if (lower.includes('low_confidence') || lower.includes('contract_mismatch')) return 'Low Confidence';
  if (lower.includes('dismissed')) return 'Dismissed';
  if (lower.includes('manual')) return 'Manual Match';
  return 'Exception';
}

function buildActionItem(line, exType) {
  const ticket = line.delivery_ticket;
  switch (exType) {
    case 'Missing Ticket': {
      const date = fmtDate(line.delivery_date);
      const parts = [`No matching delivery ticket found in system.`];
      if (line.ticket_number_on_settlement) parts.push(`Buyer ticket #: ${line.ticket_number_on_settlement}`);
      if (date) parts.push(`Delivery date on settlement: ${date}`);
      if (line.net_weight_mt) parts.push(`Net weight: ${fmtMT(line.net_weight_mt)} MT`);
      if (line.commodity) parts.push(`Grade/commodity: ${line.commodity}`);
      parts.push('Action: Confirm with trucker or buyer that this load was delivered and obtain the original ticket.');
      return parts.join('\n');
    }
    case 'Date Mismatch': {
      const sDate = fmtDate(line.delivery_date);
      const tDate = ticket ? fmtDate(ticket.delivery_date) : '';
      const daysDiff = line.delivery_date && ticket?.delivery_date
        ? Math.abs(Math.round((new Date(line.delivery_date) - new Date(ticket.delivery_date)) / 86400000))
        : '?';
      return `Settlement date: ${sDate}, Ticket date: ${tDate} (${daysDiff} days apart).\nAction: Verify correct delivery date with buyer. May be a scale date vs. hauling date discrepancy.`;
    }
    case 'Weight Discrepancy': {
      const sWt = fmtMT(line.net_weight_mt);
      const tWt = ticket ? fmtMT(ticket.net_weight_mt) : null;
      const diff = sWt && tWt ? fmtMT(Math.abs(sWt - tWt)) : '?';
      return `Settlement net: ${sWt ?? '?'} MT, Ticket net: ${tWt ?? '?'} MT (diff: ${diff} MT).\nAction: Check for dockage adjustments, moisture deductions, or scale calibration differences.`;
    }
    case 'Commodity Mismatch':
      return `Settlement commodity/grade: "${line.commodity || '?'}", Ticket commodity: "${ticket?.commodity?.name || '?'}".\nAction: Verify the correct commodity classification. Grade designations may differ between buyer and Traction Ag.`;
    case 'Low Confidence':
      return `Match confidence below threshold. The system found a possible match but the data doesn't align well enough to auto-confirm.\nAction: Review the settlement line and ticket data side-by-side and manually confirm or reject.`;
    default:
      return line.exception_reason || 'Review and resolve this exception.';
  }
}

// ─── Excel Export (Full Reconciliation Report) ──────────────────────

export async function generateExceptionExcel(settlementId, farmId) {
  const settlement = await fetchSettlementForExport(settlementId, farmId);
  const exceptions = settlement.lines.filter(l => l.match_status === 'exception' || l.match_status === 'unmatched');
  const matched = settlement.lines.filter(l => l.match_status === 'matched' || l.match_status === 'manual');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'C2 Farms';
  workbook.created = new Date();

  // ── Summary sheet ──
  const summary = workbook.addWorksheet('Summary');
  summary.columns = [{ width: 25 }, { width: 45 }];

  const titleRow = summary.addRow(['Settlement Reconciliation Report', '']);
  titleRow.font = { bold: true, size: 14 };
  summary.mergeCells('A1:B1');
  summary.addRow([]);

  const fields = [
    ['Settlement #', settlement.settlement_number],
    ['Date', fmtDate(settlement.settlement_date)],
    ['Buyer', settlement.counterparty?.name || '—'],
    ['Contract #', settlement.marketing_contract?.contract_number || '—'],
    ['Commodity', settlement.marketing_contract?.commodity?.name || '—'],
    ['Total Amount', settlement.total_amount ? `$${settlement.total_amount.toLocaleString()}` : '—'],
    ['Status', settlement.status.toUpperCase()],
    ['Total Lines', settlement.lines.length],
    ['Matched Lines', matched.length],
    ['Exception Lines', exceptions.length],
    ['Report Generated', new Date().toLocaleString()],
  ];
  for (const [label, value] of fields) {
    const row = summary.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }

  // Add approval report data if available
  if (settlement.reconciliation_report) {
    const rpt = settlement.reconciliation_report;
    summary.addRow([]);
    const approvalHeader = summary.addRow(['Approval Report', '']);
    approvalHeader.font = { bold: true, size: 12 };
    summary.addRow(['Approved At', rpt.approved_at ? new Date(rpt.approved_at).toLocaleString() : '—']);
    summary.addRow(['Deliveries Created', rpt.deliveries_created || 0]);
    summary.addRow(['Cash Flow Total', rpt.cash_flow_total ? `$${rpt.cash_flow_total.toLocaleString()}` : '—']);
    if (rpt.contracts_updated?.length > 0) {
      for (const c of rpt.contracts_updated) {
        summary.addRow([`Contract ${c.contract_number}`, `Delivered: ${c.delivered_mt} MT | Remaining: ${c.remaining_mt} MT | Status: ${c.previous_status} → ${c.new_status}`]);
      }
    }
  }

  // ── Matched Lines sheet ──
  const matchedSheet = workbook.addWorksheet('Matched Lines');
  const matchedHeaderFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };

  matchedSheet.columns = [
    { header: 'Line #', key: 'line_number', width: 8 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Buyer Ticket #', key: 'buyer_ticket', width: 15 },
    { header: 'Delivery Date', key: 'delivery_date', width: 14 },
    { header: 'Grade', key: 'grade', width: 12 },
    { header: 'Gross MT', key: 'gross_mt', width: 12 },
    { header: 'Net MT', key: 'net_mt', width: 12 },
    { header: '$/MT', key: 'price_per_mt', width: 12 },
    { header: 'Line Net $', key: 'line_net', width: 14 },
    { header: 'Matched Ticket #', key: 'matched_ticket_num', width: 16 },
    { header: 'Ticket Date', key: 'ticket_date', width: 14 },
    { header: 'Ticket Net MT', key: 'ticket_net_mt', width: 14 },
    { header: 'Ticket Location', key: 'ticket_location', width: 16 },
    { header: 'Ticket Operator', key: 'ticket_operator', width: 18 },
    { header: 'Contract #', key: 'contract_number', width: 16 },
    { header: 'Confidence', key: 'confidence', width: 12 },
  ];

  const mHeaderRow = matchedSheet.getRow(1);
  mHeaderRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = matchedHeaderFill;
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  mHeaderRow.height = 28;
  matchedSheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const line of matched) {
    const ticket = line.delivery_ticket;
    const row = matchedSheet.addRow({
      line_number: line.line_number,
      status: line.match_status === 'manual' ? 'Manual' : 'Matched',
      buyer_ticket: line.ticket_number_on_settlement || '',
      delivery_date: fmtDate(line.delivery_date),
      grade: line.grade || line.commodity || '',
      gross_mt: fmtMT(line.gross_weight_mt),
      net_mt: fmtMT(line.net_weight_mt),
      price_per_mt: line.price_per_mt,
      line_net: line.line_net,
      matched_ticket_num: ticket?.ticket_number || '',
      ticket_date: ticket ? fmtDate(ticket.delivery_date) : '',
      ticket_net_mt: ticket ? fmtMT(ticket.net_weight_mt) : null,
      ticket_location: ticket?.location?.name || '',
      ticket_operator: ticket?.operator_name || '',
      contract_number: ticket?.marketing_contract?.contract_number || '',
      confidence: line.match_confidence != null ? `${(line.match_confidence * 100).toFixed(0)}%` : '',
    });
    if (line.price_per_mt) row.getCell('price_per_mt').numFmt = '#,##0.00';
    if (line.line_net) row.getCell('line_net').numFmt = '#,##0.00';
    row.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: line.match_status === 'manual' ? 'FFE3F2FD' : 'FFE8F5E9' } };
    });
  }

  // Add totals row for matched
  if (matched.length > 0) {
    const totalGross = matched.reduce((s, l) => s + (l.gross_weight_mt || 0), 0);
    const totalNet = matched.reduce((s, l) => s + (l.net_weight_mt || 0), 0);
    const totalValue = matched.reduce((s, l) => s + (l.line_net || 0), 0);
    const totRow = matchedSheet.addRow({
      line_number: '', status: 'TOTAL', buyer_ticket: '', delivery_date: '', grade: '',
      gross_mt: fmtMT(totalGross), net_mt: fmtMT(totalNet),
      price_per_mt: null, line_net: totalValue,
    });
    totRow.font = { bold: true };
    if (totalValue) totRow.getCell('line_net').numFmt = '#,##0.00';
  }

  // ── Exceptions sheet ──
  if (exceptions.length > 0) {
    const exSheet = workbook.addWorksheet('Exceptions');
    const exHeaderFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC62828' } };

    exSheet.columns = [
      { header: 'Line #', key: 'line_number', width: 8 },
      { header: 'Exception Type', key: 'exception_type', width: 18 },
      { header: 'Buyer Ticket #', key: 'buyer_ticket', width: 15 },
      { header: 'Delivery Date', key: 'delivery_date', width: 14 },
      { header: 'Grade', key: 'grade', width: 12 },
      { header: 'Gross MT', key: 'gross_mt', width: 12 },
      { header: 'Net MT', key: 'net_mt', width: 12 },
      { header: '$/MT', key: 'price_per_mt', width: 12 },
      { header: 'Line Net $', key: 'line_net', width: 14 },
      { header: 'Closest Ticket #', key: 'matched_ticket_num', width: 16 },
      { header: 'Ticket Date', key: 'ticket_date', width: 14 },
      { header: 'Ticket Net MT', key: 'ticket_net_mt', width: 14 },
      { header: 'Ticket Location', key: 'ticket_location', width: 16 },
      { header: 'Ticket Operator', key: 'ticket_operator', width: 18 },
      { header: 'Confidence', key: 'confidence', width: 12 },
      { header: 'Action Required', key: 'action', width: 55 },
    ];

    const eHeaderRow = exSheet.getRow(1);
    eHeaderRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = exHeaderFill;
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    eHeaderRow.height = 28;
    exSheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const line of exceptions) {
      const exType = parseExceptionType(line.exception_reason);
      const ticket = line.delivery_ticket;
      const action = buildActionItem(line, exType);

      const row = exSheet.addRow({
        line_number: line.line_number,
        exception_type: exType,
        buyer_ticket: line.ticket_number_on_settlement || '',
        delivery_date: fmtDate(line.delivery_date),
        grade: line.grade || line.commodity || '',
        gross_mt: fmtMT(line.gross_weight_mt),
        net_mt: fmtMT(line.net_weight_mt),
        price_per_mt: line.price_per_mt,
        line_net: line.line_net,
        matched_ticket_num: ticket?.ticket_number || '',
        ticket_date: ticket ? fmtDate(ticket.delivery_date) : '',
        ticket_net_mt: ticket ? fmtMT(ticket.net_weight_mt) : null,
        ticket_location: ticket?.location?.name || '',
        ticket_operator: ticket?.operator_name || '',
        confidence: line.match_confidence != null ? `${(line.match_confidence * 100).toFixed(0)}%` : '',
        action: action,
      });
      if (line.price_per_mt) row.getCell('price_per_mt').numFmt = '#,##0.00';
      if (line.line_net) row.getCell('line_net').numFmt = '#,##0.00';
      row.getCell('action').alignment = { wrapText: true, vertical: 'top' };
      row.height = Math.max(30, action.split('\n').length * 15);
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } };
      });
    }
  }

  // ── All Lines sheet (combined view) ──
  const allSheet = workbook.addWorksheet('All Lines');

  allSheet.columns = [
    { header: 'Line #', key: 'line_number', width: 8 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Buyer Ticket #', key: 'buyer_ticket', width: 15 },
    { header: 'Delivery Date', key: 'delivery_date', width: 14 },
    { header: 'Grade', key: 'grade', width: 12 },
    { header: 'Gross MT', key: 'gross_mt', width: 12 },
    { header: 'Net MT', key: 'net_mt', width: 12 },
    { header: '$/MT', key: 'price_per_mt', width: 12 },
    { header: 'Line Net $', key: 'line_net', width: 14 },
    { header: 'Matched Ticket #', key: 'matched_ticket_num', width: 16 },
    { header: 'Ticket Date', key: 'ticket_date', width: 14 },
    { header: 'Ticket Net MT', key: 'ticket_net_mt', width: 14 },
    { header: 'Ticket Location', key: 'ticket_location', width: 16 },
    { header: 'Confidence', key: 'confidence', width: 12 },
    { header: 'Notes', key: 'notes', width: 30 },
  ];

  const allHeaderRow = allSheet.getRow(1);
  allHeaderRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
  });
  allSheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const line of settlement.lines) {
    const ticket = line.delivery_ticket;
    const row = allSheet.addRow({
      line_number: line.line_number,
      status: line.match_status,
      buyer_ticket: line.ticket_number_on_settlement || '',
      delivery_date: fmtDate(line.delivery_date),
      grade: line.grade || line.commodity || '',
      gross_mt: fmtMT(line.gross_weight_mt),
      net_mt: fmtMT(line.net_weight_mt),
      price_per_mt: line.price_per_mt,
      line_net: line.line_net,
      matched_ticket_num: ticket?.ticket_number || '',
      ticket_date: ticket ? fmtDate(ticket.delivery_date) : '',
      ticket_net_mt: ticket ? fmtMT(ticket.net_weight_mt) : null,
      ticket_location: ticket?.location?.name || '',
      confidence: line.match_confidence != null ? `${(line.match_confidence * 100).toFixed(0)}%` : '',
      notes: line.exception_reason || '',
    });

    if (line.price_per_mt) row.getCell('price_per_mt').numFmt = '#,##0.00';
    if (line.line_net) row.getCell('line_net').numFmt = '#,##0.00';

    const statusColors = {
      matched: 'FFE8F5E9', manual: 'FFE3F2FD',
      exception: 'FFFFEBEE', unmatched: 'FFFFF3E0',
    };
    const bg = statusColors[line.match_status];
    if (bg) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      });
    }
  }

  return workbook;
}

// ─── PDF Export (Full Reconciliation Report) ────────────────────────

export function generateExceptionPdf(settlement) {
  const exceptions = settlement.lines.filter(l => l.match_status === 'exception' || l.match_status === 'unmatched');
  const matchedLines = settlement.lines.filter(l => l.match_status === 'matched' || l.match_status === 'manual');

  const content = [];

  // Title
  content.push({ text: 'Settlement Reconciliation Report', style: 'header' });
  content.push({
    text: `Generated ${new Date().toLocaleDateString()} — C2 Farms`,
    style: 'subheader',
  });

  // Settlement info table
  content.push({
    margin: [0, 0, 0, 12],
    table: {
      widths: [100, 140, 100, 140],
      body: [
        [
          { text: 'Settlement #', bold: true }, settlement.settlement_number || '',
          { text: 'Date', bold: true }, fmtDate(settlement.settlement_date),
        ],
        [
          { text: 'Buyer', bold: true }, settlement.counterparty?.name || '—',
          { text: 'Contract #', bold: true }, settlement.marketing_contract?.contract_number || '—',
        ],
        [
          { text: 'Commodity', bold: true }, settlement.marketing_contract?.commodity?.name || '—',
          { text: 'Total Amount', bold: true },
          settlement.total_amount ? `$${settlement.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—',
        ],
        [
          { text: 'Matched', bold: true }, `${matchedLines.length} of ${settlement.lines.length} lines`,
          { text: 'Exceptions', bold: true, color: exceptions.length > 0 ? '#C62828' : '#2E7D32' },
          exceptions.length > 0 ? `${exceptions.length} lines need resolution` : 'None — all matched',
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0.5, vLineWidth: () => 0,
      hLineColor: () => '#CCCCCC',
      paddingLeft: () => 4, paddingRight: () => 4,
      paddingTop: () => 3, paddingBottom: () => 3,
    },
  });

  // ── Matched Lines Table ──
  if (matchedLines.length > 0) {
    content.push({
      text: `Matched Lines (${matchedLines.length})`,
      style: 'sectionHeaderGreen',
      margin: [0, 8, 0, 6],
    });

    const matchedTableBody = [
      [
        { text: '#', bold: true, fontSize: 7 },
        { text: 'Buyer Tkt #', bold: true, fontSize: 7 },
        { text: 'Date', bold: true, fontSize: 7 },
        { text: 'Net MT', bold: true, fontSize: 7, alignment: 'right' },
        { text: '$/MT', bold: true, fontSize: 7, alignment: 'right' },
        { text: 'Net $', bold: true, fontSize: 7, alignment: 'right' },
        { text: 'Matched Tkt', bold: true, fontSize: 7 },
        { text: 'Tkt Net MT', bold: true, fontSize: 7, alignment: 'right' },
        { text: 'Location', bold: true, fontSize: 7 },
        { text: 'Conf', bold: true, fontSize: 7 },
      ],
    ];

    for (const line of matchedLines) {
      const ticket = line.delivery_ticket;
      matchedTableBody.push([
        { text: String(line.line_number), fontSize: 7 },
        { text: line.ticket_number_on_settlement || '', fontSize: 7 },
        { text: fmtDate(line.delivery_date), fontSize: 7 },
        { text: fmtMT(line.net_weight_mt)?.toString() || '', fontSize: 7, alignment: 'right' },
        { text: line.price_per_mt ? `$${line.price_per_mt.toFixed(2)}` : '', fontSize: 7, alignment: 'right' },
        { text: line.line_net ? `$${line.line_net.toLocaleString()}` : '', fontSize: 7, alignment: 'right' },
        { text: ticket?.ticket_number || '', fontSize: 7 },
        { text: ticket ? (fmtMT(ticket.net_weight_mt)?.toString() || '') : '', fontSize: 7, alignment: 'right' },
        { text: ticket?.location?.name || '', fontSize: 7 },
        { text: line.match_confidence != null ? `${(line.match_confidence * 100).toFixed(0)}%` : '', fontSize: 7 },
      ]);
    }

    content.push({
      table: {
        headerRows: 1,
        widths: [20, 50, 50, 40, 40, 55, 50, 45, 55, 30],
        body: matchedTableBody,
      },
      layout: {
        hLineWidth: (i, node) => i === 0 || i === 1 || i === node.table.body.length ? 0.5 : 0.25,
        vLineWidth: () => 0,
        hLineColor: (i) => i === 1 ? '#2E7D32' : '#E0E0E0',
        paddingLeft: () => 3, paddingRight: () => 3,
        paddingTop: () => 2, paddingBottom: () => 2,
        fillColor: (i) => i === 0 ? '#E8F5E9' : null,
      },
    });
  }

  // ── Exception Details ──
  if (exceptions.length > 0) {
    content.push({
      text: `Exception Details — ${exceptions.length} line${exceptions.length !== 1 ? 's' : ''} need resolution`,
      style: 'sectionHeader',
      margin: [0, 12, 0, 8],
    });

    for (const line of exceptions) {
      const exType = parseExceptionType(line.exception_reason);
      const ticket = line.delivery_ticket;
      const action = buildActionItem(line, exType);

      // Exception header bar
      content.push({
        margin: [0, 6, 0, 0],
        table: {
          widths: ['*'],
          body: [[{
            text: `Line ${line.line_number} — ${exType}`,
            bold: true, color: '#FFFFFF', fontSize: 9,
          }]],
        },
        layout: {
          hLineWidth: () => 0, vLineWidth: () => 0,
          fillColor: () => '#C62828',
          paddingLeft: () => 6, paddingRight: () => 6,
          paddingTop: () => 4, paddingBottom: () => 4,
        },
      });

      // Two-column: Settlement data | Ticket data
      const leftCol = [
        { text: 'Settlement Line', bold: true, fontSize: 8, margin: [0, 0, 0, 2] },
        `Buyer Ticket #: ${line.ticket_number_on_settlement || 'N/A'}`,
        `Date: ${fmtDate(line.delivery_date) || 'N/A'}`,
        `Grade: ${line.grade || line.commodity || 'N/A'}`,
        `Gross: ${fmtMT(line.gross_weight_mt) ?? '—'} MT`,
        `Net: ${fmtMT(line.net_weight_mt) ?? '—'} MT`,
        `Price: ${line.price_per_mt ? `$${line.price_per_mt.toFixed(2)}/MT` : '—'}`,
        `Line Value: ${line.line_net ? `$${line.line_net.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}`,
      ].map(t => typeof t === 'string' ? { text: t, fontSize: 8 } : { ...t });

      const rightCol = ticket ? [
        { text: 'Closest Ticket Match', bold: true, fontSize: 8, margin: [0, 0, 0, 2] },
        `Ticket #: ${ticket.ticket_number}`,
        `Date: ${fmtDate(ticket.delivery_date)}`,
        `Commodity: ${ticket.commodity?.name || '—'}`,
        `Net: ${fmtMT(ticket.net_weight_mt) ?? '—'} MT`,
        `Location: ${ticket.location?.name || '—'}`,
        `Operator: ${ticket.operator_name || '—'}`,
        `Confidence: ${line.match_confidence != null ? `${(line.match_confidence * 100).toFixed(0)}%` : '—'}`,
      ].map(t => typeof t === 'string' ? { text: t, fontSize: 8 } : { ...t }) : [
        { text: 'No Matching Ticket Found', bold: true, fontSize: 8, color: '#C62828' },
      ];

      content.push({
        margin: [0, 0, 0, 0],
        columns: [
          { width: '48%', stack: leftCol },
          { width: '4%', text: '' },
          { width: '48%', stack: rightCol },
        ],
      });

      // Action box
      content.push({
        margin: [0, 4, 0, 8],
        table: {
          widths: ['*'],
          body: [[{
            stack: [
              { text: 'Action Required:', bold: true, fontSize: 8 },
              { text: action, fontSize: 8 },
            ],
          }]],
        },
        layout: {
          hLineWidth: () => 0.5, vLineWidth: () => 0.5,
          hLineColor: () => '#E65100', vLineColor: () => '#E65100',
          paddingLeft: () => 6, paddingRight: () => 6,
          paddingTop: () => 4, paddingBottom: () => 4,
        },
      });
    }
  } else {
    content.push({
      text: 'All lines matched successfully. No exceptions to report.',
      style: 'note',
      margin: [0, 10, 0, 0],
    });
  }

  return buildDocDefinition(content);
}

function buildDocDefinition(content) {
  return {
    pageSize: 'LETTER',
    pageOrientation: 'landscape',
    pageMargins: [30, 30, 30, 30],
    content,
    styles: {
      header: { fontSize: 16, bold: true, margin: [0, 0, 0, 2] },
      subheader: { fontSize: 10, color: '#666666', margin: [0, 0, 0, 10] },
      sectionHeader: { fontSize: 12, bold: true, color: '#C62828' },
      sectionHeaderGreen: { fontSize: 12, bold: true, color: '#2E7D32' },
      note: { fontSize: 10, italics: true, color: '#666666' },
    },
    defaultStyle: { fontSize: 9 },
    footer: (currentPage, pageCount) => ({
      text: `Page ${currentPage} of ${pageCount} — C2 Farms Settlement Reconciliation Report`,
      alignment: 'center',
      fontSize: 8,
      color: '#999999',
      margin: [0, 10, 0, 0],
    }),
  };
}
