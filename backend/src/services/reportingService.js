import ExcelJS from 'exceljs';
import prisma from '../config/database.js';
import { generateFiscalMonths } from '../utils/fiscalYear.js';
import { buildStatementRows } from './exportService.js';
import { getFarmCategories } from './categoryService.js';
import { getExecutiveDashboard } from './agronomyService.js';
import { getDashboard as getLabourDashboard } from './labourService.js';
import { getContractFulfillment } from './marketingService.js';
import { getAvailableToSell } from './inventoryService.js';
import {
  sectionTitle, noData,
  buildBuCropPlanSection, buildBuProcurementSection, buildBuLabourSection,
  buildBuCostModelSection, buildBuPerAcreSection,
  buildEnterpriseMarketingSection, buildEnterpriseLogisticsSection, buildEnterpriseInventorySection,
  buildCoverPage, buildBuDivider,
} from './auditReportService.js';
import createLogger from '../utils/logger.js';

const log = createLogger('reporting-service');

const BU_SECTIONS = ['crop_plan', 'procurement', 'labour', 'cost_model', 'per_acre'];

export async function generateCustomReport({ fiscalYear, farmIds, sections, format }) {
  log.info(`Generating custom report: FY${fiscalYear}, format=${format}, sections=${sections.join(',')}`);

  const enterpriseFarm = await prisma.farm.findFirst({ where: { is_enterprise: true } });
  const enterpriseFarmId = enterpriseFarm?.id;

  // Resolve BU farms
  let buFarms;
  if (farmIds.includes('all')) {
    buFarms = await prisma.farm.findMany({
      where: { is_enterprise: false, farm_type: 'farm' },
      orderBy: { name: 'asc' },
    });
  } else {
    buFarms = await prisma.farm.findMany({
      where: { id: { in: farmIds }, is_enterprise: false, farm_type: 'farm' },
      orderBy: { name: 'asc' },
    });
  }

  const hasBuSections = sections.some(s => BU_SECTIONS.includes(s));
  const months = generateFiscalMonths();
  const cropYear = fiscalYear;

  // Pre-fetch data needed for BU sections
  let assumptions = {};
  let buCropResults = [];
  let buLabourResults = [];

  if (hasBuSections && buFarms.length > 0) {
    const assumptionRows = await prisma.assumption.findMany({
      where: { fiscal_year: fiscalYear, farm_id: { in: buFarms.map(f => f.id) } },
    });
    for (const a of assumptionRows) assumptions[a.farm_id] = a;

    if (sections.includes('crop_plan')) {
      for (const farm of buFarms) {
        const dashboard = await getExecutiveDashboard(farm.id, cropYear);
        buCropResults.push({ farmId: farm.id, farmName: farm.name, dashboard });
      }
    }

    if (sections.includes('labour')) {
      for (const farm of buFarms) {
        const dashboard = await getLabourDashboard(farm.id, fiscalYear);
        buLabourResults.push({ farmId: farm.id, farmName: farm.name, dashboard });
      }
    }
  }

  if (format === 'pdf') {
    return buildPdfReport({ fiscalYear, buFarms, enterpriseFarmId, sections, months, cropYear, assumptions, buCropResults, buLabourResults });
  } else if (format === 'excel') {
    return buildExcelReport({ fiscalYear, buFarms, enterpriseFarmId, sections, months, cropYear, assumptions, buCropResults, buLabourResults });
  } else {
    return buildCsvReport({ fiscalYear, buFarms, enterpriseFarmId, sections, months, cropYear, assumptions, buCropResults, buLabourResults });
  }
}

// ─── PDF ─────────────────────────────────────────────────────────────

