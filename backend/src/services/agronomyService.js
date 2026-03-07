import prisma from '../config/database.js';
import ExcelJS from 'exceljs';
import { updatePerUnitCell } from './calculationService.js';
import createLogger from '../utils/logger.js';

const log = createLogger('agronomy');

// ─── Nutrient Calculations ──────────────────────────────────────────

export function parseAnalysis(code) {
  if (!code) return { n: 0, p: 0, k: 0, s: 0, cu: 0, b: 0, zn: 0 };
  const parts = code.split('-').map(Number);
  return {
    n: parts[0] || 0,
    p: parts[1] || 0,
    k: parts[2] || 0,
    s: parts[3] || 0,
    cu: parts[4] || 0,
    b: parts[5] || 0,
    zn: parts[6] || 0,
  };
}

export function computeNutrientBalance(allocation, fertInputs) {
  const yld = allocation.target_yield_bu || 0;
  // N/P/K/S: yield-based. Cu/B/Zn: flat targets from allocation
  // P and K rates are entered as negative (removal lbs), use absolute value for required
  const required = {
    n: yld * (allocation.n_rate_per_bu || 0),
    p: Math.abs(yld * (allocation.p_rate_per_bu || 0)),
    k: Math.abs(yld * (allocation.k_rate_per_bu || 0)),
    s: yld * (allocation.s_rate_per_bu || 0),
    cu: allocation.cu_target || 0,
    b: allocation.b_target || 0,
    zn: allocation.zn_target || 0,
  };

  const toApply = {
    n: required.n - (allocation.available_n || 0),
    p: required.p,
    k: required.k,
    s: required.s,
    cu: required.cu,
    b: required.b,
    zn: required.zn,
  };

  const applied = { n: 0, p: 0, k: 0, s: 0, cu: 0, b: 0, zn: 0 };
  for (const input of fertInputs) {
    const a = parseAnalysis(input.product_analysis);
    applied.n += input.rate * (a.n / 100);
    applied.p += input.rate * (a.p / 100);
    applied.k += input.rate * (a.k / 100);
    applied.s += input.rate * (a.s / 100);
    applied.cu += input.rate * (a.cu / 100);
    applied.b += input.rate * (a.b / 100);
    applied.zn += input.rate * (a.zn / 100);
  }

  return {
    required,
    toApply,
    applied,
    available_n: allocation.available_n || 0,
    surplus: {
      n: applied.n - toApply.n,
      p: applied.p - toApply.p,
      k: applied.k - toApply.k,
      s: applied.s - toApply.s,
      cu: applied.cu - toApply.cu,
      b: applied.b - toApply.b,
      zn: applied.zn - toApply.zn,
    },
  };
}

// ─── Plan CRUD ──────────────────────────────────────────────────────

export async function getPlan(farmId, cropYear) {
  return prisma.agroPlan.findUnique({
    where: { farm_id_crop_year: { farm_id: farmId, crop_year: cropYear } },
    include: {
      allocations: {
        orderBy: { sort_order: 'asc' },
        include: { inputs: { orderBy: { sort_order: 'asc' } } },
      },
    },
  });
}

export async function getPlanById(planId) {
  return prisma.agroPlan.findUnique({ where: { id: planId } });
}

export async function createPlan(farmId, cropYear, data = {}) {
  return prisma.agroPlan.create({
    data: {
      farm_id: farmId,
      crop_year: cropYear,
      prepared_by: data.prepared_by || null,
      notes: data.notes || null,
    },
    include: { allocations: { include: { inputs: true } } },
  });
}

export async function updatePlanStatus(planId, status, userName, { rejectionNotes, userEmail } = {}) {
  const updates = { status };
  if (status === 'submitted') {
    updates.submitted_by = userEmail || null;
  }
  if (status === 'approved') {
    updates.approved_by = userName;
    updates.approved_at = new Date();
    updates.rejected_by = null;
    updates.rejected_at = null;
    updates.rejection_notes = null;
  }
  if (status === 'rejected') {
    updates.rejected_by = userName;
    updates.rejected_at = new Date();
    updates.rejection_notes = rejectionNotes || null;
  }
  if (status === 'draft') {
    // Unlock — clear approval/rejection state
    updates.approved_by = null;
    updates.approved_at = null;
    updates.rejected_by = null;
    updates.rejected_at = null;
    updates.rejection_notes = null;
  }
  return prisma.agroPlan.update({
    where: { id: planId },
    data: updates,
    include: { allocations: { include: { inputs: true } } },
  });
}

