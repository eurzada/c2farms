import ExcelJS from 'exceljs';
import prisma from '../config/database.js';
import { generateFiscalMonths } from '../utils/fiscalYear.js';
import { getFarmCategories } from './categoryService.js';

/**
 * Build structured accounting statement rows from farm categories and data.
 * Returns array of { label, values[], total, type }
 * type: 'header' | 'child' | 'subtotal' | 'blank' | 'grandTotal' | 'profit'
 */
export function buildStatementRows(farmCategories, dataMap, months) {
  const rows = [];
  const level0 = farmCategories.filter(c => c.level === 0);
  const childrenOf = (parentId) => farmCategories.filter(c => c.parent_id === parentId);

  const revenueGroup = level0.find(c => c.code === 'revenue');
  const expenseGroups = level0.filter(c => c.code !== 'revenue');

  function getValues(code) {
    const values = [];
    let total = 0;
    for (const month of months) {
      const val = dataMap[month]?.[code] || 0;
      values.push(val);
      total += val;
    }
    return { values, total };
  }

  function addSection(parent) {
    const children = childrenOf(parent.id);
    rows.push({ label: parent.display_name, values: [], total: 0, type: 'header' });
    for (const child of children) {
      const { values, total } = getValues(child.code);
      rows.push({ label: child.display_name, values, total, type: 'child' });
    }
    const shortName = parent.display_name.split(' - ')[0];
    const { values: parentValues, total: parentTotal } = getValues(parent.code);
    rows.push({ label: `Total ${shortName}`, values: parentValues, total: parentTotal, type: 'subtotal' });
  }

  // Revenue section
  if (revenueGroup) {
    addSection(revenueGroup);
    rows.push({ label: '', values: [], total: 0, type: 'blank' });
  }

  // Expense sections
  for (const group of expenseGroups) {
    addSection(group);
    rows.push({ label: '', values: [], total: 0, type: 'blank' });
  }

  // Total Expenses = sum of all expense group subtotals
  const round2 = (v) => Math.round(v * 100) / 100;
  const totalExpValues = [];
  let totalExpTotal = 0;
  for (let i = 0; i < months.length; i++) {
    let sum = 0;
    for (const g of expenseGroups) {
      sum += dataMap[months[i]]?.[g.code] || 0;
    }
    totalExpValues.push(round2(sum));
    totalExpTotal += round2(sum);
  }
  totalExpTotal = round2(totalExpTotal);
  rows.push({ label: 'Total Expenses', values: totalExpValues, total: totalExpTotal, type: 'grandTotal' });
  rows.push({ label: '', values: [], total: 0, type: 'blank' });

  // Net Profit = Revenue - Total Expenses
  const revData = revenueGroup ? getValues(revenueGroup.code) : { values: months.map(() => 0), total: 0 };
  const profitValues = months.map((_, i) => round2(revData.values[i] - totalExpValues[i]));
  const profitTotal = round2(profitValues.reduce((a, b) => a + b, 0));
  rows.push({ label: 'Net Profit (Loss)', values: profitValues, total: profitTotal, type: 'profit' });

  return rows;
}

/**
 * Build an Excel sheet from structured statement rows with accounting formatting.
 */
function buildExcelSheet(sheet, statementRows, months) {
  const numFmt = '#,##0.00;(#,##0.00);"-"';

  // Header row
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
        for (let col = 2; col <= months.length + 2; col++) {
          r.getCell(col).numFmt = numFmt;
        }
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

  // Column widths
  sheet.getColumn(1).width = 35;
  for (let col = 2; col <= months.length + 2; col++) {
    sheet.getColumn(col).width = 14;
  }
}

