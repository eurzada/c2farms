import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('terminal:bu-credits');

/**
 * BU Credit Allocation Service
 *
 * When a buyer (e.g., JGL) settles a MarketingContract that was routed through
 * LGX terminal (delivery_method='terminal'), this service allocates the settlement
 * amount to the contributing BU farms based on their grain contributions.
 *
 * Allocation methods:
 *   - grade_adjusted (default when grade_prices_json available):
 *     Each BU's credit is adjusted by the relative value of the grade they contributed.
 *   - proportional (fallback):
 *     Each BU gets credited proportionally by weight.
 */

/**
 * Compute BU credit allocations for a terminal-routed contract.
 *
 * @param {string} terminalFarmId - LGX terminal farm ID
 * @param {string} marketingContractId - The settled MarketingContract
 * @param {number} settlementNetAmount - Net amount from buyer settlement ($)
 * @returns {Array<{bu_farm_name, contributed_mt, grade, allocated_amount, rate_per_mt, allocation_basis}>}
 */
export async function computeAllocations(terminalFarmId, marketingContractId, settlementNetAmount) {
  // Get the marketing contract with grade prices
  const contract = await prisma.marketingContract.findUnique({
    where: { id: marketingContractId },
    select: {
      id: true,
      contract_number: true,
      grade_prices_json: true,
      commodity_id: true,
    },
  });

  if (!contract) {
    throw Object.assign(new Error('MarketingContract not found'), { status: 404 });
  }

  // Get all inbound C2 terminal tickets linked to this contract
  const tickets = await prisma.terminalTicket.findMany({
    where: {
      farm_id: terminalFarmId,
      marketing_contract_id: marketingContractId,
      is_c2_farms: true,
      direction: 'inbound',
      status: 'complete',
    },
    select: {
      id: true,
      grower_name: true,
      weight_kg: true,
      product: true,
      dockage_pct: true,
    },
  });

  if (tickets.length === 0) {
    logger.warn('No C2 inbound tickets found for contract %s', contract.contract_number);
    return [];
  }

  // Group by source BU farm (grower_name)
  const buGroups = new Map();
  for (const ticket of tickets) {
    const buName = ticket.grower_name || 'Unknown';
    if (!buGroups.has(buName)) {
      buGroups.set(buName, { contributed_kg: 0, tickets: [] });
    }
    const group = buGroups.get(buName);
    group.contributed_kg += ticket.weight_kg;
    group.tickets.push(ticket);
  }

  const totalKg = tickets.reduce((sum, t) => sum + t.weight_kg, 0);
  const totalMt = totalKg / 1000;

  // Determine allocation method
  const gradePrices = contract.grade_prices_json;
  const hasGradePrices = Array.isArray(gradePrices) && gradePrices.length > 0;
  const allocationBasis = hasGradePrices ? 'grade_adjusted' : 'proportional';

  let allocations;

  if (allocationBasis === 'grade_adjusted') {
    allocations = computeGradeAdjusted(buGroups, gradePrices, totalKg, settlementNetAmount);
  } else {
    allocations = computeProportional(buGroups, totalKg, settlementNetAmount);
  }

  // Apply rounding adjustment to the largest allocation so totals match exactly
  const allocatedTotal = allocations.reduce((sum, a) => sum + a.allocated_amount, 0);
  const roundingDiff = settlementNetAmount - allocatedTotal;
  if (Math.abs(roundingDiff) > 0.001 && allocations.length > 0) {
    // Add rounding to largest allocation
    const largest = allocations.reduce((max, a) => a.allocated_amount > max.allocated_amount ? a : max);
    largest.allocated_amount = Math.round((largest.allocated_amount + roundingDiff) * 100) / 100;
    largest.rate_per_mt = Math.round((largest.allocated_amount / largest.contributed_mt) * 100) / 100;
  }

  logger.info('Computed %s BU allocations (%s) for contract %s: $%s total',
    allocations.length, allocationBasis, contract.contract_number, settlementNetAmount);

  return allocations.map(a => ({ ...a, allocation_basis: allocationBasis }));
}

/**
 * Grade-adjusted allocation: each BU's credit reflects the grade value they contributed.
 */
