import prisma from '../config/database.js';
import { convertBuToKg, convertKgToMt } from './inventoryService.js';

// ─── Conversion Utility ─────────────────────────────────────────────

/**
 * Factor to convert $/bu to $/MT for a given commodity.
 * price_per_mt = price_per_bu * buToMtFactor(lbs_per_bu)
 */
export function buToMtFactor(lbsPerBu) {
  return 1000 / (lbsPerBu * 0.45359237);
}

// ─── Group A: Pure functions (no DB) ─────────────────────────────────

/**
 * Compute hold-vs-sell analysis for a given position.
 */
export function computeHoldVsSell(carryPerMtMonth, months, expectedGainPerMt, qty) {
  const holdCost = carryPerMtMonth * months * qty;
  const potentialGain = expectedGainPerMt * qty;
  const netBenefit = potentialGain - holdCost;
  return {
    hold_cost: holdCost,
    potential_gain: potentialGain,
    net_benefit: netBenefit,
    recommendation: netBenefit > 0 ? 'hold' : 'sell',
  };
}

/**
 * Compute sell priority for a commodity position row.
 * Expects: { bid_per_bu, cop_per_bu, target_price_bu, outlook, pct_committed }
 */
export function computeSellPriority(row) {
  let score = 50;
  const reasons = [];

  // Margin above COP
  if (row.bid_per_bu && row.cop_per_bu) {
    const margin = ((row.bid_per_bu - row.cop_per_bu) / row.cop_per_bu) * 100;
    if (margin > 20) { score += 20; reasons.push(`Strong margin (${margin.toFixed(0)}% above COP)`); }
    else if (margin > 10) { score += 10; reasons.push(`Good margin (${margin.toFixed(0)}% above COP)`); }
    else if (margin < 0) { score -= 15; reasons.push('Below cost of production'); }
  }

  // Target price check
  if (row.bid_per_bu && row.target_price_bu) {
    if (row.bid_per_bu >= row.target_price_bu) {
      score += 15;
      reasons.push('At or above target price');
    } else {
      const gap = ((row.target_price_bu - row.bid_per_bu) / row.target_price_bu) * 100;
      if (gap < 5) { score += 5; reasons.push('Within 5% of target'); }
    }
  }

  // Outlook
  if (row.outlook === 'bearish') { score += 10; reasons.push('Bearish outlook — sell before decline'); }
  else if (row.outlook === 'bullish') { score -= 10; reasons.push('Bullish outlook — consider holding'); }

  // Commitment level
  if (row.pct_committed !== undefined) {
    if (row.pct_committed < 30) { score += 5; reasons.push('Low commitment — room to sell'); }
    else if (row.pct_committed > 80) { score -= 10; reasons.push('High commitment — limited remaining'); }
  }

  score = Math.max(0, Math.min(100, score));

  let priority, action;
  if (score >= 75) { priority = 'high'; action = 'STRONG SELL'; }
  else if (score >= 55) { priority = 'medium'; action = 'MODERATE'; }
  else if (score >= 40) { priority = 'low'; action = 'WEAK'; }
  else { priority = 'low'; action = 'HOLD'; }

  return { priority, action, rationale: reasons.join('; '), score };
}

// ─── Group B: Settings & Reference ───────────────────────────────────

/**
 * Atomically get next contract number and increment sequence.
 */
export async function getContractNextNumber(farmId) {
  return prisma.$transaction(async (tx) => {
    const settings = await tx.marketingSettings.upsert({
      where: { farm_id: farmId },
      update: { next_contract_seq: { increment: 1 } },
      create: { farm_id: farmId, next_contract_seq: 2 },
    });
    const seq = settings.next_contract_seq - 1; // We incremented, so subtract 1 for current
    const prefix = settings.contract_prefix || 'MKT';
    return `${prefix}-${String(seq).padStart(3, '0')}`;
  });
}

/**
 * Compute carry cost from farm settings.
 */
