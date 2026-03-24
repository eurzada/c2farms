#!/usr/bin/env node
/**
 * Bulk QBO P&L Import Script
 *
 * Imports QuickBooks P&L (monthly) Excel exports into C2 Farms.
 * Feeds data through the existing GL pipeline:
 *   GlAccount → GlActualDetail → rollupGlActuals → MonthlyData
 *
 * Usage:
 *   node src/scripts/importQboPnl.js <path> [--dry-run] [--force] [--basis accrual|cash]
 *
 * File naming: <FarmName>_FY<year>.xlsx  (e.g. Lewvan_FY2025.xlsx)
 * Override file: qbo-account-overrides.json in the same directory
 */

import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { DEFAULT_GL_ACCOUNTS } from '../utils/defaultCategoryTemplate.js';
import { FISCAL_MONTHS, CALENDAR_MONTHS, calendarToFiscal } from '../utils/fiscalYear.js';
import { rollupGlActuals } from '../services/glRollupService.js';
import { invalidateCache } from '../services/categoryService.js';

const prisma = new PrismaClient();

// ─── Account Mapping ────────────────────────────────────────────────────────

// Build name-based lookup from DEFAULT_GL_ACCOUNTS
const EXACT_NAME_MAP = {};
for (const gl of DEFAULT_GL_ACCOUNTS) {
  EXACT_NAME_MAP[gl.account_name.toLowerCase()] = gl.category_code;
}