export async function generateExcel(farmId, fiscalYear) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'C2 Farms';

  const assumption = await prisma.assumption.findUnique({
    where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
  });

  const farm = await prisma.farm.findUnique({ where: { id: farmId } });
  const months = generateFiscalMonths(assumption?.start_month || 'Nov');
  const farmCategories = await getFarmCategories(farmId);

  // Fetch data
  const [perUnitData, accountingData] = await Promise.all([
    prisma.monthlyData.findMany({
      where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'per_unit' },
    }),
    prisma.monthlyData.findMany({
      where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'accounting' },
    }),
  ]);

  const perUnitMap = {};
  for (const row of perUnitData) perUnitMap[row.month] = row.data_json || {};

  const accountingMap = {};
  for (const row of accountingData) accountingMap[row.month] = row.data_json || {};

  // Sheet 1: Per-Unit Analysis
  const perUnitSheet = workbook.addWorksheet('Per-Unit Analysis');
  const perUnitRows = buildStatementRows(farmCategories, perUnitMap, months);
  buildExcelSheet(perUnitSheet, perUnitRows, months);

  // Sheet 2: Accounting Statement
  const accountingSheet = workbook.addWorksheet('Accounting Statement');
  const accountingRows = buildStatementRows(farmCategories, accountingMap, months);
  buildExcelSheet(accountingSheet, accountingRows, months);

  // Sheet 3: GL Detail (if GL accounts exist)
  const glAccounts = await prisma.glAccount.findMany({
    where: { farm_id: farmId, is_active: true },
    include: { category: true },
    orderBy: { account_number: 'asc' },
  });

  if (glAccounts.length > 0) {
    const glSheet = workbook.addWorksheet('GL Detail');
    const glActuals = await prisma.glActualDetail.findMany({
      where: { farm_id: farmId, fiscal_year: fiscalYear },
      include: { gl_account: true },
    });

    const glHeader = ['Account #', 'Account Name', 'Category', ...months, 'Total'];
    glSheet.addRow(glHeader);
    glSheet.getRow(1).font = { bold: true };

    for (const gl of glAccounts) {
      const row = [gl.account_number, gl.account_name, gl.category?.display_name || 'Unmapped'];
      let total = 0;
      for (const month of months) {
        const actual = glActuals.find(a => a.gl_account_id === gl.id && a.month === month);
        const val = actual?.amount || 0;
        row.push(val);
        total += val;
      }
      row.push(total);
      glSheet.addRow(row);
    }

    glSheet.columns.forEach(col => { col.width = 16; });
    glSheet.getColumn(1).width = 14;
    glSheet.getColumn(2).width = 30;
    glSheet.getColumn(3).width = 22;
  }

  // Sheet: Assumptions
  if (assumption) {
    const assSheet = workbook.addWorksheet('Assumptions');
    assSheet.addRow(['Farm', farm?.name || '']);
    assSheet.addRow(['Fiscal Year', fiscalYear]);
    assSheet.addRow(['Total Acres', assumption.total_acres]);
    assSheet.addRow([]);
    assSheet.addRow(['Crops']);
    assSheet.addRow(['Name', 'Acres', 'Target Yield', 'Price/Unit']);
    const crops = assumption.crops_json || [];
    for (const crop of crops) {
      assSheet.addRow([crop.name, crop.acres, crop.target_yield, crop.price_per_unit]);
    }
    assSheet.addRow([]);
    assSheet.addRow(['Bins']);
    assSheet.addRow(['Name', 'Capacity', 'Opening Balance', 'Grain Type']);
    const bins = assumption.bins_json || [];
    for (const bin of bins) {
      assSheet.addRow([bin.name, bin.capacity, bin.opening_balance, bin.grain_type]);
    }
    assSheet.columns.forEach(col => { col.width = 18; });
  }

  return workbook;
}