export async function computeCarryCost(farmId) {
  const settings = await prisma.marketingSettings.findUnique({ where: { farm_id: farmId } });
  const locRate = settings?.loc_interest_rate || 0.0725;
  const storageCost = settings?.storage_cost_per_mt_month || 3.5;

  // Assume average grain value of ~$400/MT for LOC cost calc
  const avgGrainValue = 400;
  const monthlyLocCost = (avgGrainValue * locRate) / 12;
  const monthlyCarryPerMt = monthlyLocCost + storageCost;

  return {
    loc_rate: locRate,
    storage: storageCost,
    monthly_loc_cost: monthlyLocCost,
    monthly_carry_per_mt: monthlyCarryPerMt,
  };
}

// ─── Group C: Prices ─────────────────────────────────────────────────

/**
 * Get latest market price per commodity for a farm.
 */
export async function getLatestPrices(farmId) {
  const commodities = await prisma.commodity.findMany({
    where: { farm_id: farmId, NOT: { code: 'FERT' } },
    orderBy: { name: 'asc' },
  });

  const results = [];
  for (const c of commodities) {
    const price = await prisma.marketPrice.findFirst({
      where: { farm_id: farmId, commodity_id: c.id },
      orderBy: { price_date: 'desc' },
    });
    results.push({
      commodity_id: c.id,
      commodity_name: c.name,
      commodity_code: c.code,
      lbs_per_bu: c.lbs_per_bu,
      ...(price ? {
        price_id: price.id,
        price_date: price.price_date,
        bid_per_bu: price.bid_per_bu,
        basis_per_bu: price.basis_per_bu,
        futures_reference: price.futures_reference,
        futures_close: price.futures_close,
        buyer_name: price.buyer_name,
        outlook: price.outlook,
        cop_per_bu: price.cop_per_bu,
        target_price_bu: price.target_price_bu,
        notes: price.notes,
      } : {}),
    });
  }
  return results;
}

/**
 * Upsert a market price for today, then check alerts.
 */
export async function updatePrice(farmId, commodityId, data) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const price = await prisma.marketPrice.upsert({
    where: { farm_id_commodity_id_price_date: { farm_id: farmId, commodity_id: commodityId, price_date: today } },
    update: data,
    create: { farm_id: farmId, commodity_id: commodityId, price_date: today, ...data },
    include: { commodity: true },
  });

  // Check price alerts
  if (data.bid_per_bu) {
    await checkPriceAlerts(farmId, commodityId, data.bid_per_bu);
  }

  return price;
}

/**
 * Evaluate price alerts for a commodity.
 */
export async function checkPriceAlerts(farmId, commodityId, bidPerBu) {
  const alerts = await prisma.priceAlert.findMany({
    where: { farm_id: farmId, commodity_id: commodityId, is_active: true },
  });

  const triggered = [];
  for (const alert of alerts) {
    let shouldTrigger = false;
    if (alert.direction === 'above' && bidPerBu >= alert.threshold_value) shouldTrigger = true;
    if (alert.direction === 'below' && bidPerBu <= alert.threshold_value) shouldTrigger = true;

    if (shouldTrigger) {
      await prisma.priceAlert.update({
        where: { id: alert.id },
        data: { is_active: false, triggered_at: new Date(), triggered_value: bidPerBu },
      });
      triggered.push(alert);
    }
  }
  return triggered;
}

// ─── Group D: Position & Dashboard ───────────────────────────────────

/**
 * Get grain position by commodity: inventory, committed, available, price, sell priority.
 */