// ─── Copy Inputs Between Allocations ─────────────────────────────────

export async function copyInputs(sourceAllocId, targetAllocId) {
  const source = await prisma.cropAllocation.findUnique({
    where: { id: sourceAllocId },
    include: { inputs: { orderBy: { sort_order: 'asc' } } },
  });
  if (!source) throw Object.assign(new Error('Source allocation not found'), { status: 404 });

  const target = await prisma.cropAllocation.findUnique({
    where: { id: targetAllocId },
    include: { inputs: true },
  });
  if (!target) throw Object.assign(new Error('Target allocation not found'), { status: 404 });

  // Delete existing inputs on target
  if (target.inputs.length > 0) {
    await prisma.cropInput.deleteMany({ where: { allocation_id: targetAllocId } });
  }

  // Copy source inputs (product/rate/cost only, not nutrient balance)
  const newInputs = source.inputs.map((inp, i) => ({
    allocation_id: targetAllocId,
    category: inp.category,
    product_name: inp.product_name,
    product_analysis: inp.product_analysis,
    form: inp.form,
    timing: inp.timing,
    rate: inp.rate,
    rate_unit: inp.rate_unit,
    cost_per_unit: inp.cost_per_unit,
    sort_order: i,
  }));

  if (newInputs.length > 0) {
    await prisma.cropInput.createMany({ data: newInputs });
  }

  return prisma.cropAllocation.findUnique({
    where: { id: targetAllocId },
    include: { inputs: { orderBy: { sort_order: 'asc' } } },
  });
}

// ─── Agronomy → Forecast Push ────────────────────────────────────────

// Seasonal distribution: maps category (and chemical timing) to fiscal months + weights
const SEASONAL_DISTRIBUTION = {
  seed: [
    { month: 'Apr', pct: 0.50 },
    { month: 'May', pct: 0.50 },
  ],
  fertilizer: [
    { month: 'Apr', pct: 0.25 },
    { month: 'May', pct: 0.25 },
    { month: 'Jun', pct: 0.25 },
    { month: 'Sep', pct: 0.25 },
  ],
  // Chemical timing → months
  chemical_preburn: [
    { month: 'May', pct: 1.0 },
  ],
  chemical_incrop: [
    { month: 'Jun', pct: 0.50 },
    { month: 'Jul', pct: 0.50 },
  ],
  chemical_fungicide: [
    { month: 'Aug', pct: 1.0 },
  ],
  chemical_fall_residual: [
    { month: 'Oct', pct: 1.0 },
  ],
  chemical_desiccation: [
    { month: 'Sep', pct: 1.0 },
  ],
  // Default for chemicals with no timing specified
  chemical_default: [
    { month: 'Jun', pct: 1.0 },
  ],
};

// Category code mapping for Forecast MonthlyData
const CATEGORY_CODES = {
  seed: 'input_seed',
  fertilizer: 'input_fert',
  chemical: 'input_chem',
};

function getChemicalDistribution(timing) {
  const key = `chemical_${timing || 'default'}`;
  return SEASONAL_DISTRIBUTION[key] || SEASONAL_DISTRIBUTION.chemical_default;
}