// Keyword-based fuzzy mapping as fallback
const KEYWORD_RULES = [
  // Revenue
  { keywords: ['canola', 'sales'], code: 'rev_canola' },
  { keywords: ['canola', 'revenue'], code: 'rev_canola' },
  { keywords: ['durum', 'sales'], code: 'rev_durum' },
  { keywords: ['durum', 'revenue'], code: 'rev_durum' },
  { keywords: ['chickpea', 'sales'], code: 'rev_chickpeas' },
  { keywords: ['chickpea', 'revenue'], code: 'rev_chickpeas' },
  { keywords: ['lentil', 'sales'], code: 'rev_small_red_lentils' },
  { keywords: ['lentil', 'revenue'], code: 'rev_small_red_lentils' },
  { keywords: ['barley', 'sales'], code: 'rev_barley' },
  { keywords: ['barley', 'revenue'], code: 'rev_barley' },
  { keywords: ['wheat', 'sales'], code: 'rev_wheat' },
  { keywords: ['wheat', 'revenue'], code: 'rev_wheat' },
  { keywords: ['flax', 'sales'], code: 'rev_flax' },
  { keywords: ['flax', 'revenue'], code: 'rev_flax' },
  { keywords: ['oat', 'sales'], code: 'rev_oats' },
  { keywords: ['oat', 'revenue'], code: 'rev_oats' },
  { keywords: ['pea', 'sales'], code: 'rev_peas' },
  { keywords: ['pea', 'revenue'], code: 'rev_peas' },
  { keywords: ['mustard', 'sales'], code: 'rev_mustard' },
  { keywords: ['mustard', 'revenue'], code: 'rev_mustard' },
  { keywords: ['surface', 'lease'], code: 'rev_other_income' },
  { keywords: ['custom', 'work', 'income'], code: 'rev_other_income' },
  { keywords: ['rebate'], code: 'rev_other_income' },
  { keywords: ['other', 'farm', 'income'], code: 'rev_other_income' },
  { keywords: ['other', 'income'], code: 'rev_other_income' },
  // Inputs
  { keywords: ['seed', 'treatment'], code: 'input_seed' },
  { keywords: ['seed'], code: 'input_seed' },
  { keywords: ['fertiliz'], code: 'input_fert' },
  { keywords: ['micronutrient'], code: 'input_fert' },
  { keywords: ['herbicid'], code: 'input_chem' },
  { keywords: ['fungicid'], code: 'input_chem' },
  { keywords: ['insecticid'], code: 'input_chem' },
  { keywords: ['adjuvant'], code: 'input_chem' },
  { keywords: ['surfactant'], code: 'input_chem' },
  { keywords: ['chemical'], code: 'input_chem' },
  // LPM
  { keywords: ['wage'], code: 'lpm_personnel' },
  { keywords: ['salar'], code: 'lpm_personnel' },
  { keywords: ['benefits'], code: 'lpm_personnel' },
  { keywords: ['wcb'], code: 'lpm_personnel' },
  { keywords: ['contract', 'labour'], code: 'lpm_personnel' },
  { keywords: ['fuel'], code: 'lpm_fog' },
  { keywords: ['oil', 'lubricant'], code: 'lpm_fog' },
  { keywords: ['grease'], code: 'lpm_fog' },
  { keywords: ['equipment', 'repair'], code: 'lpm_repairs' },
  { keywords: ['parts', 'tools'], code: 'lpm_repairs' },
  { keywords: ['tire', 'repair'], code: 'lpm_repairs' },
  { keywords: ['repair'], code: 'lpm_repairs' },
  { keywords: ['shop', 'suppli'], code: 'lpm_shop' },
  { keywords: ['meals'], code: 'lpm_shop' },
  { keywords: ['entertainment'], code: 'lpm_shop' },
  { keywords: ['freight'], code: 'lpm_shop' },
  { keywords: ['trucking'], code: 'lpm_shop' },
  { keywords: ['custom', 'work', 'expense'], code: 'lpm_shop' },
  { keywords: ['utilit'], code: 'lpm_shop' },
  { keywords: ['professional', 'fee'], code: 'lpm_shop' },
  { keywords: ['office', 'expense'], code: 'lpm_shop' },
  { keywords: ['agronomy'], code: 'lpm_shop' },
  { keywords: ['machinery', 'lease'], code: 'lpm_shop' },
  { keywords: ['depreciation', 'machinery'], code: 'lpm_shop' },
  { keywords: ['depreciation', 'building'], code: 'lpm_shop' },
  { keywords: ['depreciation'], code: 'lpm_shop' },
  // LBF
  { keywords: ['land', 'rent'], code: 'lbf_rent_interest' },
  { keywords: ['property', 'tax'], code: 'lbf_rent_interest' },
  { keywords: ['interest'], code: 'lbf_rent_interest' },
  { keywords: ['building', 'repair'], code: 'lbf_rent_interest' },
  { keywords: ['management', 'fee'], code: 'lbf_rent_interest' },
  { keywords: ['income', 'tax'], code: 'lbf_rent_interest' },
  { keywords: ['rent'], code: 'lbf_rent_interest' },
  // Insurance
  { keywords: ['crop', 'insurance'], code: 'ins_crop' },
  { keywords: ['hail', 'insurance'], code: 'ins_crop' },
  { keywords: ['hail'], code: 'ins_crop' },
  { keywords: ['farm', 'insurance'], code: 'ins_other' },
  { keywords: ['liability', 'insurance'], code: 'ins_other' },
  { keywords: ['insurance'], code: 'ins_other' },
];

function mapAccountName(name, overrides) {
  const lower = name.toLowerCase().trim();

  // 1. User overrides (highest priority)
  if (overrides && overrides[name]) return overrides[name] === '__skip__' ? '__skip__' : overrides[name];
  if (overrides && overrides[lower]) return overrides[lower] === '__skip__' ? '__skip__' : overrides[lower];

  // 2. Exact match against DEFAULT_GL_ACCOUNTS names
  if (EXACT_NAME_MAP[lower]) return EXACT_NAME_MAP[lower];

  // 3. Keyword fuzzy match
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.every(kw => lower.includes(kw))) return rule.code;
  }

  return null;
}

// ─── Farm Name Aliases ───────────────────────────────────────────────────────
// Map QBO class names to C2 Farms DB names when they differ
const FARM_NAME_ALIASES = {
  keywest: 'Ogema',
};