export async function getPositionByCommodity(farmId) {
  // Get latest count period
  const latestPeriod = await prisma.countPeriod.findFirst({
    where: { farm_id: farmId },
    orderBy: { period_date: 'desc' },
  });

  // Get bin counts for inventory
  const binCounts = latestPeriod ? await prisma.binCount.findMany({
    where: { farm_id: farmId, count_period_id: latestPeriod.id },
    include: { commodity: true },
  }) : [];

  // Aggregate inventory by commodity
  const inventoryMap = {};
  for (const bc of binCounts) {
    if (!bc.commodity || bc.commodity.code === 'FERT') continue;
    const code = bc.commodity.code;
    if (!inventoryMap[code]) {
      inventoryMap[code] = {
        commodity_id: bc.commodity.id,
        commodity_name: bc.commodity.name,
        commodity_code: code,
        lbs_per_bu: bc.commodity.lbs_per_bu,
        inventory_kg: 0,
      };
    }
    inventoryMap[code].inventory_kg += bc.kg;
  }

  // Get marketing contracts (active = not cancelled/settled)
  const contracts = await prisma.marketingContract.findMany({
    where: {
      farm_id: farmId,
      status: { in: ['executed', 'in_delivery'] },
    },
    include: { commodity: true },
  });

  const committedMap = {};
  for (const c of contracts) {
    const code = c.commodity.code;
    committedMap[code] = (committedMap[code] || 0) + c.remaining_mt;
  }

  // Get latest prices
  const prices = await getLatestPrices(farmId);
  const priceMap = {};
  for (const p of prices) {
    priceMap[p.commodity_code] = p;
  }

  // Ensure all commodities with contracts or prices are included
  const allCodes = new Set([
    ...Object.keys(inventoryMap),
    ...Object.keys(committedMap),
    ...prices.map(p => p.commodity_code),
  ]);

  const result = [];
  for (const code of allCodes) {
    const inv = inventoryMap[code];
    const price = priceMap[code] || {};
    const inventoryMt = inv ? convertKgToMt(inv.inventory_kg) : 0;
    const committedMt = committedMap[code] || 0;
    const availableMt = Math.max(0, inventoryMt - committedMt);
    const pctCommitted = inventoryMt > 0 ? (committedMt / inventoryMt) * 100 : 0;

    // Value at current bid
    const factor = inv ? buToMtFactor(inv.lbs_per_bu) : (price.lbs_per_bu ? buToMtFactor(price.lbs_per_bu) : 0);
    const bidPerMt = price.bid_per_bu && factor ? price.bid_per_bu * factor : 0;
    const inventoryValue = inventoryMt * bidPerMt;

    const sellPriority = computeSellPriority({
      bid_per_bu: price.bid_per_bu,
      cop_per_bu: price.cop_per_bu,
      target_price_bu: price.target_price_bu,
      outlook: price.outlook,
      pct_committed: pctCommitted,
    });

    result.push({
      commodity_id: inv?.commodity_id || price.commodity_id,
      commodity_name: inv?.commodity_name || price.commodity_name,
      commodity_code: code,
      lbs_per_bu: inv?.lbs_per_bu || price.lbs_per_bu,
      inventory_mt: inventoryMt,
      committed_mt: committedMt,
      available_mt: availableMt,
      pct_committed: pctCommitted,
      bid_per_bu: price.bid_per_bu || null,
      bid_per_mt: bidPerMt || null,
      cop_per_bu: price.cop_per_bu || null,
      target_price_bu: price.target_price_bu || null,
      outlook: price.outlook || null,
      inventory_value: inventoryValue,
      ...sellPriority,
    });
  }

  return result.sort((a, b) => (a.commodity_name || '').localeCompare(b.commodity_name || ''));
}

/**
 * Get full marketing dashboard data.
 */
export async function getMarketingDashboard(farmId) {
  const positionGrid = await getPositionByCommodity(farmId);

  // KPIs
  const totalMt = positionGrid.reduce((s, r) => s + r.inventory_mt, 0);
  const committedMt = positionGrid.reduce((s, r) => s + r.committed_mt, 0);
  const availableMt = positionGrid.reduce((s, r) => s + r.available_mt, 0);
  const totalValue = positionGrid.reduce((s, r) => s + r.inventory_value, 0);
  const pctSold = totalMt > 0 ? (committedMt / totalMt) * 100 : 0;

  // Active contracts count
  const activeContracts = await prisma.marketingContract.count({
    where: { farm_id: farmId, status: { in: ['executed', 'in_delivery'] } },
  });

  // YTD hauled
  const ytdContracts = await prisma.marketingContract.findMany({
    where: { farm_id: farmId, status: { in: ['in_delivery', 'delivered', 'settled'] } },
  });
  const ytdHauled = ytdContracts.reduce((s, c) => s + c.delivered_mt, 0);

  // Chart data: committed vs available per crop
  const chartData = positionGrid.map(r => ({
    commodity: r.commodity_code,
    committed: r.committed_mt,
    available: r.available_mt,
  }));

  return {
    kpis: {
      total_mt: totalMt,
      ytd_hauled: ytdHauled,
      committed_mt: committedMt,
      available_mt: availableMt,
      active_contracts: activeContracts,
      total_value: totalValue,
      pct_sold: pctSold,
    },
    positionGrid,
    chartData,
  };
}