function computeGradeAdjusted(buGroups, gradePrices, totalKg, settlementNetAmount) {
  // Build grade price lookup (normalize grade names to lowercase)
  const priceByGrade = new Map();
  for (const gp of gradePrices) {
    priceByGrade.set(normalizeGrade(gp.grade), gp.price_per_mt);
  }

  // Compute weighted value for each BU
  const buValues = [];
  let totalWeightedValue = 0;

  for (const [buName, group] of buGroups) {
    // Determine the dominant grade for this BU's tickets
    // (use the product field which contains grade info like "CWAD #1")
    const gradeCounts = new Map();
    for (const ticket of group.tickets) {
      const grade = normalizeGrade(ticket.product || '');
      gradeCounts.set(grade, (gradeCounts.get(grade) || 0) + ticket.weight_kg);
    }

    // Find the dominant grade by weight
    let dominantGrade = '';
    let maxKg = 0;
    for (const [grade, kg] of gradeCounts) {
      if (kg > maxKg) {
        dominantGrade = grade;
        maxKg = kg;
      }
    }

    // Look up grade price (fall back to average if grade not found)
    const gradePrice = priceByGrade.get(dominantGrade)
      || findClosestGradePrice(dominantGrade, priceByGrade)
      || averageGradePrice(gradePrices);

    const contributedMt = group.contributed_kg / 1000;
    const weightedValue = contributedMt * gradePrice;

    buValues.push({
      bu_farm_name: buName,
      contributed_mt: Math.round(contributedMt * 1000) / 1000,
      grade: dominantGrade || 'unknown',
      grade_price: gradePrice,
      weighted_value: weightedValue,
    });

    totalWeightedValue += weightedValue;
  }

  // Allocate settlement proportionally to weighted values
  return buValues.map(bv => ({
    bu_farm_name: bv.bu_farm_name,
    contributed_mt: bv.contributed_mt,
    grade: bv.grade,
    allocated_amount: Math.round((bv.weighted_value / totalWeightedValue) * settlementNetAmount * 100) / 100,
    rate_per_mt: Math.round(((bv.weighted_value / totalWeightedValue) * settlementNetAmount / bv.contributed_mt) * 100) / 100,
  }));
}

/**
 * Proportional allocation: simple weight-based split.
 */
function computeProportional(buGroups, totalKg, settlementNetAmount) {
  const allocations = [];
  const ratePmt = Math.round((settlementNetAmount / (totalKg / 1000)) * 100) / 100;

  for (const [buName, group] of buGroups) {
    const contributedMt = group.contributed_kg / 1000;
    const proportion = group.contributed_kg / totalKg;

    allocations.push({
      bu_farm_name: buName,
      contributed_mt: Math.round(contributedMt * 1000) / 1000,
      grade: 'all',
      allocated_amount: Math.round(proportion * settlementNetAmount * 100) / 100,
      rate_per_mt: ratePmt,
    });
  }

  return allocations;
}

/**
 * Create TerminalSettlement type='bu_credit' records from computed allocations.
 *
 * @param {string} terminalFarmId - LGX terminal farm ID
 * @param {string} marketingContractId - The settled MarketingContract
 * @param {string} counterpartyId - The buyer counterparty (for record keeping)
 * @param {Array} allocations - Output from computeAllocations
 * @returns {Array<Object>} Created TerminalSettlement records
 */
export async function createBuCredits(terminalFarmId, marketingContractId, counterpartyId, allocations) {
  if (!allocations.length) return [];

  // Look up BU farm IDs by name
  const buFarmMap = await resolveBuFarms(allocations.map(a => a.bu_farm_name));

  const created = [];
  for (let i = 0; i < allocations.length; i++) {
    const alloc = allocations[i];
    const buFarmId = buFarmMap.get(alloc.bu_farm_name) || null;

    // Generate settlement number: BUCR-<contractNumber>-<buName>
    const contract = await prisma.marketingContract.findUnique({
      where: { id: marketingContractId },
      select: { contract_number: true },
    });
    const settlementNumber = `BUCR-${contract?.contract_number || 'UNK'}-${i + 1}`;

    const settlement = await prisma.terminalSettlement.create({
      data: {
        farm_id: terminalFarmId,
        type: 'bu_credit',
        settlement_number: settlementNumber,
        counterparty_id: counterpartyId,
        marketing_contract_id: marketingContractId,
        source_bu_farm_id: buFarmId,
        allocation_basis: alloc.allocation_basis,
        settlement_date: new Date(),
        gross_amount: alloc.allocated_amount,
        net_amount: alloc.allocated_amount,
        status: 'finalized',
        notes: `BU credit for ${alloc.bu_farm_name}: ${alloc.contributed_mt} MT ${alloc.grade} @ $${alloc.rate_per_mt}/MT (${alloc.allocation_basis})`,
        lines: {
          create: [{
            line_number: 1,
            source_farm_name: alloc.bu_farm_name,
            grade: alloc.grade,
            net_weight_mt: alloc.contributed_mt,
            price_per_mt: alloc.rate_per_mt,
            line_amount: alloc.allocated_amount,
            match_status: 'matched',
            match_confidence: 1.0,
          }],
        },
      },
      include: {
        lines: true,
        source_bu_farm: { select: { id: true, name: true } },
      },
    });

    created.push(settlement);
  }

  logger.info('Created %d BU credit settlements for contract %s', created.length, marketingContractId);
  return created;
}

