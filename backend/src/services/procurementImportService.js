import ExcelJS from 'exceljs';
import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';
import { syncContractPricingToLibrary } from './procurementContractService.js';

const log = createLogger('procurement-import');

// BU name (from Excel) → Farm name (in DB)
const BU_NAME_MAP = {
  'hyas': 'Hyas',
  'ridgedale': 'Ridgedale',
  'lewvan': 'Lewvan',
  'stockholm': 'Stockholm',
  'balcarres': 'Balcarres',
  'keywest': 'Ogema',
  'provost': 'Provost',
};

// ─── Helpers ──────────────────────────────────────────────────────────

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  // ExcelJS formula cell: { formula: '...', result: ... }
  if (typeof val === 'object' && val.result != null) return parseDate(val.result);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function parseNumber(val) {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'object' && val.result != null) return parseNumber(val.result);
  const n = parseFloat(String(val).replace(/[,$]/g, ''));
  return isNaN(n) ? 0 : n;
}

function cellStr(val) {
  if (val == null) return '';
  if (typeof val === 'object' && val.result != null) return cellStr(val.result);
  // ExcelJS rich text
  if (typeof val === 'object' && val.richText) {
    return val.richText.map(r => r.text || '').join('').trim();
  }
  return String(val).trim();
}

/**
 * Normalize header string to snake_case key.
 */
function normalizeHeader(h) {
  return h.toLowerCase()
    .replace(/[()$/¢]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Extract cents-per-litre pricing from a notes string.
 * e.g. "96.89 ¢/L" → 96.89
 */
function parseCentsPerLitre(notes) {
  if (!notes) return null;
  const m = notes.match(/(\d+\.?\d*)\s*¢\/L/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Determine input_category from the Excel column value.
 */
function normalizeInputCategory(raw) {
  const lower = (raw || '').toLowerCase().trim();
  if (lower.includes('fuel') || lower.includes('diesel') || lower.includes('gas')) return 'fuel';
  if (lower.includes('fert')) return 'fertilizer';
  if (lower.includes('chem')) return 'chemical';
  if (lower.includes('seed')) return 'seed';
  return lower || 'other';
}

/**
 * Map Excel status to our contract status enum.
 */
function mapStatus(raw) {
  const lower = (raw || '').toLowerCase().trim();
  if (lower === 'delivered') return 'delivered';
  if (lower === 'active') return 'ordered';
  if (lower === 'cancelled' || lower === 'canceled') return 'cancelled';
  if (lower === 'invoiced') return 'invoiced';
  if (lower === 'paid') return 'paid';
  // Default for unknown statuses
  return 'ordered';
}

/**
 * Auto-generate a short_code from a supplier name.
 * e.g. "Nutrien Ag Solutions" → "NAS", "Co-op Fuel" → "CF"
 */
function generateShortCode(name) {
  if (!name) return 'UNK';
  // Take first letter of each word, uppercase, max 6 chars
  const code = name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0].toUpperCase())
    .join('')
    .slice(0, 6);
  return code || 'UNK';
}

// ─── Parse ────────────────────────────────────────────────────────────

/**
 * Parse the procurement contract Excel file.
 * Returns { contracts: rawRow[], products: rawRow[], locations: rawRow[] }
 */
export async function parseProcurementExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const result = { contracts: [], products: [], locations: [] };

  // ── Contracts sheet ──
  const contractsSheet = wb.worksheets.find(ws =>
    ws.name.toLowerCase().includes('contract')
  ) || wb.worksheets[0];

  if (!contractsSheet || contractsSheet.rowCount < 2) {
    throw new Error('Contracts sheet must have a header row and data');
  }

  const cHeaders = [];
  contractsSheet.getRow(1).eachCell((cell, col) => {
    cHeaders[col] = normalizeHeader(cellStr(cell.value));
  });

  contractsSheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const obj = {};
    row.eachCell((cell, col) => {
      const h = cHeaders[col];
      if (h) obj[h] = cell.value != null ? cell.value : null;
    });
    // Skip fully empty rows
    if (obj.contract || obj.contract_number || obj.supplier || obj.product_name) {
      obj._rowNum = rowNum;
      result.contracts.push(obj);
    }
  });

  // ── Product Reference sheet ──
  const prodSheet = wb.worksheets.find(ws =>
    ws.name.toLowerCase().includes('product')
  );
  if (prodSheet && prodSheet.rowCount >= 2) {
    const pHeaders = [];
    prodSheet.getRow(1).eachCell((cell, col) => {
      pHeaders[col] = normalizeHeader(cellStr(cell.value));
    });
    prodSheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const obj = {};
      row.eachCell((cell, col) => {
        const h = pHeaders[col];
        if (h) obj[h] = cell.value != null ? cell.value : null;
      });
      if (obj.product_code || obj.product_name) {
        result.products.push(obj);
      }
    });
  }

  // ── Location Reference sheet ──
  const locSheet = wb.worksheets.find(ws =>
    ws.name.toLowerCase().includes('location')
  );
  if (locSheet && locSheet.rowCount >= 2) {
    const lHeaders = [];
    locSheet.getRow(1).eachCell((cell, col) => {
      lHeaders[col] = normalizeHeader(cellStr(cell.value));
    });
    locSheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const obj = {};
      row.eachCell((cell, col) => {
        const h = lHeaders[col];
        if (h) obj[h] = cell.value != null ? cell.value : null;
      });
      if (obj.business_unit) {
        result.locations.push(obj);
      }
    });
  }

  log.info(`Parsed procurement Excel: ${result.contracts.length} contract rows, ${result.products.length} products, ${result.locations.length} locations`);
  return result;
}