// ─── Group E: Contract Lifecycle ─────────────────────────────────────

/**
 * Create a new marketing contract.
 */
export async function createContract(farmId, data) {
  const commodity = await prisma.commodity.findUnique({ where: { id: data.commodity_id } });
  if (!commodity) throw new Error('Commodity not found');

  const contractNumber = await getContractNextNumber(farmId);
  const factor = buToMtFactor(commodity.lbs_per_bu);
  const priceMt = data.price_per_bu ? data.price_per_bu * factor : null;
  const contractValue = priceMt ? priceMt * data.contracted_mt : null;

  const contract = await prisma.marketingContract.create({
    data: {
      farm_id: farmId,
      contract_number: contractNumber,
      crop_year: data.crop_year || '2025/26',
      commodity_id: data.commodity_id,
      counterparty_id: data.counterparty_id,
      grade: data.grade || null,
      broker: data.broker || null,
      contracted_mt: data.contracted_mt,
      delivered_mt: 0,
      remaining_mt: data.contracted_mt,
      tolerance_pct: data.tolerance_pct || null,
      pricing_type: data.pricing_type || 'flat',
      pricing_status: data.pricing_status || (data.price_per_bu ? 'priced' : 'unpriced'),
      price_per_bu: data.price_per_bu || null,
      price_per_mt: priceMt,
      basis_level: data.basis_level || null,
      futures_reference: data.futures_reference || null,
      futures_price: data.futures_price || null,
      currency: data.currency || 'CAD',
      delivery_start: data.delivery_start ? new Date(data.delivery_start) : null,
      delivery_end: data.delivery_end ? new Date(data.delivery_end) : null,
      elevator_site: data.elevator_site || null,
      farm_origin: data.farm_origin || null,
      status: 'executed',
      contract_value: contractValue,
      cop_per_mt: data.cop_per_mt || null,
      notes: data.notes || null,
      created_by: data.created_by || null,
    },
    include: { counterparty: true, commodity: true },
  });

  // Check if this oversells inventory
  let warning = null;
  const position = await getPositionByCommodity(farmId);
  const pos = position.find(p => p.commodity_id === data.commodity_id);
  if (pos && pos.available_mt < 0) {
    warning = `Warning: This contract oversells ${commodity.name} by ${Math.abs(pos.available_mt).toFixed(1)} MT`;
  }

  return { contract, warning };
}

/**
 * Record a delivery against a marketing contract.
 */
export async function updateContractDelivery(contractId, deliveryData) {
  const contract = await prisma.marketingContract.findUnique({
    where: { id: contractId },
    include: { commodity: true },
  });
  if (!contract) throw new Error('Contract not found');

  const delivery = await prisma.delivery.create({
    data: {
      farm_id: contract.farm_id,
      marketing_contract_id: contractId,
      mt_delivered: deliveryData.mt_delivered,
      gross_weight_mt: deliveryData.gross_weight_mt || null,
      dockage_pct: deliveryData.dockage_pct || null,
      delivery_date: new Date(deliveryData.delivery_date),
      ticket_number: deliveryData.ticket_number || null,
      notes: deliveryData.notes || null,
    },
  });

  // Update contract delivered/remaining
  const newDelivered = contract.delivered_mt + deliveryData.mt_delivered;
  const newRemaining = Math.max(0, contract.contracted_mt - newDelivered);

  // Auto-transition status
  let newStatus = contract.status;
  if (contract.status === 'executed') newStatus = 'in_delivery';
  if (newRemaining <= 0) newStatus = 'delivered';

  await prisma.marketingContract.update({
    where: { id: contractId },
    data: {
      delivered_mt: newDelivered,
      remaining_mt: newRemaining,
      status: newStatus,
    },
  });

  return { delivery, newStatus, delivered_mt: newDelivered, remaining_mt: newRemaining };
}

