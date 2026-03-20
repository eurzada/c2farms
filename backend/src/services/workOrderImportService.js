import ExcelJS from 'exceljs';
import prisma from '../config/database.js';
import { buildCanonicalName } from './productMatchingService.js';
import createLogger from '../utils/logger.js';

const log = createLogger('work-order-import');

// Customer entity → BU mapping (hardcoded, confirmed by user)
const CUSTOMER_BU_MAP = {
  'c2 farms joint venture': 'Lewvan',
  'c2 farms joint venture - balcarres': 'Balcarres',
  'c2 farms joint venture - hyas': 'Hyas',
  'c2 farms joint venture - waldron': 'Stockholm',
  'c2 farms joint venture - ridgedale': 'Ridgedale',
  'keywest farms': 'Ogema',
};

// Known packaging volumes (L or kg per unit)
const PACKAGING_VOLUMES = {
  'JUG':  10,
  'DRUM': 200,
  'TOTE': 1000,
  'MB':   1000,   // metric bag = 1000 kg (fertilizer)
  'BAG':  25,     // typical seed bag in kg
  'CASE': 1,      // varies, default 1
  'PAIL': 20,
  'UNIT': 1,
};

/**
 * Parse Synergy Work Order Excel file.
 * Expected columns (16): Customer, Work Order, Order Date, Payment Due Date,
 *   Product Code, Product Name, Packaging Unit, Qty Ordered, Qty Taken,
 *   Qty Remaining, Prepaid, Unit Price, Line Total, ...
 */
export async function parseWorkOrderExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2) throw new Error('Work Order file must have a header row and data');

  // Read headers from row 1
  const headers = [];
  ws.getRow(1).eachCell((cell, col) => {
    headers[col] = (cell.value || '').toString().trim().toLowerCase()
      .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  });

  const rows = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const obj = {};
    row.eachCell((cell, col) => {
      const h = headers[col];
      if (h) {
        obj[h] = cell.value != null ? cell.value : null;
      }
    });
    // Skip fully empty rows
    if (obj.product_name || obj.product_code) {
      rows.push(obj);
    }
  });

  if (rows.length === 0) throw new Error('No work order lines found');
  log.info(`Parsed ${rows.length} work order lines`);
  return rows;
}

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function parseNumber(val) {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  const n = parseFloat(String(val).replace(/[,$]/g, ''));
  return isNaN(n) ? 0 : n;
}

function resolvePackagingVolume(packagingUnit) {
  if (!packagingUnit) return null;
  return PACKAGING_VOLUMES[packagingUnit.toUpperCase().trim()] || null;
}

/**
 * Preview a work order import: resolve entity mapping, match to product library.
 */
export async function previewWorkOrderImport(rows, cropYear) {
  // Resolve farms
  const farms = await prisma.farm.findMany({ where: { is_enterprise: false, farm_type: 'farm' } });
  const farmByName = {};
  for (const f of farms) {
    farmByName[f.name.toLowerCase()] = f;
  }

  // Get enterprise farm for product library scope
  const enterprise = await prisma.farm.findFirst({ where: { is_enterprise: true } });

  // Existing products (enterprise-scoped)
  const existingProducts = enterprise
    ? await prisma.agroProduct.findMany({ where: { farm_id: enterprise.id } })
    : [];
  const existingByCanonical = {};
  for (const p of existingProducts) {
    const cn = p.canonical_name || buildCanonicalName(p.name);
    existingByCanonical[cn] = p;
  }

  const lines = [];
  const entitySummary = {};
  const newProducts = new Set();
  const warnings = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const customerName = (r.customer || r.customer_name || '').toString().trim();
    const buName = CUSTOMER_BU_MAP[customerName.toLowerCase()];
    const farm = buName ? farmByName[buName.toLowerCase()] : null;

    if (!farm && customerName) {
      warnings.push(`Row ${i + 2}: Customer "${customerName}" has no BU mapping`);
    }

    const productName = (r.product_name || r.product || '').toString().trim();
    const canonical = buildCanonicalName(productName);
    const isNew = canonical && !existingByCanonical[canonical];
    if (isNew) newProducts.add(canonical);

    const packagingUnit = (r.packaging_unit || r.packaging || '').toString().trim();
    const unitPrice = parseNumber(r.unit_price || r.price);
    const packVol = resolvePackagingVolume(packagingUnit);
    const costPerAppUnit = packVol && unitPrice ? unitPrice / packVol : null;

    const line = {
      row: i + 2,
      customer_name: customerName,
      bu_name: buName || null,
      farm_id: farm?.id || null,
      work_order_ref: (r.work_order || r.work_order_ref || '').toString().trim(),
      order_date: parseDate(r.order_date),
      payment_due_date: parseDate(r.payment_due_date || r.payment_due),
      product_name: productName,
      product_code: (r.product_code || '').toString().trim(),
      packaging_unit: packagingUnit,
      packaging_volume: packVol,
      qty_ordered: parseNumber(r.qty_ordered),
      qty_taken: parseNumber(r.qty_taken),
      qty_remaining: parseNumber(r.qty_remaining),
      prepaid: parseNumber(r.prepaid),
      unit_price: unitPrice,
      line_total: parseNumber(r.line_total || r.total),
      canonical_name: canonical,
      cost_per_application_unit: costPerAppUnit,
      is_new_product: isNew,
    };
    lines.push(line);

    // Entity summary
    const key = buName || customerName || 'Unknown';
    if (!entitySummary[key]) entitySummary[key] = { farm_id: farm?.id, lines: 0, total: 0 };
    entitySummary[key].lines++;
    entitySummary[key].total += line.line_total;
  }

  return {
    lines,
    entity_summary: entitySummary,
    new_product_count: newProducts.size,
    total_lines: lines.length,
    total_value: lines.reduce((s, l) => s + l.line_total, 0),
    warnings,
    crop_year: cropYear,
  };
}

