import ExcelJS from 'exceljs';
import prisma from '../config/database.js';
import * as svc from './agronomyService.js';
import * as procSvc from './procurementContractService.js';
import createLogger from '../utils/logger.js';

const log = createLogger('procurement-export');

// ─── Formatting helpers ──────────────────────────────────────────────

function fmtDollar(v, d = 0) {
  if (v == null) return '$0';
  return `$${(v || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
function fmtNum(v, d = 2) {
  if (v == null) return '—';
  return typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : String(v);
}
function fmtInt(v) {
  return typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(v || '—');
}

const TIMING_LABELS = {
  fall_residual: 'Fall Residual', preburn: 'Pre-Burn',
  incrop: 'In-Crop', fungicide: 'Fungicide', desiccation: 'Desiccation',
};
const TIMING_ORDER = ['fall_residual', 'preburn', 'incrop', 'fungicide', 'desiccation'];

function shortName(name) { return (name || '').replace(/^C2\s*/i, ''); }

// ─── Data Builders (ported from frontend EnterpriseAgroPlan.jsx) ─────

function buildCategoryData(farmsWithData, category) {
  const productMap = new Map();
  const farmTotals = new Map();

  for (const { farm, plan, dashboard } of farmsWithData) {
    const acres = dashboard?.farm?.acres || 0;
    farmTotals.set(farm.id, { cost: 0, acres });
    if (!plan?.allocations) continue;

    for (const alloc of plan.allocations) {
      const inputs = (alloc.inputs || []).filter(i =>
        category === 'seed' ? (i.category === 'seed' || i.category === 'seed_treatment') : i.category === category
      );
      for (const inp of inputs) {
        if (!productMap.has(inp.product_name)) {
          productMap.set(inp.product_name, { unit: inp.rate_unit, unitPrice: inp.cost_per_unit, farms: {} });
        }
        const p = productMap.get(inp.product_name);
        if (!p.farms[farm.id]) p.farms[farm.id] = { cost: 0, volume: 0 };
        // Use per-varietal acres for seed/seed_treatment, allocation acres for others
        const acres = (inp.category === 'seed' || inp.category === 'seed_treatment') && inp.acres != null ? inp.acres : alloc.acres;
        const vol = inp.rate * acres;
        const cost = vol * inp.cost_per_unit;
        p.farms[farm.id].cost += cost;
        p.farms[farm.id].volume += vol;
        farmTotals.get(farm.id).cost += cost;
      }
    }
  }

  const products = [...productMap.entries()]
    .map(([name, data]) => {
      const totalCost = Object.values(data.farms).reduce((s, f) => s + f.cost, 0);
      const totalVol = Object.values(data.farms).reduce((s, f) => s + f.volume, 0);
      return { name, unit: data.unit, unitPrice: data.unitPrice, farms: data.farms, totalCost, totalVol };
    })
    .sort((a, b) => b.totalCost - a.totalCost);

  const grandCost = products.reduce((s, p) => s + p.totalCost, 0);
  const grandAcres = [...farmTotals.values()].reduce((s, f) => s + f.acres, 0);

  return { products, farmTotals, grandCost, grandAcres };
}

function buildStageData(farmsWithData) {
  const stageSet = new Set();
  const farmStage = new Map();
  const farmAcres = new Map();

  for (const { farm, plan, dashboard } of farmsWithData) {
    const acres = dashboard?.farm?.acres || 0;
    farmAcres.set(farm.id, acres);
    farmStage.set(farm.id, {});
    if (!plan?.allocations) continue;

    for (const alloc of plan.allocations) {
      for (const inp of (alloc.inputs || []).filter(i => i.category === 'chemical')) {
        const t = inp.timing || 'other';
        stageSet.add(t);
        const sd = farmStage.get(farm.id);
        sd[t] = (sd[t] || 0) + inp.rate * inp.cost_per_unit * alloc.acres;
      }
    }
  }

  const stages = TIMING_ORDER.filter(t => stageSet.has(t));
  if (stageSet.has('other')) stages.push('other');
  return { stages, farmStage, farmAcres };
}

// ─── Shared Data Fetcher ─────────────────────────────────────────────

async function getProcurementExportData(cropYear) {
  const year = Number(cropYear);

  // Fetch all BU farms (non-enterprise)
  const buFarms = await prisma.farm.findMany({
    where: { is_enterprise: { not: true } },
    orderBy: { name: 'asc' },
  });

  // Fetch plan + dashboard per BU
  const farmResults = await Promise.all(
    buFarms.map(async (farm) => {
      const [plan, dashboard] = await Promise.all([
        svc.getPlan(farm.id, year),
        svc.getExecutiveDashboard(farm.id, year),
      ]);
      return { farm, plan, dashboard };
    })
  );

  const farmsWithData = farmResults.filter(r => r.dashboard?.farm && r.plan?.allocations?.length > 0);

  const seedData = buildCategoryData(farmsWithData, 'seed');
  const fertData = buildCategoryData(farmsWithData, 'fertilizer');
  const chemData = buildCategoryData(farmsWithData, 'chemical');
  const stageData = buildStageData(farmsWithData);

  // Fetch procurement contracts from enterprise farm
  let contracts = [];
  try {
    const ent = await prisma.farm.findFirst({ where: { is_enterprise: true } });
    if (ent) {
      contracts = await procSvc.getContracts(ent.id, { cropYear: year });
    }
  } catch (err) {
    log.warn('Could not fetch procurement contracts for export', err.message);
  }

  return { farmsWithData, seedData, fertData, chemData, stageData, contracts };
}

// ─── Excel Export ────────────────────────────────────────────────────

export async function generateProcurementExcel(cropYear) {
  const data = await getProcurementExportData(cropYear);
  const { farmsWithData, seedData, fertData, chemData, stageData, contracts } = data;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'C2 Farms';

  const dollarFmt = '$#,##0;($#,##0);"-"';
  const decFmt = '$#,##0.00;($#,##0.00);"-"';
  const intFmt = '#,##0';

  const grandAcres = seedData.grandAcres;
  const totalInput = seedData.grandCost + fertData.grandCost + chemData.grandCost;

  // ── Sheet 1: Summary ──
  const sumSheet = workbook.addWorksheet('Summary');
  sumSheet.addRow([`C2 Farms — Procurement Report — Crop Year ${cropYear}`]);
  sumSheet.getRow(1).font = { bold: true, size: 14 };
  sumSheet.addRow([`Generated: ${new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}`]);
  sumSheet.getRow(2).font = { size: 10, color: { argb: '666666' } };
  sumSheet.addRow([]);

  // KPI row
  sumSheet.addRow(['Farms', 'Total Acres', 'Seed', 'Fertilizer', 'Chemistry', 'Total Input', 'Total $/Acre']);
  sumSheet.getRow(4).font = { bold: true };
  sumSheet.getRow(4).eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E8EAF6' } }; });
  const kpiRow = sumSheet.addRow([
    farmsWithData.length, grandAcres, seedData.grandCost, fertData.grandCost, chemData.grandCost,
    totalInput, grandAcres > 0 ? totalInput / grandAcres : 0,
  ]);
  kpiRow.getCell(2).numFmt = intFmt;
  [3, 4, 5, 6].forEach(i => { kpiRow.getCell(i).numFmt = dollarFmt; });
  kpiRow.getCell(7).numFmt = decFmt;
  sumSheet.addRow([]);

  // Cost by Location
  const locHeaders = ['Location', 'Acres', 'Seed $/ac', 'Fert $/ac', 'Chem $/ac', 'Total $/ac'];
  const locHeaderRow = sumSheet.addRow(locHeaders);
  locHeaderRow.font = { bold: true };
  locHeaderRow.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1565C0' } }; c.font = { bold: true, color: { argb: 'FFFFFF' } }; });

  for (const { farm } of farmsWithData) {
    const acres = seedData.farmTotals.get(farm.id)?.acres || 0;
    const s = seedData.farmTotals.get(farm.id)?.cost || 0;
    const f = fertData.farmTotals.get(farm.id)?.cost || 0;
    const c = chemData.farmTotals.get(farm.id)?.cost || 0;
    const row = sumSheet.addRow([
      shortName(farm.name), acres,
      acres > 0 ? s / acres : 0, acres > 0 ? f / acres : 0,
      acres > 0 ? c / acres : 0, acres > 0 ? (s + f + c) / acres : 0,
    ]);
    row.getCell(2).numFmt = intFmt;
    [3, 4, 5, 6].forEach(i => { row.getCell(i).numFmt = decFmt; });
  }

  const totRow = sumSheet.addRow([
    'TOTAL', grandAcres,
    grandAcres > 0 ? seedData.grandCost / grandAcres : 0,
    grandAcres > 0 ? fertData.grandCost / grandAcres : 0,
    grandAcres > 0 ? chemData.grandCost / grandAcres : 0,
    grandAcres > 0 ? totalInput / grandAcres : 0,
  ]);
  totRow.font = { bold: true };
  totRow.getCell(2).numFmt = intFmt;
  [3, 4, 5, 6].forEach(i => { totRow.getCell(i).numFmt = decFmt; });
  totRow.eachCell(c => { c.border = { top: { style: 'medium' } }; });

  sumSheet.columns = [{ width: 18 }, { width: 10 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];

  // ── Product Detail Sheets ──
  const buildProductSheet = (sheetName, catData) => {
    const sheet = workbook.addWorksheet(sheetName);
    const farmCols = farmsWithData.map(({ farm }) => shortName(farm.name));
    const headers = ['Product', '$/Unit', ...farmCols, 'Total'];
    const headerRow = sheet.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1565C0' } }; c.font = { bold: true, color: { argb: 'FFFFFF' } }; });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const p of catData.products) {
      const farmValues = farmsWithData.map(({ farm }) => p.farms[farm.id]?.cost || 0);
      const row = sheet.addRow([p.name, p.unitPrice, ...farmValues, p.totalCost]);
      row.getCell(2).numFmt = decFmt;
      for (let i = 3; i <= 2 + farmValues.length; i++) row.getCell(i).numFmt = dollarFmt;
      row.getCell(3 + farmValues.length).numFmt = dollarFmt;
    }

    // Total row
    const farmTotalValues = farmsWithData.map(({ farm }) => catData.farmTotals.get(farm.id)?.cost || 0);
    const tRow = sheet.addRow(['Total', '', ...farmTotalValues, catData.grandCost]);
    tRow.font = { bold: true };
    for (let i = 3; i <= 2 + farmTotalValues.length; i++) tRow.getCell(i).numFmt = dollarFmt;
    tRow.getCell(3 + farmTotalValues.length).numFmt = dollarFmt;
    tRow.eachCell(c => { c.border = { top: { style: 'medium' } }; });

    sheet.columns = [{ width: 28 }, { width: 12 }, ...farmCols.map(() => ({ width: 14 })), { width: 14 }];
  };

  buildProductSheet('Seed Detail', seedData);
  buildProductSheet('Fertilizer Detail', fertData);
  buildProductSheet('Chemistry Detail', chemData);

  // ── Chemistry by Stage ──
  const { stages, farmStage, farmAcres } = stageData;
  if (stages.length > 0) {
    const stageSheet = workbook.addWorksheet('Chemistry by Stage');
    const stageHeaders = ['Location', ...stages.map(s => TIMING_LABELS[s] || s), 'Total $/ac'];
    const stageHeaderRow = stageSheet.addRow(stageHeaders);
    stageHeaderRow.font = { bold: true };
    stageHeaderRow.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1565C0' } }; c.font = { bold: true, color: { argb: 'FFFFFF' } }; });
    stageSheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const { farm } of farmsWithData) {
      const sd = farmStage.get(farm.id) || {};
      const acres = farmAcres.get(farm.id) || 0;
      let rowTotal = 0;
      const stageVals = stages.map(s => {
        const val = sd[s] || 0;
        rowTotal += val;
        return acres > 0 ? val / acres : 0;
      });
      const row = stageSheet.addRow([shortName(farm.name), ...stageVals, acres > 0 ? rowTotal / acres : 0]);
      for (let i = 2; i <= 1 + stageVals.length + 1; i++) row.getCell(i).numFmt = decFmt;
    }

    // Avg row
    const grandStageAcres = [...farmAcres.values()].reduce((s, v) => s + v, 0);
    const avgVals = stages.map(s => {
      const total = farmsWithData.reduce((sum, { farm }) => sum + (farmStage.get(farm.id)?.[s] || 0), 0);
      return grandStageAcres > 0 ? total / grandStageAcres : 0;
    });
    const grandChemTotal = farmsWithData.reduce((sum, { farm }) => {
      const sd = farmStage.get(farm.id) || {};
      return sum + stages.reduce((ss, s) => ss + (sd[s] || 0), 0);
    }, 0);
    const avgRow = stageSheet.addRow(['Avg $/Acre', ...avgVals, grandStageAcres > 0 ? grandChemTotal / grandStageAcres : 0]);
    avgRow.font = { bold: true };
    for (let i = 2; i <= 1 + avgVals.length + 1; i++) avgRow.getCell(i).numFmt = decFmt;
    avgRow.eachCell(c => { c.border = { top: { style: 'medium' } }; });

    stageSheet.columns = [{ width: 18 }, ...stages.map(() => ({ width: 14 })), { width: 14 }];
  }

  // ── Contracts Sheet ──
  if (contracts.length > 0) {
    const conSheet = workbook.addWorksheet('Contracts');
    const conHeaders = ['Contract #', 'Supplier', 'Category', 'Description', 'Value', 'Status', 'Delivery Window', 'Payment Due'];
    const conHeaderRow = conSheet.addRow(conHeaders);
    conHeaderRow.font = { bold: true };
    conHeaderRow.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1565C0' } }; c.font = { bold: true, color: { argb: 'FFFFFF' } }; });
    conSheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const c of contracts) {
      const row = conSheet.addRow([
        c.contract_number,
        c.counterparty?.name || '',
        c.input_category || '',
        c.description || '',
        c.contract_value || 0,
        c.status || '',
        c.delivery_window || '',
        c.payment_due || '',
      ]);
      row.getCell(5).numFmt = dollarFmt;
    }

    conSheet.columns = [
      { width: 16 }, { width: 22 }, { width: 14 }, { width: 30 },
      { width: 14 }, { width: 14 }, { width: 18 }, { width: 16 },
    ];
  }

  log.info(`Generated procurement Excel for crop year ${cropYear}, ${farmsWithData.length} farms`);
  return workbook;
}

// ─── PDF Export ──────────────────────────────────────────────────────

export async function generateProcurementPdf(cropYear) {
  const data = await getProcurementExportData(cropYear);
  const { farmsWithData, seedData, fertData, chemData, stageData, contracts } = data;

  const dateStr = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const noBorder = [false, false, false, false];
  const colors = {
    primary: '#1565C0', accent: '#2E7D32', grey: '#757575',
    lightGrey: '#F5F5F5', headerBg: '#1565C0', headerText: '#FFFFFF',
  };
  const cleanLayout = {
    hLineWidth: () => 0, vLineWidth: () => 0,
    paddingLeft: () => 6, paddingRight: () => 6,
    paddingTop: () => 3, paddingBottom: () => 3,
  };

  const grandAcres = seedData.grandAcres;
  const totalInput = seedData.grandCost + fertData.grandCost + chemData.grandCost;

  // ─── Title bar ───
  const titleBar = {
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          { text: 'C2 FARMS', fontSize: 9, color: '#FFFFFF', bold: true, margin: [0, 0, 0, 2] },
          { text: 'Procurement Report', fontSize: 16, color: '#FFFFFF', bold: true },
          { text: `Crop Year: ${cropYear}  |  Generated: ${dateStr}`, fontSize: 8, color: '#B3D4FC' },
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
      widths: ['*', '*', '*', '*', '*', '*'],
      body: [[
        kpiCard('Farms', String(farmsWithData.length)),
        kpiCard('Total Acres', fmtInt(grandAcres)),
        kpiCard('Seed', fmtDollar(seedData.grandCost)),
        kpiCard('Fertilizer', fmtDollar(fertData.grandCost)),
        kpiCard('Chemistry', fmtDollar(chemData.grandCost)),
        kpiCard('Total $/Acre', grandAcres > 0 ? fmtDollar(Math.round(totalInput / grandAcres)) : '—'),
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

  // ─── Cost by Location table ───
  const locHeaders = ['Location', 'Acres', 'Seed $/ac', 'Fert $/ac', 'Chem $/ac', 'Total $/ac'];
  const locBody = [
    locHeaders.map(h => ({
      text: h, bold: true, fontSize: 8, color: colors.headerText,
      fillColor: colors.headerBg, border: noBorder,
      alignment: h === 'Location' ? 'left' : 'right',
    })),
    ...farmsWithData.map(({ farm }, i) => {
      const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
      const acres = seedData.farmTotals.get(farm.id)?.acres || 0;
      const s = seedData.farmTotals.get(farm.id)?.cost || 0;
      const f = fertData.farmTotals.get(farm.id)?.cost || 0;
      const c = chemData.farmTotals.get(farm.id)?.cost || 0;
      return [
        { text: shortName(farm.name), bold: true, fontSize: 8, fillColor: bg, border: noBorder },
        { text: fmtInt(acres), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
        { text: acres > 0 ? fmtNum(s / acres) : '—', fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
        { text: acres > 0 ? fmtNum(f / acres) : '—', fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
        { text: acres > 0 ? fmtNum(c / acres) : '—', fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
        { text: acres > 0 ? fmtNum((s + f + c) / acres) : '—', fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder, bold: true },
      ];
    }),
    // Total row
    [
      { text: 'TOTAL', bold: true, fontSize: 8, fillColor: '#E8EAF6', border: noBorder },
      { text: fmtInt(grandAcres), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
      { text: grandAcres > 0 ? fmtNum(seedData.grandCost / grandAcres) : '—', bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
      { text: grandAcres > 0 ? fmtNum(fertData.grandCost / grandAcres) : '—', bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
      { text: grandAcres > 0 ? fmtNum(chemData.grandCost / grandAcres) : '—', bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
      { text: grandAcres > 0 ? fmtNum(totalInput / grandAcres) : '—', bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
    ],
  ];

  const locTable = {
    table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'], body: locBody },
    layout: cleanLayout,
    margin: [0, 0, 0, 16],
  };

  // ─── Product Cost Table builder (PDF) ───
  const buildProductTable = (title, catData) => {
    if (catData.products.length === 0) return [];

    const farmCols = farmsWithData.map(({ farm }) => shortName(farm.name));
    const headers = ['Product', '$/Unit', ...farmCols, 'Total'];
    const body = [
      headers.map(h => ({
        text: h, bold: true, fontSize: 7, color: colors.headerText,
        fillColor: colors.headerBg, border: noBorder,
        alignment: h === 'Product' ? 'left' : 'right',
      })),
      ...catData.products.map((p, i) => {
        const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
        return [
          { text: p.name, fontSize: 7, fillColor: bg, border: noBorder },
          { text: fmtNum(p.unitPrice, 2), fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder, color: colors.grey },
          ...farmsWithData.map(({ farm }) => {
            const cost = p.farms[farm.id]?.cost || 0;
            return { text: cost > 0 ? fmtDollar(cost) : '—', fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder };
          }),
          { text: fmtDollar(p.totalCost), fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder, bold: true },
        ];
      }),
      // Total row
      [
        { text: 'Total', bold: true, fontSize: 7, fillColor: '#E8EAF6', border: noBorder },
        { text: '', fillColor: '#E8EAF6', border: noBorder },
        ...farmsWithData.map(({ farm }) => ({
          text: fmtDollar(catData.farmTotals.get(farm.id)?.cost || 0),
          bold: true, fontSize: 7, alignment: 'right', fillColor: '#E8EAF6', border: noBorder,
        })),
        { text: fmtDollar(catData.grandCost), bold: true, fontSize: 7, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
      ],
    ];

    const widths = ['*', 'auto', ...farmCols.map(() => 'auto'), 'auto'];

    return [
      { text: title, style: 'sectionHeader' },
      { table: { headerRows: 1, widths, body }, layout: cleanLayout, margin: [0, 0, 0, 12] },
    ];
  };

  // ─── Chemistry by Stage table (PDF) ───
  const buildStageTable = () => {
    const { stages, farmStage, farmAcres: stFarmAcres } = stageData;
    if (stages.length === 0) return [];

    const stageGrandAcres = [...stFarmAcres.values()].reduce((s, v) => s + v, 0);
    const headers = ['Location', ...stages.map(s => TIMING_LABELS[s] || s), 'Total $/ac'];
    const body = [
      headers.map(h => ({
        text: h, bold: true, fontSize: 7, color: colors.headerText,
        fillColor: colors.headerBg, border: noBorder,
        alignment: h === 'Location' ? 'left' : 'right',
      })),
      ...farmsWithData.map(({ farm }, i) => {
        const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
        const sd = farmStage.get(farm.id) || {};
        const acres = stFarmAcres.get(farm.id) || 0;
        let rowTotal = 0;
        const vals = stages.map(s => { const v = sd[s] || 0; rowTotal += v; return acres > 0 ? v / acres : 0; });
        return [
          { text: shortName(farm.name), bold: true, fontSize: 7, fillColor: bg, border: noBorder },
          ...vals.map(v => ({ text: v > 0 ? fmtNum(v) : '—', fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder })),
          { text: acres > 0 ? fmtNum(rowTotal / acres) : '—', fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder, bold: true },
        ];
      }),
      // Avg row
      (() => {
        const avgVals = stages.map(s => {
          const total = farmsWithData.reduce((sum, { farm }) => sum + (farmStage.get(farm.id)?.[s] || 0), 0);
          return stageGrandAcres > 0 ? total / stageGrandAcres : 0;
        });
        const grandTotal = farmsWithData.reduce((sum, { farm }) => {
          const sd = farmStage.get(farm.id) || {};
          return sum + stages.reduce((ss, s) => ss + (sd[s] || 0), 0);
        }, 0);
        return [
          { text: 'Avg $/Acre', bold: true, fontSize: 7, fillColor: '#E8EAF6', border: noBorder },
          ...avgVals.map(v => ({ text: fmtNum(v), bold: true, fontSize: 7, alignment: 'right', fillColor: '#E8EAF6', border: noBorder })),
          { text: stageGrandAcres > 0 ? fmtNum(grandTotal / stageGrandAcres) : '—', bold: true, fontSize: 7, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
        ];
      })(),
    ];

    const widths = ['*', ...stages.map(() => 'auto'), 'auto'];

    return [
      { text: 'Chemistry by Stage ($/Acre)', style: 'sectionHeader' },
      { table: { headerRows: 1, widths, body }, layout: cleanLayout, margin: [0, 0, 0, 12] },
    ];
  };

  // ─── Contracts summary (PDF) ───
  const buildContractsTable = () => {
    if (contracts.length === 0) return [];

    const headers = ['Contract #', 'Supplier', 'Category', 'Value', 'Status', 'Delivery Window'];
    const body = [
      headers.map(h => ({
        text: h, bold: true, fontSize: 7, color: colors.headerText,
        fillColor: colors.headerBg, border: noBorder,
        alignment: h === 'Value' ? 'right' : 'left',
      })),
      ...contracts.map((c, i) => {
        const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
        return [
          { text: c.contract_number || '', fontSize: 7, fillColor: bg, border: noBorder },
          { text: c.counterparty?.name || '', fontSize: 7, fillColor: bg, border: noBorder },
          { text: c.input_category || '', fontSize: 7, fillColor: bg, border: noBorder },
          { text: fmtDollar(c.contract_value), fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder },
          { text: c.status || '', fontSize: 7, fillColor: bg, border: noBorder },
          { text: c.delivery_window || '', fontSize: 7, fillColor: bg, border: noBorder },
        ];
      }),
    ];

    return [
      { text: 'Procurement Contracts', style: 'sectionHeader', pageBreak: 'before' },
      { table: { headerRows: 1, widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto'], body }, layout: cleanLayout, margin: [0, 0, 0, 12] },
    ];
  };

  const footer = {
    text: `C2 Farms  |  Procurement Report  |  Generated ${dateStr}`,
    fontSize: 6, color: colors.grey, alignment: 'center', margin: [0, 14, 0, 0],
  };

  const content = [
    titleBar,
    kpiTable,
    { text: 'Cost by Location ($/Acre)', style: 'sectionHeader' },
    locTable,
    ...buildProductTable('Seed', seedData),
    ...buildProductTable('Fertilizer', fertData),
    ...buildProductTable('Chemistry', chemData),
    ...buildStageTable(),
    ...buildContractsTable(),
    footer,
  ];

  log.info(`Generated procurement PDF for crop year ${cropYear}, ${farmsWithData.length} farms`);

  return {
    pageOrientation: 'landscape',
    pageSize: 'LETTER',
    pageMargins: [28, 28, 28, 28],
    content,
    styles: {
      sectionHeader: { fontSize: 11, bold: true, color: colors.primary, margin: [0, 4, 0, 6] },
    },
    defaultStyle: { fontSize: 8 },
  };
}

// ─── CSV Export ──────────────────────────────────────────────────────

export async function generateProcurementCsv(cropYear) {
  const data = await getProcurementExportData(cropYear);
  const { farmsWithData, seedData, fertData, chemData } = data;

  const escapeCsv = (val) => {
    const s = val == null ? '' : String(val);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const farmNames = farmsWithData.map(({ farm }) => shortName(farm.name));
  const lines = [];

  // Section 1: Cost by Location
  lines.push(['Cost by Location'].map(escapeCsv).join(','));
  lines.push(['Location', 'Acres', 'Seed $/ac', 'Fert $/ac', 'Chem $/ac', 'Total $/ac'].map(escapeCsv).join(','));

  const grandAcres = seedData.grandAcres;
  const totalInput = seedData.grandCost + fertData.grandCost + chemData.grandCost;

  for (const { farm } of farmsWithData) {
    const acres = seedData.farmTotals.get(farm.id)?.acres || 0;
    const s = seedData.farmTotals.get(farm.id)?.cost || 0;
    const f = fertData.farmTotals.get(farm.id)?.cost || 0;
    const c = chemData.farmTotals.get(farm.id)?.cost || 0;
    lines.push([
      shortName(farm.name), acres,
      acres > 0 ? (s / acres).toFixed(2) : 0,
      acres > 0 ? (f / acres).toFixed(2) : 0,
      acres > 0 ? (c / acres).toFixed(2) : 0,
      acres > 0 ? ((s + f + c) / acres).toFixed(2) : 0,
    ].map(escapeCsv).join(','));
  }

  lines.push([
    'TOTAL', grandAcres,
    grandAcres > 0 ? (seedData.grandCost / grandAcres).toFixed(2) : 0,
    grandAcres > 0 ? (fertData.grandCost / grandAcres).toFixed(2) : 0,
    grandAcres > 0 ? (chemData.grandCost / grandAcres).toFixed(2) : 0,
    grandAcres > 0 ? (totalInput / grandAcres).toFixed(2) : 0,
  ].map(escapeCsv).join(','));

  lines.push('');

  // Section 2: Product Detail
  lines.push(['Product Detail'].map(escapeCsv).join(','));
  lines.push(['Category', 'Product', '$/Unit', ...farmNames, 'Total'].map(escapeCsv).join(','));

  for (const [catLabel, catData] of [['Seed', seedData], ['Fertilizer', fertData], ['Chemistry', chemData]]) {
    for (const p of catData.products) {
      const farmValues = farmsWithData.map(({ farm }) => (p.farms[farm.id]?.cost || 0).toFixed(0));
      lines.push([
        catLabel, p.name, p.unitPrice?.toFixed(2) || '', ...farmValues, p.totalCost.toFixed(0),
      ].map(escapeCsv).join(','));
    }
  }

  log.info(`Generated procurement CSV for crop year ${cropYear}, ${farmsWithData.length} farms`);
  return lines.join('\n');
}