// ─── Preview ──────────────────────────────────────────────────────────

/**
 * Preview the import: group rows into contracts + lines, resolve suppliers and BUs.
 */
export async function previewProcurementImport(parsed, cropYear) {
  const rows = parsed.contracts;
  if (!rows || rows.length === 0) {
    throw new Error('No contract rows to import');
  }

  // Build a product reference lookup from the Product Reference sheet
  const productRef = {};
  for (const p of (parsed.products || [])) {
    const code = cellStr(p.product_code);
    if (code) {
      productRef[code.toLowerCase()] = {
        npk_analysis: cellStr(p.npk_analysis),
        type: cellStr(p.type),
        notes: cellStr(p.notes),
      };
    }
  }

  // Resolve farms by name
  const farms = await prisma.farm.findMany({
    where: { is_enterprise: false, farm_type: 'farm' },
  });
  const farmByName = {};
  for (const f of farms) {
    farmByName[f.name.toLowerCase()] = f;
  }

  // Resolve existing suppliers (counterparties)
  const enterprise = await prisma.farm.findFirst({ where: { is_enterprise: true } });
  if (!enterprise) throw new Error('Enterprise farm not found');

  const counterparties = await prisma.counterparty.findMany({
    where: { farm_id: enterprise.id },
  });
  const cpByName = {};
  for (const cp of counterparties) {
    cpByName[cp.name.toLowerCase()] = cp;
  }

  // Group rows by contract number
  const contractMap = new Map(); // contract_number → { header fields, lines[] }
  const warnings = [];
  const newSupplierSet = new Map(); // supplier name → true

  for (const r of rows) {
    const contractNumber = cellStr(r.contract || r.contract_number);
    if (!contractNumber) {
      warnings.push(`Row ${r._rowNum}: Missing contract number, skipping`);
      continue;
    }

    const supplierName = cellStr(r.supplier);
    const inputCategory = normalizeInputCategory(cellStr(r.input_category));
    const buRaw = cellStr(r.business_unit).toLowerCase().trim();
    const buName = BU_NAME_MAP[buRaw] || null;
    const farm = buName ? farmByName[buName.toLowerCase()] : null;

    if (buRaw && !buName) {
      warnings.push(`Row ${r._rowNum}: Business unit "${cellStr(r.business_unit)}" has no BU mapping`);
    }

    // Resolve supplier
    const cpMatch = supplierName ? cpByName[supplierName.toLowerCase()] : null;
    if (supplierName && !cpMatch && !newSupplierSet.has(supplierName)) {
      newSupplierSet.set(supplierName, {
        name: supplierName,
        short_code: generateShortCode(supplierName),
      });
    }

    // Product info
    const productCode = cellStr(r.product_code);
    const productName = cellStr(r.product_name);
    const ref = productCode ? productRef[productCode.toLowerCase()] : null;

    // Quantities and pricing
    let qty = parseNumber(r.qty_tonnes);
    let qtyUnit = 'tonnes';
    let unitPrice = parseNumber(r.unit_price_tonne);
    let priceUnit = '$/tonne';

    // If qty in lbs column is present and tonnes is 0, use lbs
    const qtyLbs = parseNumber(r.qty_lbs);
    if (qty === 0 && qtyLbs > 0) {
      qty = qtyLbs;
      qtyUnit = 'lbs';
    }

    // For fuel: parse ¢/L from notes
    const notes = cellStr(r.notes);
    if (inputCategory === 'fuel') {
      const cpl = parseCentsPerLitre(notes);
      if (cpl !== null) {
        unitPrice = cpl;
        priceUnit = '¢/L';
      }
    }

    const lineTotal = parseNumber(r.line_total_cad);

    // Build/update contract group
    if (!contractMap.has(contractNumber)) {
      contractMap.set(contractNumber, {
        contract_number: contractNumber,
        supplier_name: supplierName,
        counterparty_id: cpMatch?.id || null,
        is_new_supplier: !cpMatch && !!supplierName,
        input_category: inputCategory,
        description: cellStr(r.contract_description),
        blend_formula: cellStr(r.blend_formula) || null,
        contract_value: parseNumber(r.contract_total_cad),
        valid_from: parseDate(r.valid_from),
        valid_to: parseDate(r.valid_to),
        payment_due: cellStr(r.payment_due),
        delivery_window: cellStr(r.delivery_window),
        status: mapStatus(cellStr(r.status)),
        source_file: cellStr(r.source_file),
        notes: null,
        lines: [],
      });
    }

    const contract = contractMap.get(contractNumber);

    // Accumulate contract-level notes from individual lines if needed
    if (notes && inputCategory === 'fuel') {
      // Collect fuel location notes at contract level
      if (!contract.notes) contract.notes = '';
      if (contract.notes) contract.notes += '; ';
      contract.notes += `${buName || buRaw}: ${notes}`;
    }

    contract.lines.push({
      line_number: contract.lines.length + 1,
      bu_name: buName,
      bu_farm_id: farm?.id || null,
      input_category: inputCategory,
      product_code: productCode,
      product_name: productName,
      product_analysis: ref?.npk_analysis || cellStr(r.blend_formula) || null,
      blend_formula: cellStr(r.blend_formula) || null,
      qty,
      qty_unit: qtyUnit,
      unit_price: unitPrice,
      price_unit: priceUnit,
      line_total: lineTotal,
      notes: notes || null,
      _rowNum: r._rowNum,
    });
  }

  // Build final contracts array
  const contracts = Array.from(contractMap.values());

  // Compute stats
  let totalValue = 0;
  let totalLines = 0;
  for (const c of contracts) {
    totalLines += c.lines.length;
    // Use contract_value if available, otherwise sum line totals
    if (c.contract_value > 0) {
      totalValue += c.contract_value;
    } else {
      totalValue += c.lines.reduce((sum, l) => sum + l.line_total, 0);
    }
  }

  const newSuppliers = Array.from(newSupplierSet.values());

  log.info(`Preview: ${contracts.length} contracts, ${totalLines} lines, ${newSuppliers.length} new suppliers, $${totalValue.toFixed(2)} total value`);

  return {
    contracts,
    warnings,
    newSuppliers,
    stats: {
      totalContracts: contracts.length,
      totalLines,
      totalValue,
    },
  };
}