/**
 * Settle a delivered contract.
 */
export async function settleContract(contractId, data) {
  const contract = await prisma.marketingContract.findUnique({ where: { id: contractId } });
  if (!contract) throw new Error('Contract not found');
  if (contract.status !== 'delivered') throw new Error('Contract must be in delivered status to settle');

  return prisma.marketingContract.update({
    where: { id: contractId },
    data: {
      status: 'settled',
      settlement_date: data.settlement_date ? new Date(data.settlement_date) : new Date(),
      settlement_amount: data.settlement_amount,
    },
    include: { counterparty: true, commodity: true },
  });
}

// ─── Group F: Analysis ───────────────────────────────────────────────

/**
 * Comprehensive sell analysis for the Sell Decision Tool.
 */
export async function computeSellAnalysis(farmId, inputs) {
  const { commodity_id, quantity_mt, price_per_bu, hold_months, expected_future_price_bu } = inputs;

  const commodity = await prisma.commodity.findUnique({ where: { id: commodity_id } });
  if (!commodity) throw new Error('Commodity not found');

  const factor = buToMtFactor(commodity.lbs_per_bu);
  const priceMt = price_per_bu * factor;
  const dealValue = priceMt * quantity_mt;

  // Get COP from latest price
  const latestPrice = await prisma.marketPrice.findFirst({
    where: { farm_id: farmId, commodity_id },
    orderBy: { price_date: 'desc' },
  });
  const copBu = latestPrice?.cop_per_bu || 0;
  const copMt = copBu * factor;
  const margin = priceMt - copMt;
  const marginPct = copMt > 0 ? (margin / copMt) * 100 : 0;

  // Target check
  const targetBu = latestPrice?.target_price_bu || 0;
  const targetMet = targetBu > 0 && price_per_bu >= targetBu;

  // Carry cost
  const carry = await computeCarryCost(farmId);
  const holdCost = carry.monthly_carry_per_mt * (hold_months || 0) * quantity_mt;

  // Expected gain if holding
  const futurePriceMt = expected_future_price_bu ? expected_future_price_bu * factor : priceMt;
  const expectedGain = (futurePriceMt - priceMt) * quantity_mt;
  const netGainFromHolding = expectedGain - holdCost;

  // Cash flow check
  const cashFlow = await getCashFlowProjection(farmId, 3);
  const threeMonthNet = cashFlow.monthly.reduce((s, m) => s + m.net, 0);
  const cashFlowTight = threeMonthNet < 0;

  // Scoring
  const signals = [];
  let score = 50;

  if (marginPct > 15) { score += 15; signals.push({ signal: 'margin', value: 'positive', detail: `${marginPct.toFixed(0)}% above COP` }); }
  else if (marginPct < 0) { score -= 10; signals.push({ signal: 'margin', value: 'negative', detail: 'Below COP' }); }
  else { signals.push({ signal: 'margin', value: 'neutral', detail: `${marginPct.toFixed(0)}% above COP` }); }

  if (targetMet) { score += 15; signals.push({ signal: 'target', value: 'positive', detail: 'At or above target' }); }
  else { signals.push({ signal: 'target', value: 'neutral', detail: `${((targetBu - price_per_bu) / targetBu * 100).toFixed(0)}% below target` }); }

  if (netGainFromHolding < 0) { score += 10; signals.push({ signal: 'carry', value: 'positive', detail: 'Carry cost exceeds expected gain' }); }
  else { score -= 5; signals.push({ signal: 'carry', value: 'negative', detail: 'Expected gain exceeds carry' }); }

  if (cashFlowTight) { score += 10; signals.push({ signal: 'cash_flow', value: 'positive', detail: 'Cash flow pressure — sell to fund operations' }); }
  else { signals.push({ signal: 'cash_flow', value: 'neutral', detail: 'Cash flow adequate' }); }

  score = Math.max(0, Math.min(100, score));
  let recommendation;
  if (score >= 75) recommendation = 'STRONG SELL';
  else if (score >= 55) recommendation = 'MODERATE';
  else if (score >= 40) recommendation = 'WEAK';
  else recommendation = 'HOLD';

  return {
    commodity: { id: commodity.id, name: commodity.name, code: commodity.code },
    quantity_mt,
    price_per_bu,
    price_per_mt: priceMt,
    deal_value: dealValue,
    cop_per_bu: copBu,
    cop_per_mt: copMt,
    margin_per_mt: margin,
    margin_pct: marginPct,
    target_per_bu: targetBu,
    target_met: targetMet,
    hold_months: hold_months || 0,
    carry_cost_total: holdCost,
    carry_per_mt_month: carry.monthly_carry_per_mt,
    expected_future_price_bu: expected_future_price_bu || price_per_bu,
    expected_gain: expectedGain,
    net_gain_from_holding: netGainFromHolding,
    cash_flow_tight: cashFlowTight,
    three_month_net: threeMonthNet,
    signals,
    score,
    recommendation,
  };
}