// ─── Excel Parsing ──────────────────────────────────────────────────────────

// Month name variations QBO might use
const MONTH_ABBREV = {
  jan: 'Jan', january: 'Jan',
  feb: 'Feb', february: 'Feb',
  mar: 'Mar', march: 'Mar',
  apr: 'Apr', april: 'Apr',
  may: 'May',
  jun: 'Jun', june: 'Jun',
  jul: 'Jul', july: 'Jul',
  aug: 'Aug', august: 'Aug',
  sep: 'Sep', september: 'Sep',
  oct: 'Oct', october: 'Oct',
  nov: 'Nov', november: 'Nov',
  dec: 'Dec', december: 'Dec',
};

// Month name to 0-indexed calendar month number (for fiscal year calculation)
const MONTH_NUM = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function parseMonthYearFromHeader(header) {
  if (!header || typeof header !== 'string') return null;
  const trimmed = header.trim();

  // Skip "Total" column
  if (/^total$/i.test(trimmed)) return null;

  // Try "November 2023", "Nov 2024", "Nov-2024", "Nov.2024"
  let match = trimmed.match(/^([A-Za-z]+)[\s\-\.]+(\d{4})$/);
  if (match) {
    const m = match[1].toLowerCase();
    const month = MONTH_ABBREV[m];
    if (month) return { month, year: parseInt(match[2]) };
  }

  // Try partial-month QBO format: "Mar. 1 - Mar. 20 2026" or "Nov. 1 - Nov. 30 2025"
  match = trimmed.match(/^([A-Za-z]+)\.\s*\d+\s*-\s*[A-Za-z]+\.\s*\d+\s+(\d{4})$/);
  if (match) {
    const m = match[1].toLowerCase();
    const month = MONTH_ABBREV[m];
    if (month) return { month, year: parseInt(match[2]) };
  }

  // Try "Nov-24" (2-digit year)
  match = trimmed.match(/^([A-Za-z]+)[\s\-\.]+(\d{2})$/);
  if (match) {
    const m = match[1].toLowerCase();
    const month = MONTH_ABBREV[m];
    if (month) return { month, year: 2000 + parseInt(match[2]) };
  }

  // Try month name alone (no year — cannot determine fiscal year)
  const m = trimmed.toLowerCase();
  const month = MONTH_ABBREV[m];
  if (month) return { month, year: null };

  return null;
}

function parseAmount(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  if (s === '' || s === '-') return 0;
  // Handle (1,234.56) as negative
  const isNeg = s.startsWith('(') && s.endsWith(')');
  const cleaned = s.replace(/[($,)]/g, '').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return isNeg ? -num : num;
}

// Rows to skip (section headers, totals)
const SKIP_PATTERNS = [
  /^total\s/i,
  /^net\s+(income|loss)/i,
  /^net\s+ordinary/i,
  /^gross\s+profit/i,
  /^other\s+(income|expense)/i,
  /^cost\s+of\s+goods/i,
  /^ordinary\s+income/i,
  /^\s*$/,
];

function shouldSkipRow(accountName) {
  if (!accountName || typeof accountName !== 'string') return true;
  const trimmed = accountName.trim();
  if (trimmed === '') return true;
  // Skip QBO section headers (single words like "Income", "Expenses", or patterns above)
  if (/^(income|expenses?|revenue)$/i.test(trimmed)) return true;
  return SKIP_PATTERNS.some(p => p.test(trimmed));
}

