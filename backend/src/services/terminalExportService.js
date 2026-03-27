import ExcelJS from 'exceljs';
import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('terminal:export');

function fmtKg(kg) {
  return kg != null ? kg.toLocaleString('en-CA', { maximumFractionDigits: 0 }) : '—';
}

function fmtMt(kg) {
  return kg != null ? (kg / 1000).toLocaleString('en-CA', { maximumFractionDigits: 2 }) : '—';
}

export async function generateGrainBalanceReport(farmId, { format = 'excel' } = {}) {
  const [farm, bins] = await Promise.all([
    prisma.farm.findUnique({ where: { id: farmId } }),
    prisma.terminalBin.findMany({
      where: { farm_id: farmId, is_active: true },
      orderBy: { bin_number: 'asc' },
    }),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'C2 Farms Terminal';
  wb.created = new Date();
  const ws = wb.addWorksheet('Grain Balance');

  ws.columns = [
    { header: 'Bin', key: 'bin', width: 15 },
    { header: 'Product', key: 'product', width: 20 },
    { header: 'Balance KG', key: 'balance_kg', width: 15 },
    { header: 'Balance MT', key: 'balance_mt', width: 15 },
    { header: 'C2 Farms KG', key: 'c2_kg', width: 15 },
    { header: 'Non-C2 KG', key: 'non_c2_kg', width: 15 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

  for (const bin of bins) {
    ws.addRow({
      bin: bin.name,
      product: bin.current_product_label || 'Empty',
      balance_kg: bin.balance_kg,
      balance_mt: +(bin.balance_kg / 1000).toFixed(2),
      c2_kg: bin.c2_balance_kg,
      non_c2_kg: bin.non_c2_balance_kg,
    });
  }

  const totalKg = bins.reduce((s, b) => s + b.balance_kg, 0);
  const totalRow = ws.addRow({
    bin: 'TOTAL',
    product: '',
    balance_kg: totalKg,
    balance_mt: +(totalKg / 1000).toFixed(2),
    c2_kg: bins.reduce((s, b) => s + b.c2_balance_kg, 0),
    non_c2_kg: bins.reduce((s, b) => s + b.non_c2_balance_kg, 0),
  });
  totalRow.font = { bold: true };

  // Title row
  ws.insertRow(1, [`${farm.name} — Grain Balance Report — ${new Date().toLocaleDateString('en-CA')}`]);
  ws.getRow(1).font = { bold: true, size: 14 };
  ws.mergeCells('A1:F1');

  return wb;
}

export async function generateGrainBalancePdf(farmId) {
  const [farm, bins] = await Promise.all([
    prisma.farm.findUnique({ where: { id: farmId } }),
    prisma.terminalBin.findMany({
      where: { farm_id: farmId, is_active: true },
      orderBy: { bin_number: 'asc' },
    }),
  ]);

  const totalKg = bins.reduce((s, b) => s + b.balance_kg, 0);

  const tableBody = [
    [
      { text: 'Bin', bold: true, fillColor: '#1565C0', color: '#FFFFFF' },
      { text: 'Product', bold: true, fillColor: '#1565C0', color: '#FFFFFF' },
      { text: 'KG', bold: true, fillColor: '#1565C0', color: '#FFFFFF', alignment: 'right' },
      { text: 'MT', bold: true, fillColor: '#1565C0', color: '#FFFFFF', alignment: 'right' },
      { text: 'C2 KG', bold: true, fillColor: '#1565C0', color: '#FFFFFF', alignment: 'right' },
      { text: 'Non-C2 KG', bold: true, fillColor: '#1565C0', color: '#FFFFFF', alignment: 'right' },
    ],
    ...bins.map(b => [
      b.name,
      b.current_product_label || 'Empty',
      { text: fmtKg(b.balance_kg), alignment: 'right' },
      { text: fmtMt(b.balance_kg), alignment: 'right' },
      { text: fmtKg(b.c2_balance_kg), alignment: 'right' },
      { text: fmtKg(b.non_c2_balance_kg), alignment: 'right' },
    ]),
    [
      { text: 'TOTAL', bold: true },
      '',
      { text: fmtKg(totalKg), bold: true, alignment: 'right' },
      { text: fmtMt(totalKg), bold: true, alignment: 'right' },
      { text: fmtKg(bins.reduce((s, b) => s + b.c2_balance_kg, 0)), bold: true, alignment: 'right' },
      { text: fmtKg(bins.reduce((s, b) => s + b.non_c2_balance_kg, 0)), bold: true, alignment: 'right' },
    ],
  ];

  return {
    pageOrientation: 'portrait',
    pageSize: 'LETTER',
    pageMargins: [40, 40, 40, 40],
    content: [
      { text: farm.name, style: 'header' },
      { text: `Grain Balance Report — ${new Date().toLocaleDateString('en-CA')}`, style: 'subheader' },
      { text: ' ' },
      {
        table: {
          headerRows: 1,
          widths: [80, 100, 70, 70, 70, 70],
          body: tableBody,
        },
        layout: 'lightHorizontalLines',
      },
    ],
    styles: {
      header: { fontSize: 18, bold: true, margin: [0, 0, 0, 5] },
      subheader: { fontSize: 12, color: '#666666', margin: [0, 0, 0, 10] },
    },
  };
}

export async function generateShippingHistory(farmId, { buyer, startDate, endDate } = {}) {
  const farm = await prisma.farm.findUnique({ where: { id: farmId } });

  const where = { farm_id: farmId, direction: 'outbound', status: 'complete' };
  if (buyer) where.sold_to = { contains: buyer, mode: 'insensitive' };
  if (startDate) where.ticket_date = { ...(where.ticket_date || {}), gte: new Date(startDate) };
  if (endDate) where.ticket_date = { ...(where.ticket_date || {}), lte: new Date(endDate) };

  const tickets = await prisma.terminalTicket.findMany({
    where,
    include: { samples: true, bin: { select: { name: true } } },
    orderBy: { ticket_date: 'desc' },
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Shipping History');

  ws.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Crop', key: 'crop', width: 12 },
    { header: 'Rail Car #', key: 'rail_car', width: 15 },
    { header: 'FMO#', key: 'fmo', width: 12 },
    { header: 'KG', key: 'kg', width: 12 },
    { header: 'MT', key: 'mt', width: 10 },
    { header: 'Sold To', key: 'sold_to', width: 12 },
    { header: 'Seal #s', key: 'seals', width: 30 },
    { header: 'Sample', key: 'sample', width: 12 },
    { header: 'Inspector', key: 'inspector', width: 12 },
    { header: 'Source Bin', key: 'bin', width: 10 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };

  let totalKg = 0;
  for (const t of tickets) {
    totalKg += t.outbound_kg || t.weight_kg || 0;
    ws.addRow({
      date: new Date(t.ticket_date).toLocaleDateString('en-CA'),
      crop: t.product,
      rail_car: t.rail_car_number || '',
      fmo: t.fmo_number || '',
      kg: t.outbound_kg || t.weight_kg || 0,
      mt: +((t.outbound_kg || t.weight_kg || 0) / 1000).toFixed(2),
      sold_to: t.sold_to || '',
      seals: t.seal_numbers || '',
      sample: t.samples[0]?.sample_type || '',
      inspector: t.samples[0]?.inspector || '',
      bin: t.bin?.name || '',
    });
  }

  const totalRow = ws.addRow({
    date: 'TOTAL', crop: '', rail_car: '', fmo: '',
    kg: totalKg, mt: +(totalKg / 1000).toFixed(2),
  });
  totalRow.font = { bold: true };

  ws.insertRow(1, [
    `${farm.name} — Shipping History${buyer ? ` (${buyer})` : ''}`,
    '', '',
    startDate ? `From: ${startDate}` : '',
    endDate ? `To: ${endDate}` : '',
  ]);
  ws.getRow(1).font = { bold: true, size: 12 };

  return wb;
}

export async function generateQualitySummary(farmId) {
  const farm = await prisma.farm.findUnique({ where: { id: farmId } });
  const bins = await prisma.terminalBin.findMany({
    where: { farm_id: farmId, is_active: true },
    orderBy: { bin_number: 'asc' },
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Quality Summary');

  ws.columns = [
    { header: 'Bin', key: 'bin', width: 12 },
    { header: 'Product', key: 'product', width: 18 },
    { header: 'KG', key: 'kg', width: 12 },
    { header: 'Avg Dock%', key: 'dock', width: 12 },
    { header: 'Avg Moist%', key: 'moisture', width: 12 },
    { header: 'Avg TW', key: 'tw', width: 10 },
    { header: 'Avg Prot%', key: 'protein', width: 12 },
    { header: 'Avg HVK%', key: 'hvk', width: 12 },
    { header: 'Loads', key: 'loads', width: 8 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6A1B9A' } };

  for (const bin of bins) {
    const tickets = await prisma.terminalTicket.findMany({
      where: { bin_id: bin.id, direction: 'inbound', status: 'complete' },
      select: { dockage_pct: true, moisture_pct: true, test_weight: true, protein_pct: true, hvk_pct: true, weight_kg: true },
    });

    if (!tickets.length) continue;

    const totalKg = tickets.reduce((s, t) => s + t.weight_kg, 0);
    const avg = (field) => {
      const vals = tickets.filter(t => t[field] != null);
      if (!vals.length) return null;
      const weighted = vals.reduce((s, t) => s + t[field] * t.weight_kg, 0);
      return +(weighted / vals.reduce((s, t) => s + t.weight_kg, 0)).toFixed(2);
    };

    ws.addRow({
      bin: bin.name,
      product: bin.current_product_label || 'Unknown',
      kg: totalKg,
      dock: avg('dockage_pct'),
      moisture: avg('moisture_pct'),
      tw: avg('test_weight'),
      protein: avg('protein_pct'),
      hvk: avg('hvk_pct'),
      loads: tickets.length,
    });
  }

  ws.insertRow(1, [`${farm.name} — Quality Summary — ${new Date().toLocaleDateString('en-CA')}`]);
  ws.getRow(1).font = { bold: true, size: 12 };

  return wb;
}

export async function generateContractFulfillment(farmId, { buyer } = {}) {
  const farm = await prisma.farm.findUnique({ where: { id: farmId } });

  const where = { farm_id: farmId, status: { not: 'cancelled' } };
  if (buyer) {
    where.counterparty = { name: { contains: buyer, mode: 'insensitive' } };
  }

  const contracts = await prisma.terminalContract.findMany({
    where,
    include: {
      counterparty: { select: { name: true } },
      commodity: { select: { name: true, code: true } },
    },
    orderBy: [{ direction: 'asc' }, { contract_number: 'asc' }],
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Contract Fulfillment');

  ws.columns = [
    { header: 'Contract #', key: 'number', width: 15 },
    { header: 'Type', key: 'direction', width: 10 },
    { header: 'Counterparty', key: 'counterparty', width: 20 },
    { header: 'Commodity', key: 'commodity', width: 15 },
    { header: 'Contracted MT', key: 'contracted', width: 14 },
    { header: 'Delivered MT', key: 'delivered', width: 14 },
    { header: 'Remaining MT', key: 'remaining', width: 14 },
    { header: '% Complete', key: 'pct', width: 12 },
    { header: '$/MT', key: 'price', width: 10 },
    { header: 'Status', key: 'status', width: 12 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };

  for (const c of contracts) {
    const pct = c.contracted_mt > 0 ? +(c.delivered_mt / c.contracted_mt * 100).toFixed(1) : 0;
    ws.addRow({
      number: c.contract_number,
      direction: c.direction === 'purchase' ? 'Purchase' : 'Sale',
      counterparty: c.counterparty.name,
      commodity: c.commodity.name,
      contracted: c.contracted_mt,
      delivered: c.delivered_mt,
      remaining: c.remaining_mt,
      pct: `${pct}%`,
      price: c.price_per_mt || '',
      status: c.status,
    });
  }

  ws.insertRow(1, [
    `${farm.name} — Contract Fulfillment Report${buyer ? ` (${buyer})` : ''}`,
    '', '',
    `Generated: ${new Date().toLocaleDateString('en-CA')}`,
  ]);
  ws.getRow(1).font = { bold: true, size: 12 };

  return wb;
}

// ─── Three-Party Reports ────────────────────────────────────────────────────

const HEADER_STYLE = {
  font: { bold: true, color: { argb: 'FFFFFFFF' } },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } },
};

function applyHeaderStyle(ws) {
  const row = ws.getRow(ws.lastRow?.number === 1 ? 1 : 2);
  row.font = HEADER_STYLE.font;
  row.fill = HEADER_STYLE.fill;
}

/**
 * BU Credit Allocation Report — shows how buyer settlements were allocated to BU farms.
 */
export async function generateBuCreditReport(farmId) {
  const farm = await prisma.farm.findUnique({ where: { id: farmId } });

  const credits = await prisma.terminalSettlement.findMany({
    where: { farm_id: farmId, type: 'bu_credit' },
    include: {
      counterparty: { select: { name: true } },
      source_bu_farm: { select: { name: true } },
      contract: { select: { contract_number: true } },
      lines: { orderBy: { line_number: 'asc' } },
    },
    orderBy: { settlement_date: 'desc' },
  });

  // Also get linked MarketingContracts for contract numbers
  const mcIds = [...new Set(credits.map(c => c.marketing_contract_id).filter(Boolean))];
  const mcs = mcIds.length > 0 ? await prisma.marketingContract.findMany({
    where: { id: { in: mcIds } },
    select: { id: true, contract_number: true, commodity: { select: { name: true } } },
  }) : [];
  const mcMap = new Map(mcs.map(m => [m.id, m]));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'C2 Farms Terminal';
  wb.created = new Date();
  const ws = wb.addWorksheet('BU Credit Allocations');

  ws.addRow([`${farm?.name || 'LGX'} — BU Credit Allocation Report`, '', '', '', `Generated: ${new Date().toLocaleDateString('en-CA')}`]);
  ws.getRow(1).font = { bold: true, size: 12 };

  ws.addRow([]);
  ws.addRow(['Settlement #', 'Date', 'Contract #', 'Commodity', 'Buyer', 'BU Farm', 'Basis', 'Contributed MT', '$/MT', 'Allocated Amount']);
  applyHeaderStyle(ws);

  let totalAllocated = 0;

  for (const credit of credits) {
    const mc = mcMap.get(credit.marketing_contract_id);
    const line = credit.lines[0];
    totalAllocated += credit.net_amount || 0;

    ws.addRow([
      credit.settlement_number,
      credit.settlement_date ? new Date(credit.settlement_date).toLocaleDateString('en-CA') : '',
      mc?.contract_number || credit.contract?.contract_number || '',
      mc?.commodity?.name || '',
      credit.counterparty?.name || '',
      credit.source_bu_farm?.name || line?.source_farm_name || '',
      credit.allocation_basis || '',
      line?.net_weight_mt || 0,
      line?.price_per_mt || 0,
      credit.net_amount || 0,
    ]);
  }

  // Total row
  const totalRow = ws.addRow(['TOTAL', '', '', '', '', '', '', '', '', totalAllocated]);
  totalRow.font = { bold: true };

  // Format currency columns
  ws.getColumn(9).numFmt = '$#,##0.00';
  ws.getColumn(10).numFmt = '$#,##0.00';
  ws.getColumn(8).numFmt = '#,##0.000';

  // Auto-width
  ws.columns.forEach(col => { col.width = Math.max(col.width || 12, 14); });

  logger.info('Generated BU credit report', { farmId, credits: credits.length });
  return wb;
}

/**
 * LGX P&L Report — transloading revenue by buyer and month.
 */
export async function generateTransloadingPnlReport(farmId) {
  const farm = await prisma.farm.findUnique({ where: { id: farmId } });

  const settlements = await prisma.terminalSettlement.findMany({
    where: { farm_id: farmId, type: 'transloading' },
    include: {
      counterparty: { select: { name: true } },
      contract: { select: { contract_number: true, transloading_rate: true } },
      lines: true,
    },
    orderBy: { settlement_date: 'desc' },
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'C2 Farms Terminal';
  wb.created = new Date();

  // Sheet 1: Detail
  const wsDetail = wb.addWorksheet('Transloading Revenue');
  wsDetail.addRow([`${farm?.name || 'LGX'} — Transloading Revenue Report`, '', '', '', `Generated: ${new Date().toLocaleDateString('en-CA')}`]);
  wsDetail.getRow(1).font = { bold: true, size: 12 };
  wsDetail.addRow([]);
  wsDetail.addRow(['Settlement #', 'Date', 'Contract #', 'Buyer', 'Rate $/MT', 'Total MT', 'Gross Amount', 'Net Amount', 'Status']);
  const hRow = wsDetail.getRow(3);
  hRow.font = HEADER_STYLE.font;
  hRow.fill = HEADER_STYLE.fill;

  let totalRevenue = 0;
  let totalMt = 0;

  for (const s of settlements) {
    const mt = s.lines.reduce((sum, l) => sum + (l.net_weight_mt || 0), 0);
    totalRevenue += s.net_amount || 0;
    totalMt += mt;

    wsDetail.addRow([
      s.settlement_number,
      s.settlement_date ? new Date(s.settlement_date).toLocaleDateString('en-CA') : '',
      s.contract?.contract_number || '',
      s.counterparty?.name || '',
      s.contract?.transloading_rate || '',
      mt,
      s.gross_amount || 0,
      s.net_amount || 0,
      s.status,
    ]);
  }

  const totRow = wsDetail.addRow(['TOTAL', '', '', '', '', totalMt, totalRevenue, totalRevenue, '']);
  totRow.font = { bold: true };
  wsDetail.getColumn(5).numFmt = '$#,##0.00';
  wsDetail.getColumn(7).numFmt = '$#,##0.00';
  wsDetail.getColumn(8).numFmt = '$#,##0.00';
  wsDetail.getColumn(6).numFmt = '#,##0.000';
  wsDetail.columns.forEach(col => { col.width = Math.max(col.width || 12, 15); });

  // Sheet 2: Summary by buyer
  const wsBuyer = wb.addWorksheet('By Buyer');
  wsBuyer.addRow(['Buyer', 'Invoices', 'Total MT', 'Total Revenue']);
  const bHRow = wsBuyer.getRow(1);
  bHRow.font = HEADER_STYLE.font;
  bHRow.fill = HEADER_STYLE.fill;

  const byBuyer = new Map();
  for (const s of settlements) {
    const name = s.counterparty?.name || 'Unknown';
    if (!byBuyer.has(name)) byBuyer.set(name, { count: 0, mt: 0, revenue: 0 });
    const g = byBuyer.get(name);
    g.count += 1;
    g.mt += s.lines.reduce((sum, l) => sum + (l.net_weight_mt || 0), 0);
    g.revenue += s.net_amount || 0;
  }
  for (const [name, data] of byBuyer) {
    wsBuyer.addRow([name, data.count, data.mt, data.revenue]);
  }
  wsBuyer.getColumn(3).numFmt = '#,##0.000';
  wsBuyer.getColumn(4).numFmt = '$#,##0.00';
  wsBuyer.columns.forEach(col => { col.width = Math.max(col.width || 12, 18); });

  // Sheet 3: Summary by month
  const wsMonth = wb.addWorksheet('By Month');
  wsMonth.addRow(['Month', 'Invoices', 'Total MT', 'Total Revenue']);
  const mHRow = wsMonth.getRow(1);
  mHRow.font = HEADER_STYLE.font;
  mHRow.fill = HEADER_STYLE.fill;

  const byMonth = new Map();
  for (const s of settlements) {
    const month = s.settlement_date ? new Date(s.settlement_date).toISOString().slice(0, 7) : 'unknown';
    if (!byMonth.has(month)) byMonth.set(month, { count: 0, mt: 0, revenue: 0 });
    const g = byMonth.get(month);
    g.count += 1;
    g.mt += s.lines.reduce((sum, l) => sum + (l.net_weight_mt || 0), 0);
    g.revenue += s.net_amount || 0;
  }
  for (const [month, data] of [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    wsMonth.addRow([month, data.count, data.mt, data.revenue]);
  }
  wsMonth.getColumn(3).numFmt = '#,##0.000';
  wsMonth.getColumn(4).numFmt = '$#,##0.00';
  wsMonth.columns.forEach(col => { col.width = Math.max(col.width || 12, 18); });

  logger.info('Generated transloading P&L report', { farmId, settlements: settlements.length, totalRevenue });
  return wb;
}

/**
 * Inventory Flow Report — tracks grain through inventory stages at LGX.
 * Shows: raw_material → wip → finished_goods → shipped
 */
export async function generateInventoryFlowReport(farmId) {
  const farm = await prisma.farm.findUnique({ where: { id: farmId } });

  // Get all tickets with inventory stages
  const tickets = await prisma.terminalTicket.findMany({
    where: { farm_id: farmId, status: 'complete' },
    select: {
      ticket_number: true, direction: true, ticket_date: true,
      grower_name: true, product: true, weight_kg: true,
      inventory_stage: true, is_c2_farms: true,
      rail_car_number: true, sold_to: true,
      marketing_contract: { select: { contract_number: true } },
    },
    orderBy: { ticket_date: 'asc' },
  });

  // Get blend events
  const blends = await prisma.terminalBlendEvent.findMany({
    where: { farm_id: farmId },
    select: {
      blend_date: true, description: true,
      total_output_kg: true, source_bin_kg: true, blend_bin_kg: true,
      rail_car_numbers: true, car_count: true, target_protein: true,
      marketing_contract: { select: { contract_number: true } },
    },
    orderBy: { blend_date: 'asc' },
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'C2 Farms Terminal';
  wb.created = new Date();

  // Sheet 1: Ticket flow
  const ws = wb.addWorksheet('Inventory Flow');
  ws.addRow([`${farm?.name || 'LGX'} — Inventory Flow Report`, '', '', '', `Generated: ${new Date().toLocaleDateString('en-CA')}`]);
  ws.getRow(1).font = { bold: true, size: 12 };
  ws.addRow([]);
  ws.addRow(['Ticket #', 'Date', 'Direction', 'Stage', 'Grower/Buyer', 'Product', 'Weight MT', 'C2 Farms', 'Rail Car', 'Contract #']);
  const hRow2 = ws.getRow(3);
  hRow2.font = HEADER_STYLE.font;
  hRow2.fill = HEADER_STYLE.fill;

  const stageStats = { raw_material: 0, wip: 0, finished_goods: 0, shipped: 0, unknown: 0 };

  for (const t of tickets) {
    const mt = (t.weight_kg || 0) / 1000;
    const stage = t.inventory_stage || (t.direction === 'inbound' ? 'raw_material' : 'finished_goods');
    stageStats[stage] = (stageStats[stage] || 0) + mt;

    ws.addRow([
      t.ticket_number,
      t.ticket_date ? new Date(t.ticket_date).toLocaleDateString('en-CA') : '',
      t.direction,
      stage,
      t.direction === 'inbound' ? (t.grower_name || '') : (t.sold_to || ''),
      t.product || '',
      mt,
      t.is_c2_farms ? 'Yes' : 'No',
      t.rail_car_number || '',
      t.marketing_contract?.contract_number || '',
    ]);
  }

  ws.getColumn(7).numFmt = '#,##0.000';
  ws.columns.forEach(col => { col.width = Math.max(col.width || 12, 14); });

  // Sheet 2: Stage summary
  const wsSummary = wb.addWorksheet('Stage Summary');
  wsSummary.addRow(['Inventory Stage', 'Total MT', 'Description']);
  const sHRow = wsSummary.getRow(1);
  sHRow.font = HEADER_STYLE.font;
  sHRow.fill = HEADER_STYLE.fill;

  wsSummary.addRow(['Raw Material', stageStats.raw_material, 'Grain received at LGX, sitting in bins']);
  wsSummary.addRow(['Work in Process', stageStats.wip, 'Grain being blended']);
  wsSummary.addRow(['Finished Goods', stageStats.finished_goods, 'Blended grain loaded into rail cars']);
  wsSummary.addRow(['Shipped', stageStats.shipped, 'Delivered to buyer']);
  wsSummary.addRow(['TOTAL', Object.values(stageStats).reduce((a, b) => a + b, 0), '']);
  wsSummary.getRow(6).font = { bold: true };
  wsSummary.getColumn(2).numFmt = '#,##0.000';
  wsSummary.columns.forEach(col => { col.width = Math.max(col.width || 12, 20); });

  // Sheet 3: Blend events
  const wsBlend = wb.addWorksheet('Blend Events');
  wsBlend.addRow(['Date', 'Description', 'Output MT', 'Source MT', 'Blend MT', 'Rail Cars', 'Target Protein', 'Contract #']);
  const blHRow = wsBlend.getRow(1);
  blHRow.font = HEADER_STYLE.font;
  blHRow.fill = HEADER_STYLE.fill;

  for (const b of blends) {
    wsBlend.addRow([
      b.blend_date ? new Date(b.blend_date).toLocaleDateString('en-CA') : '',
      b.description || '',
      (b.total_output_kg || 0) / 1000,
      (b.source_bin_kg || 0) / 1000,
      (b.blend_bin_kg || 0) / 1000,
      b.rail_car_numbers?.join(', ') || '',
      b.target_protein || '',
      b.marketing_contract?.contract_number || '',
    ]);
  }
  wsBlend.getColumn(3).numFmt = '#,##0.000';
  wsBlend.getColumn(4).numFmt = '#,##0.000';
  wsBlend.getColumn(5).numFmt = '#,##0.000';
  wsBlend.columns.forEach(col => { col.width = Math.max(col.width || 12, 16); });

  logger.info('Generated inventory flow report', { farmId, tickets: tickets.length, blends: blends.length });
  return wb;
}