/**
 * Get cash flow projection for N months forward.
 */
export async function getCashFlowProjection(farmId, months = 6) {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + months, 0);

  const entries = await prisma.cashFlowEntry.findMany({
    where: {
      farm_id: farmId,
      period_date: { gte: startDate, lte: endDate },
    },
    orderBy: { period_date: 'asc' },
  });

  // Also include expected receipts from active contracts
  const activeContracts = await prisma.marketingContract.findMany({
    where: {
      farm_id: farmId,
      status: { in: ['executed', 'in_delivery'] },
      contract_value: { not: null },
    },
    include: { commodity: true },
  });

  // Build monthly buckets
  const monthly = [];
  let cumulative = 0;
  for (let i = 0; i < months; i++) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const monthKey = monthDate.toISOString().slice(0, 7); // YYYY-MM

    const monthEntries = entries.filter(e => {
      const d = new Date(e.period_date);
      return d.getFullYear() === monthDate.getFullYear() && d.getMonth() === monthDate.getMonth();
    });

    const requirements = monthEntries
      .filter(e => e.entry_type === 'requirement')
      .reduce((s, e) => s + e.amount, 0);

    const receipts = monthEntries
      .filter(e => e.entry_type === 'receipt')
      .reduce((s, e) => s + e.amount, 0);

    const net = requirements + receipts; // requirements are negative
    cumulative += net;

    monthly.push({
      month: monthKey,
      month_date: monthDate,
      requirements: Math.abs(requirements),
      receipts,
      net,
      cumulative,
    });
  }

  // Stress test: what if prices drop 10%?
  const totalReceipts = monthly.reduce((s, m) => s + m.receipts, 0);
  const stressReceipts = totalReceipts * 0.9;
  const stressNet = monthly.reduce((s, m) => s + m.net, 0) - (totalReceipts * 0.1);

  // Get LOC available
  const settings = await prisma.marketingSettings.findUnique({ where: { farm_id: farmId } });
  const locAvailable = settings?.loc_available || 0;

  const totalNet = monthly.reduce((s, m) => s + m.net, 0);
  const cashGap3Mo = monthly.slice(0, 3).reduce((s, m) => s + m.net, 0);

  return {
    monthly,
    summary: {
      total_requirements: monthly.reduce((s, m) => s + m.requirements, 0),
      total_receipts: totalReceipts,
      total_net: totalNet,
      cash_gap_3mo: cashGap3Mo,
      loc_available: locAvailable,
      net_gap_after_loc: cashGap3Mo + locAvailable,
    },
    stressTest: {
      price_reduction_pct: 10,
      stressed_receipts: stressReceipts,
      stressed_net: stressNet,
    },
  };
}