// ─── Commit ───────────────────────────────────────────────────────────

/**
 * Commit the previewed procurement import to the database.
 */
export async function commitProcurementImport(preview, cropYear, userId) {
  const enterprise = await prisma.farm.findFirst({ where: { is_enterprise: true } });
  if (!enterprise) throw new Error('Enterprise farm not found');

  // 1. Create new supplier Counterparty records
  const newCpMap = {}; // supplier name (lower) → counterparty id
  for (const ns of (preview.newSuppliers || [])) {
    // Check for short_code collision and de-dup
    let shortCode = ns.short_code;
    const existing = await prisma.counterparty.findFirst({
      where: { farm_id: enterprise.id, short_code: shortCode },
    });
    if (existing) {
      // Append numeric suffix
      shortCode = `${shortCode}${Date.now() % 1000}`;
    }

    const cp = await prisma.counterparty.create({
      data: {
        farm_id: enterprise.id,
        name: ns.name,
        short_code: shortCode,
        type: 'supplier',
        is_active: true,
      },
    });
    newCpMap[ns.name.toLowerCase()] = cp.id;
    log.info(`Created new supplier counterparty: ${ns.name} (${shortCode})`);
  }

  // 2. Create contracts + lines in a transaction
  let contractsCreated = 0;
  let linesCreated = 0;

  await prisma.$transaction(async (tx) => {
    for (const c of preview.contracts) {
      // Resolve counterparty_id: existing or newly created
      let counterpartyId = c.counterparty_id;
      if (!counterpartyId && c.supplier_name) {
        counterpartyId = newCpMap[c.supplier_name.toLowerCase()];
      }
      if (!counterpartyId) {
        log.warn(`Skipping contract ${c.contract_number}: no counterparty resolved for "${c.supplier_name}"`);
        continue;
      }

      // Upsert contract (by farm_id + contract_number unique constraint)
      const contract = await tx.procurementContract.upsert({
        where: {
          farm_id_contract_number: {
            farm_id: enterprise.id,
            contract_number: c.contract_number,
          },
        },
        update: {
          counterparty_id: counterpartyId,
          input_category: c.input_category,
          description: c.description || null,
          blend_formula: c.blend_formula || null,
          contract_value: c.contract_value || null,
          valid_from: c.valid_from,
          valid_to: c.valid_to,
          payment_due: c.payment_due || null,
          delivery_window: c.delivery_window || null,
          status: c.status,
          source_file: c.source_file || null,
          notes: c.notes || null,
          crop_year: cropYear,
        },
        create: {
          farm_id: enterprise.id,
          contract_number: c.contract_number,
          counterparty_id: counterpartyId,
          crop_year: cropYear,
          input_category: c.input_category,
          description: c.description || null,
          blend_formula: c.blend_formula || null,
          contract_value: c.contract_value || null,
          currency: 'CAD',
          valid_from: c.valid_from,
          valid_to: c.valid_to,
          payment_due: c.payment_due || null,
          delivery_window: c.delivery_window || null,
          status: c.status,
          source_file: c.source_file || null,
          notes: c.notes || null,
          created_by: userId || null,
        },
      });
      contractsCreated++;

      // Delete existing lines for this contract (re-import scenario)
      await tx.procurementContractLine.deleteMany({
        where: { contract_id: contract.id },
      });

      // Create lines
      for (const l of c.lines) {
        await tx.procurementContractLine.create({
          data: {
            contract_id: contract.id,
            line_number: l.line_number,
            bu_farm_id: l.bu_farm_id || null,
            input_category: l.input_category,
            product_code: l.product_code || null,
            product_name: l.product_name,
            product_analysis: l.product_analysis || null,
            blend_formula: l.blend_formula || null,
            qty: l.qty,
            qty_unit: l.qty_unit,
            unit_price: l.unit_price,
            price_unit: l.price_unit,
            line_total: l.line_total,
            notes: l.notes || null,
          },
        });
        linesCreated++;
      }
    }
  });

  const suppliersCreated = Object.keys(newCpMap).length;

  log.info(`Procurement import committed: ${contractsCreated} contracts, ${linesCreated} lines, ${suppliersCreated} new suppliers for crop year ${cropYear}`);

  // Sync fertilizer contract pricing → product library
  let pricingSync = null;
  try {
    pricingSync = await syncContractPricingToLibrary(enterprise.id, cropYear);
  } catch (err) {
    log.warn(`Contract pricing sync failed: ${err.message}`);
    pricingSync = { error: err.message };
  }

  return {
    contractsCreated,
    linesCreated,
    suppliersCreated,
    pricingSync,
  };
}