/**
 * Commit work order import: write WorkOrderLine records and upsert AgroProduct with pricing.
 */
export async function commitWorkOrderImport(preview, cropYear, _userId) {
  const enterprise = await prisma.farm.findFirst({ where: { is_enterprise: true } });
  if (!enterprise) throw new Error('Enterprise farm not found — required for product library');

  let linesCreated = 0;
  let productsUpserted = 0;
  const productsSeen = new Set();

  // Delete existing WO lines for this crop year to allow re-import
  await prisma.workOrderLine.deleteMany({ where: { crop_year: cropYear } });

  for (const line of preview.lines) {
    // Create WorkOrderLine (farm_id may be null for unmapped entities)
    await prisma.workOrderLine.create({
      data: {
        farm_id: line.farm_id || enterprise.id,
        customer_name: line.customer_name,
        work_order_ref: line.work_order_ref,
        order_date: line.order_date,
        payment_due_date: line.payment_due_date,
        product_name: line.product_name,
        product_code: line.product_code,
        packaging_unit: line.packaging_unit,
        qty_ordered: line.qty_ordered,
        qty_taken: line.qty_taken,
        qty_remaining: line.qty_remaining,
        prepaid: line.prepaid,
        unit_price: line.unit_price,
        line_total: line.line_total,
        crop_year: cropYear,
        canonical_name: line.canonical_name,
      },
    });
    linesCreated++;

    // Upsert AgroProduct (enterprise-scoped, once per unique product)
    if (line.product_name && !productsSeen.has(line.canonical_name)) {
      productsSeen.add(line.canonical_name);

      // Determine type from product characteristics
      const type = guessProductType(line.product_name, line.product_code);

      await prisma.agroProduct.upsert({
        where: {
          farm_id_name_type: {
            farm_id: enterprise.id,
            name: line.product_name,
            type,
          },
        },
        update: {
          unit_price: line.unit_price || undefined,
          packaging_unit: line.packaging_unit || undefined,
          packaging_volume: line.packaging_volume || undefined,
          dealer_code: line.product_code || undefined,
          dealer_name: line.customer_name || undefined,
          canonical_name: line.canonical_name || undefined,
          cost_per_application_unit: line.cost_per_application_unit || undefined,
        },
        create: {
          farm_id: enterprise.id,
          name: line.product_name,
          type,
          dealer_code: line.product_code || null,
          dealer_name: line.customer_name || null,
          canonical_name: line.canonical_name,
          unit_price: line.unit_price || null,
          packaging_unit: line.packaging_unit || null,
          packaging_volume: line.packaging_volume || null,
          cost_per_application_unit: line.cost_per_application_unit || null,
        },
      });
      productsUpserted++;
    }
  }

  log.info(`Work order import committed: ${linesCreated} lines, ${productsUpserted} products for crop year ${cropYear}`);
  return { lines_created: linesCreated, products_upserted: productsUpserted, crop_year: cropYear };
}

/**
 * Guess product type from name/code heuristics.
 */
function guessProductType(name, _code) {
  const lower = (name || '').toLowerCase();
  // Seed keywords
  if (/\bseed\b|\bvariety\b|\bcwrs\b|\bcwad\b|\bcps\b|\bcanola\b.*\bhybrid\b/i.test(lower)) return 'seed';
  // Fertilizer keywords
  if (/\burea\b|\bmap\b|\bpotash\b|\b\d+-\d+-\d+\b|\bammonium\b|\bphosph\b|\bsulphate\b|\bsulfur\b|\bnitrogen\b|\besn\b/i.test(lower)) return 'fertilizer';
  // Default to chemical
  return 'chemical';
}
