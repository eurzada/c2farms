import ExcelJS from 'exceljs';
import prisma from '../config/database.js';

// ─── Date filter helper (Nov–Oct fiscal year) ───

function fiscalYearDateFilter(fy) {
  const year = parseInt(fy);
  if (!year) return {};
  return {
    delivery_date: {
      gte: new Date(`${year - 1}-11-01T00:00:00Z`),
      lt: new Date(`${year}-11-01T00:00:00Z`),
    },
  };
}

// ─── Data fetcher (shared by all export formats) ───

async function getTicketData(farmId, filters = {}) {
  const { fiscal_year, settled, matched, buyer, commodity, counterparty_id, commodity_id } = filters;

  const where = { farm_id: farmId };

  if (fiscal_year) Object.assign(where, fiscalYearDateFilter(fiscal_year));
  if (settled !== undefined && settled !== '') where.settled = settled === 'true';
  if (matched === 'true') where.settlement_lines = { some: {} };
  if (matched === 'false') where.settlement_lines = { none: {} };
  if (counterparty_id) where.counterparty_id = counterparty_id;
  if (commodity_id) where.commodity_id = commodity_id;
  if (buyer) where.buyer_name = { contains: buyer, mode: 'insensitive' };
  if (commodity) where.commodity = { name: { contains: commodity, mode: 'insensitive' } };

  const tickets = await prisma.deliveryTicket.findMany({
    where,
    include: {
      marketing_contract: { select: { contract_number: true } },
      counterparty: { select: { name: true, short_code: true } },
      commodity: { select: { name: true, code: true } },
      location: { select: { name: true, code: true } },
      bin: { select: { bin_number: true } },
      settlement_lines: {
        select: {
          id: true,
          match_status: true,
          settlement: { select: { id: true, settlement_number: true, status: true } },
        },
        take: 1,
      },
    },
    orderBy: { delivery_date: 'desc' },
  });

  const rows = tickets.map(t => {
    const sl = t.settlement_lines?.[0];
    return {
      ticket_number: t.ticket_number || '',
      delivery_date: t.delivery_date ? new Date(t.delivery_date).toISOString().split('T')[0] : '',
      crop_year: t.crop_year ?? '',
      commodity: t.commodity?.name || '',
      gross_weight_mt: t.gross_weight_kg != null ? Math.round(t.gross_weight_kg / 1000 * 1000) / 1000 : '',
      tare_weight_mt: t.tare_weight_kg != null ? Math.round(t.tare_weight_kg / 1000 * 1000) / 1000 : '',
      net_weight_mt: t.net_weight_mt != null ? Math.round(t.net_weight_mt * 1000) / 1000 : 0,
      dockage_pct: t.dockage_pct != null ? t.dockage_pct : '',
      location: t.location?.name || '',
      bin: t.bin?.bin_number || t.bin_label || '',
      buyer: t.buyer_name || t.counterparty?.name || '',
      contract_number: t.contract_number || t.marketing_contract?.contract_number || '',
      grade: t.grade || '',
      moisture_pct: t.moisture_pct,
      operator: t.operator_name || '',
      destination: t.destination || '',
      source: t.source_system || 'traction_ag',
      settlement: sl ? `#${sl.settlement?.settlement_number || '?'}` : '',
      settled: t.settled,
    };
  });

  // Farm name for PDF header
  const farm = await prisma.farm.findUnique({ where: { id: farmId } });
  const farmName = farm?.name || 'Farm';

  return { rows, farmName };
}

// ─── Excel Export ───