// Compute per-acre costs broken down by month for a single allocation
function computeMonthlyInputCosts(alloc) {
  // monthCosts: { 'Apr': { input_seed: X, input_fert: Y, input_chem: Z }, ... }
  const monthCosts = {};

  for (const inp of alloc.inputs || []) {
    const costPerAcre = inp.rate * inp.cost_per_unit;
    if (costPerAcre === 0) continue;

    let categoryCode;
    let distribution;

    if (inp.category === 'seed' || inp.category === 'seed_treatment') {
      categoryCode = CATEGORY_CODES.seed;
      distribution = SEASONAL_DISTRIBUTION.seed;
    } else if (inp.category === 'fertilizer') {
      categoryCode = CATEGORY_CODES.fertilizer;
      distribution = SEASONAL_DISTRIBUTION.fertilizer;
    } else if (inp.category === 'chemical') {
      categoryCode = CATEGORY_CODES.chemical;
      distribution = getChemicalDistribution(inp.timing);
    } else {
      continue;
    }

    for (const { month, pct } of distribution) {
      if (!monthCosts[month]) monthCosts[month] = {};
      monthCosts[month][categoryCode] = (monthCosts[month][categoryCode] || 0) + costPerAcre * pct;
    }
  }

  return monthCosts;
}

// Push approved agronomy plan costs into Forecast MonthlyData
// Crop year 2026 → FY2026 (Nov 2025 – Oct 2026); all input months (Apr–Oct) fall within FY2026
export async function pushToForecast(farmId, cropYear) {
  const plan = await getPlan(farmId, cropYear);
  if (!plan) throw new Error(`No agronomy plan found for crop year ${cropYear}`);

  const fiscalYear = cropYear; // Apr–Oct of crop year falls within same fiscal year

  // Check that assumptions exist for this fiscal year
  const assumption = await prisma.assumption.findUnique({
    where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
  });
  if (!assumption) {
    log.warn(`No assumptions for farm ${farmId} FY${fiscalYear} — skipping forecast push`);
    return { pushed: false, reason: 'No forecast assumptions for this fiscal year' };
  }

  // Aggregate monthly costs across all allocations (weighted by acres)
  // Since per-unit in forecast is farm-wide $/acre, we need weighted average
  const totalAcres = plan.allocations.reduce((s, a) => s + a.acres, 0);
  if (totalAcres === 0) {
    return { pushed: false, reason: 'No acres allocated' };
  }

  // Sync total_acres from agronomy plan to forecast assumptions
  if (assumption.total_acres !== totalAcres) {
    await prisma.assumption.update({
      where: { id: assumption.id },
      data: { total_acres: totalAcres },
    });
    log.info(`Updated assumption total_acres: ${assumption.total_acres} → ${totalAcres}`);
  }

  // Accumulate total $ by month, then divide by totalAcres for $/acre
  const monthTotals = {}; // { 'Apr': { input_seed: total$, ... }, ... }

  for (const alloc of plan.allocations) {
    const monthlyCosts = computeMonthlyInputCosts(alloc);
    for (const [month, costs] of Object.entries(monthlyCosts)) {
      if (!monthTotals[month]) monthTotals[month] = {};
      for (const [catCode, costPerAcre] of Object.entries(costs)) {
        // costPerAcre is per acre for THIS crop; scale by this crop's acres
        monthTotals[month][catCode] = (monthTotals[month][catCode] || 0) + costPerAcre * alloc.acres;
      }
    }
  }

  // Write to forecast — skip months that already have actuals
  const updated = [];
  for (const [month, costs] of Object.entries(monthTotals)) {
    // Check if this month already has actual data
    const existing = await prisma.monthlyData.findUnique({
      where: {
        farm_id_fiscal_year_month_type: {
          farm_id: farmId, fiscal_year: fiscalYear, month, type: 'per_unit',
        },
      },
    });

    if (existing?.is_actual) {
      log.info(`Skipping ${month} — already has actuals`);
      continue;
    }

    // Write each category as $/acre (total$ / totalAcres)
    for (const [catCode, totalDollars] of Object.entries(costs)) {
      const perAcre = totalDollars / totalAcres;
      await updatePerUnitCell(
        farmId, fiscalYear, month, catCode, perAcre,
        `From approved agronomy plan (crop year ${cropYear})`
      );
    }
    updated.push(month);
  }

  log.info(`Pushed agronomy costs to forecast: farm=${farmId}, FY=${fiscalYear}, months=${updated.join(',')}`);
  return { pushed: true, fiscalYear, monthsUpdated: updated };
}

// ─── Allocation CRUD ────────────────────────────────────────────────