async function parseQboExcel(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('No worksheet found');

  // Find header row (scan rows 1-15 for one containing month names)
  let headerRow = null;
  // columnInfos: array of { month, year, fiscalYear, col } per detected column
  let columnInfos = [];

  const maxCol = Math.min(sheet.columnCount || 100, 200); // cap to avoid ExcelJS overflow
  for (let r = 1; r <= Math.min(15, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    const found = [];
    for (let c = 2; c <= maxCol; c++) {
      const cell = row.getCell(c);
      const val = cell.text || (cell.value && String(cell.value));
      const parsed = parseMonthYearFromHeader(val);
      if (parsed) {
        const fiscalYear = parsed.year != null
          ? calendarToFiscal(new Date(parsed.year, MONTH_NUM[parsed.month], 1)).fiscalYear
          : null;
        found.push({ month: parsed.month, year: parsed.year, fiscalYear, col: c });
      }
    }
    // Need at least 3 months to identify as header row
    if (found.length >= 3) {
      headerRow = r;
      columnInfos = found;
      break;
    }
  }

  if (!headerRow) {
    throw new Error('Could not find header row with month columns. Expected headers like "Nov 2024", "Dec 2024", etc.');
  }

  // Parse account rows (starting after header)
  const accounts = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const accountName = (row.getCell(1).text || String(row.getCell(1).value || '')).trim();

    if (shouldSkipRow(accountName)) continue;

    // months keyed by "FY:Month" (e.g., "2025:Nov") for multi-FY support
    const months = {};
    let hasAnyValue = false;
    for (const colInfo of columnInfos) {
      const val = parseAmount(row.getCell(colInfo.col).value);
      const key = `${colInfo.fiscalYear}:${colInfo.month}`;
      months[key] = val;
      if (val !== 0) hasAnyValue = true;
    }

    // Skip rows where all months are zero
    if (!hasAnyValue) continue;

    accounts.push({ name: accountName, months });
  }

  // Determine which fiscal years are present
  const fiscalYears = [...new Set(columnInfos.map(c => c.fiscalYear).filter(Boolean))].sort();

  return { columnInfos, fiscalYears, accounts };
}

// ─── Filename Parsing ───────────────────────────────────────────────────────

function parseFilename(filename) {
  const base = path.basename(filename, '.xlsx');

  // Try legacy format first: FarmName_FY2025.xlsx
  const legacyMatch = base.match(/^(.+?)_FY(\d{4})$/i);
  if (legacyMatch) {
    const rawName = legacyMatch[1].replace(/_/g, ' ');
    return {
      farmName: resolveFarmAlias(rawName),
      fiscalYear: parseInt(legacyMatch[2]),
    };
  }

  // New format: just FarmName.xlsx (fiscal years detected from column headers)
  const rawName = base.replace(/_/g, ' ');
  return {
    farmName: resolveFarmAlias(rawName),
    fiscalYear: null, // will be determined from column headers
  };
}

function resolveFarmAlias(name) {
  const lower = name.toLowerCase().trim();
  return FARM_NAME_ALIASES[lower] || name;
}

// ─── Farm Lookup ────────────────────────────────────────────────────────────

async function findFarm(farmName) {
  const farms = await prisma.farm.findMany({
    where: { is_enterprise: false },
    select: { id: true, name: true },
  });

  // Exact match first
  const exact = farms.find(f => f.name.toLowerCase() === farmName.toLowerCase());
  if (exact) return exact;

  // Partial match (farm name contains the search term)
  const partial = farms.find(f =>
    f.name.toLowerCase().includes(farmName.toLowerCase()) ||
    farmName.toLowerCase().includes(f.name.toLowerCase())
  );
  return partial || null;
}

// ─── Prerequisites ──────────────────────────────────────────────────────────

async function ensureAssumption(farmId, fiscalYear, dryRun) {
  const existing = await prisma.assumption.findUnique({
    where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
  });
  if (existing) return { assumption: existing, created: false };

  // Find the most recent assumption to clone from
  const source = await prisma.assumption.findFirst({
    where: { farm_id: farmId },
    orderBy: { fiscal_year: 'desc' },
  });

  if (!source) {
    throw new Error(`No existing assumptions for this farm to clone from. Create FY${fiscalYear} assumptions first.`);
  }

  if (dryRun) {
    return {
      assumption: { ...source, fiscal_year: fiscalYear },
      created: true,
      clonedFrom: source.fiscal_year,
    };
  }

  const created = await prisma.assumption.create({
    data: {
      farm_id: farmId,
      fiscal_year: fiscalYear,
      total_acres: source.total_acres,
      crops_json: source.crops_json || [],
      bins_json: source.bins_json || [],
      is_frozen: false,
    },
  });

  return { assumption: created, created: true, clonedFrom: source.fiscal_year };
}