async function buildPdfReport({ fiscalYear, buFarms, enterpriseFarmId, sections, months, cropYear, assumptions, buCropResults }) {
  const content = [];

  // Cover page with selected BUs
  if (buFarms.length > 0 && buCropResults.length > 0) {
    content.push(...buildCoverPage(fiscalYear, buFarms, assumptions, buCropResults));
  } else {
    // Minimal title page
    content.push(
      { text: ' ', margin: [0, 100, 0, 0] },
      { text: 'C2 Farms', fontSize: 28, bold: true, alignment: 'center', color: '#1565c0' },
      { text: 'Custom Report', fontSize: 22, alignment: 'center', color: '#333', margin: [0, 4, 0, 20] },
      { text: `Fiscal Year ${fiscalYear} (Nov ${fiscalYear - 1} – Oct ${fiscalYear})`, fontSize: 12, alignment: 'center', color: '#666' },
    );
  }

  // BU sections
  const hasBuSections = sections.some(s => BU_SECTIONS.includes(s));
  if (hasBuSections && buFarms.length > 0) {
    for (const farm of buFarms) {
      const assumption = assumptions[farm.id];
      const cropResult = buCropResults.find(r => r.farmId === farm.id);
      const cropsSummary = cropResult?.dashboard?.crops?.map(c => ({ crop: c.crop, acres: c.acres })) || [];
      content.push(...buildBuDivider(farm, assumption, cropsSummary));

      const farmCategories = await getFarmCategories(farm.id);

      if (sections.includes('crop_plan')) {
        const section = cropResult?.dashboard
          ? await buildBuCropPlanSection(farm.id, farm.name, cropYear)
          : [sectionTitle(`Crop Plan — ${farm.name}`), noData('No agronomy plan found.')];
        content.push(...section);
      }

      if (sections.includes('procurement') && enterpriseFarmId) {
        content.push(...await buildBuProcurementSection(enterpriseFarmId, farm.id, farm.name, cropYear));
      }

      if (sections.includes('labour')) {
        content.push(...await buildBuLabourSection(farm.id, farm.name, fiscalYear));
      }

      if (sections.includes('cost_model')) {
        content.push(...await buildBuCostModelSection(farm.id, farm.name, fiscalYear, farmCategories, months));
      }

      if (sections.includes('per_acre')) {
        content.push(...await buildBuPerAcreSection(farm.id, farm.name, fiscalYear, farmCategories, months));
      }
    }
  }

  // Enterprise sections
  if (enterpriseFarmId) {
    if (sections.includes('marketing')) {
      content.push(...await buildEnterpriseMarketingSection(enterpriseFarmId));
    }
    if (sections.includes('logistics')) {
      content.push(...await buildEnterpriseLogisticsSection(enterpriseFarmId, fiscalYear));
    }
    if (sections.includes('inventory')) {
      content.push(...await buildEnterpriseInventorySection(enterpriseFarmId));
    }
  }

  const docDefinition = {
    pageOrientation: 'landscape',
    pageSize: 'LETTER',
    pageMargins: [30, 40, 30, 30],
    content,
    styles: {
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 4] },
      subtitle: { fontSize: 10, color: '#666' },
      sectionHeader: { fontSize: 11, bold: true, color: '#1565c0' },
    },
    defaultStyle: { fontSize: 7, font: 'Roboto' },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: `C2 Farms — Custom Report FY${fiscalYear}`, fontSize: 7, color: '#999', margin: [30, 0, 0, 0] },
        { text: `Page ${currentPage} of ${pageCount}`, fontSize: 7, color: '#999', alignment: 'right', margin: [0, 0, 30, 0] },
      ],
    }),
  };

  return {
    contentType: 'application/pdf',
    filename: `c2-custom-report-FY${fiscalYear}.pdf`,
    docDefinition,
    format: 'pdf',
  };
}

// ─── Excel ───────────────────────────────────────────────────────────

