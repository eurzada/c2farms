import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';

const log = createLogger('procurement');

// ─── Contract CRUD ──────────────────────────────────────────────────

export async function getContracts(farmId, filters = {}) {
  const { cropYear, status, category, buFarmId, search } = filters;

  const where = { farm_id: farmId };
  if (cropYear) where.crop_year = Number(cropYear);
  if (status) where.status = status;
  if (category) where.input_category = category;
  if (buFarmId) where.lines = { some: { bu_farm_id: buFarmId } };
  if (search) {
    where.OR = [
      { contract_number: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { counterparty: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const contracts = await prisma.procurementContract.findMany({
    where,
    include: {
      counterparty: { select: { id: true, name: true, short_code: true, type: true } },
      lines: { orderBy: { line_number: 'asc' } },
    },
    orderBy: { contract_number: 'asc' },
  });

  // Resolve BU farm names for lines
  const allBuIds = [...new Set(contracts.flatMap(c => c.lines.map(l => l.bu_farm_id)).filter(Boolean))];
  const buFarms = allBuIds.length > 0
    ? await prisma.farm.findMany({ where: { id: { in: allBuIds } }, select: { id: true, name: true } })
    : [];
  const farmNameMap = Object.fromEntries(buFarms.map(f => [f.id, f.name.replace(/^C2\s*/i, '')]));

  // Annotate lines with bu_farm_name
  for (const c of contracts) {
    for (const l of c.lines) {
      l.bu_farm_name = l.bu_farm_id ? (farmNameMap[l.bu_farm_id] || l.bu_farm_id) : null;
    }
  }

  return contracts;
}

export async function getContractById(farmId, id) {
  const contract = await prisma.procurementContract.findFirst({
    where: { id, farm_id: farmId },
    include: {
      counterparty: { select: { id: true, name: true, short_code: true, type: true } },
      lines: true,
    },
  });
  if (!contract) {
    throw Object.assign(new Error('Contract not found'), { status: 404 });
  }
  return contract;
}

export async function createContract(farmId, data) {
  const { lines = [], ...headerFields } = data;

  const result = await prisma.$transaction(async (tx) => {
    // Compute contract_value from lines if not provided
    let contractValue = headerFields.contract_value;
    if (contractValue == null && lines.length > 0) {
      contractValue = lines.reduce((sum, l) => sum + (l.line_total || (l.qty * l.unit_price) || 0), 0);
    }

    const contract = await tx.procurementContract.create({
      data: {
        farm_id: farmId,
        contract_number: headerFields.contract_number,
        counterparty_id: headerFields.counterparty_id,
        crop_year: headerFields.crop_year,
        input_category: headerFields.input_category,
        description: headerFields.description || null,
        blend_formula: headerFields.blend_formula || null,
        contract_value: contractValue || null,
        currency: headerFields.currency || 'CAD',
        valid_from: headerFields.valid_from ? new Date(headerFields.valid_from) : null,
        valid_to: headerFields.valid_to ? new Date(headerFields.valid_to) : null,
        payment_due: headerFields.payment_due || null,
        delivery_window: headerFields.delivery_window || null,
        status: headerFields.status || 'ordered',
        source_file: headerFields.source_file || null,
        notes: headerFields.notes || null,
        created_by: headerFields.created_by || null,
      },
    });

    if (lines.length > 0) {
      await tx.procurementContractLine.createMany({
        data: lines.map((l, i) => ({
          contract_id: contract.id,
          line_number: l.line_number ?? (i + 1),
          bu_farm_id: l.bu_farm_id || null,
          input_category: l.input_category || headerFields.input_category,
          product_code: l.product_code || null,
          product_name: l.product_name,
          product_analysis: l.product_analysis || null,
          blend_formula: l.blend_formula || null,
          qty: l.qty || 0,
          qty_unit: l.qty_unit || 'tonnes',
          unit_price: l.unit_price || 0,
          price_unit: l.price_unit || '$/tonne',
          line_total: l.line_total || (l.qty || 0) * (l.unit_price || 0),
          delivered_qty: l.delivered_qty || 0,
          notes: l.notes || null,
        })),
      });
    }

    return tx.procurementContract.findUnique({
      where: { id: contract.id },
      include: {
        counterparty: { select: { id: true, name: true, short_code: true, type: true } },
        lines: true,
      },
    });
  });

  log.info(`Created procurement contract ${result.contract_number} with ${lines.length} lines`);
  return result;
}

export async function updateContract(farmId, id, data) {
  // Verify ownership
  const existing = await prisma.procurementContract.findFirst({
    where: { id, farm_id: farmId },
  });
  if (!existing) {
    throw Object.assign(new Error('Contract not found'), { status: 404 });
  }

  const updateData = {};
  const allowedFields = [
    'contract_number', 'counterparty_id', 'crop_year', 'input_category',
    'description', 'blend_formula', 'contract_value', 'currency',
    'valid_from', 'valid_to', 'payment_due', 'delivery_window',
    'status', 'source_file', 'notes',
  ];
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      if ((field === 'valid_from' || field === 'valid_to') && data[field]) {
        updateData[field] = new Date(data[field]);
      } else {
        updateData[field] = data[field];
      }
    }
  }

  const updated = await prisma.procurementContract.update({
    where: { id },
    data: updateData,
    include: {
      counterparty: { select: { id: true, name: true, short_code: true, type: true } },
      lines: true,
    },
  });

  log.info(`Updated procurement contract ${updated.contract_number}`);
  return updated;
}

export async function updateLine(lineId, data) {
  const existing = await prisma.procurementContractLine.findUnique({
    where: { id: lineId },
  });
  if (!existing) {
    throw Object.assign(new Error('Contract line not found'), { status: 404 });
  }

  const updateData = {};
  const allowedFields = [
    'bu_farm_id', 'input_category', 'product_code', 'product_name',
    'product_analysis', 'blend_formula', 'qty', 'qty_unit',
    'unit_price', 'price_unit', 'line_total', 'delivered_qty', 'notes',
  ];
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updateData[field] = data[field];
    }
  }

  // Recompute line_total if qty or unit_price changed but line_total wasn't explicitly set
  if (data.line_total === undefined && (data.qty !== undefined || data.unit_price !== undefined)) {
    const qty = data.qty ?? existing.qty;
    const unitPrice = data.unit_price ?? existing.unit_price;
    updateData.line_total = qty * unitPrice;
  }

  const updated = await prisma.procurementContractLine.update({
    where: { id: lineId },
    data: updateData,
  });

  log.info(`Updated procurement contract line ${lineId}`);
  return updated;
}

