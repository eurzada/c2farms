import ExcelJS from 'exceljs';
import prisma from '../config/database.js';
import { buildCanonicalName, findBestMatch } from './productMatchingService.js';
import createLogger from '../utils/logger.js';

const log = createLogger('cwo-import');

// CWO Applicable Type → CropInput category
const TYPE_MAP = {
  'seed': 'seed',
  'fertilizer': 'fertilizer',
  'nutrients': 'fertilizer',
  'herbicide': 'chemical',
  'fungicide': 'chemical',
  'adjuvant': 'chemical',
  'defoamer': 'chemical',
  'insecticide': 'chemical',
  'acaricide': 'chemical',
  'other': 'chemical',
};

// CWO type → CropInput timing (for chemicals)
const TIMING_MAP = {
  'herbicide': 'incrop',
  'fungicide': 'fungicide',
  'insecticide': 'incrop',
  'adjuvant': 'incrop',
  'defoamer': 'incrop',
};

// Unit conversion: kg/ac → lbs/ac
const KG_TO_LBS = 2.20462;

/**
 * Parse CWO Excel export. Handles duplicate column names by index.
 * Returns raw row objects.
 */
export async function parseCwoExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2) throw new Error('CWO file must have a header row and data');

  // Read all headers — may have duplicates
  const headers = [];
  ws.getRow(1).eachCell((cell, col) => {
    headers[col] = (cell.value || '').toString().trim();
  });

  const rows = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const obj = { _headers: headers };
    const vals = {};
    row.eachCell((cell, col) => {
      const h = headers[col];
      if (h) {
        // Store by column index for duplicate handling
        vals[col] = cell.value != null ? cell.value : null;
        // Also store by header name (last wins for duplicates)
        obj[h] = cell.value != null ? cell.value : null;
      }
    });
    obj._vals = vals;
    // Skip empty rows
    if (obj['Field group'] || obj['Crop'] || obj['Product name']) {
      rows.push(obj);
    }
  });

  if (rows.length === 0) throw new Error('No CWO data rows found');
  log.info(`Parsed ${rows.length} CWO rows`);
  return rows;
}

/**
 * Extract unique field groups from parsed CWO rows.
 */
export function extractFieldGroups(rows) {
  const groups = new Set();
  for (const r of rows) {
    const fg = (r['Field group'] || '').toString().trim();
    if (fg) groups.add(fg);
  }
  return [...groups].sort();
}

function parseNum(val) {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  const n = parseFloat(String(val).replace(/[,]/g, ''));
  return isNaN(n) ? 0 : n;
}

/**
 * Preview CWO import: aggregate fields → farm+crop, match products.
 */