export async function upsertAllocation(planId, data) {
  const { id, ...fields } = data;
  if (id) {
    return prisma.cropAllocation.update({
      where: { id },
      data: fields,
      include: { inputs: { orderBy: { sort_order: 'asc' } } },
    });
  }
  return prisma.cropAllocation.create({
    data: { plan_id: planId, ...fields },
    include: { inputs: { orderBy: { sort_order: 'asc' } } },
  });
}

export async function deleteAllocation(allocationId) {
  return prisma.cropAllocation.delete({ where: { id: allocationId } });
}

// ─── Input CRUD ─────────────────────────────────────────────────────

export async function upsertInput(allocationId, data) {
  const { id, ...fields } = data;
  if (id) {
    return prisma.cropInput.update({ where: { id }, data: fields });
  }
  return prisma.cropInput.create({ data: { allocation_id: allocationId, ...fields } });
}

export async function deleteInput(inputId) {
  return prisma.cropInput.delete({ where: { id: inputId } });
}

// ─── Bulk Fertilizer Save ───────────────────────────────────────────

export async function bulkSaveFertilizers(allocationId, fertRows) {
  // Delete all existing fertilizer inputs for this allocation
  await prisma.cropInput.deleteMany({
    where: { allocation_id: allocationId, category: 'fertilizer' },
  });

  // Create new records only where rate > 0
  const toCreate = fertRows
    .filter(r => r.rate > 0)
    .map((r, i) => ({
      allocation_id: allocationId,
      category: 'fertilizer',
      product_name: r.product_name,
      product_analysis: r.product_analysis || null,
      form: r.form || null,
      rate: r.rate,
      rate_unit: r.rate_unit || 'lbs/acre',
      cost_per_unit: r.cost_per_unit || 0,
      sort_order: r.sort_order ?? (10 + i),
    }));

  if (toCreate.length > 0) {
    await prisma.cropInput.createMany({ data: toCreate });
  }

  // Return updated allocation with inputs + nutrient balance
  const alloc = await prisma.cropAllocation.findUnique({
    where: { id: allocationId },
    include: { inputs: { orderBy: { sort_order: 'asc' } } },
  });
  const fertInputs = alloc.inputs.filter(i => i.category === 'fertilizer');
  const balance = computeNutrientBalance(alloc, fertInputs);
  return { allocation: alloc, balance };
}

// ─── Dashboard Aggregation ──────────────────────────────────────────

function computeInputCost(input) {
  return input.rate * input.cost_per_unit;
}

function summarizeAllocation(alloc) {
  let seedCost = 0, fertCost = 0, chemCost = 0;
  for (const inp of alloc.inputs || []) {
    const cpa = computeInputCost(inp);
    if (inp.category === 'seed' || inp.category === 'seed_treatment') seedCost += cpa;
    else if (inp.category === 'fertilizer') fertCost += cpa;
    else if (inp.category === 'chemical') chemCost += cpa;
  }
  const totalPerAcre = seedCost + fertCost + chemCost;
  const revenue = alloc.acres * alloc.target_yield_bu * alloc.commodity_price;
  return {
    crop: alloc.crop,
    acres: alloc.acres,
    target_yield_bu: alloc.target_yield_bu,
    commodity_price: alloc.commodity_price,
    seed_per_acre: seedCost,
    fert_per_acre: fertCost,
    chem_per_acre: chemCost,
    total_per_acre: totalPerAcre,
    seed_total: seedCost * alloc.acres,
    fert_total: fertCost * alloc.acres,
    chem_total: chemCost * alloc.acres,
    total_cost: totalPerAcre * alloc.acres,
    revenue,
    margin: revenue - totalPerAcre * alloc.acres,
  };
}

export async function getFarmSummary(planId) {
  const plan = await prisma.agroPlan.findUnique({
    where: { id: planId },
    include: {
      allocations: {
        orderBy: { sort_order: 'asc' },
        include: { inputs: true },
      },
    },
  });
  if (!plan) return null;

  const crops = plan.allocations.map(summarizeAllocation);
  const totals = crops.reduce(
    (acc, c) => {
      acc.acres += c.acres;
      acc.seed_total += c.seed_total;
      acc.fert_total += c.fert_total;
      acc.chem_total += c.chem_total;
      acc.total_cost += c.total_cost;
      acc.revenue += c.revenue;
      acc.margin += c.margin;
      return acc;
    },
    { acres: 0, seed_total: 0, fert_total: 0, chem_total: 0, total_cost: 0, revenue: 0, margin: 0 },
  );
  totals.total_per_acre = totals.acres ? totals.total_cost / totals.acres : 0;

  return { plan, crops, totals };
}

