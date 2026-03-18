import ExcelJS from 'exceljs';
import prisma from '../config/database.js';
import { resolveInventoryFarm } from './resolveInventoryFarm.js';

// ─── Data fetcher (shared by all export formats) ───

async function getGradingData(farmId, { location, commodity, crop_year } = {}) {
  const { farmId: entFarmId } = await resolveInventoryFarm(farmId);

  const where = { farm_id: entFarmId };
  if (crop_year) where.crop_year = parseInt(crop_year, 10);

  const binWhere = {};
  if (location) binWhere.location_id = location;
  if (commodity) binWhere.commodity_id = commodity;

  const grades = await prisma.binGrade.findMany({
    where: {
      ...where,
      bin: Object.keys(binWhere).length > 0 ? binWhere : undefined,
    },
    include: {
      bin: {
        include: {
          location: true,
          commodity: true,
        },
      },
    },
    orderBy: [{ bin: { location: { name: 'asc' } } }, { bin: { bin_number: 'asc' } }],
  });

  // Fetch latest inventory counts for context
  const latestPeriod = await prisma.countPeriod.findFirst({
    where: { farm_id: entFarmId },
    orderBy: { period_date: 'desc' },
  });

  let binCountMap = {};
  if (latestPeriod) {
    const binIds = grades.map(g => g.bin_id);
    const binCounts = await prisma.binCount.findMany({
      where: {
        farm_id: entFarmId,
        count_period_id: latestPeriod.id,
        bin_id: { in: binIds },
      },
    });
    for (const bc of binCounts) {
      binCountMap[bc.bin_id] = bc;
    }
  }

  const rows = grades.map(g => {
    const bc = binCountMap[g.bin_id];
    return {
      location: g.bin.location.name,
      bin_number: g.bin.bin_number,
      commodity: g.bin.commodity?.name || '',
      crop_year: g.crop_year,
      inv_bushels: bc?.bushels ?? null,
      inv_mt: bc ? bc.kg / 1000 : null,
      grade: g.grade || '',
      grade_short: g.grade_short || '',
      variety: g.variety || '',
      grade_reason: g.grade_reason || '',
      protein_pct: g.protein_pct,
      moisture_pct: g.moisture_pct,
      dockage_pct: g.dockage_pct,
      test_weight: g.test_weight,
      frost: g.frost || '',
      colour: g.colour || '',
      falling_number: g.falling_number,
      fusarium_pct: g.fusarium_pct,
      status: g.status || 'available',
    };
  });

  const periodLabel = latestPeriod
    ? latestPeriod.period_date.toISOString().split('T')[0]
    : 'N/A';

  return { rows, periodLabel };
}

// ─── Excel Export ───