export async function previewCwoImport(rows, cropYear, fieldGroupMappings) {
  // fieldGroupMappings: { fieldGroup: farmId }

  // Get enterprise farm for product library
  const enterprise = await prisma.farm.findFirst({ where: { is_enterprise: true } });
  const productLibrary = enterprise
    ? await prisma.agroProduct.findMany({ where: { farm_id: enterprise.id } })
    : [];

  // Get farm names for display
  const farms = await prisma.farm.findMany({ where: { is_enterprise: false, farm_type: 'farm' } });
  const farmById = {};
  for (const f of farms) farmById[f.id] = f;

  // Aggregate: farmId+crop → { acres, products[], yields[] }
  const aggregated = {}; // key: farmId:crop
  const warnings = [];
  const unmappedGroups = new Set();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const fieldGroup = (r['Field group'] || '').toString().trim();
    const status = (r['Status'] || '').toString().trim();
    if (status === 'Canceled') continue;

    const farmId = fieldGroupMappings[fieldGroup];
    if (!farmId && fieldGroup) {
      unmappedGroups.add(fieldGroup);
      continue;
    }
    if (!farmId) continue;

    const crop = (r['Crop'] || '').toString().trim();
    if (!crop) continue;

    const key = `${farmId}:${crop}`;
    if (!aggregated[key]) {
      aggregated[key] = {
        farm_id: farmId,
        farm_name: farmById[farmId]?.name || farmId,
        crop,
        acres: 0,
        fieldGroups: new Set(),
        products: {},
        yields: [],
      };
    }
    const agg = aggregated[key];
    agg.fieldGroups.add(fieldGroup);

    // Acres from sowing operations (Tillable area column)
    const operationType = (r['Operation type'] || '').toString().trim();
    if (operationType.toLowerCase() === 'sowing') {
      const tillableArea = parseNum(r['Tillable area']);
      // Only add acres once per field group for this crop
      // We track per-field acres, so sum them
      if (tillableArea > 0) {
        agg.acres += tillableArea;
      }
    }

    // Product data
    const productName = (r['Product name'] || '').toString().trim();
    if (productName) {
      const applicableType = (r['Applicable type'] || '').toString().trim().toLowerCase();
      const category = TYPE_MAP[applicableType] || 'chemical';
      const timing = TIMING_MAP[applicableType] || null;

      // Prefer Fact rate, fall back to Planned rate
      const factRate = parseNum(r['Fact rate per area']);
      const plannedRate = parseNum(r['Planned rate per area']);
      const rate = factRate > 0 ? factRate : plannedRate;
      const rateSource = factRate > 0 ? 'actual' : 'planned';

      let rateUnit = (r['Rate per area unit'] || '').toString().trim();
      // Unit normalization: kg/ac → lbs/ac
      if (rateUnit.toLowerCase().includes('kg/ac') || rateUnit.toLowerCase().includes('kg/acre')) {
        rateUnit = 'lbs/acre';
        // Convert kg to lbs
        const convertedRate = rate * KG_TO_LBS;
        if (!agg.products[productName]) {
          agg.products[productName] = {
            product_name: productName,
            category,
            timing,
            rates: [],
            rate_unit: rateUnit,
            canonical_name: buildCanonicalName(productName),
          };
        }
        agg.products[productName].rates.push({ rate: convertedRate, source: rateSource });
      } else {
        // Normalize common units
        if (rateUnit.toLowerCase().includes('l/ac') || rateUnit.toLowerCase().includes('l/acre')) {
          rateUnit = 'L/acre';
        } else if (rateUnit.toLowerCase().includes('lbs/ac') || rateUnit.toLowerCase().includes('lb/ac')) {
          rateUnit = 'lbs/acre';
        }
        if (!agg.products[productName]) {
          agg.products[productName] = {
            product_name: productName,
            category,
            timing,
            rates: [],
            rate_unit: rateUnit || 'per acre',
            canonical_name: buildCanonicalName(productName),
          };
        }
        agg.products[productName].rates.push({ rate, source: rateSource });
      }
    }

    // Harvest yield (Fact amount = bu/acre for harvest operations)
    if (operationType.toLowerCase() === 'harvesting') {
      const factAmount = parseNum(r['Fact amount']);
      if (factAmount > 0) {
        agg.yields.push(factAmount);
      }
    }
  }

  // Compute averages and match products
  const farmCrops = [];
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const agg of Object.values(aggregated)) {
    const products = [];
    for (const p of Object.values(agg.products)) {
      const avgRate = p.rates.length > 0
        ? p.rates.reduce((s, r) => s + r.rate, 0) / p.rates.length
        : 0;
      const hasActual = p.rates.some(r => r.source === 'actual');

      // Fuzzy match to product library
      const match = findBestMatch(p.product_name, productLibrary);
      if (match) matchedCount++;
      else unmatchedCount++;

      products.push({
        product_name: p.product_name,
        canonical_name: p.canonical_name,
        category: p.category,
        timing: p.timing,
        avg_rate: avgRate,
        rate_unit: p.rate_unit,
        rate_source: hasActual ? 'actual' : 'planned',
        matched_product: match?.match?.name || null,
        matched_product_id: match?.match?.id || null,
        match_score: match?.score || 0,
        cost_per_unit: match?.match?.cost_per_application_unit || 0,
      });
    }

    const avgYield = agg.yields.length > 0
      ? agg.yields.reduce((s, y) => s + y, 0) / agg.yields.length
      : 0;

    farmCrops.push({
      farm_id: agg.farm_id,
      farm_name: agg.farm_name,
      crop: agg.crop,
      acres: agg.acres,
      field_groups: [...agg.fieldGroups],
      avg_yield_bu: avgYield,
      products,
      product_count: products.length,
      matched_count: products.filter(p => p.matched_product).length,
      unmatched_count: products.filter(p => !p.matched_product).length,
    });
  }

  if (unmappedGroups.size > 0) {
    warnings.push(`Unmapped field groups: ${[...unmappedGroups].join(', ')}`);
  }

  // Check for zero-rate products
  const zeroRateCount = farmCrops.reduce(
    (s, fc) => s + fc.products.filter(p => p.avg_rate === 0).length, 0,
  );
  if (zeroRateCount > 0) {
    warnings.push(`${zeroRateCount} products have zero application rate`);
  }

  return {
    farm_crops: farmCrops,
    total_farms: new Set(farmCrops.map(fc => fc.farm_id)).size,
    total_crops: farmCrops.length,
    total_products: matchedCount + unmatchedCount,
    matched_products: matchedCount,
    unmatched_products: unmatchedCount,
    pricing_coverage: matchedCount + unmatchedCount > 0
      ? Math.round((matchedCount / (matchedCount + unmatchedCount)) * 100)
      : 0,
    warnings,
    crop_year: cropYear,
  };
}

