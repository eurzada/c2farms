import ExcelJS from 'exceljs';
import prisma from '../config/database.js';
import { resolveInventoryFarm } from './resolveInventoryFarm.js';

// ─── Shared data fetcher ─────────────────────────────────────────────

async function getMatrixData(farmId, filters = {}) {
  const { farmId: resolvedFarmId } = await resolveInventoryFarm(farmId);
  const { from_period, to_period } = filters;

  const periods = await prisma.countPeriod.findMany({
    where: { farm_id: resolvedFarmId },
    orderBy: { period_date: 'desc' },
  });

  if (periods.length === 0) return { rows: [], periodDates: [], farmName: '' };

  const selectedPeriods = periods.filter(p => {
    if (from_period && to_period) {
      return p.period_date >= new Date(from_period) && p.period_date <= new Date(to_period);
    }
    return true;
  }).slice(0, 12);

  const periodIds = selectedPeriods.map(p => p.id);
  const allCounts = await prisma.binCount.findMany({
    where: { farm_id: resolvedFarmId, count_period_id: { in: periodIds } },
    include: {
      commodity: true,
      bin: { include: { location: true } },
      count_period: true,
    },
  });

  const rowMap = {};
  for (const bc of allCounts) {
    if (!bc.commodity || bc.commodity.code === 'FERT') continue;
    const locName = bc.bin?.location?.name || 'Unknown';
    const comName = bc.commodity.name;
    const key = `${locName}|${comName}`;
    const periodDate = bc.count_period.period_date.toISOString().slice(0, 10);

    if (!rowMap[key]) {
      rowMap[key] = { location: locName, commodity: comName, periods: {} };
    }
    const mt = (bc.kg || 0) / 1000;
    rowMap[key].periods[periodDate] = (rowMap[key].periods[periodDate] || 0) + mt;
  }

  const rows = Object.values(rowMap).sort((a, b) => {
    const locCmp = a.location.localeCompare(b.location);
    return locCmp !== 0 ? locCmp : a.commodity.localeCompare(b.commodity);
  });

  const periodDates = selectedPeriods
    .map(p => p.period_date.toISOString().slice(0, 10))
    .sort();

  const farm = await prisma.farm.findUnique({ where: { id: resolvedFarmId } });

  return { rows, periodDates, farmName: farm?.name || 'Farm' };
}

function fmtPeriod(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', timeZone: 'UTC' });
}

function fmtNum(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 });
}

// ─── Excel ───────────────────────────────────────────────────────────

export async function generateCountHistoryExcel(farmId, filters = {}) {
  const { rows, periodDates, farmName } = await getMatrixData(farmId, filters);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'C2 Farms';

  const sheet = workbook.addWorksheet('Count History');

  // Header row
  const headers = ['Location', 'Commodity', ...periodDates.map(fmtPeriod)];
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];

  // Data rows
  for (const r of rows) {
    sheet.addRow([
      r.location,
      r.commodity,
      ...periodDates.map(pd => {
        const v = r.periods[pd];
        return v != null ? Math.round(v * 10) / 10 : null;
      }),
    ]);
  }

  // Totals row
  const totals = ['Total', '', ...periodDates.map(pd => {
    let sum = 0;
    for (const r of rows) sum += r.periods[pd] || 0;
    return Math.round(sum * 10) / 10;
  })];
  const totalRow = sheet.addRow(totals);
  totalRow.font = { bold: true };

  // Auto-width
  sheet.columns.forEach(col => {
    col.width = Math.max(12, (col.header || '').length + 2);
  });

  return workbook;
}

// ─── PDF ─────────────────────────────────────────────────────────────

export async function generateCountHistoryPdf(farmId, filters = {}) {
  const { rows, periodDates, farmName } = await getMatrixData(farmId, filters);
  const dateStr = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const noBorder = [false, false, false, false];
  const colors = { primary: '#1565C0', headerBg: '#1565C0', headerText: '#FFFFFF', grey: '#757575', lightGrey: '#F5F5F5' };

  const titleBar = {
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          { text: farmName.toUpperCase(), fontSize: 9, color: '#FFFFFF', bold: true, margin: [0, 0, 0, 2] },
          { text: 'Count History Matrix', fontSize: 16, color: '#FFFFFF', bold: true },
          { text: `Generated: ${dateStr}`, fontSize: 8, color: '#B3D4FC' },
        ],
        fillColor: colors.primary,
        border: noBorder,
        margin: [8, 8, 8, 8],
      }]],
    },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
    margin: [0, 0, 0, 14],
  };

  const headerCols = ['Location', 'Commodity', ...periodDates.map(fmtPeriod)];
  const colWidths = ['auto', 'auto', ...periodDates.map(() => '*')];

  const tableBody = [
    headerCols.map(h => ({
      text: h, bold: true, fontSize: 7, color: colors.headerText,
      fillColor: colors.headerBg, border: noBorder,
    })),
    ...rows.map((r, i) => {
      const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
      return [
        { text: r.location, fontSize: 7, fillColor: bg, border: noBorder },
        { text: r.commodity, fontSize: 7, fillColor: bg, border: noBorder },
        ...periodDates.map(pd => ({
          text: fmtNum(r.periods[pd]),
          fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder,
        })),
      ];
    }),
    // Totals
    [
      { text: 'Total', bold: true, fontSize: 7, fillColor: '#E8EAF6', border: noBorder },
      { text: '', fillColor: '#E8EAF6', border: noBorder },
      ...periodDates.map(pd => {
        let sum = 0;
        for (const r of rows) sum += r.periods[pd] || 0;
        return {
          text: fmtNum(sum), bold: true, fontSize: 7,
          alignment: 'right', fillColor: '#E8EAF6', border: noBorder,
        };
      }),
    ],
  ];

  return {
    pageOrientation: 'landscape',
    pageSize: 'LETTER',
    pageMargins: [28, 28, 28, 28],
    content: [
      titleBar,
      {
        table: { headerRows: 1, widths: colWidths, body: tableBody },
        layout: {
          hLineWidth: () => 0, vLineWidth: () => 0,
          paddingLeft: () => 4, paddingRight: () => 4,
          paddingTop: () => 3, paddingBottom: () => 3,
        },
      },
      { text: `C2 Farms  |  ${farmName}  |  Generated ${dateStr}`, fontSize: 6, color: colors.grey, alignment: 'center', margin: [0, 14, 0, 0] },
    ],
    defaultStyle: { fontSize: 8 },
  };
}

// ─── CSV ─────────────────────────────────────────────────────────────

export async function generateCountHistoryCsv(farmId, filters = {}) {
  const { rows, periodDates } = await getMatrixData(farmId, filters);

  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const headers = ['Location', 'Commodity', ...periodDates.map(fmtPeriod)];
  const lines = [headers.map(esc).join(',')];

  for (const r of rows) {
    lines.push([
      r.location,
      r.commodity,
      ...periodDates.map(pd => r.periods[pd] != null ? Math.round(r.periods[pd] * 10) / 10 : ''),
    ].map(esc).join(','));
  }

  return lines.join('\n');
}