async function ensureFarmCategory(farmId, code, displayName, parentCode, dryRun) {
  const existing = await prisma.farmCategory.findUnique({
    where: { farm_id_code: { farm_id: farmId, code } },
  });
  if (existing) return false;

  if (dryRun) return true; // would create

  const parent = await prisma.farmCategory.findUnique({
    where: { farm_id_code: { farm_id: farmId, code: parentCode } },
  });
  if (!parent) return false;

  // Determine sort order (after last sibling)
  const siblings = await prisma.farmCategory.findMany({
    where: { farm_id: farmId, parent_id: parent.id },
    orderBy: { sort_order: 'desc' },
    take: 1,
  });
  const sortOrder = siblings.length > 0 ? siblings[0].sort_order + 1 : parent.sort_order + 1;

  await prisma.farmCategory.create({
    data: {
      farm_id: farmId,
      code,
      display_name: displayName,
      parent_id: parent.id,
      path: `${parentCode}.${code}`,
      level: 1,
      sort_order: sortOrder,
      category_type: parent.category_type,
    },
  });

  invalidateCache(farmId);
  return true;
}

// ─── Main Import Logic ──────────────────────────────────────────────────────

async function processFile(filePath, overrides, dryRun, basis = 'cash') {
  const filename = path.basename(filePath);
  const parsed = parseFilename(filename);
  if (!parsed) {
    return { file: filename, error: `Cannot parse filename. Expected format: FarmName.xlsx or FarmName_FY2025.xlsx` };
  }

  const farm = await findFarm(parsed.farmName);
  if (!farm) {
    return { file: filename, error: `Farm "${parsed.farmName}" not found in database` };
  }

  const { accounts, columnInfos, fiscalYears: detectedFYs } = await parseQboExcel(filePath);

  // Determine fiscal years: from filename (legacy) or from column headers (new)
  const fiscalYears = parsed.fiscalYear ? [parsed.fiscalYear] : detectedFYs;

  if (fiscalYears.length === 0) {
    return { file: filename, error: 'Could not determine fiscal year(s) from column headers. Headers must include year (e.g., "Nov 2024").' };
  }

  // Map accounts
  const mapped = [];
  const unmapped = [];
  const skipped = [];
  for (const acct of accounts) {
    const code = mapAccountName(acct.name, overrides);
    const total = Object.values(acct.months).reduce((s, v) => s + v, 0);
    if (code === '__skip__') {
      skipped.push({ name: acct.name, total });
    } else if (code) {
      mapped.push({ ...acct, categoryCode: code, total });
    } else {
      unmapped.push({ name: acct.name, total });
    }
  }

  // For legacy single-FY files, rekey months from "FY:Month" back to "Month" for compatibility
  if (parsed.fiscalYear) {
    for (const acct of mapped) {
      const rekeyed = {};
      for (const [key, val] of Object.entries(acct.months)) {
        const month = key.includes(':') ? key.split(':')[1] : key;
        rekeyed[month] = val;
      }
      acct.months = rekeyed;
    }
  }

  // Check/create assumptions for all fiscal years
  const assumptions = {};
  for (const fy of fiscalYears) {
    assumptions[fy] = await ensureAssumption(farm.id, fy, dryRun);
  }

  // Check for new revenue categories (crops in QBO not in farm categories)
  const newCategories = [];
  const checkedCodes = new Set();
  for (const acct of mapped) {
    if (acct.categoryCode.startsWith('rev_') && acct.categoryCode !== 'rev_other_income' && !checkedCodes.has(acct.categoryCode)) {
      checkedCodes.add(acct.categoryCode);
      const exists = await prisma.farmCategory.findUnique({
        where: { farm_id_code: { farm_id: farm.id, code: acct.categoryCode } },
      });
      if (!exists) {
        const cropName = acct.categoryCode.replace('rev_', '').replace(/_/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());
        newCategories.push({ code: acct.categoryCode, displayName: `${cropName} Revenue`, parentCode: 'revenue' });
      }
    }
  }

  // Build human-readable month list
  const monthLabels = columnInfos.map(c => `${c.month} ${c.year || '?'}`);

  return {
    file: filename,
    farm,
    fiscalYears,
    isMultiFY: fiscalYears.length > 1,
    monthLabels,
    mapped,
    unmapped,
    skipped,
    assumptions,
    newCategories,
    filePath,
  };
}