export async function generateTicketExcel(farmId, filters = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'C2 Farms';

  const { rows } = await getTicketData(farmId, filters);

  // Sheet 1: Ticket Detail
  const detailSheet = workbook.addWorksheet('Ticket Detail');
  detailSheet.addRow([
    'Ticket #', 'Date', 'Crop Year', 'Crop', 'Gross MT', 'Tare MT', 'Net MT', 'Dockage %',
    'Location', 'Bin', 'Buyer', 'Contract #', 'Grade', 'Moisture %',
    'Operator', 'Destination', 'Source', 'Settlement', 'Paid',
  ]);
  detailSheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) {
    detailSheet.addRow([
      r.ticket_number, r.delivery_date, r.crop_year, r.commodity,
      r.gross_weight_mt, r.tare_weight_mt, r.net_weight_mt, r.dockage_pct,
      r.location, r.bin, r.buyer, r.contract_number, r.grade,
      r.moisture_pct != null ? Math.round(r.moisture_pct * 10000) / 100 : '',
      r.operator, r.destination, r.source, r.settlement,
      r.settled ? 'Yes' : 'No',
    ]);
  }

  // Sheet 2: By Buyer
  const buyerMap = {};
  for (const r of rows) {
    const key = r.buyer || '(Unknown)';
    if (!buyerMap[key]) buyerMap[key] = { count: 0, mt: 0 };
    buyerMap[key].count++;
    buyerMap[key].mt += r.net_weight_mt;
  }
  const buyerSheet = workbook.addWorksheet('By Buyer');
  buyerSheet.addRow(['Buyer', 'Tickets', 'Total MT']);
  buyerSheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const [name, data] of Object.entries(buyerMap).sort((a, b) => b[1].mt - a[1].mt)) {
    buyerSheet.addRow([name, data.count, Math.round(data.mt * 100) / 100]);
  }

  // Sheet 3: By Commodity
  const comMap = {};
  for (const r of rows) {
    const key = r.commodity || '(Unknown)';
    if (!comMap[key]) comMap[key] = { count: 0, mt: 0 };
    comMap[key].count++;
    comMap[key].mt += r.net_weight_mt;
  }
  const comSheet = workbook.addWorksheet('By Commodity');
  comSheet.addRow(['Commodity', 'Tickets', 'Total MT']);
  comSheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const [name, data] of Object.entries(comMap).sort((a, b) => b[1].mt - a[1].mt)) {
    comSheet.addRow([name, data.count, Math.round(data.mt * 100) / 100]);
  }

  return workbook;
}

// ─── PDF Export ───