async function buildExcelReport({ fiscalYear, buFarms, enterpriseFarmId, sections, months, cropYear, buCropResults, buLabourResults }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'C2 Farms';

  const numFmt = '#,##0.00;(#,##0.00);"-"';

  // BU sections
  for (const farm of buFarms) {
    const farmCategories = await getFarmCategories(farm.id);

    if (sections.includes('crop_plan')) {
      const dashboard = buCropResults.find(r => r.farmId === farm.id)?.dashboard;
      if (dashboard) {
        const sheet = workbook.addWorksheet(`Crop Plan - ${farm.name}`.substring(0, 31));
        const header = sheet.addRow(['Crop', 'Acres', 'Seed $/ac', 'Fert $/ac', 'Chem $/ac', 'Cost $/ac', 'Revenue', 'Margin']);
        header.font = { bold: true };
        for (const c of dashboard.crops) {
          sheet.addRow([c.crop, c.acres, c.seed_per_acre, c.fert_per_acre, c.chem_per_acre, c.total_per_acre, c.revenue, c.margin]);
        }
        const f = dashboard.farm;
        const totalRow = sheet.addRow(['Total', f.acres, f.acres > 0 ? f.seed_total / f.acres : 0, f.acres > 0 ? f.fert_total / f.acres : 0, f.acres > 0 ? f.chem_total / f.acres : 0, f.cost_per_acre, f.revenue, f.margin]);
        totalRow.font = { bold: true };
        sheet.columns.forEach(col => { col.width = 16; });
      }
    }

    if (sections.includes('procurement') && enterpriseFarmId) {
      const lines = await prisma.procurementContractLine.findMany({
        where: { bu_farm_id: farm.id, contract: { farm_id: enterpriseFarmId, crop_year: cropYear } },
        include: { contract: { select: { contract_number: true, status: true, counterparty: { select: { name: true } } } } },
        orderBy: { product_name: 'asc' },
      });
      if (lines.length > 0) {
        const sheet = workbook.addWorksheet(`Procurement - ${farm.name}`.substring(0, 31));
        const header = sheet.addRow(['Contract #', 'Product', 'Category', 'Qty', 'Unit', 'Unit Price', 'Line Total', 'Status']);
        header.font = { bold: true };
        for (const l of lines) {
          sheet.addRow([l.contract.contract_number, l.product_name, l.input_category, l.qty, l.qty_unit, l.unit_price, l.line_total, l.contract.status]);
        }
        sheet.columns.forEach(col => { col.width = 16; });
      }
    }

    if (sections.includes('labour')) {
      const dashboard = buLabourResults.find(r => r.farmId === farm.id)?.dashboard;
      if (!dashboard) {
        const freshDashboard = await getLabourDashboard(farm.id, fiscalYear);
        if (freshDashboard) {
          const sheet = workbook.addWorksheet(`Labour - ${farm.name}`.substring(0, 31));
          addLabourSheet(sheet, freshDashboard);
        }
      } else {
        const sheet = workbook.addWorksheet(`Labour - ${farm.name}`.substring(0, 31));
        addLabourSheet(sheet, dashboard);
      }
    }

    if (sections.includes('cost_model')) {
      const accountingData = await prisma.monthlyData.findMany({
        where: { farm_id: farm.id, fiscal_year: fiscalYear, type: 'accounting' },
      });
      if (accountingData.length > 0) {
        const dataMap = {};
        for (const row of accountingData) dataMap[row.month] = row.data_json || {};
        const statementRows = buildStatementRows(farmCategories, dataMap, months);
        const sheet = workbook.addWorksheet(`Cost Model - ${farm.name}`.substring(0, 31));
        buildExcelStatementSheet(sheet, statementRows, months, numFmt);
      }
    }

    if (sections.includes('per_acre')) {
      const perUnitData = await prisma.monthlyData.findMany({
        where: { farm_id: farm.id, fiscal_year: fiscalYear, type: 'per_unit' },
      });
      if (perUnitData.length > 0) {
        const dataMap = {};
        for (const row of perUnitData) dataMap[row.month] = row.data_json || {};
        const statementRows = buildStatementRows(farmCategories, dataMap, months);
        const sheet = workbook.addWorksheet(`Per Acre - ${farm.name}`.substring(0, 31));
        buildExcelStatementSheet(sheet, statementRows, months, numFmt);
      }
    }
  }

  // Enterprise sections
  if (enterpriseFarmId) {
    if (sections.includes('marketing')) {
      const fulfillment = await getContractFulfillment(enterpriseFarmId);
      if (fulfillment?.length > 0) {
        const sheet = workbook.addWorksheet('Marketing Contracts');
        const header = sheet.addRow(['Contract #', 'Commodity', 'Buyer', 'Contracted MT', 'Hauled MT', 'Settled MT', 'Remaining MT', '% Done']);
        header.font = { bold: true };
        for (const c of fulfillment) {
          sheet.addRow([c.contract_number, c.commodity, c.buyer, c.contracted_mt, c.hauled_mt, c.settled_net_mt, c.remaining_mt, c.pct_complete]);
        }
        sheet.columns.forEach(col => { col.width = 16; });
      }
    }

    if (sections.includes('logistics')) {
      const startDate = new Date(fiscalYear - 1, 10, 1);
      const endDate = new Date(fiscalYear, 10, 1);
      const [ticketStats, settlementStats, settledTicketCount] = await Promise.all([
        prisma.deliveryTicket.aggregate({
          where: { farm_id: enterpriseFarmId, delivery_date: { gte: startDate, lt: endDate } },
          _count: true, _sum: { net_weight_mt: true },
        }),
        prisma.settlement.findMany({
          where: { farm_id: enterpriseFarmId, settlement_date: { gte: startDate, lt: endDate } },
          select: { status: true, total_amount: true },
        }),
        prisma.deliveryTicket.count({
          where: { farm_id: enterpriseFarmId, delivery_date: { gte: startDate, lt: endDate }, settled: true },
        }),
      ]);
      const totalSettlementValue = settlementStats.reduce((s, st) => s + (st.total_amount || 0), 0);
      const approvedCount = settlementStats.filter(s => s.status === 'approved').length;

      const sheet = workbook.addWorksheet('Logistics Summary');
      const header = sheet.addRow(['Metric', 'Value']);
      header.font = { bold: true };
      sheet.addRow(['Delivery Tickets', ticketStats._count]);
      sheet.addRow(['Total Hauled MT', ticketStats._sum.net_weight_mt || 0]);
      sheet.addRow(['Settled Tickets', settledTicketCount]);
      sheet.addRow(['Unsettled Tickets', ticketStats._count - settledTicketCount]);
      sheet.addRow(['Total Settlements', settlementStats.length]);
      sheet.addRow(['Total Settlement Value', totalSettlementValue]);
      sheet.addRow(['Approved Settlements', approvedCount]);
      sheet.addRow(['Pending Settlements', settlementStats.length - approvedCount]);
      sheet.columns.forEach(col => { col.width = 24; });
    }

    if (sections.includes('inventory')) {
      const available = await getAvailableToSell(enterpriseFarmId);
      if (available?.length > 0) {
        const sheet = workbook.addWorksheet('Inventory Position');
        const header = sheet.addRow(['Commodity', 'Bin Count MT', 'Contracted MT', 'Available MT', '% Committed']);
        header.font = { bold: true };
        for (const item of available) {
          sheet.addRow([item.commodity_name, item.total_mt, item.contracted_mt, item.available_mt, item.pct_committed]);
        }
        sheet.columns.forEach(col => { col.width = 18; });
      }
    }
  }

  return {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename: `c2-custom-report-FY${fiscalYear}.xlsx`,
    workbook,
    format: 'excel',
  };
}