export async function deleteContract(farmId, id) {
  const existing = await prisma.procurementContract.findFirst({
    where: { id, farm_id: farmId },
  });
  if (!existing) {
    throw Object.assign(new Error('Contract not found'), { status: 404 });
  }

  await prisma.procurementContract.delete({ where: { id } });
  log.info(`Deleted procurement contract ${existing.contract_number}`);
  return { deleted: true, contract_number: existing.contract_number };
}

// ─── Dashboard KPIs ─────────────────────────────────────────────────

export async function getDashboardKPIs(farmId, cropYear) {
  const contracts = await prisma.procurementContract.findMany({
    where: { farm_id: farmId, crop_year: Number(cropYear) },
    include: { lines: true },
  });

  const byStatus = {};
  const byCategory = {};

  for (const c of contracts) {
    const value = c.contract_value || c.lines.reduce((s, l) => s + l.line_total, 0);

    // By status
    if (!byStatus[c.status]) byStatus[c.status] = { count: 0, value: 0 };
    byStatus[c.status].count++;
    byStatus[c.status].value += value;

    // By category
    if (!byCategory[c.input_category]) byCategory[c.input_category] = { count: 0, value: 0 };
    byCategory[c.input_category].count++;
    byCategory[c.input_category].value += value;
  }

  // By BU — aggregate from lines
  const buMap = {};
  for (const c of contracts) {
    for (const l of c.lines) {
      const key = l.bu_farm_id || '__unassigned__';
      if (!buMap[key]) buMap[key] = { farmId: l.bu_farm_id, value: 0 };
      buMap[key].value += l.line_total;
    }
  }

  // Look up farm names for BU breakdown
  const buFarmIds = Object.keys(buMap).filter(k => k !== '__unassigned__');
  const buFarms = buFarmIds.length > 0
    ? await prisma.farm.findMany({
      where: { id: { in: buFarmIds } },
      select: { id: true, name: true },
    })
    : [];
  const farmNameLookup = {};
  for (const f of buFarms) farmNameLookup[f.id] = f.name;

  const byBu = Object.values(buMap).map(b => ({
    farmId: b.farmId,
    farmName: b.farmId ? (farmNameLookup[b.farmId] || b.farmId) : 'Unassigned',
    value: b.value,
  })).sort((a, b) => b.value - a.value);

  const totalValue = contracts.reduce((s, c) => {
    return s + (c.contract_value || c.lines.reduce((ls, l) => ls + l.line_total, 0));
  }, 0);

  return {
    totalContracts: contracts.length,
    totalValue,
    byStatus,
    byCategory,
    byBu,
  };
}