export async function generatePdf(farmId, fiscalYear) {
  const farm = await prisma.farm.findUnique({ where: { id: farmId } });

  const assumption = await prisma.assumption.findUnique({
    where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
  });
  const months = generateFiscalMonths(assumption?.start_month || 'Nov');
  const farmCategories = await getFarmCategories(farmId);

  const accountingData = await prisma.monthlyData.findMany({
    where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'accounting' },
  });

  const accountingMap = {};
  for (const row of accountingData) {
    accountingMap[row.month] = row.data_json || {};
  }

  const statementRows = buildStatementRows(farmCategories, accountingMap, months);

  // Build PDF table body
  const noBorder = [false, false, false, false];
  const topBorder = [false, true, false, false];
  const topAndBottomBorder = [false, true, false, true];
  const bottomBorder = [false, false, false, true];

  const tableBody = [];

  // Header row
  tableBody.push([
    { text: 'Category', bold: true, border: bottomBorder },
    ...months.map(m => ({ text: m, bold: true, alignment: 'right', border: bottomBorder })),
    { text: 'Total', bold: true, alignment: 'right', border: bottomBorder },
  ]);

  for (const row of statementRows) {
    const numCols = months.length;

    switch (row.type) {
      case 'header':
        tableBody.push([
          { text: row.label, bold: true, border: noBorder },
          ...Array(numCols).fill({ text: '', border: noBorder }),
          { text: '', border: noBorder },
        ]);
        break;

      case 'child':
        tableBody.push([
          { text: `    ${row.label}`, border: noBorder },
          ...row.values.map(v => ({ text: formatCurrency(v), alignment: 'right', border: noBorder })),
          { text: formatCurrency(row.total), alignment: 'right', border: noBorder },
        ]);
        break;

      case 'subtotal':
        tableBody.push([
          { text: `  ${row.label}`, bold: true, border: noBorder },
          ...row.values.map(v => ({
            text: formatCurrency(v), alignment: 'right', bold: true, border: topBorder,
          })),
          { text: formatCurrency(row.total), alignment: 'right', bold: true, border: topBorder },
        ]);
        break;

      case 'grandTotal':
        tableBody.push([
          { text: row.label, bold: true, border: noBorder },
          ...row.values.map(v => ({
            text: formatCurrency(v), alignment: 'right', bold: true, border: topBorder,
          })),
          { text: formatCurrency(row.total), alignment: 'right', bold: true, border: topBorder },
        ]);
        break;

      case 'profit':
        tableBody.push([
          { text: row.label, bold: true, border: noBorder },
          ...row.values.map(v => ({
            text: formatCurrency(v), alignment: 'right', bold: true, border: topAndBottomBorder,
          })),
          { text: formatCurrency(row.total), alignment: 'right', bold: true, border: topAndBottomBorder },
        ]);
        break;

      case 'blank':
        tableBody.push([
          { text: '', border: noBorder, fontSize: 4 },
          ...Array(numCols).fill({ text: '', border: noBorder, fontSize: 4 }),
          { text: '', border: noBorder, fontSize: 4 },
        ]);
        break;
    }
  }

  const startMonth = assumption?.start_month || 'Nov';
  const endMonth = assumption?.end_month || 'Oct';

  const docDefinition = {
    pageOrientation: 'landscape',
    pageSize: 'LEGAL',
    pageMargins: [30, 40, 30, 30],
    content: [
      { text: `${farm?.name || 'Farm'} - Operating Statement`, style: 'header' },
      { text: `Fiscal Year ${fiscalYear} (${startMonth} ${fiscalYear - 1} - ${endMonth} ${fiscalYear})`, style: 'subheader' },
      { text: ' ' },
      {
        table: {
          headerRows: 1,
          widths: ['*', ...months.map(() => 60), 60],
          body: tableBody,
        },
        layout: {
          hLineWidth: function () { return 0.5; },
          vLineWidth: function () { return 0; },
          hLineColor: function () { return '#000000'; },
          paddingLeft: function () { return 3; },
          paddingRight: function () { return 3; },
          paddingTop: function () { return 1; },
          paddingBottom: function () { return 1; },
        },
        fontSize: 7,
      },
    ],
    styles: {
      header: { fontSize: 16, bold: true, margin: [0, 0, 0, 5] },
      subheader: { fontSize: 11, color: '#666', margin: [0, 0, 0, 10] },
    },
    defaultStyle: { fontSize: 7 },
  };

  return docDefinition;
}

export function formatCurrency(val) {
  if (Math.abs(val) < 0.005) return '-';
  if (val < 0) return `(${Math.abs(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
  return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