function addLabourSheet(sheet, dashboard) {
  const summaryHeader = sheet.addRow(['Avg Wage', 'Total Hours', 'Total Cost', 'Acres', 'Cost/Acre']);
  summaryHeader.font = { bold: true };
  sheet.addRow([dashboard.avg_wage, dashboard.total_hours, dashboard.total_cost, dashboard.total_acres, dashboard.cost_per_acre]);
  sheet.addRow([]);
  const seasonHeader = sheet.addRow(['Season', 'Hours', 'Cost', 'Roles']);
  seasonHeader.font = { bold: true };
  for (const s of dashboard.seasons) {
    sheet.addRow([s.name, s.hours, s.cost, s.role_count]);
  }
  sheet.columns.forEach(col => { col.width = 16; });
}

function buildExcelStatementSheet(sheet, statementRows, months, numFmt) {
  const headerRow = sheet.addRow(['Category', ...months, 'Total']);
  headerRow.font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of statementRows) {
    switch (row.type) {
      case 'header': {
        const r = sheet.addRow([row.label]);
        r.font = { bold: true };
        break;
      }
      case 'child': {
        const r = sheet.addRow([`    ${row.label}`, ...row.values, row.total]);
        for (let col = 2; col <= months.length + 2; col++) r.getCell(col).numFmt = numFmt;
        break;
      }
      case 'subtotal': {
        const r = sheet.addRow([`  ${row.label}`, ...row.values, row.total]);
        r.font = { bold: true };
        for (let col = 2; col <= months.length + 2; col++) {
          const cell = r.getCell(col);
          cell.numFmt = numFmt;
          cell.border = { top: { style: 'thin' } };
        }
        break;
      }
      case 'grandTotal': {
        const r = sheet.addRow([row.label, ...row.values, row.total]);
        r.font = { bold: true };
        for (let col = 2; col <= months.length + 2; col++) {
          const cell = r.getCell(col);
          cell.numFmt = numFmt;
          cell.border = { top: { style: 'thin' } };
        }
        break;
      }
      case 'profit': {
        const r = sheet.addRow([row.label, ...row.values, row.total]);
        r.font = { bold: true };
        for (let col = 2; col <= months.length + 2; col++) {
          const cell = r.getCell(col);
          cell.numFmt = numFmt;
          cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
        }
        break;
      }
      case 'blank': {
        const r = sheet.addRow([]);
        r.height = 8;
        break;
      }
    }
  }

  sheet.getColumn(1).width = 35;
  for (let col = 2; col <= months.length + 2; col++) sheet.getColumn(col).width = 14;
}