async function executeImport(result, basis = 'cash') {
  const { farm, fiscalYears, mapped, newCategories, assumptions, isMultiFY } = result;

  // 1. Ensure assumptions exist for all fiscal years
  for (const fy of fiscalYears) {
    if (assumptions[fy] && assumptions[fy].created) {
      await ensureAssumption(farm.id, fy, false);
    }
  }

  // 2. Create new categories
  for (const cat of newCategories) {
    await ensureFarmCategory(farm.id, cat.code, cat.displayName, cat.parentCode, false);
  }
  if (newCategories.length > 0) {
    invalidateCache(farm.id);
  }

  // 3. Build category map
  const dbCategories = await prisma.farmCategory.findMany({
    where: { farm_id: farm.id },
    select: { id: true, code: true },
  });
  const categoryMap = {};
  for (const cat of dbCategories) {
    categoryMap[cat.code] = cat.id;
  }

  // Track affected FY+month combos for rollup
  const rollupTargets = new Set(); // "FY:Month"

  // 4. Upsert GlAccount + GlActualDetail in a transaction
  await prisma.$transaction(async (tx) => {
    for (const acct of mapped) {
      const categoryId = categoryMap[acct.categoryCode];
      if (!categoryId) {
        console.warn(`  ⚠ Category ${acct.categoryCode} not found for "${acct.name}", skipping`);
        continue;
      }

      // Upsert GL account
      const glAccount = await tx.glAccount.upsert({
        where: { farm_id_account_number: { farm_id: farm.id, account_number: acct.name } },
        update: { account_name: acct.name, category_id: categoryId },
        create: { farm_id: farm.id, account_number: acct.name, account_name: acct.name, category_id: categoryId },
      });

      // Upsert monthly amounts
      for (const [key, amount] of Object.entries(acct.months)) {
        let fiscalYear, month;

        if (key.includes(':')) {
          // Multi-FY format: "2025:Nov"
          const parts = key.split(':');
          fiscalYear = parseInt(parts[0]);
          month = parts[1];
        } else {
          // Legacy single-FY format: "Nov"
          fiscalYear = fiscalYears[0];
          month = key;
        }

        if (!CALENDAR_MONTHS.includes(month)) continue;
        if (!fiscalYear) continue;

        await tx.glActualDetail.upsert({
          where: {
            farm_id_fiscal_year_month_gl_account_id: {
              farm_id: farm.id, fiscal_year: fiscalYear, month, gl_account_id: glAccount.id,
            },
          },
          update: { amount: amount || 0 },
          create: {
            farm_id: farm.id, fiscal_year: fiscalYear, month,
            gl_account_id: glAccount.id, amount: amount || 0,
          },
        });

        rollupTargets.add(`${fiscalYear}:${month}`);
      }
    }
  });

  // 5. Rollup each affected FY+month (outside transaction)
  for (const target of rollupTargets) {
    const [fy, month] = target.split(':');
    await rollupGlActuals(farm.id, parseInt(fy), month, { basis });
  }

  return { months: rollupTargets.size, accounts: mapped.length, fiscalYears };
}

// ─── Display ────────────────────────────────────────────────────────────────

