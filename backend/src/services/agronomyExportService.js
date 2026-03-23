import ExcelJS from 'exceljs';
import prisma from '../config/database.js';
import { getFontPaths } from '../utils/fontPaths.js';
import createLogger from '../utils/logger.js';

const log = createLogger('agronomy-export');

// ─── Formatting helpers ──────────────────────────────────────────────

function fmtNum(v, d = 2) {
  if (v == null) return '—';
  return typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : String(v);
}
function fmtDollar(v, d = 0) {
  if (v == null) return '$0';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
function fmtInt(v) {
  return typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(v || '—');
}
function fmtPct(v) {
  return v != null ? `${(v * 100).toFixed(1)}%` : '—';
}

const TIMING_LABELS = {
  fall_residual: 'Fall Residual',
  preburn: 'Pre-Burn',
  incrop: 'In-Crop',
  fungicide: 'Fungicide',
  desiccation: 'Desiccation',
};

const FORM_LABELS = {
  nh3: 'NH3',
  dry: 'Dry',
  liquid: 'Liquid',
  micro_nutrient: 'Micro',
  granular: 'Granular',
};

// ─── Shared Data Fetcher ─────────────────────────────────────────────

export async function getExportData(farmId, cropYear) {
  const farm = await prisma.farm.findUnique({ where: { id: farmId } });
  const farmName = farm?.name || 'Farm';

  const plan = await prisma.agroPlan.findUnique({
    where: { farm_id_crop_year: { farm_id: farmId, crop_year: Number(cropYear) } },
    include: {
      allocations: {
        orderBy: { sort_order: 'asc' },
        include: { inputs: { orderBy: { sort_order: 'asc' } } },
      },
    },
  });

  if (!plan || plan.allocations.length === 0) {
    return { farmName, cropYear, planStatus: plan?.status || null, crops: [], summary: null };
  }

  // For seed/seed_treatment inputs, use per-varietal acres if set; otherwise fall back to allocation acres
  const effAcres = (inp, alloc) =>
    (inp.category === 'seed' || inp.category === 'seed_treatment') && inp.acres != null ? inp.acres : alloc.acres;

  const crops = plan.allocations.map(alloc => {
    const seedInputs = alloc.inputs.filter(i => i.category === 'seed' || i.category === 'seed_treatment');
    const fertInputs = alloc.inputs.filter(i => i.category === 'fertilizer');
    const chemInputs = alloc.inputs.filter(i => i.category === 'chemical');

    const mapInput = (inp) => ({
      product_name: inp.product_name,
      product_analysis: inp.product_analysis || '',
      form: inp.form || '',
      timing: inp.timing || '',
      rate: inp.rate,
      rate_unit: inp.rate_unit,
      cost_per_unit: inp.cost_per_unit,
      cost_per_acre: inp.rate * inp.cost_per_unit,
      total_cost: inp.rate * inp.cost_per_unit * effAcres(inp, alloc),
    });

    const sumTotal = (inputs) => inputs.reduce((s, i) => s + i.rate * i.cost_per_unit * effAcres(i, alloc), 0);

    const seedTotal = sumTotal(seedInputs);
    const fertTotal = sumTotal(fertInputs);
    const chemTotal = sumTotal(chemInputs);
    const totalCost = seedTotal + fertTotal + chemTotal;
    const revenue = alloc.acres * alloc.target_yield_bu * alloc.commodity_price;

    return {
      crop: alloc.crop,
      acres: alloc.acres,
      target_yield_bu: alloc.target_yield_bu,
      commodity_price: alloc.commodity_price,
      seed: { inputs: seedInputs.map(mapInput), subtotal_per_acre: alloc.acres ? seedTotal / alloc.acres : 0, subtotal: seedTotal },
      fertilizer: { inputs: fertInputs.map(mapInput), subtotal_per_acre: alloc.acres ? fertTotal / alloc.acres : 0, subtotal: fertTotal },
      chemical: { inputs: chemInputs.map(mapInput), subtotal_per_acre: alloc.acres ? chemTotal / alloc.acres : 0, subtotal: chemTotal },
      total_per_acre: alloc.acres ? totalCost / alloc.acres : 0,
      total_cost: totalCost,
      revenue,
      margin: revenue - totalCost,
    };
  });

  // Farm summary
  const totalAcres = crops.reduce((s, c) => s + c.acres, 0);
  const totalSeed = crops.reduce((s, c) => s + c.seed.subtotal, 0);
  const totalFert = crops.reduce((s, c) => s + c.fertilizer.subtotal, 0);
  const totalChem = crops.reduce((s, c) => s + c.chemical.subtotal, 0);
  const totalCost = totalSeed + totalFert + totalChem;
  const totalRevenue = crops.reduce((s, c) => s + c.revenue, 0);
  const totalMargin = totalRevenue - totalCost;

  return {
    farmName,
    cropYear,
    planStatus: plan.status,
    crops,
    summary: {
      total_acres: totalAcres,
      seed_total: totalSeed,
      fert_total: totalFert,
      chem_total: totalChem,
      total_cost: totalCost,
      total_revenue: totalRevenue,
      total_margin: totalMargin,
      cost_per_acre: totalAcres > 0 ? totalCost / totalAcres : 0,
    },
  };
}

// ─── Excel Export ────────────────────────────────────────────────────

export async function generateAgronomyExcel(farmId, cropYear) {
  const data = await getExportData(farmId, cropYear);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'C2 Farms';

  const numFmt = '#,##0.00;(#,##0.00);"-"';
  const dollarFmt = '$#,##0.00;($#,##0.00);"-"';
  const intFmt = '#,##0;(#,##0);"-"';

  // ── Sheet 1: Farm Summary ──
  const summarySheet = workbook.addWorksheet('Farm Summary');
  summarySheet.addRow([`${data.farmName} — Crop Input Plan — FY${data.cropYear}`]);
  summarySheet.getRow(1).font = { bold: true, size: 14 };
  if (data.planStatus) {
    summarySheet.addRow([`Plan Status: ${data.planStatus.toUpperCase()}`]);
    summarySheet.getRow(2).font = { bold: true, size: 10, color: { argb: '666666' } };
  }
  summarySheet.addRow([]);

  const sumHeaders = ['Crop', 'Acres', 'Seed $/ac', 'Fert $/ac', 'Chem $/ac', 'Total $/ac', 'Total Input $', 'Revenue $', 'Margin $', 'Margin %'];
  const headerRow = summarySheet.addRow(sumHeaders);
  headerRow.font = { bold: true };
  headerRow.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E8EAF6' } }; });

  for (const c of data.crops) {
    const row = summarySheet.addRow([
      c.crop, c.acres,
      c.seed.subtotal_per_acre, c.fertilizer.subtotal_per_acre, c.chemical.subtotal_per_acre,
      c.total_per_acre, c.total_cost, c.revenue, c.margin,
      c.revenue > 0 ? c.margin / c.revenue : 0,
    ]);
    row.getCell(3).numFmt = numFmt;
    row.getCell(4).numFmt = numFmt;
    row.getCell(5).numFmt = numFmt;
    row.getCell(6).numFmt = numFmt;
    row.getCell(7).numFmt = intFmt;
    row.getCell(8).numFmt = intFmt;
    row.getCell(9).numFmt = intFmt;
    row.getCell(10).numFmt = '0.0%';
  }

  if (data.summary) {
    const s = data.summary;
    const totRow = summarySheet.addRow([
      'TOTAL', s.total_acres,
      s.total_acres > 0 ? s.seed_total / s.total_acres : 0,
      s.total_acres > 0 ? s.fert_total / s.total_acres : 0,
      s.total_acres > 0 ? s.chem_total / s.total_acres : 0,
      s.cost_per_acre, s.total_cost, s.total_revenue, s.total_margin,
      s.total_revenue > 0 ? s.total_margin / s.total_revenue : 0,
    ]);
    totRow.font = { bold: true };
    totRow.getCell(3).numFmt = numFmt;
    totRow.getCell(4).numFmt = numFmt;
    totRow.getCell(5).numFmt = numFmt;
    totRow.getCell(6).numFmt = numFmt;
    totRow.getCell(7).numFmt = intFmt;
    totRow.getCell(8).numFmt = intFmt;
    totRow.getCell(9).numFmt = intFmt;
    totRow.getCell(10).numFmt = '0.0%';
    totRow.eachCell(c => {
      c.border = { top: { style: 'medium' } };
    });
  }

  summarySheet.columns = [
    { width: 18 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 12 },
    { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 10 },
  ];

  // ── Sheet 2: Crop Plans (line detail) ──
  const detailSheet = workbook.addWorksheet('Crop Plans');
  detailSheet.views = [{ state: 'frozen', ySplit: 0 }];

  for (const crop of data.crops) {
    // Crop header
    const cropRow = detailSheet.addRow([
      `${crop.crop} — ${fmtInt(crop.acres)} ac | Target: ${fmtNum(crop.target_yield_bu, 0)} bu/ac @ $${fmtNum(crop.commodity_price, 2)}/bu`,
    ]);
    cropRow.font = { bold: true, size: 12 };
    cropRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1565C0' } };
    cropRow.getCell(1).font = { bold: true, size: 12, color: { argb: 'FFFFFF' } };
    detailSheet.mergeCells(cropRow.number, 1, cropRow.number, 8);

    // SEEDING section
    if (crop.seed.inputs.length > 0) {
      const seedLabel = detailSheet.addRow(['SEEDING', '', '', '', '', '', '', '']);
      seedLabel.font = { bold: true };
      seedLabel.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E8F5E9' } };

      detailSheet.addRow(['Product', '', '', 'Rate', 'Unit', '$/Unit', '$/Acre', 'Total $']).font = { bold: true, size: 9 };

      for (const inp of crop.seed.inputs) {
        const r = detailSheet.addRow([inp.product_name, '', '', inp.rate, inp.rate_unit, inp.cost_per_unit, inp.cost_per_acre, inp.total_cost]);
        r.getCell(6).numFmt = dollarFmt;
        r.getCell(7).numFmt = numFmt;
        r.getCell(8).numFmt = intFmt;
      }
      const sub = detailSheet.addRow(['Seed Subtotal', '', '', '', '', '', crop.seed.subtotal_per_acre, crop.seed.subtotal]);
      sub.font = { bold: true };
      sub.getCell(7).numFmt = numFmt;
      sub.getCell(8).numFmt = intFmt;
    }

    // FERTILIZER section
    if (crop.fertilizer.inputs.length > 0) {
      const fertLabel = detailSheet.addRow(['FERTILIZER', '', '', '', '', '', '', '']);
      fertLabel.font = { bold: true };
      fertLabel.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E0' } };

      detailSheet.addRow(['Product', 'Analysis', 'Form', 'Rate', 'Unit', '$/Unit', '$/Acre', 'Total $']).font = { bold: true, size: 9 };

      for (const inp of crop.fertilizer.inputs) {
        const r = detailSheet.addRow([
          inp.product_name, inp.product_analysis, FORM_LABELS[inp.form] || inp.form,
          inp.rate, inp.rate_unit, inp.cost_per_unit, inp.cost_per_acre, inp.total_cost,
        ]);
        r.getCell(6).numFmt = dollarFmt;
        r.getCell(7).numFmt = numFmt;
        r.getCell(8).numFmt = intFmt;
      }
      const sub = detailSheet.addRow(['Fertilizer Subtotal', '', '', '', '', '', crop.fertilizer.subtotal_per_acre, crop.fertilizer.subtotal]);
      sub.font = { bold: true };
      sub.getCell(7).numFmt = numFmt;
      sub.getCell(8).numFmt = intFmt;
    }

    // CHEMICAL section
    if (crop.chemical.inputs.length > 0) {
      const chemLabel = detailSheet.addRow(['CHEMICAL', '', '', '', '', '', '', '']);
      chemLabel.font = { bold: true };
      chemLabel.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E3F2FD' } };

      detailSheet.addRow(['Product', 'Timing', '', 'Rate', 'Unit', '$/Unit', '$/Acre', 'Total $']).font = { bold: true, size: 9 };

      for (const inp of crop.chemical.inputs) {
        const r = detailSheet.addRow([
          inp.product_name, TIMING_LABELS[inp.timing] || inp.timing, '',
          inp.rate, inp.rate_unit, inp.cost_per_unit, inp.cost_per_acre, inp.total_cost,
        ]);
        r.getCell(6).numFmt = dollarFmt;
        r.getCell(7).numFmt = numFmt;
        r.getCell(8).numFmt = intFmt;
      }
      const sub = detailSheet.addRow(['Chemical Subtotal', '', '', '', '', '', crop.chemical.subtotal_per_acre, crop.chemical.subtotal]);
      sub.font = { bold: true };
      sub.getCell(7).numFmt = numFmt;
      sub.getCell(8).numFmt = intFmt;
    }

    // Crop total row
    const totRow = detailSheet.addRow([
      `${crop.crop} Total`, '', '', '', '', '',
      crop.total_per_acre, crop.total_cost,
    ]);
    totRow.font = { bold: true };
    totRow.eachCell(c => { c.border = { top: { style: 'medium' }, bottom: { style: 'medium' } }; });
    totRow.getCell(7).numFmt = numFmt;
    totRow.getCell(8).numFmt = intFmt;

    detailSheet.addRow([]); // spacer
  }

  detailSheet.columns = [
    { width: 28 }, { width: 14 }, { width: 10 }, { width: 10 }, { width: 12 },
    { width: 12 }, { width: 12 }, { width: 14 },
  ];

  return workbook;
}

// ─── PDF Export ──────────────────────────────────────────────────────

export async function generateAgronomyPdf(farmId, cropYear) {
  const data = await getExportData(farmId, cropYear);
  const dateStr = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

  const noBorder = [false, false, false, false];
  const colors = {
    primary: '#1565C0', accent: '#2E7D32', warn: '#E65100',
    grey: '#757575', lightGrey: '#F5F5F5',
    headerBg: '#1565C0', headerText: '#FFFFFF',
    seedBg: '#E8F5E9', fertBg: '#FFF3E0', chemBg: '#E3F2FD',
  };
  const cleanLayout = {
    hLineWidth: () => 0, vLineWidth: () => 0,
    paddingLeft: () => 6, paddingRight: () => 6,
    paddingTop: () => 3, paddingBottom: () => 3,
  };

  // ─── Title ───
  const titleBar = {
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          { text: data.farmName.toUpperCase(), fontSize: 9, color: '#FFFFFF', bold: true, margin: [0, 0, 0, 2] },
          { text: `Crop Input Plan — FY${data.cropYear}`, fontSize: 16, color: '#FFFFFF', bold: true },
          { text: `Status: ${(data.planStatus || 'N/A').toUpperCase()}  |  Generated: ${dateStr}`, fontSize: 8, color: '#B3D4FC' },
        ],
        fillColor: colors.primary,
        border: noBorder,
        margin: [8, 8, 8, 8],
      }]],
    },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
    margin: [0, 0, 0, 14],
  };

  // ─── Farm Summary Table ───
  const summaryHeaders = ['Crop', 'Acres', 'Seed $/ac', 'Fert $/ac', 'Chem $/ac', 'Total $/ac', 'Total $', 'Revenue $', 'Margin $', 'Margin %'];
  const summaryBody = [
    summaryHeaders.map(h => ({
      text: h, bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: h === 'Crop' ? 'left' : 'right', border: noBorder,
    })),
    ...data.crops.map((c, i) => {
      const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
      const marginColor = c.margin >= 0 ? colors.accent : '#D32F2F';
      return [
        { text: c.crop, bold: true, fontSize: 8, fillColor: bg, border: noBorder },
        { text: fmtInt(c.acres), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
        { text: fmtNum(c.seed.subtotal_per_acre), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
        { text: fmtNum(c.fertilizer.subtotal_per_acre), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
        { text: fmtNum(c.chemical.subtotal_per_acre), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
        { text: fmtNum(c.total_per_acre), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder, bold: true },
        { text: fmtDollar(c.total_cost), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
        { text: fmtDollar(c.revenue), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
        { text: fmtDollar(c.margin), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder, color: marginColor, bold: true },
        { text: c.revenue > 0 ? `${((c.margin / c.revenue) * 100).toFixed(1)}%` : '—', fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
      ];
    }),
  ];

  // Summary total row
  if (data.summary) {
    const s = data.summary;
    summaryBody.push([
      { text: 'TOTAL', bold: true, fontSize: 8, fillColor: '#E8EAF6', border: noBorder },
      { text: fmtInt(s.total_acres), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
      { text: fmtNum(s.total_acres > 0 ? s.seed_total / s.total_acres : 0), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
      { text: fmtNum(s.total_acres > 0 ? s.fert_total / s.total_acres : 0), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
      { text: fmtNum(s.total_acres > 0 ? s.chem_total / s.total_acres : 0), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
      { text: fmtNum(s.cost_per_acre), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
      { text: fmtDollar(s.total_cost), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
      { text: fmtDollar(s.total_revenue), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
      { text: fmtDollar(s.total_margin), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder, color: s.total_margin >= 0 ? colors.accent : '#D32F2F' },
      { text: s.total_revenue > 0 ? `${((s.total_margin / s.total_revenue) * 100).toFixed(1)}%` : '—', bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
    ]);
  }

  const summaryTable = {
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
      body: summaryBody,
    },
    layout: cleanLayout,
    margin: [0, 0, 0, 16],
  };

  // ─── Per-Crop Detail Sections ───
  const cropSections = [];

  for (const crop of data.crops) {
    const cropContent = [];

    // Crop header bar
    cropContent.push({
      table: {
        widths: ['*'],
        body: [[{
          text: `${crop.crop} — ${fmtInt(crop.acres)} ac  |  Target: ${fmtNum(crop.target_yield_bu, 0)} bu/ac @ $${fmtNum(crop.commodity_price, 2)}/bu`,
          fontSize: 10, bold: true, color: '#FFFFFF',
          fillColor: colors.primary, border: noBorder,
          margin: [6, 4, 6, 4],
        }]],
      },
      layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
      margin: [0, 0, 0, 4],
    });

    // Helper: build section table
    const buildSection = (label, bgColor, headers, inputs, subtotalPerAcre, subtotal) => {
      if (inputs.length === 0) return;

      const body = [
        headers.map(h => ({
          text: h, bold: true, fontSize: 7, color: colors.headerText, fillColor: '#455A64', border: noBorder,
          alignment: ['Product'].includes(h) ? 'left' : 'right',
        })),
        ...inputs.map((inp, i) => {
          const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
          const cells = [];
          cells.push({ text: inp.product_name, fontSize: 7, fillColor: bg, border: noBorder });
          // Extra columns per section
          if (label === 'FERTILIZER') {
            cells.push({ text: inp.product_analysis, fontSize: 7, fillColor: bg, border: noBorder, color: colors.grey });
            cells.push({ text: FORM_LABELS[inp.form] || inp.form || '', fontSize: 7, fillColor: bg, border: noBorder });
          } else if (label === 'CHEMICAL') {
            cells.push({ text: TIMING_LABELS[inp.timing] || inp.timing || '', fontSize: 7, fillColor: bg, border: noBorder });
          }
          cells.push({ text: fmtNum(inp.rate, 1), fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder });
          cells.push({ text: inp.rate_unit, fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder });
          cells.push({ text: `$${fmtNum(inp.cost_per_unit, 4)}`, fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder });
          cells.push({ text: `$${fmtNum(inp.cost_per_acre)}`, fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder });
          cells.push({ text: fmtDollar(inp.total_cost), fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder });
          return cells;
        }),
      ];

      // Subtotal row
      const subCells = Array(headers.length).fill({ text: '', fillColor: bgColor, border: noBorder });
      subCells[0] = { text: `${label} Subtotal`, bold: true, fontSize: 7, fillColor: bgColor, border: noBorder };
      subCells[headers.length - 2] = { text: `$${fmtNum(subtotalPerAcre)}`, bold: true, fontSize: 7, alignment: 'right', fillColor: bgColor, border: noBorder };
      subCells[headers.length - 1] = { text: fmtDollar(subtotal), bold: true, fontSize: 7, alignment: 'right', fillColor: bgColor, border: noBorder };
      body.push(subCells);

      const colCount = headers.length;
      cropContent.push({
        table: {
          headerRows: 1,
          widths: Array(colCount).fill('auto').map((_, i) => i === 0 ? '*' : 'auto'),
          body,
        },
        layout: cleanLayout,
        margin: [0, 0, 0, 4],
      });
    };

    buildSection('SEEDING', colors.seedBg,
      ['Product', 'Rate', 'Unit', '$/Unit', '$/Acre', 'Total $'],
      crop.seed.inputs, crop.seed.subtotal_per_acre, crop.seed.subtotal);

    buildSection('FERTILIZER', colors.fertBg,
      ['Product', 'Analysis', 'Form', 'Rate', 'Unit', '$/Unit', '$/Acre', 'Total $'],
      crop.fertilizer.inputs, crop.fertilizer.subtotal_per_acre, crop.fertilizer.subtotal);

    buildSection('CHEMICAL', colors.chemBg,
      ['Product', 'Timing', 'Rate', 'Unit', '$/Unit', '$/Acre', 'Total $'],
      crop.chemical.inputs, crop.chemical.subtotal_per_acre, crop.chemical.subtotal);

    // Crop total bar
    cropContent.push({
      table: {
        widths: ['*', 'auto', 'auto', 'auto'],
        body: [[
          { text: `${crop.crop} Total`, bold: true, fontSize: 8, border: noBorder, fillColor: '#E8EAF6' },
          { text: `$${fmtNum(crop.total_per_acre)}/ac`, bold: true, fontSize: 8, alignment: 'right', border: noBorder, fillColor: '#E8EAF6' },
          { text: `Total: ${fmtDollar(crop.total_cost)}`, bold: true, fontSize: 8, alignment: 'right', border: noBorder, fillColor: '#E8EAF6' },
          { text: `Margin: ${fmtDollar(crop.margin)}`, bold: true, fontSize: 8, alignment: 'right', border: noBorder, fillColor: '#E8EAF6', color: crop.margin >= 0 ? colors.accent : '#D32F2F' },
        ]],
      },
      layout: cleanLayout,
      margin: [0, 0, 0, 12],
    });

    cropSections.push({ stack: cropContent, unbreakable: true });
  }

  const footer = {
    text: `C2 Farms  |  ${data.farmName}  |  Generated ${dateStr}`,
    fontSize: 6, color: colors.grey, alignment: 'center', margin: [0, 14, 0, 0],
  };

  return {
    pageOrientation: 'landscape',
    pageSize: 'LEGAL',
    pageMargins: [28, 28, 28, 28],
    content: [
      titleBar,
      { text: 'Farm Summary', style: 'sectionHeader' },
      summaryTable,
      { text: 'Crop Input Detail', style: 'sectionHeader' },
      ...cropSections,
      footer,
    ],
    styles: {
      sectionHeader: { fontSize: 11, bold: true, color: colors.primary, margin: [0, 4, 0, 6] },
    },
    defaultStyle: { fontSize: 8 },
  };
}

// ─── CSV Export ──────────────────────────────────────────────────────

export async function generateAgronomyCsv(farmId, cropYear) {
  const data = await getExportData(farmId, cropYear);

  const escapeCsv = (val) => {
    const s = val == null ? '' : String(val);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const headers = ['Crop', 'Acres', 'Category', 'Product', 'Analysis', 'Timing', 'Form', 'Rate', 'Unit', '$/Unit', '$/Acre', 'Total $'];
  const lines = [headers.map(escapeCsv).join(',')];

  for (const crop of data.crops) {
    const allInputs = [
      ...crop.seed.inputs.map(i => ({ ...i, category: 'Seed' })),
      ...crop.fertilizer.inputs.map(i => ({ ...i, category: 'Fertilizer' })),
      ...crop.chemical.inputs.map(i => ({ ...i, category: 'Chemical' })),
    ];

    for (const inp of allInputs) {
      lines.push([
        crop.crop, crop.acres, inp.category, inp.product_name,
        inp.product_analysis, TIMING_LABELS[inp.timing] || inp.timing || '',
        FORM_LABELS[inp.form] || inp.form || '',
        inp.rate, inp.rate_unit, inp.cost_per_unit,
        inp.cost_per_acre, inp.total_cost,
      ].map(escapeCsv).join(','));
    }
  }

  return lines.join('\n');
}
