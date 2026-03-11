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