export async function generateGradingExcel(farmId, filters = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'C2 Farms';

  const { rows } = await getGradingData(farmId, filters);

  // Sheet 1: Grading Detail
  const detailSheet = workbook.addWorksheet('Grading Detail');
  detailSheet.addRow([
    'Location', 'Bin #', 'Commodity', 'Crop Year', 'Inv Bu', 'Inv MT',
    'Grade', 'Grade Short', 'Variety', 'Reason',
    'Protein %', 'Moisture %', 'Dockage %', 'Test Weight',
    'Frost', 'Colour', 'Falling Number', 'Fusarium %', 'Status',
  ]);
  detailSheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) {
    detailSheet.addRow([
      r.location, r.bin_number, r.commodity, r.crop_year,
      r.inv_bushels, r.inv_mt != null ? Math.round(r.inv_mt * 10) / 10 : '',
      r.grade, r.grade_short, r.variety, r.grade_reason,
      r.protein_pct, r.moisture_pct, r.dockage_pct, r.test_weight,
      r.frost, r.colour, r.falling_number, r.fusarium_pct, r.status,
    ]);
  }

  // Sheet 2: Summary by Location
  const locMap = {};
  for (const r of rows) {
    if (!locMap[r.location]) locMap[r.location] = { bins: 0, mt: 0 };
    locMap[r.location].bins++;
    locMap[r.location].mt += r.inv_mt || 0;
  }
  const locSheet = workbook.addWorksheet('By Location');
  locSheet.addRow(['Location', 'Bins Graded', 'Inventory MT']);
  locSheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const [loc, data] of Object.entries(locMap).sort((a, b) => a[0].localeCompare(b[0]))) {
    locSheet.addRow([loc, data.bins, Math.round(data.mt * 10) / 10]);
  }

  // Sheet 3: Summary by Commodity
  const comMap = {};
  for (const r of rows) {
    if (!r.commodity) continue;
    if (!comMap[r.commodity]) comMap[r.commodity] = { bins: 0, mt: 0, proteins: [], moistures: [] };
    comMap[r.commodity].bins++;
    comMap[r.commodity].mt += r.inv_mt || 0;
    if (r.protein_pct != null) comMap[r.commodity].proteins.push(r.protein_pct);
    if (r.moisture_pct != null) comMap[r.commodity].moistures.push(r.moisture_pct);
  }
  const comSheet = workbook.addWorksheet('By Commodity');
  comSheet.addRow(['Commodity', 'Bins Graded', 'Inventory MT', 'Avg Protein %', 'Avg Moisture %']);
  comSheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const [com, data] of Object.entries(comMap).sort((a, b) => b[1].mt - a[1].mt)) {
    const avgProt = data.proteins.length > 0 ? data.proteins.reduce((s, v) => s + v, 0) / data.proteins.length : null;
    const avgMoist = data.moistures.length > 0 ? data.moistures.reduce((s, v) => s + v, 0) / data.moistures.length : null;
    comSheet.addRow([
      com, data.bins, Math.round(data.mt * 10) / 10,
      avgProt != null ? Math.round(avgProt * 100) / 100 : '',
      avgMoist != null ? Math.round(avgMoist * 100) / 100 : '',
    ]);
  }

  return workbook;
}

// ─── PDF Export ───