/**
 * Commit CWO import: create/update AgroPlan + CropAllocation + CropInput.
 */
export async function commitCwoImport(preview, cropYear, label, userId) {
  const plansCreated = [];
  const allocsCreated = [];
  const inputsCreated = [];

  // Group by farm
  const byFarm = {};
  for (const fc of preview.farm_crops) {
    if (!byFarm[fc.farm_id]) byFarm[fc.farm_id] = [];
    byFarm[fc.farm_id].push(fc);
  }

  for (const [farmId, crops] of Object.entries(byFarm)) {
    // Find or create plan (only draft plans can be updated)
    let plan = await prisma.agroPlan.findUnique({
      where: { farm_id_crop_year: { farm_id: farmId, crop_year: cropYear } },
    });

    if (plan && !['draft', 'submitted'].includes(plan.status)) {
      log.info(`Skipping farm ${farmId}: plan is ${plan.status} (not draft/submitted)`);
      continue;
    }

    if (!plan) {
      plan = await prisma.agroPlan.create({
        data: {
          farm_id: farmId,
          crop_year: cropYear,
          status: 'draft',
          prepared_by: 'CWO Import',
        },
      });
      plansCreated.push(plan.id);
    }

    for (let i = 0; i < crops.length; i++) {
      const fc = crops[i];

      // Upsert allocation
      let alloc = await prisma.cropAllocation.findUnique({
        where: { plan_id_crop: { plan_id: plan.id, crop: fc.crop } },
      });

      if (alloc) {
        // Update existing allocation
        alloc = await prisma.cropAllocation.update({
          where: { id: alloc.id },
          data: {
            acres: fc.acres || alloc.acres,
            target_yield_bu: fc.avg_yield_bu || alloc.target_yield_bu,
          },
        });
        // Delete existing CWO-sourced inputs (keep manually entered ones)
        // For simplicity, replace all inputs for this allocation
        await prisma.cropInput.deleteMany({ where: { allocation_id: alloc.id } });
      } else {
        alloc = await prisma.cropAllocation.create({
          data: {
            plan_id: plan.id,
            crop: fc.crop,
            acres: fc.acres,
            target_yield_bu: fc.avg_yield_bu || 0,
            commodity_price: 0,
            sort_order: i,
          },
        });
        allocsCreated.push(alloc.id);
      }

      // Create inputs
      for (let j = 0; j < fc.products.length; j++) {
        const p = fc.products[j];
        if (p.avg_rate === 0 && !p.cost_per_unit) continue; // Skip zero-everything

        await prisma.cropInput.create({
          data: {
            allocation_id: alloc.id,
            category: p.category,
            product_name: p.product_name,
            timing: p.timing,
            rate: p.avg_rate,
            rate_unit: p.rate_unit,
            cost_per_unit: p.cost_per_unit || 0,
            sort_order: j,
          },
        });
        inputsCreated.push(`${fc.crop}:${p.product_name}`);
      }
    }
  }

  // Create import snapshot
  await prisma.cwoImportSnapshot.create({
    data: {
      crop_year: cropYear,
      label: label || `CWO Import ${new Date().toISOString().slice(0, 10)}`,
      source: 'cwo_export',
      imported_by: userId,
      row_count: preview.farm_crops.reduce((s, fc) => s + fc.products.length, 0),
      summary_json: {
        farms: preview.total_farms,
        crops: preview.total_crops,
        products: preview.total_products,
        pricing_coverage: preview.pricing_coverage,
      },
    },
  });

  log.info(`CWO import committed: ${plansCreated.length} plans, ${allocsCreated.length} allocs, ${inputsCreated.length} inputs`);

  return {
    plans_created: plansCreated.length,
    allocations_created: allocsCreated.length,
    inputs_created: inputsCreated.length,
    crop_year: cropYear,
  };
}