// ─── Supplier Summary ───────────────────────────────────────────────

export async function getSupplierSummary(farmId, cropYear) {
  const contracts = await prisma.procurementContract.findMany({
    where: { farm_id: farmId, crop_year: Number(cropYear) },
    include: {
      counterparty: { select: { id: true, name: true } },
    },
  });

  const supplierMap = {};
  for (const c of contracts) {
    const key = c.counterparty_id;
    if (!supplierMap[key]) {
      supplierMap[key] = {
        counterpartyId: c.counterparty_id,
        name: c.counterparty.name,
        totalContracts: 0,
        totalValue: 0,
        categories: new Set(),
      };
    }
    supplierMap[key].totalContracts++;
    supplierMap[key].totalValue += c.contract_value || 0;
    supplierMap[key].categories.add(c.input_category);
  }

  return Object.values(supplierMap)
    .map(s => ({
      ...s,
      categories: [...s.categories].sort(),
    }))
    .sort((a, b) => b.totalValue - a.totalValue);
}

// ─── BU Matrix ──────────────────────────────────────────────────────

// ─── Sync Contract Pricing → Product Library ────────────────────────

const LBS_PER_TONNE = 2204.62;

/**
 * Sync fertilizer pricing from procurement contracts into AgroProduct records.
 * Computes weighted-average $/tonne per product, converts to $/lb,
 * and updates both cost_per_application_unit and default_cost.
 */