export async function generateGradingPdf(farmId, filters = {}) {
  const { farmId: entFarmId } = await resolveInventoryFarm(farmId);
  const farm = await prisma.farm.findUnique({ where: { id: entFarmId } });
  const farmName = farm?.name || 'Farm';

  const { rows, periodLabel } = await getGradingData(farmId, filters);

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
    return typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : String(v);
  };

  // ─── KPIs ───
  const totalBins = rows.length;
  const totalMt = rows.reduce((s, r) => s + (r.inv_mt || 0), 0);
  const allProteins = rows.filter(r => r.protein_pct != null).map(r => r.protein_pct);
  const avgProtein = allProteins.length > 0 ? allProteins.reduce((s, v) => s + v, 0) / allProteins.length : null;
  const allMoistures = rows.filter(r => r.moisture_pct != null).map(r => r.moisture_pct);
  const avgMoisture = allMoistures.length > 0 ? allMoistures.reduce((s, v) => s + v, 0) / allMoistures.length : null;
  const commodityCount = new Set(rows.map(r => r.commodity).filter(Boolean)).size;
  const locationCount = new Set(rows.map(r => r.location)).size;

  const cropYearLabel = filters.crop_year ? `Crop Year: ${filters.crop_year}` : 'All Crop Years';

  // ─── Title bar ───
  const titleBar = {
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          { text: farmName.toUpperCase(), fontSize: 9, color: '#FFFFFF', bold: true, margin: [0, 0, 0, 2] },
          { text: 'Bin Grading Report', fontSize: 16, color: '#FFFFFF', bold: true },
          { text: `${cropYearLabel}  |  Inventory Period: ${periodLabel}  |  Generated: ${dateStr}`, fontSize: 8, color: '#B3D4FC' },
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
      widths: ['*', '*', '*', '*', '*'],
      body: [[
        kpiCard('Bins Graded', String(totalBins), `${locationCount} locations`),
        kpiCard('Total Inventory', `${fmtNum(totalMt)} MT`, `${commodityCount} commodities`),
        kpiCard('Avg Protein', avgProtein != null ? `${avgProtein.toFixed(2)}%` : '—', allProteins.length > 0 ? `${Math.min(...allProteins).toFixed(1)}–${Math.max(...allProteins).toFixed(1)}%` : ''),
        kpiCard('Avg Moisture', avgMoisture != null ? `${avgMoisture.toFixed(2)}%` : '—', allMoistures.length > 0 ? `${Math.min(...allMoistures).toFixed(1)}–${Math.max(...allMoistures).toFixed(1)}%` : ''),
        kpiCard('Commodities', String(commodityCount), `across ${locationCount} sites`),
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

  // ─── Summary by Commodity ───
  const comMap = {};
  for (const r of rows) {
    if (!r.commodity) continue;
    if (!comMap[r.commodity]) comMap[r.commodity] = { bins: 0, mt: 0, proteins: [], moistures: [], dockages: [] };
    comMap[r.commodity].bins++;
    comMap[r.commodity].mt += r.inv_mt || 0;
    if (r.protein_pct != null) comMap[r.commodity].proteins.push(r.protein_pct);
    if (r.moisture_pct != null) comMap[r.commodity].moistures.push(r.moisture_pct);
    if (r.dockage_pct != null) comMap[r.commodity].dockages.push(r.dockage_pct);
  }
  const comSummary = Object.entries(comMap).sort((a, b) => b[1].mt - a[1].mt);
  const avg = (arr) => arr.length > 0 ? (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2) : '—';

  const comTable = {
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'],
      body: [
        ['Commodity', 'Bins', 'Inventory MT', 'Avg Protein %', 'Avg Moisture %', 'Avg Dockage %'].map(h =>
          ({ text: h, bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, border: noBorder })
        ),
        ...comSummary.map(([name, data], i) => {
          const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
          return [
            { text: name, bold: true, fontSize: 8, fillColor: bg, border: noBorder },
            { text: String(data.bins), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
            { text: fmtNum(data.mt), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
            { text: avg(data.proteins), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
            { text: avg(data.moistures), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
            { text: avg(data.dockages), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
          ];
        }),
        [
          { text: 'Total', bold: true, fontSize: 8, fillColor: '#E8EAF6', border: noBorder },
          { text: String(totalBins), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
          { text: fmtNum(totalMt), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
          { text: '', fillColor: '#E8EAF6', border: noBorder },
          { text: '', fillColor: '#E8EAF6', border: noBorder },
          { text: '', fillColor: '#E8EAF6', border: noBorder },
        ],
      ],
    },
    layout: cleanLayout,
    margin: [0, 0, 0, 12],
  };

  // ─── Grade Distribution ───
  const gradeMap = {};
  for (const r of rows) {
    const key = r.grade_short || r.grade || 'Ungraded';
    if (!gradeMap[key]) gradeMap[key] = { count: 0, mt: 0 };
    gradeMap[key].count++;
    gradeMap[key].mt += r.inv_mt || 0;
  }
  const gradeSummary = Object.entries(gradeMap).sort((a, b) => b[1].mt - a[1].mt);
  const maxGradeMt = gradeSummary.length > 0 ? gradeSummary[0][1].mt : 1;

  const gradeTable = {
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto', '*'],
      body: [
        ['Grade', 'Bins', 'Inventory MT', ''].map(h =>
          ({ text: h, bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, border: noBorder })
        ),
        ...gradeSummary.map(([name, data], i) => {
          const barWidth = Math.max(8, Math.round((data.mt / maxGradeMt) * 140));
          const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
          return [
            { text: name, bold: true, fontSize: 8, fillColor: bg, border: noBorder },
            { text: String(data.count), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
            { text: fmtNum(data.mt), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
            {
              table: { widths: [barWidth], body: [[{ text: '', fillColor: colors.accent, border: noBorder }]] },
              layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 3, paddingBottom: () => 3 },
              fillColor: bg, border: noBorder,
            },
          ];
        }),
      ],
    },
    layout: cleanLayout,
    margin: [0, 0, 0, 12],
  };

  // ─── Bin Detail table ───
  const detailBody = [
    ['Location', 'Bin #', 'Commodity', 'Inv MT', 'Grade', 'Variety', 'Prot %', 'Mst %', 'Dkg %', 'TWT', 'Frost', 'Status'].map(h =>
      ({ text: h, bold: true, fontSize: 7, color: colors.headerText, fillColor: colors.headerBg, border: noBorder })
    ),
    ...rows.map((r, i) => {
      const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
      return [
        { text: r.location, fontSize: 7, fillColor: bg, border: noBorder },
        { text: r.bin_number, fontSize: 7, fillColor: bg, border: noBorder },
        { text: r.commodity, fontSize: 7, fillColor: bg, border: noBorder },
        { text: r.inv_mt != null ? fmtNum(r.inv_mt) : '—', fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder },
        { text: r.grade_short || r.grade, fontSize: 7, fillColor: bg, border: noBorder },
        { text: r.variety, fontSize: 7, fillColor: bg, border: noBorder },
        { text: r.protein_pct != null ? r.protein_pct.toFixed(2) : '—', fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder },
        { text: r.moisture_pct != null ? r.moisture_pct.toFixed(2) : '—', fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder },
        { text: r.dockage_pct != null ? r.dockage_pct.toFixed(2) : '—', fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder },
        { text: r.test_weight != null ? fmtNum(r.test_weight) : '—', fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder },
        { text: r.frost, fontSize: 7, fillColor: bg, border: noBorder },
        { text: r.status, fontSize: 7, fillColor: bg, border: noBorder },
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
      section('Quality Summary by Commodity', comTable),
      section('Grade Distribution', gradeTable),
      footer,
      // Detail pages
      { text: 'Bin Grading Detail', style: 'sectionHeader', pageBreak: 'before' },
      { text: `${rows.length} bins  |  ${cropYearLabel}  |  Inventory Period: ${periodLabel}`, fontSize: 7, color: colors.grey, margin: [0, 0, 0, 6] },
      {
        table: {
          headerRows: 1,
          widths: ['auto', 'auto', 'auto', 'auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
          body: detailBody,
        },
        layout: {
          hLineWidth: () => 0, vLineWidth: () => 0,
          paddingLeft: () => 4, paddingRight: () => 4,
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

export async function generateGradingCsv(farmId, filters = {}) {
  const { rows } = await getGradingData(farmId, filters);

  const escapeCsv = (val) => {
    const s = val == null ? '' : String(val);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const columns = [
    'Location', 'Bin #', 'Commodity', 'Crop Year', 'Inv Bushels', 'Inv MT',
    'Grade', 'Grade Short', 'Variety', 'Reason',
    'Protein %', 'Moisture %', 'Dockage %', 'Test Weight',
    'Frost', 'Colour', 'Falling Number', 'Fusarium %', 'Status',
  ];

  const lines = [columns.map(escapeCsv).join(',')];
  for (const r of rows) {
    lines.push([
      r.location, r.bin_number, r.commodity, r.crop_year,
      r.inv_bushels, r.inv_mt != null ? Math.round(r.inv_mt * 10) / 10 : '',
      r.grade, r.grade_short, r.variety, r.grade_reason,
      r.protein_pct, r.moisture_pct, r.dockage_pct, r.test_weight,
      r.frost, r.colour, r.falling_number, r.fusarium_pct, r.status,
    ].map(escapeCsv).join(','));
  }
  return lines.join('\n');
}