// ─── CSV ─────────────────────────────────────────────────────────────

async function buildCsvReport({ fiscalYear, buFarms, enterpriseFarmId, sections, months, cropYear, buCropResults, buLabourResults }) {
  const lines = [];

  function addSection(title, headers, rows) {
    if (lines.length > 0) lines.push('');
    lines.push(title);
    lines.push(headers.map(escapeCsv).join(','));
    for (const row of rows) {
      lines.push(row.map(escapeCsv).join(','));
    }
  }

  // BU sections
  for (const farm of buFarms) {
    if (sections.includes('crop_plan')) {
      const dashboard = buCropResults.find(r => r.farmId === farm.id)?.dashboard;
      if (dashboard) {
        const rows = dashboard.crops.map(c => [c.crop, c.acres, c.seed_per_acre, c.fert_per_acre, c.chem_per_acre, c.total_per_acre, c.revenue, c.margin]);
        addSection(`Crop Plan - ${farm.name}`, ['Crop', 'Acres', 'Seed $/ac', 'Fert $/ac', 'Chem $/ac', 'Cost $/ac', 'Revenue', 'Margin'], rows);
      }
    }

    if (sections.includes('procurement') && enterpriseFarmId) {
      const procLines = await prisma.procurementContractLine.findMany({
        where: { bu_farm_id: farm.id, contract: { farm_id: enterpriseFarmId, crop_year: cropYear } },
        include: { contract: { select: { contract_number: true, status: true } } },
        orderBy: { product_name: 'asc' },
      });
      if (procLines.length > 0) {
        const rows = procLines.map(l => [l.contract.contract_number, l.product_name, l.input_category, l.qty, l.qty_unit, l.unit_price, l.line_total, l.contract.status]);
        addSection(`Procurement - ${farm.name}`, ['Contract #', 'Product', 'Category', 'Qty', 'Unit', 'Unit Price', 'Line Total', 'Status'], rows);
      }
    }

    if (sections.includes('labour')) {
      let dashboard = buLabourResults.find(r => r.farmId === farm.id)?.dashboard;
      if (!dashboard) dashboard = await getLabourDashboard(farm.id, fiscalYear);
      if (dashboard) {
        const rows = dashboard.seasons.map(s => [s.name, s.hours, s.cost, s.role_count]);
        addSection(`Labour - ${farm.name}`, ['Season', 'Hours', 'Cost', 'Roles'], rows);
      }
    }

    if (sections.includes('cost_model')) {
      const farmCategories = await getFarmCategories(farm.id);
      const accountingData = await prisma.monthlyData.findMany({
        where: { farm_id: farm.id, fiscal_year: fiscalYear, type: 'accounting' },
      });
      if (accountingData.length > 0) {
        const dataMap = {};
        for (const row of accountingData) dataMap[row.month] = row.data_json || {};
        const statementRows = buildStatementRows(farmCategories, dataMap, months);
        const rows = statementRows.filter(r => r.type !== 'blank').map(r => [r.label, ...r.values, r.total]);
        addSection(`Operating Statement - ${farm.name}`, ['Category', ...months, 'Total'], rows);
      }
    }

    if (sections.includes('per_acre')) {
      const farmCategories = await getFarmCategories(farm.id);
      const perUnitData = await prisma.monthlyData.findMany({
        where: { farm_id: farm.id, fiscal_year: fiscalYear, type: 'per_unit' },
      });
      if (perUnitData.length > 0) {
        const dataMap = {};
        for (const row of perUnitData) dataMap[row.month] = row.data_json || {};
        const statementRows = buildStatementRows(farmCategories, dataMap, months);
        const rows = statementRows.filter(r => r.type !== 'blank').map(r => [r.label, ...r.values, r.total]);
        addSection(`Per-Acre Analysis - ${farm.name}`, ['Category', ...months, 'Total'], rows);
      }
    }
  }

  // Enterprise sections
  if (enterpriseFarmId) {
    if (sections.includes('marketing')) {
      const fulfillment = await getContractFulfillment(enterpriseFarmId);
      if (fulfillment?.length > 0) {
        const rows = fulfillment.map(c => [c.contract_number, c.commodity, c.buyer, c.contracted_mt, c.hauled_mt, c.settled_net_mt, c.remaining_mt, c.pct_complete]);
        addSection('Marketing Contracts', ['Contract #', 'Commodity', 'Buyer', 'Contracted MT', 'Hauled MT', 'Settled MT', 'Remaining MT', '% Done'], rows);
      }
    }

    if (sections.includes('logistics')) {
      const startDate = new Date(fiscalYear - 1, 10, 1);
      const endDate = new Date(fiscalYear, 10, 1);
      const [ticketStats, settlementStats, settledTicketCount] = await Promise.all([
        prisma.deliveryTicket.aggregate({
          where: { farm_id: enterpriseFarmId, delivery_date: { gte: startDate, lt: endDate } },
          _count: true, _sum: { net_weight_mt: true },
        }),
        prisma.settlement.findMany({
          where: { farm_id: enterpriseFarmId, settlement_date: { gte: startDate, lt: endDate } },
          select: { status: true, total_amount: true },
        }),
        prisma.deliveryTicket.count({
          where: { farm_id: enterpriseFarmId, delivery_date: { gte: startDate, lt: endDate }, settled: true },
        }),
      ]);
      const totalSettlementValue = settlementStats.reduce((s, st) => s + (st.total_amount || 0), 0);
      const approvedCount = settlementStats.filter(s => s.status === 'approved').length;
      addSection('Logistics Summary', ['Metric', 'Value'], [
        ['Delivery Tickets', ticketStats._count],
        ['Total Hauled MT', ticketStats._sum.net_weight_mt || 0],
        ['Settled Tickets', settledTicketCount],
        ['Unsettled Tickets', ticketStats._count - settledTicketCount],
        ['Total Settlements', settlementStats.length],
        ['Total Settlement Value', totalSettlementValue],
        ['Approved Settlements', approvedCount],
        ['Pending Settlements', settlementStats.length - approvedCount],
      ]);
    }

    if (sections.includes('inventory')) {
      const available = await getAvailableToSell(enterpriseFarmId);
      if (available?.length > 0) {
        const rows = available.map(item => [item.commodity_name, item.total_mt, item.contracted_mt, item.available_mt, item.pct_committed]);
        addSection('Inventory Position', ['Commodity', 'Bin Count MT', 'Contracted MT', 'Available MT', '% Committed'], rows);
      }
    }
  }

  return {
    contentType: 'text/csv',
    filename: `c2-custom-report-FY${fiscalYear}.csv`,
    csvString: lines.join('\n'),
    format: 'csv',
  };
}

function escapeCsv(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