export async function syncContractPricingToLibrary(farmId, cropYear) {
  const lines = await prisma.procurementContractLine.findMany({
    where: {
      contract: { farm_id: farmId, crop_year: Number(cropYear) },
      input_category: 'fertilizer',
    },
    select: {
      product_name: true,
      product_analysis: true,
      qty: true,
      qty_unit: true,
      unit_price: true,
      price_unit: true,
      line_total: true,
    },
  });

  if (lines.length === 0) {
    log.info(`No fertilizer contract lines found for crop year ${cropYear}`);
    return { updated: 0, created: 0 };
  }

  // Group by product_analysis (NPK formula) — primary key for matching
  const byAnalysis = {};
  for (const l of lines) {
    const analysis = (l.product_analysis || '').trim();
    if (!analysis) continue;

    if (!byAnalysis[analysis]) {
      byAnalysis[analysis] = { product_name: l.product_name, totalQty: 0, totalValue: 0 };
    }

    // Normalize qty to tonnes for weighting
    let qtyTonnes = l.qty || 0;
    if (l.qty_unit === 'lbs') qtyTonnes = l.qty / LBS_PER_TONNE;

    // Compute value: prefer line_total, fallback to qty × unit_price
    let value = l.line_total || 0;
    if (!value && l.unit_price) {
      value = qtyTonnes * l.unit_price;
    }

    byAnalysis[analysis].totalQty += qtyTonnes;
    byAnalysis[analysis].totalValue += value;
  }

  // Load existing fertilizer AgroProducts for this farm
  const existing = await prisma.agroProduct.findMany({
    where: { farm_id: farmId, type: 'fertilizer' },
  });
  const byCode = {};
  for (const p of existing) {
    if (p.analysis_code) byCode[p.analysis_code.trim()] = p;
  }

  let updated = 0;
  let created = 0;

  for (const [analysis, data] of Object.entries(byAnalysis)) {
    if (data.totalQty <= 0) continue;

    const avgPricePerTonne = data.totalValue / data.totalQty;
    const costPerLb = avgPricePerTonne / LBS_PER_TONNE;

    const match = byCode[analysis];
    if (match) {
      // Update existing AgroProduct
      await prisma.agroProduct.update({
        where: { id: match.id },
        data: {
          cost_per_application_unit: costPerLb,
          default_cost: costPerLb,
        },
      });
      log.info(`Updated ${match.name} (${analysis}): $${costPerLb.toFixed(4)}/lb from $${avgPricePerTonne.toFixed(2)}/tonne`);
      updated++;
    } else {
      // Create new AgroProduct for unmatched fertilizer
      await prisma.agroProduct.create({
        data: {
          farm_id: farmId,
          name: data.product_name,
          type: 'fertilizer',
          analysis_code: analysis,
          form: 'dry',
          default_unit: 'lbs/acre',
          default_cost: costPerLb,
          cost_per_application_unit: costPerLb,
        },
      });
      log.info(`Created new product ${data.product_name} (${analysis}): $${costPerLb.toFixed(4)}/lb`);
      created++;
    }
  }

  log.info(`Contract pricing sync complete: ${updated} updated, ${created} created for crop year ${cropYear}`);
  return { updated, created };
}

// ─── BU Matrix ──────────────────────────────────────────────────────

export async function getBuMatrix(farmId, cropYear) {
  const contracts = await prisma.procurementContract.findMany({
    where: { farm_id: farmId, crop_year: Number(cropYear) },
    include: { lines: true },
  });

  const allLines = contracts.flatMap(c => c.lines);
  if (allLines.length === 0) return { products: [], farms: [], totals: { total_lines: 0, total_value: 0 } };

  // Collect unique BU farm IDs
  const buFarmIds = [...new Set(allLines.map(l => l.bu_farm_id).filter(Boolean))];
  const buFarms = buFarmIds.length > 0
    ? await prisma.farm.findMany({
      where: { id: { in: buFarmIds } },
      select: { id: true, name: true, is_enterprise: true },
    })
    : [];

  const farmLookup = {};
  for (const f of buFarms) farmLookup[f.id] = f;

  const farms = buFarms
    .filter(f => !f.is_enterprise)
    .map(f => ({ id: f.id, name: f.name.replace(/^C2\s*/i, '') }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Aggregate by product
  const productMap = {};
  for (const l of allLines) {
    const key = l.product_name;
    if (!productMap[key]) {
      productMap[key] = {
        product_name: l.product_name,
        product_code: l.product_code,
        product_analysis: l.product_analysis,
        type: l.input_category,
        by_farm: {},
        total_qty: 0,
        total_cost: 0,
      };
    }
    const p = productMap[key];
    const farmKey = l.bu_farm_id || '__unassigned__';

    if (!p.by_farm[farmKey]) p.by_farm[farmKey] = { qty: 0, cost: 0 };
    p.by_farm[farmKey].qty += l.qty;
    p.by_farm[farmKey].cost += l.line_total;
    p.total_qty += l.qty;
    p.total_cost += l.line_total;
  }

  const products = Object.values(productMap).sort((a, b) => b.total_cost - a.total_cost);

  const totals = {
    total_lines: allLines.length,
    total_value: products.reduce((s, p) => s + p.total_cost, 0),
  };

  return { products, farms, totals };
}