export async function getExecutiveDashboard(farmId, cropYear) {
  // For now, single-farm dashboard. Multi-farm (consolidated) is future.
  const plan = await getPlan(farmId, cropYear);
  if (!plan) return null;

  const crops = plan.allocations.map(summarizeAllocation);

  const byFarm = {
    farm_id: farmId,
    acres: 0, seed_total: 0, fert_total: 0, chem_total: 0,
    total_cost: 0, revenue: 0, margin: 0,
  };
  for (const c of crops) {
    byFarm.acres += c.acres;
    byFarm.seed_total += c.seed_total;
    byFarm.fert_total += c.fert_total;
    byFarm.chem_total += c.chem_total;
    byFarm.total_cost += c.total_cost;
    byFarm.revenue += c.revenue;
    byFarm.margin += c.margin;
  }
  byFarm.cost_per_acre = byFarm.acres ? byFarm.total_cost / byFarm.acres : 0;
  byFarm.margin_per_acre = byFarm.acres ? byFarm.margin / byFarm.acres : 0;
  byFarm.margin_pct = byFarm.revenue ? byFarm.margin / byFarm.revenue : 0;

  return {
    plan_status: plan.status,
    farm: byFarm,
    crops,
  };
}

export async function getProcurementSummary(farmId, cropYear) {
  const plan = await getPlan(farmId, cropYear);
  if (!plan) return null;

  const products = {};
  for (const alloc of plan.allocations) {
    for (const inp of alloc.inputs) {
      const key = `${inp.category}:${inp.product_name}`;
      if (!products[key]) {
        products[key] = {
          category: inp.category,
          product_name: inp.product_name,
          product_analysis: inp.product_analysis,
          rate_unit: inp.rate_unit,
          cost_per_unit: inp.cost_per_unit,
          total_qty: 0,
          total_cost: 0,
          crops: [],
        };
      }
      const qty = inp.rate * alloc.acres;
      products[key].total_qty += qty;
      products[key].total_cost += qty * inp.cost_per_unit;
      products[key].crops.push({ crop: alloc.crop, acres: alloc.acres, rate: inp.rate });
    }
  }
  return Object.values(products).sort((a, b) => b.total_cost - a.total_cost);
}

// ─── Product Reference CRUD ─────────────────────────────────────────

export async function getProducts(farmId, type) {
  const where = { farm_id: farmId };
  if (type) where.type = type;
  return prisma.agroProduct.findMany({ where, orderBy: { name: 'asc' } });
}

export async function upsertProduct(farmId, data) {
  const { id, ...fields } = data;
  if (id) {
    return prisma.agroProduct.update({ where: { id }, data: fields });
  }
  return prisma.agroProduct.create({ data: { farm_id: farmId, ...fields } });
}

export async function deleteProduct(productId) {
  return prisma.agroProduct.delete({ where: { id: productId } });
}

// ─── Bulk Import (Crop Allocations) ─────────────────────────────────

function normalizeHeader(h) {
  const s = (h || '').toString().trim().toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const map = {
    farm: 'farm', farm_name: 'farm', location: 'farm', business_unit: 'farm',
    crop: 'crop', crop_type: 'crop',
    acres: 'acres', total_acres: 'acres',
    yield_target: 'yield_target', target_yield: 'yield_target', yield_bu_ac: 'yield_target',
    target_yield_bu_ac: 'yield_target', yield: 'yield_target',
    price: 'price', commodity_price: 'price', price_bu: 'price', price_per_bu: 'price',
  };
  return map[s] || s;
}

