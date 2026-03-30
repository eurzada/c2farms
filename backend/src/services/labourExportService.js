import ExcelJS from 'exceljs';
import prisma from '../config/database.js';
import { getPlan } from './labourService.js';
import { tableLayout } from './exportService.js';
import createLogger from '../utils/logger.js';

const _log = createLogger('labour-export');

// ─── Formatting helpers ──────────────────────────────────────────────

function fmtDollar(v, d = 2) {
  if (v == null) return '$0.00';
  return `$${(v || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
function fmtNum(v, d = 2) {
  if (v == null) return '—';
  return typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : String(v);
}
function fmtInt(v) {
  return typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(v || '—');
}

function shortName(name) { return (name || '').replace(/^C2\s*/i, ''); }

const SEASON_ORDER = { 'Winter': 1, 'Seeding': 2, 'Summer': 3, 'Harvest': 4, 'Fall Work': 5 };

// ─── Shared Data Fetcher ─────────────────────────────────────────────

async function getLabourExportData(fiscalYear) {
  const year = Number(fiscalYear);

  const buFarms = await prisma.farm.findMany({
    where: { is_enterprise: { not: true } },
    orderBy: { name: 'asc' },
  });

  // Fetch full plan (with seasons→roles) for each BU
  const farmResults = await Promise.all(
    buFarms.map(async (farm) => {
      const plan = await getPlan(farm.id, year);
      if (!plan) return { farm, plan: null, dashboard: null };

      const wage = Number(plan.avg_wage);
      const fuelRate = Number(plan.fuel_rate_per_acre) || 0;
      const fuelCostPerLitre = Number(plan.fuel_cost_per_litre) || 1;
      let totalHours = 0;
      for (const s of plan.seasons) {
        for (const r of s.roles) totalHours += Number(r.hours);
      }
      const totalCost = totalHours * wage;
      const totalFuelCost = fuelRate * (plan.total_acres || 0);
      const totalFuelLitres = fuelCostPerLitre > 0 ? totalFuelCost / fuelCostPerLitre : 0;
      const acres = plan.total_acres || 0;

      return {
        farm,
        plan,
        dashboard: {
          status: plan.status,
          avg_wage: wage,
          fuel_rate_per_acre: fuelRate,
          total_acres: acres,
          total_hours: totalHours,
          total_cost: totalCost,
          total_fuel_cost: totalFuelCost,
          total_fuel_litres: totalFuelLitres,
          litres_per_acre: acres ? totalFuelLitres / acres : 0,
          cost_per_acre: acres ? totalCost / acres : 0,
          hours_per_acre: acres ? totalHours / acres : 0,
        },
      };
    })
  );

  const farmsWithData = farmResults.filter(r => r.dashboard);

  // Enterprise totals
  let totalHours = 0, totalCost = 0, totalAcres = 0, totalFuelCost = 0, totalFuelLitres = 0;
  for (const { dashboard: d } of farmsWithData) {
    totalHours += d.total_hours;
    totalCost += d.total_cost;
    totalAcres += d.total_acres;
    totalFuelCost += d.total_fuel_cost;
    totalFuelLitres += d.total_fuel_litres;
  }
  const totals = {
    totalHours, totalCost, totalAcres, totalFuelCost, totalFuelLitres,
    avgCostPerAcre: totalAcres ? totalCost / totalAcres : 0,
    avgHoursPerAcre: totalAcres ? totalHours / totalAcres : 0,
    avgFuelPerAcre: totalAcres ? totalFuelCost / totalAcres : 0,
    litresPerAcre: totalAcres ? totalFuelLitres / totalAcres : 0,
  };
  const hasFuel = totalFuelCost > 0;

  // ── Build matrix rows (season→role hierarchy) ──
  // Collect all unique seasons and their roles across all farms
  const seasonMap = new Map(); // seasonName → { sortOrder, roleMap: Map<roleName, sortOrder> }
  for (const { plan } of farmsWithData) {
    if (!plan) continue;
    for (const s of plan.seasons) {
      if (!seasonMap.has(s.name)) {
        seasonMap.set(s.name, { sortOrder: SEASON_ORDER[s.name] || 99, roleMap: new Map() });
      }
      const sm = seasonMap.get(s.name);
      for (const r of s.roles) {
        if (!sm.roleMap.has(r.name)) sm.roleMap.set(r.name, r.sort_order);
      }
    }
  }

  // Sort seasons and roles
  const sortedSeasons = [...seasonMap.entries()]
    .sort((a, b) => a[1].sortOrder - b[1].sortOrder);

  // Build lookup: farmId → seasonName → { totalHours, wage, acres, roles: { roleName → hours } }
  const farmLookup = new Map();
  for (const { farm, plan } of farmsWithData) {
    const fMap = new Map();
    if (plan) {
      const wage = Number(plan.avg_wage);
      const acres = plan.total_acres || 0;
      for (const s of plan.seasons) {
        const roles = {};
        let seasonHrs = 0;
        for (const r of s.roles) {
          const hrs = Number(r.hours);
          roles[r.name] = hrs;
          seasonHrs += hrs;
        }
        fMap.set(s.name, { totalHours: seasonHrs, wage, acres, roles });
      }
    }
    farmLookup.set(farm.id, fMap);
  }

  // Compute total hours & cost per season/role across all farms (for TOTAL column)
  const matrixRows = [];
  for (const [seasonName, { roleMap }] of sortedSeasons) {
    // Season row: aggregate hours and cost across all farms
    const seasonValues = {};
    let seasonHrsAll = 0, seasonCostAll = 0;
    for (const { farm } of farmsWithData) {
      const fMap = farmLookup.get(farm.id);
      const sd = fMap?.get(seasonName);
      const hrs = sd?.totalHours || 0;
      const cost = hrs * (sd?.wage || 0);
      const acres = sd?.acres || 0;
      seasonValues[farm.id] = {
        hrsPerAcre: acres ? hrs / acres : 0,
        dolPerAcre: acres ? cost / acres : 0,
      };
      seasonHrsAll += hrs;
      seasonCostAll += cost;
    }
    seasonValues.total = {
      hrsPerAcre: totalAcres ? seasonHrsAll / totalAcres : 0,
      dolPerAcre: totalAcres ? seasonCostAll / totalAcres : 0,
    };
    matrixRows.push({ type: 'season', name: seasonName, values: seasonValues });

    // Role rows under this season
    const sortedRoles = [...roleMap.entries()].sort((a, b) => a[1] - b[1]);
    for (const [roleName] of sortedRoles) {
      const roleValues = {};
      let roleHrsAll = 0, roleCostAll = 0;
      for (const { farm } of farmsWithData) {
        const fMap = farmLookup.get(farm.id);
        const sd = fMap?.get(seasonName);
        const hrs = sd?.roles?.[roleName] || 0;
        const cost = hrs * (sd?.wage || 0);
        const acres = sd?.acres || 0;
        roleValues[farm.id] = {
          hrsPerAcre: acres ? hrs / acres : 0,
          dolPerAcre: acres ? cost / acres : 0,
        };
        roleHrsAll += hrs;
        roleCostAll += cost;
      }
      roleValues.total = {
        hrsPerAcre: totalAcres ? roleHrsAll / totalAcres : 0,
        dolPerAcre: totalAcres ? roleCostAll / totalAcres : 0,
      };
      matrixRows.push({ type: 'role', name: roleName, indent: true, values: roleValues });
    }

  }

  // TOTAL row
  const totalValues = {};
  for (const { farm, dashboard } of farmsWithData) {
    totalValues[farm.id] = {
      hrsPerAcre: dashboard.hours_per_acre,
      dolPerAcre: dashboard.cost_per_acre,
    };
  }
  totalValues.total = {
    hrsPerAcre: totals.avgHoursPerAcre,
    dolPerAcre: totals.avgCostPerAcre,
  };
  matrixRows.push({ type: 'total', name: 'TOTAL', values: totalValues });

  const farmColumns = farmsWithData.map(({ farm }) => ({ id: farm.id, name: shortName(farm.name) }));

  return { farmsWithData, totals, hasFuel, matrixRows, farmColumns, fiscalYear: year };
}

// ─── Excel Export ────────────────────────────────────────────────────

export async function generateLabourExcel(fiscalYear) {
  const data = await getLabourExportData(fiscalYear);
  const { farmsWithData, totals, hasFuel, matrixRows, farmColumns } = data;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'C2 Farms';

  const dollarFmt = '$#,##0.00;($#,##0.00);"-"';
  const intFmt = '#,##0';
  const decFmt = '#,##0.00';

  const dateStr = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

  // ── Sheet 1: Labour Summary ──
  const labSheet = workbook.addWorksheet('Labour Summary');
  labSheet.addRow([`C2 Farms — Enterprise Labour Report — FY${fiscalYear}`]);
  labSheet.getRow(1).font = { bold: true, size: 14 };
  labSheet.addRow([`Generated: ${dateStr}`]);
  labSheet.getRow(2).font = { size: 10, color: { argb: '666666' } };
  labSheet.addRow([]);

  // KPI header
  labSheet.addRow(['Farms', 'Total Acres', 'Total Hours', 'Total Cost', 'Avg $/Acre', 'Avg Hrs/Acre']);
  labSheet.getRow(4).font = { bold: true };
  labSheet.getRow(4).eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E8EAF6' } }; });
  const kpiRow = labSheet.addRow([
    farmsWithData.length, totals.totalAcres, totals.totalHours, totals.totalCost,
    totals.avgCostPerAcre, totals.avgHoursPerAcre,
  ]);
  kpiRow.getCell(2).numFmt = intFmt;
  kpiRow.getCell(3).numFmt = intFmt;
  kpiRow.getCell(4).numFmt = dollarFmt;
  kpiRow.getCell(5).numFmt = dollarFmt;
  kpiRow.getCell(6).numFmt = decFmt;
  labSheet.addRow([]);

  // Per-farm table
  const labHeaders = ['Farm Unit', 'Acres', 'Total Hours', 'Hrs/Acre', 'Avg Wage', 'Total Cost', '$/Acre', 'Status'];
  const labHeaderRow = labSheet.addRow(labHeaders);
  labHeaderRow.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1565C0' } };
    c.font = { bold: true, color: { argb: 'FFFFFF' } };
  });
  labSheet.views = [{ state: 'frozen', ySplit: 7 }];

  for (const { farm, dashboard } of farmsWithData) {
    const d = dashboard;
    const row = labSheet.addRow([
      shortName(farm.name), d.total_acres, d.total_hours,
      d.hours_per_acre, d.avg_wage, d.total_cost, d.cost_per_acre, d.status,
    ]);
    row.getCell(2).numFmt = intFmt;
    row.getCell(3).numFmt = intFmt;
    row.getCell(4).numFmt = decFmt;
    row.getCell(5).numFmt = dollarFmt;
    row.getCell(6).numFmt = dollarFmt;
    row.getCell(7).numFmt = dollarFmt;
  }

  const labTotRow = labSheet.addRow([
    'TOTAL', totals.totalAcres, totals.totalHours,
    totals.avgHoursPerAcre, '', totals.totalCost, totals.avgCostPerAcre, '',
  ]);
  labTotRow.font = { bold: true };
  labTotRow.getCell(2).numFmt = intFmt;
  labTotRow.getCell(3).numFmt = intFmt;
  labTotRow.getCell(4).numFmt = decFmt;
  labTotRow.getCell(6).numFmt = dollarFmt;
  labTotRow.getCell(7).numFmt = dollarFmt;
  labTotRow.eachCell(c => { c.border = { top: { style: 'medium' } }; });

  labSheet.columns = [
    { width: 18 }, { width: 10 }, { width: 12 }, { width: 10 },
    { width: 12 }, { width: 14 }, { width: 12 }, { width: 10 },
  ];

  // ── Sheet 2: Fuel Summary (conditional) ──
  if (hasFuel) {
    const fuelSheet = workbook.addWorksheet('Fuel Summary');
    fuelSheet.addRow([`C2 Farms — Enterprise Fuel Summary — FY${fiscalYear}`]);
    fuelSheet.getRow(1).font = { bold: true, size: 14 };
    fuelSheet.addRow([`Generated: ${dateStr}`]);
    fuelSheet.getRow(2).font = { size: 10, color: { argb: '666666' } };
    fuelSheet.addRow([]);

    const fuelHeaders = ['Farm Unit', 'Acres', 'L/Acre', 'Fuel $/Acre', 'Total Fuel Cost', 'Status'];
    const fuelHeaderRow = fuelSheet.addRow(fuelHeaders);
    fuelHeaderRow.eachCell(c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1565C0' } };
      c.font = { bold: true, color: { argb: 'FFFFFF' } };
    });
    fuelSheet.views = [{ state: 'frozen', ySplit: 4 }];

    for (const { farm, dashboard } of farmsWithData) {
      const d = dashboard;
      if (d.total_fuel_cost <= 0) continue;
      const row = fuelSheet.addRow([
        shortName(farm.name), d.total_acres, d.litres_per_acre,
        d.fuel_rate_per_acre, d.total_fuel_cost, d.status,
      ]);
      row.getCell(2).numFmt = intFmt;
      row.getCell(3).numFmt = decFmt;
      row.getCell(4).numFmt = dollarFmt;
      row.getCell(5).numFmt = dollarFmt;
    }

    const fuelTotRow = fuelSheet.addRow([
      'TOTAL', totals.totalAcres, totals.litresPerAcre,
      totals.avgFuelPerAcre, totals.totalFuelCost, '',
    ]);
    fuelTotRow.font = { bold: true };
    fuelTotRow.getCell(2).numFmt = intFmt;
    fuelTotRow.getCell(3).numFmt = decFmt;
    fuelTotRow.getCell(4).numFmt = dollarFmt;
    fuelTotRow.getCell(5).numFmt = dollarFmt;
    fuelTotRow.eachCell(c => { c.border = { top: { style: 'medium' } }; });

    fuelSheet.columns = [
      { width: 18 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 16 }, { width: 10 },
    ];
  }

  // ── Sheet 3: Hours per Acre ──
  const hrsSheet = workbook.addWorksheet('Hours per Acre');
  buildMatrixSheet(hrsSheet, 'Hours per Acre', fiscalYear, dateStr, farmColumns, matrixRows, 'hrsPerAcre', decFmt);

  // ── Sheet 4: Cost per Acre ──
  const costSheet = workbook.addWorksheet('Cost per Acre');
  buildMatrixSheet(costSheet, 'Cost per Acre', fiscalYear, dateStr, farmColumns, matrixRows, 'dolPerAcre', dollarFmt);

  return workbook;
}

function buildMatrixSheet(sheet, title, fiscalYear, dateStr, farmColumns, matrixRows, valueKey, numFmt) {
  sheet.addRow([`C2 Farms — ${title} — FY${fiscalYear}`]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.addRow([`Generated: ${dateStr}`]);
  sheet.getRow(2).font = { size: 10, color: { argb: '666666' } };
  sheet.addRow([]);

  const headers = ['Category', ...farmColumns.map(f => f.name), 'TOTAL'];
  const headerRow = sheet.addRow(headers);
  headerRow.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1565C0' } };
    c.font = { bold: true, color: { argb: 'FFFFFF' } };
  });
  sheet.views = [{ state: 'frozen', ySplit: 4 }];

  for (const mr of matrixRows) {
    const label = mr.indent ? `  ${mr.name}` : mr.name;
    const vals = farmColumns.map(f => mr.values[f.id]?.[valueKey] || 0);
    const totalVal = mr.values.total?.[valueKey] || 0;
    const row = sheet.addRow([label, ...vals, totalVal]);

    // Style
    if (mr.type === 'season') {
      row.font = { bold: true };
      row.eachCell((c, colNumber) => {
        if (colNumber > 1) c.numFmt = numFmt;
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F5F5F5' } };
      });
    } else if (mr.type === 'total') {
      row.font = { bold: true };
      row.eachCell((c, colNumber) => {
        if (colNumber > 1) c.numFmt = numFmt;
        c.border = { top: { style: 'medium' }, bottom: { style: 'double' } };
      });
    } else {
      row.eachCell((c, colNumber) => {
        if (colNumber > 1) c.numFmt = numFmt;
      });
    }
  }

  // Column widths
  sheet.columns = [
    { width: 22 },
    ...farmColumns.map(() => ({ width: 14 })),
    { width: 14 },
  ];
}

// ─── PDF Export ──────────────────────────────────────────────────────

export async function generateLabourPdf(fiscalYear) {
  const data = await getLabourExportData(fiscalYear);
  const { farmsWithData, totals, hasFuel, matrixRows, farmColumns } = data;

  const dateStr = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const topBorder = [false, true, false, false];

  // ── Labour Summary table body ──
  const labHeaders = ['Farm Unit', 'Acres', 'Total Hours', 'Hrs/Acre', 'Avg Wage', 'Total Cost', '$/Acre', 'Status']
    .map(h => ({ text: h, bold: true, fillColor: '#1565C0', color: '#FFFFFF' }));
  const labBody = [labHeaders];

  for (const { farm, dashboard: d } of farmsWithData) {
    labBody.push([
      shortName(farm.name), fmtInt(d.total_acres), fmtInt(d.total_hours),
      fmtNum(d.hours_per_acre), fmtDollar(d.avg_wage), fmtDollar(d.total_cost),
      fmtDollar(d.cost_per_acre), d.status,
    ]);
  }
  labBody.push([
    { text: 'TOTAL', bold: true, border: topBorder },
    { text: fmtInt(totals.totalAcres), bold: true, border: topBorder },
    { text: fmtInt(totals.totalHours), bold: true, border: topBorder },
    { text: fmtNum(totals.avgHoursPerAcre), bold: true, border: topBorder },
    { text: '', bold: true, border: topBorder },
    { text: fmtDollar(totals.totalCost), bold: true, border: topBorder },
    { text: fmtDollar(totals.avgCostPerAcre), bold: true, border: topBorder },
    { text: '', bold: true, border: topBorder },
  ]);

  // ── Fuel Summary table body (conditional) ──
  let fuelContent = [];
  if (hasFuel) {
    const fuelHeaders = ['Farm Unit', 'Acres', 'L/Acre', 'Fuel $/Acre', 'Total Fuel Cost', 'Status']
      .map(h => ({ text: h, bold: true, fillColor: '#1565C0', color: '#FFFFFF' }));
    const fuelBody = [fuelHeaders];
    for (const { farm, dashboard: d } of farmsWithData) {
      if (d.total_fuel_cost <= 0) continue;
      fuelBody.push([
        shortName(farm.name), fmtInt(d.total_acres), fmtNum(d.litres_per_acre),
        fmtDollar(d.fuel_rate_per_acre), fmtDollar(d.total_fuel_cost), d.status,
      ]);
    }
    fuelBody.push([
      { text: 'TOTAL', bold: true, border: topBorder },
      { text: fmtInt(totals.totalAcres), bold: true, border: topBorder },
      { text: fmtNum(totals.litresPerAcre), bold: true, border: topBorder },
      { text: fmtDollar(totals.avgFuelPerAcre), bold: true, border: topBorder },
      { text: fmtDollar(totals.totalFuelCost), bold: true, border: topBorder },
      { text: '', bold: true, border: topBorder },
    ]);
    fuelContent = [
      { text: '', pageBreak: 'before' },
      { text: 'Fuel Summary', style: 'subheader', margin: [0, 0, 0, 6] },
      { table: { headerRows: 1, body: fuelBody }, layout: tableLayout },
    ];
  }

  // ── Matrix table builder ──
  function buildMatrixPdfTable(titleText, valueKey) {
    const mHeaders = ['Category', ...farmColumns.map(f => f.name), 'TOTAL']
      .map(h => ({ text: h, bold: true, fillColor: '#1565C0', color: '#FFFFFF', fontSize: 7 }));
    const mBody = [mHeaders];

    for (const mr of matrixRows) {
      const label = mr.indent ? `  ${mr.name}` : mr.name;
      const vals = farmColumns.map(f => {
        const v = mr.values[f.id]?.[valueKey] || 0;
        const text = valueKey === 'dolPerAcre' ? fmtDollar(v) : fmtNum(v);
        return mr.type === 'total' ? { text, bold: true, border: topBorder } : text;
      });
      const totalV = mr.values.total?.[valueKey] || 0;
      const totalText = valueKey === 'dolPerAcre' ? fmtDollar(totalV) : fmtNum(totalV);

      if (mr.type === 'season') {
        mBody.push([
          { text: label, bold: true, fillColor: '#F5F5F5' },
          ...vals.map(v => ({ text: typeof v === 'string' ? v : v.text, bold: true, fillColor: '#F5F5F5', border: v.border })),
          { text: totalText, bold: true, fillColor: '#F5F5F5' },
        ]);
      } else if (mr.type === 'total') {
        mBody.push([
          { text: label, bold: true, border: topBorder },
          ...vals,
          { text: totalText, bold: true, border: topBorder },
        ]);
      } else {
        mBody.push([label, ...vals.map(v => typeof v === 'string' ? v : v.text), totalText]);
      }
    }

    const widths = [80, ...farmColumns.map(() => '*'), '*'];
    return [
      { text: '', pageBreak: 'before' },
      { text: titleText, style: 'subheader', margin: [0, 0, 0, 6] },
      { table: { headerRows: 1, widths, body: mBody }, layout: tableLayout },
    ];
  }

  const docDefinition = {
    pageOrientation: 'landscape',
    pageSize: 'LETTER',
    pageMargins: [30, 40, 30, 30],
    content: [
      { text: `C2 Farms — Enterprise Labour & Fuel Report — FY${fiscalYear}`, style: 'header' },
      { text: `Generated: ${dateStr}`, style: 'date', margin: [0, 0, 0, 10] },

      // KPI summary
      {
        table: {
          body: [
            ['Farms', 'Total Acres', 'Total Hours', 'Total Cost', 'Avg $/Acre', 'Avg Hrs/Acre'].map(h => ({ text: h, bold: true })),
            [
              String(farmsWithData.length), fmtInt(totals.totalAcres), fmtInt(totals.totalHours),
              fmtDollar(totals.totalCost), fmtDollar(totals.avgCostPerAcre), fmtNum(totals.avgHoursPerAcre),
            ],
          ],
        },
        layout: { ...tableLayout, hLineWidth: () => 0 },
        margin: [0, 0, 0, 12],
      },

      // Labour Summary
      { text: 'Labour Summary', style: 'subheader', margin: [0, 0, 0, 6] },
      { table: { headerRows: 1, body: labBody }, layout: tableLayout },

      // Fuel Summary (conditional)
      ...fuelContent,

      // Hrs/Acre Matrix
      ...buildMatrixPdfTable('Hours per Acre', 'hrsPerAcre'),

      // $/Acre Matrix
      ...buildMatrixPdfTable('Cost per Acre', 'dolPerAcre'),
    ],
    styles: {
      header: { fontSize: 14, bold: true },
      subheader: { fontSize: 11, bold: true },
      date: { fontSize: 9, color: '#666666' },
    },
    defaultStyle: { fontSize: 8 },
  };

  return docDefinition;
}

// ─── CSV Export ──────────────────────────────────────────────────────

export async function generateLabourCsv(fiscalYear) {
  const data = await getLabourExportData(fiscalYear);
  const { farmsWithData, totals, hasFuel, matrixRows, farmColumns } = data;

  const esc = (val) => {
    const s = val == null ? '' : String(val);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const fmtD = (v) => (v || 0).toFixed(2);

  const lines = [];
  lines.push(`Enterprise Labour Report - FY${fiscalYear}`);
  lines.push(`Generated: ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');

  // ── Labour Summary ──
  lines.push('--- Labour Summary ---');
  lines.push(['Farm Unit', 'Acres', 'Total Hours', 'Hrs/Acre', 'Avg Wage', 'Total Cost', '$/Acre', 'Status'].map(esc).join(','));
  for (const { farm, dashboard: d } of farmsWithData) {
    lines.push([
      shortName(farm.name), d.total_acres, Math.round(d.total_hours),
      fmtD(d.hours_per_acre), fmtD(d.avg_wage), fmtD(d.total_cost), fmtD(d.cost_per_acre), d.status,
    ].map(esc).join(','));
  }
  lines.push([
    'TOTAL', totals.totalAcres, Math.round(totals.totalHours),
    fmtD(totals.avgHoursPerAcre), '', fmtD(totals.totalCost), fmtD(totals.avgCostPerAcre), '',
  ].map(esc).join(','));
  lines.push('');

  // ── Fuel Summary ──
  if (hasFuel) {
    lines.push('--- Fuel Summary ---');
    lines.push(['Farm Unit', 'Acres', 'L/Acre', 'Fuel $/Acre', 'Total Fuel Cost', 'Status'].map(esc).join(','));
    for (const { farm, dashboard: d } of farmsWithData) {
      if (d.total_fuel_cost <= 0) continue;
      lines.push([
        shortName(farm.name), d.total_acres, fmtD(d.litres_per_acre),
        fmtD(d.fuel_rate_per_acre), fmtD(d.total_fuel_cost), d.status,
      ].map(esc).join(','));
    }
    lines.push([
      'TOTAL', totals.totalAcres, fmtD(totals.litresPerAcre),
      fmtD(totals.avgFuelPerAcre), fmtD(totals.totalFuelCost), '',
    ].map(esc).join(','));
    lines.push('');
  }

  // ── Hours/Acre Matrix ──
  const farmHeaders = farmColumns.map(f => f.name);
  lines.push('--- Hours per Acre ---');
  lines.push(['Category', ...farmHeaders, 'TOTAL'].map(esc).join(','));
  for (const mr of matrixRows) {
    const label = mr.indent ? `  ${mr.name}` : mr.name;
    const vals = farmColumns.map(f => fmtD(mr.values[f.id]?.hrsPerAcre || 0));
    const totalVal = fmtD(mr.values.total?.hrsPerAcre || 0);
    lines.push([label, ...vals, totalVal].map(esc).join(','));
  }
  lines.push('');

  // ── Cost/Acre Matrix ──
  lines.push('--- Cost per Acre ---');
  lines.push(['Category', ...farmHeaders, 'TOTAL'].map(esc).join(','));
  for (const mr of matrixRows) {
    const label = mr.indent ? `  ${mr.name}` : mr.name;
    const vals = farmColumns.map(f => fmtD(mr.values[f.id]?.dolPerAcre || 0));
    const totalVal = fmtD(mr.values.total?.dolPerAcre || 0);
    lines.push([label, ...vals, totalVal].map(esc).join(','));
  }

  return lines.join('\n');
}