/**
 * Full cascade: compute allocations + create BU credit records + update contract.
 * Called when admin approves a grain sale settlement reconciliation.
 *
 * @param {string} terminalFarmId - LGX terminal farm ID
 * @param {string} marketingContractId - The settled MarketingContract
 * @param {number} settlementNetAmount - Net amount from buyer settlement
 * @param {string} counterpartyId - The buyer counterparty
 * @param {Object} io - Socket.io instance for broadcasting
 * @returns {{ allocations, settlements }}
 */
export async function processBuCreditCascade(terminalFarmId, marketingContractId, settlementNetAmount, counterpartyId, io) {
  logger.info('Processing BU credit cascade for contract %s, net $%s', marketingContractId, settlementNetAmount);

  // Step 1: Compute allocations
  const allocations = await computeAllocations(terminalFarmId, marketingContractId, settlementNetAmount);

  if (allocations.length === 0) {
    logger.warn('No BU allocations computed — no C2 inbound tickets linked to contract');
    return { allocations: [], settlements: [] };
  }

  // Step 2: Create BU credit settlements
  const settlements = await createBuCredits(terminalFarmId, marketingContractId, counterpartyId, allocations);

  // Step 3: Update marketing contract status
  await prisma.marketingContract.update({
    where: { id: marketingContractId },
    data: {
      settlement_amount: settlementNetAmount,
    },
  });

  // Step 4: Broadcast update
  if (io) {
    io.to(`farm:${terminalFarmId}`).emit('bu-credits-created', {
      marketingContractId,
      count: settlements.length,
      totalAmount: settlementNetAmount,
    });
  }

  logger.info('BU credit cascade complete: %d allocations, $%s total', settlements.length, settlementNetAmount);

  return { allocations, settlements };
}

/**
 * Get existing BU credit allocations for a contract.
 */
export async function getBuCredits(terminalFarmId, marketingContractId) {
  return prisma.terminalSettlement.findMany({
    where: {
      farm_id: terminalFarmId,
      marketing_contract_id: marketingContractId,
      type: 'bu_credit',
    },
    include: {
      source_bu_farm: { select: { id: true, name: true } },
      lines: true,
      counterparty: { select: { id: true, name: true, short_code: true } },
    },
    orderBy: { created_at: 'asc' },
  });
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Normalize grade string for matching (e.g., "CWAD #1" -> "cwad #1", "Durum #1" -> "durum #1")
 */
function normalizeGrade(grade) {
  return (grade || '').toLowerCase().trim();
}

/**
 * Try to find a grade price by partial match (e.g., "#1" matches "Durum #1")
 */
function findClosestGradePrice(grade, priceByGrade) {
  // Extract the number grade (e.g., "#1", "#2", "#3")
  const numMatch = grade.match(/#(\d)/);
  if (!numMatch) return null;

  const gradeNum = `#${numMatch[1]}`;
  for (const [key, price] of priceByGrade) {
    if (key.includes(gradeNum)) return price;
  }
  return null;
}

/**
 * Average of all grade prices as fallback.
 */
function averageGradePrice(gradePrices) {
  if (!gradePrices?.length) return 0;
  return gradePrices.reduce((sum, gp) => sum + gp.price_per_mt, 0) / gradePrices.length;
}

/**
 * Resolve BU farm IDs from grower names.
 * Attempts to match grower_name (e.g., "C2 - Hyas", "Hyas") to Farm records.
 */
async function resolveBuFarms(buNames) {
  const farms = await prisma.farm.findMany({
    where: {
      is_enterprise: false,
      farm_type: 'farm',
    },
    select: { id: true, name: true },
  });

  const result = new Map();
  for (const buName of buNames) {
    const normalized = buName.toLowerCase().replace(/^c2\s*[-–—]\s*/, '').trim();
    const match = farms.find(f =>
      f.name.toLowerCase().includes(normalized)
      || normalized.includes(f.name.toLowerCase())
    );
    if (match) {
      result.set(buName, match.id);
    }
  }

  return result;
}