export async function parseImportFile(buffer, fileName) {
  const rows = [];
  const ext = (fileName || '').split('.').pop().toLowerCase();

  if (ext === 'csv') {
    const text = buffer.toString('utf-8');
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');
    const headers = lines[0].split(',').map(normalizeHeader);
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(',');
      const row = {};
      headers.forEach((h, j) => { row[h] = (vals[j] || '').trim(); });
      if (row.farm && row.crop) rows.push(row);
    }
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount < 2) throw new Error('Excel file must have a header row and at least one data row');
    const headers = [];
    ws.getRow(1).eachCell((cell, col) => { headers[col] = normalizeHeader(cell.value); });
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const obj = {};
      row.eachCell((cell, col) => {
        const h = headers[col];
        if (h) obj[h] = cell.value != null ? cell.value.toString().trim() : '';
      });
      if (obj.farm && obj.crop) rows.push(obj);
    });
  }

  if (rows.length === 0) throw new Error('No data rows found');
  const missing = ['farm', 'crop', 'acres'].filter(c => !(c in rows[0]));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}`);

  return rows;
}

export async function previewImport(rows, userId) {
  const userRoles = await prisma.userFarmRole.findMany({
    where: { user_id: userId },
    include: { farm: true },
  });
  const farmMap = {};
  for (const ur of userRoles) {
    farmMap[ur.farm.name.toLowerCase().trim()] = ur.farm;
  }

  const farmCrops = {};
  const warnings = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const farm = farmMap[r.farm.toLowerCase().trim()];
    if (!farm) {
      warnings.push(`Row ${i + 2}: Farm "${r.farm}" not found — skipping`);
      continue;
    }
    if (!farmCrops[farm.name]) {
      farmCrops[farm.name] = { farm_id: farm.id, crops: {} };
    }
    const cropKey = r.crop.trim();
    if (!farmCrops[farm.name].crops[cropKey]) {
      farmCrops[farm.name].crops[cropKey] = {
        crop: cropKey,
        acres: parseFloat(r.acres) || 0,
        target_yield_bu: parseFloat(r.yield_target) || 0,
        commodity_price: parseFloat(r.price) || 0,
      };
    }
  }

  const farms = Object.entries(farmCrops).map(([name, data]) => ({
    farm_name: name,
    farm_id: data.farm_id,
    crops: Object.values(data.crops),
  }));

  return {
    farms,
    warnings,
    total_farms: farms.length,
    total_crops: farms.reduce((s, f) => s + f.crops.length, 0),
  };
}

export async function commitImport(preview, cropYear) {
  const results = [];

  for (const farm of preview.farms) {
    let plan = await prisma.agroPlan.findUnique({
      where: { farm_id_crop_year: { farm_id: farm.farm_id, crop_year: cropYear } },
    });
    if (!plan) {
      plan = await prisma.agroPlan.create({
        data: { farm_id: farm.farm_id, crop_year: cropYear, status: 'draft' },
      });
    }

    // Replace existing allocations if plan is draft (keep inputs if any exist)
    if (plan.status === 'draft') {
      await prisma.cropInput.deleteMany({ where: { allocation: { plan_id: plan.id } } });
      await prisma.cropAllocation.deleteMany({ where: { plan_id: plan.id } });
    }

    for (let i = 0; i < farm.crops.length; i++) {
      const c = farm.crops[i];
      await prisma.cropAllocation.create({
        data: {
          plan_id: plan.id,
          crop: c.crop,
          acres: c.acres,
          target_yield_bu: c.target_yield_bu,
          commodity_price: c.commodity_price,
          sort_order: i,
        },
      });
    }

    results.push({ farm_name: farm.farm_name, plan_id: plan.id, crops: farm.crops.length });
  }

  return results;
}

export async function generateTemplate(userId) {
  // Fetch this user's farms
  const userRoles = await prisma.userFarmRole.findMany({
    where: { user_id: userId },
    include: { farm: true },
    orderBy: { farm: { name: 'asc' } },
  });
  const farmNames = userRoles.map(r => r.farm.name);

  const CROPS = [
    'Canola', 'Spring Wheat', 'Spring Durum Wheat', 'Spring Barley',
    'Chickpeas', 'Small Red Lentils', 'Yellow Field Peas', 'Flax',
    'Winter Wheat', 'Oats', 'Soybeans', 'Corn',
  ];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Crop Allocations');

  // ── Header row ──
  const headers = ['Farm', 'Crop', 'Acres', 'Yield Target (bu/ac)', 'Price ($/bu)'];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF008CB2' } };
    cell.alignment = { horizontal: 'center' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF006E8C' } },
    };
  });

  // ── Example row (italic, to show format — user deletes or overwrites) ──
  const exRow = ws.addRow([farmNames[0] || 'Lewvan', 'Canola', 10000, 50, 14.50]);
  exRow.eachCell(cell => {
    cell.font = { italic: true, color: { argb: 'FF999999' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBE6' } };
  });
  // Add a note on the example row
  ws.getCell('A2').note = 'Example row — edit or delete this and fill in your data below';

  // ── Pre-populate rows: one row per farm × 3 crop slots ──
  let rowNum = 3;
  for (const farmName of farmNames) {
    for (let i = 0; i < 3; i++) {
      const row = ws.addRow([farmName, '', '', '', '']);
      const bgColor = farmNames.indexOf(farmName) % 2 === 0 ? 'FFF7F9FC' : 'FFFFFFFF';
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      });
      rowNum++;
    }
  }

  // Extra blank rows
  for (let i = 0; i < 10; i++) {
    ws.addRow(['', '', '', '', '']);
    rowNum++;
  }

  // ── Data validation: Farm dropdown ──
  const farmList = `"${farmNames.join(',')}"`;
  for (let r = 2; r <= rowNum; r++) {
    ws.getCell(`A${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [farmList],
      showErrorMessage: true,
      errorTitle: 'Invalid Farm',
      error: `Farm must be one of: ${farmNames.join(', ')}`,
    };
  }

  // ── Data validation: Crop dropdown ──
  const cropList = `"${CROPS.join(',')}"`;
  for (let r = 2; r <= rowNum; r++) {
    ws.getCell(`B${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [cropList],
      showErrorMessage: true,
      errorTitle: 'Invalid Crop',
      error: `Choose from the dropdown or type a custom crop name`,
    };
  }

  // ── Column widths ──
  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 26;
  ws.getColumn(3).width = 12;
  ws.getColumn(4).width = 18;
  ws.getColumn(5).width = 14;

  // ── Column formatting ──
  ws.getColumn(3).numFmt = '#,##0';
  ws.getColumn(4).numFmt = '#,##0.0';
  ws.getColumn(5).numFmt = '$#,##0.00';

  // ── Freeze header ──
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Reference sheet ──
  const ref = wb.addWorksheet('Reference');
  ref.addRow(['C2 Farms — Crop Allocation Import']).font = { bold: true, size: 14, color: { argb: 'FF008CB2' } };
  ref.addRow([]);

  // Farm list
  ref.addRow(['Your Farms:']).font = { bold: true };
  farmNames.forEach(f => ref.addRow([f]));
  ref.addRow([]);

  // Crop list
  ref.addRow(['Available Crops:']).font = { bold: true };
  CROPS.forEach(c => ref.addRow([c]));
  ref.addRow([]);

  // Instructions
  ref.addRow(['Instructions:']).font = { bold: true };
  ref.addRow(['1. Go to the "Crop Allocations" sheet']);
  ref.addRow(['2. Each farm has 3 pre-filled rows — add more rows as needed']);
  ref.addRow(['3. Use the Farm and Crop dropdowns, or type directly']);
  ref.addRow(['4. Enter Acres (required), Yield Target and Price (optional)']);
  ref.addRow(['5. Save and upload back into C2 Farms']);
  ref.addRow([]);
  ref.addRow(['Notes:']).font = { bold: true };
  ref.addRow(['- One row per farm + crop combination']);
  ref.addRow(['- Blank rows are ignored']);
  ref.addRow(['- Importing replaces existing draft allocations for the listed farms']);
  ref.addRow(['- Input programs (seed, fertilizer, chemical) are added per-farm in the Crop Inputs tab']);

  ref.getColumn(1).width = 70;

  return wb;
}