export async function generateTicketPdf(farmId, filters = {}) {
  const { rows, farmName } = await getTicketData(farmId, filters);

  const noBorder = [false, false, false, false];
  const dateStr = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const colors = { primary: '#1565C0', accent: '#2E7D32', grey: '#757575', lightGrey: '#F5F5F5', headerBg: '#1565C0', headerText: '#FFFFFF' };
  const cleanLayout = {
    hLineWidth: () => 0, vLineWidth: () => 0,
    paddingLeft: () => 6, paddingRight: () => 6,
    paddingTop: () => 4, paddingBottom: () => 4,
  };

  const fmtNum = (v) => {
    if (v == null || v === '') return '—';
    return typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v);
  };

  // ─── KPIs ───
  const totalTickets = rows.length;
  const totalMt = rows.reduce((s, r) => s + r.net_weight_mt, 0);
  const settledCount = rows.filter(r => r.settled).length;
  const unsettledCount = rows.filter(r => !r.settled).length;
  const fyLabel = filters.fiscal_year ? `FY${filters.fiscal_year}` : 'All Years';

  // ─── Title bar ───
  const titleBar = {
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          { text: farmName.toUpperCase(), fontSize: 9, color: '#FFFFFF', bold: true, margin: [0, 0, 0, 2] },
          { text: 'Delivery Tickets Report', fontSize: 16, color: '#FFFFFF', bold: true },
          { text: `${fyLabel}  |  Generated: ${dateStr}`, fontSize: 8, color: '#B3D4FC' },
        ],
        fillColor: colors.primary,
        border: noBorder,
        margin: [8, 8, 8, 8],
      }]],
    },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
    margin: [0, 0, 0, 14],
  };

  // ─── KPI cards ───
  const kpiCard = (label, value, sub) => ({
    stack: [
      { text: label, fontSize: 7, color: colors.grey, margin: [0, 0, 0, 2] },
      { text: value, fontSize: 16, bold: true, color: colors.primary },
      ...(sub ? [{ text: sub, fontSize: 7, color: colors.grey, margin: [0, 2, 0, 0] }] : []),
    ],
    alignment: 'center',
    margin: [0, 4, 0, 4],
  });

  const kpiTable = {
    table: {
      widths: ['*', '*', '*', '*'],
      body: [[
        kpiCard('Total Tickets', String(totalTickets)),
        kpiCard('Total MT', fmtNum(totalMt)),
        kpiCard('Settled', String(settledCount)),
        kpiCard('Unsettled', String(unsettledCount)),
      ]],
    },
    layout: {
      hLineWidth: () => 0.5, vLineWidth: () => 0.5,
      hLineColor: () => '#E0E0E0', vLineColor: () => '#E0E0E0',
      paddingLeft: () => 6, paddingRight: () => 6,
      paddingTop: () => 4, paddingBottom: () => 4,
    },
    margin: [0, 0, 0, 16],
  };

  // ─── Summary by Buyer ───
  const buyerMap = {};
  for (const r of rows) {
    const key = r.buyer || '(Unknown)';
    if (!buyerMap[key]) buyerMap[key] = { count: 0, mt: 0 };
    buyerMap[key].count++;
    buyerMap[key].mt += r.net_weight_mt;
  }
  const buyerSummary = Object.entries(buyerMap).sort((a, b) => b[1].mt - a[1].mt);

  const buyerTable = {
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto'],
      body: [
        ['Buyer', 'Tickets', 'Total MT'].map(h =>
          ({ text: h, bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, border: noBorder })
        ),
        ...buyerSummary.map(([name, data], i) => {
          const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
          return [
            { text: name, bold: true, fontSize: 8, fillColor: bg, border: noBorder },
            { text: String(data.count), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
            { text: fmtNum(data.mt), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
          ];
        }),
        [
          { text: 'Total', bold: true, fontSize: 8, fillColor: '#E8EAF6', border: noBorder },
          { text: String(totalTickets), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
          { text: fmtNum(totalMt), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
        ],
      ],
    },
    layout: cleanLayout,
    margin: [0, 0, 0, 12],
  };

  // ─── Summary by Commodity ───
  const comMap = {};
  for (const r of rows) {
    const key = r.commodity || '(Unknown)';
    if (!comMap[key]) comMap[key] = { count: 0, mt: 0 };
    comMap[key].count++;
    comMap[key].mt += r.net_weight_mt;
  }
  const comSummary = Object.entries(comMap).sort((a, b) => b[1].mt - a[1].mt);

  const comTable = {
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto'],
      body: [
        ['Commodity', 'Tickets', 'Total MT'].map(h =>
          ({ text: h, bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, border: noBorder })
        ),
        ...comSummary.map(([name, data], i) => {
          const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
          return [
            { text: name, bold: true, fontSize: 8, fillColor: bg, border: noBorder },
            { text: String(data.count), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
            { text: fmtNum(data.mt), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
          ];
        }),
        [
          { text: 'Total', bold: true, fontSize: 8, fillColor: '#E8EAF6', border: noBorder },
          { text: String(totalTickets), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
          { text: fmtNum(totalMt), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
        ],
      ],
    },
    layout: cleanLayout,
    margin: [0, 0, 0, 12],
  };

  // ─── Detail table ───
  const detailHeaders = ['Ticket #', 'Date', 'CY', 'Crop', 'Gross', 'Tare', 'Net MT', 'Dkg%', 'Location', 'Bin', 'Buyer', 'Contract #', 'Grade', 'Mst%', 'Dest', 'Settlement', 'Paid'];

  const detailBody = [
    detailHeaders.map(h =>
      ({ text: h, bold: true, fontSize: 6, color: colors.headerText, fillColor: colors.headerBg, border: noBorder })
    ),
    ...rows.map((r, i) => {
      const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
      return [
        { text: r.ticket_number, fontSize: 6, fillColor: bg, border: noBorder },
        { text: r.delivery_date, fontSize: 6, fillColor: bg, border: noBorder },
        { text: String(r.crop_year), fontSize: 6, fillColor: bg, border: noBorder },
        { text: r.commodity, fontSize: 6, fillColor: bg, border: noBorder },
        { text: r.gross_weight_mt !== '' ? fmtNum(r.gross_weight_mt) : '—', fontSize: 6, alignment: 'right', fillColor: bg, border: noBorder },
        { text: r.tare_weight_mt !== '' ? fmtNum(r.tare_weight_mt) : '—', fontSize: 6, alignment: 'right', fillColor: bg, border: noBorder },
        { text: fmtNum(r.net_weight_mt), fontSize: 6, alignment: 'right', fillColor: bg, border: noBorder },
        { text: r.dockage_pct !== '' ? fmtNum(r.dockage_pct) : '—', fontSize: 6, alignment: 'right', fillColor: bg, border: noBorder },
        { text: r.location, fontSize: 6, fillColor: bg, border: noBorder },
        { text: r.bin, fontSize: 6, fillColor: bg, border: noBorder },
        { text: r.buyer, fontSize: 6, fillColor: bg, border: noBorder },
        { text: r.contract_number, fontSize: 6, fillColor: bg, border: noBorder },
        { text: r.grade, fontSize: 6, fillColor: bg, border: noBorder },
        { text: r.moisture_pct != null ? (r.moisture_pct * 100).toFixed(1) : '—', fontSize: 6, alignment: 'right', fillColor: bg, border: noBorder },
        { text: r.destination, fontSize: 6, fillColor: bg, border: noBorder },
        { text: r.settlement, fontSize: 6, fillColor: bg, border: noBorder },
        { text: r.settled ? 'Yes' : 'No', fontSize: 6, fillColor: bg, border: noBorder },
      ];
    }),
  ];

  const footer = { text: `C2 Farms  |  ${farmName}  |  Generated ${dateStr}`, fontSize: 6, color: colors.grey, alignment: 'center', margin: [0, 14, 0, 0] };

  const section = (title, table) => ({
    unbreakable: true,
    stack: [
      { text: title, style: 'sectionHeader' },
      table,
    ],
  });

  return {
    pageOrientation: 'landscape',
    pageSize: 'LETTER',
    pageMargins: [28, 28, 28, 28],
    content: [
      titleBar,
      kpiTable,
      section('Summary by Buyer', buyerTable),
      section('Summary by Commodity', comTable),
      footer,
      // Detail pages
      { text: 'Ticket Detail', style: 'sectionHeader', pageBreak: 'before' },
      { text: `${rows.length} tickets  |  ${fyLabel}`, fontSize: 7, color: colors.grey, margin: [0, 0, 0, 6] },
      {
        table: {
          headerRows: 1,
          widths: ['auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
          body: detailBody,
        },
        layout: {
          hLineWidth: () => 0, vLineWidth: () => 0,
          paddingLeft: () => 3, paddingRight: () => 3,
          paddingTop: () => 2, paddingBottom: () => 2,
        },
      },
      footer,
    ],
    styles: {
      sectionHeader: { fontSize: 10, bold: true, color: colors.primary, margin: [0, 4, 0, 6] },
    },
    defaultStyle: { fontSize: 8 },
  };
}

// ─── CSV Export ───

export async function generateTicketCsv(farmId, filters = {}) {
  const { rows } = await getTicketData(farmId, filters);

  const escapeCsv = (val) => {
    const s = val == null ? '' : String(val);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const columns = [
    'Ticket #', 'Date', 'Crop Year', 'Crop', 'Gross MT', 'Tare MT', 'Net MT', 'Dockage %',
    'Location', 'Bin', 'Buyer', 'Contract #', 'Grade', 'Moisture %',
    'Operator', 'Destination', 'Source', 'Settlement', 'Paid',
  ];

  const lines = [columns.map(escapeCsv).join(',')];
  for (const r of rows) {
    lines.push([
      r.ticket_number, r.delivery_date, r.crop_year, r.commodity,
      r.gross_weight_mt, r.tare_weight_mt, r.net_weight_mt, r.dockage_pct,
      r.location, r.bin, r.buyer, r.contract_number, r.grade,
      r.moisture_pct != null ? Math.round(r.moisture_pct * 10000) / 100 : '',
      r.operator, r.destination, r.source, r.settlement,
      r.settled ? 'Yes' : 'No',
    ].map(escapeCsv).join(','));
  }
  return lines.join('\n');
}