function formatCurrency(val) {
  return val < 0
    ? `($${Math.abs(val).toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })})`
    : `$${val.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function printPreview(results) {
  console.log('\n=== QBO P&L Import Preview ===\n');

  let ready = 0;
  let withUnmapped = 0;
  let errors = 0;

  for (const r of results) {
    if (r.error) {
      console.log(`File: ${r.file}`);
      console.log(`  ❌ ${r.error}\n`);
      errors++;
      continue;
    }

    console.log(`File: ${r.file}`);
    console.log(`  Farm: ${r.farm.name} (${r.farm.id.substring(0, 8)}...)`);
    console.log(`  Fiscal Year(s): ${r.fiscalYears.join(', ')}`);
    console.log(`  Months found: ${r.monthLabels.join(', ')}`);

    // Show assumptions per fiscal year
    for (const fy of r.fiscalYears) {
      const a = r.assumptions[fy];
      if (a.created) {
        console.log(`  FY${fy} Assumption: WILL CREATE (cloning from FY${a.clonedFrom}, ${a.assumption.total_acres} acres)`);
      } else {
        console.log(`  FY${fy} Assumption: exists (${a.assumption.total_acres} acres)`);
      }
    }

    if (r.newCategories.length > 0) {
      console.log(`  New Categories: ${r.newCategories.map(c => c.code).join(', ')}`);
    }

    console.log(`\n  Mapped Accounts (${r.mapped.length}):`);
    const byCategory = {};
    for (const acct of r.mapped) {
      if (!byCategory[acct.categoryCode]) byCategory[acct.categoryCode] = [];
      byCategory[acct.categoryCode].push(acct);
    }
    for (const [code, accts] of Object.entries(byCategory)) {
      for (const acct of accts) {
        console.log(`    ${acct.name.padEnd(35)} → ${code.padEnd(20)} Total: ${formatCurrency(acct.total)}`);
      }
    }

    if (r.skipped && r.skipped.length > 0) {
      console.log(`\n  Skipped Accounts (${r.skipped.length}):`);
      for (const acct of r.skipped) {
        console.log(`    ⊘ "${acct.name}"${' '.repeat(Math.max(1, 30 - acct.name.length))} Total: ${formatCurrency(acct.total)}`);
      }
    }

    if (r.unmapped.length > 0) {
      console.log(`\n  Unmapped Accounts (${r.unmapped.length}):`);
      for (const acct of r.unmapped) {
        console.log(`    ⚠ "${acct.name}"${' '.repeat(Math.max(1, 30 - acct.name.length))} Total: ${formatCurrency(acct.total)}`);
      }
      withUnmapped++;
    }

    ready++;
    console.log('');
  }

  const total = results.length;
  console.log(`Summary: ${total} file(s), ${ready} parseable, ${errors} error(s), ${withUnmapped} with unmapped accounts`);

  if (withUnmapped > 0) {
    console.log('\nTo map unmapped accounts, create qbo-account-overrides.json:');
    console.log('  {');
    const allUnmapped = results.flatMap(r => (r.unmapped || []).map(u => u.name));
    const unique = [...new Set(allUnmapped)];
    unique.forEach((name, i) => {
      const comma = i < unique.length - 1 ? ',' : '';
      console.log(`    "${name}": "category_code"${comma}`);
    });
    console.log('  }');
  }

  return { ready, errors, withUnmapped };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

async function confirm(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${message} (y/N): `, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: node src/scripts/importQboPnl.js <path> [--dry-run] [--force] [--basis accrual|cash]

  <path>       Directory of .xlsx files, or a single .xlsx file
  --dry-run    Preview only, no database changes
  --force      Skip confirmation prompt
  --basis      Accounting basis: 'accrual' or 'cash' (default: cash)

File naming (pick one):
  FarmName.xlsx            One file per BU, full date range (fiscal years auto-detected from headers)
  FarmName_FY2025.xlsx     Legacy format: one file per BU per fiscal year

QBO class aliases: Keywest → Ogema (add more in FARM_NAME_ALIASES)

Override unmapped accounts by placing qbo-account-overrides.json alongside the files:
  { "Bank Charges": "lpm_shop", "Miscellaneous": "lpm_shop" }
`);
    process.exit(0);
  }

  const targetPath = args.find(a => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const basisIdx = args.indexOf('--basis');
  const basis = basisIdx !== -1 && args[basisIdx + 1] ? args[basisIdx + 1] : 'cash';

  if (!targetPath) {
    console.error('Error: No path provided');
    process.exit(1);
  }

  console.log(`Accounting basis: ${basis.toUpperCase()}`);
  const resolvedPath = path.resolve(targetPath);

  // Collect xlsx files
  let files = [];
  if (fs.statSync(resolvedPath).isDirectory()) {
    files = fs.readdirSync(resolvedPath)
      .filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'))
      .map(f => path.join(resolvedPath, f))
      .sort();
  } else if (resolvedPath.endsWith('.xlsx')) {
    files = [resolvedPath];
  } else {
    console.error('Error: Path must be a directory or .xlsx file');
    process.exit(1);
  }

  if (files.length === 0) {
    console.error('No .xlsx files found');
    process.exit(1);
  }

  console.log(`Found ${files.length} file(s)`);

  // Load overrides
  const overrideDir = fs.statSync(resolvedPath).isDirectory() ? resolvedPath : path.dirname(resolvedPath);
  const overridePath = path.join(overrideDir, 'qbo-account-overrides.json');
  let overrides = null;
  if (fs.existsSync(overridePath)) {
    overrides = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
    console.log(`Loaded ${Object.keys(overrides).length} account override(s) from qbo-account-overrides.json`);
  }

  // Process all files
  const results = [];
  for (const file of files) {
    try {
      const result = await processFile(file, overrides, true, basis); // always preview first
      results.push(result);
    } catch (err) {
      results.push({ file: path.basename(file), error: err.message });
    }
  }

  // Print preview
  const summary = printPreview(results);

  // Write unmapped accounts to JSON for convenience
  const allUnmapped = results.flatMap(r => (r.unmapped || []).map(u => ({ name: u.name, total: u.total, file: r.file })));
  if (allUnmapped.length > 0) {
    const unmappedPath = path.join(overrideDir, 'unmapped-accounts.json');
    const unmappedObj = {};
    for (const u of allUnmapped) {
      if (!unmappedObj[u.name]) unmappedObj[u.name] = '';
    }
    fs.writeFileSync(unmappedPath, JSON.stringify(unmappedObj, null, 2) + '\n');
    console.log(`\nWrote ${Object.keys(unmappedObj).length} unmapped account(s) to unmapped-accounts.json`);
  }

  if (dryRun) {
    console.log('\n--dry-run mode: no changes made.');
    process.exit(0);
  }

  // Confirm before writing
  const importable = results.filter(r => !r.error);
  if (importable.length === 0) {
    console.log('\nNo files to import.');
    process.exit(1);
  }

  if (!force) {
    const ok = await confirm(`\nImport ${importable.length} file(s) into the database?`);
    if (!ok) {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  // Execute imports
  console.log('\nImporting...\n');
  let success = 0;
  let failed = 0;

  for (const result of importable) {
    try {
      // Re-process without dry-run to create assumptions/categories
      const freshResult = await processFile(result.filePath, overrides, false, basis);
      if (freshResult.error) {
        console.log(`  ❌ ${result.file}: ${freshResult.error}`);
        failed++;
        continue;
      }
      const importResult = await executeImport(freshResult, basis);
      console.log(`  ✓ ${result.file}: ${importResult.accounts} accounts, ${importResult.months} month-slots, FY ${importResult.fiscalYears.join('+')}`);
      success++;
    } catch (err) {
      console.log(`  ❌ ${result.file}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${success} imported, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main()
  .catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
