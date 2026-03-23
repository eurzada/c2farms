import prisma from '../config/database.js';
import { buildCanonicalName, diceCoefficient } from './productMatchingService.js';
import { getWorkOrderMatrix } from './agronomyService.js';
import { getBuMatrix } from './procurementContractService.js';
import createLogger from '../utils/logger.js';

const log = createLogger('plan-vs-booked');

const CATEGORY_MAP = { seed: 'seed', seed_treatment: 'seed', fertilizer: 'fertilizer', chemical: 'chemical', adjuvant: 'chemical' };
const CATEGORIES = ['seed', 'fertilizer', 'chemical'];

function normCategory(cat) {
  return CATEGORY_MAP[cat] || 'chemical';
}

/**
 * Compare planned costs (agro plans) against booked costs (contracts + work orders)
 * broken down by BU farm and input category.
 */
export async function getPlanVsBooked(cropYear) {
  const year = Number(cropYear);

  // ─── 1. Fetch BU farms (exclude enterprise + terminals like LGX) ──
  const buFarms = await prisma.farm.findMany({
    where: { is_enterprise: { not: true }, farm_type: 'farm' },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  const farms = buFarms.map(f => ({ id: f.id, name: f.name.replace(/^C2\s*/i, '') }));
  const farmIdSet = new Set(farms.map(f => f.id));

  // ─── 2. Planned side — from agro plans ────────────────────────────
  // Map: canonical_name → { category, byFarm: { farmId: cost }, totalPlanned, displayName }
  const plannedProducts = new Map();
  // Also aggregate by farm × category
  const plannedByFarmCat = {}; // { farmId: { seed: $, fertilizer: $, chemical: $ } }

  const plans = await prisma.agroPlan.findMany({
    where: { crop_year: year },
    include: {
      allocations: {
        include: { inputs: true },
      },
    },
  });

  for (const plan of plans) {
    if (!farmIdSet.has(plan.farm_id)) continue;
    if (!plannedByFarmCat[plan.farm_id]) {
      plannedByFarmCat[plan.farm_id] = { seed: 0, fertilizer: 0, chemical: 0 };
    }

    for (const alloc of plan.allocations) {
      for (const inp of alloc.inputs) {
        const cat = normCategory(inp.category);
        const acres = (inp.category === 'seed' || inp.category === 'seed_treatment') && inp.acres != null ? inp.acres : alloc.acres;
        const cost = inp.rate * inp.cost_per_unit * acres;
        const canonical = buildCanonicalName(inp.product_name);

        // Aggregate by farm × category
        plannedByFarmCat[plan.farm_id][cat] += cost;

        // Aggregate by product
        if (!plannedProducts.has(canonical)) {
          plannedProducts.set(canonical, {
            displayName: inp.product_name,
            category: cat,
            byFarm: {},
            totalPlanned: 0,
          });
        }
        const pp = plannedProducts.get(canonical);
        pp.byFarm[plan.farm_id] = (pp.byFarm[plan.farm_id] || 0) + cost;
        pp.totalPlanned += cost;
      }
    }
  }

  // ─── 3. Booked side — contracts + work orders ─────────────────────
  // Map: canonical_name → { category, byFarm: { farmId: cost }, totalBooked, displayName }
  const bookedProducts = new Map();
  const bookedByFarmCat = {}; // { farmId: { seed: $, fertilizer: $, chemical: $ } }

  const addBooked = (canonical, displayName, category, farmId, cost) => {
    if (!farmIdSet.has(farmId)) return;
    const cat = normCategory(category);

    if (!bookedByFarmCat[farmId]) bookedByFarmCat[farmId] = { seed: 0, fertilizer: 0, chemical: 0 };
    bookedByFarmCat[farmId][cat] += cost;

    if (!bookedProducts.has(canonical)) {
      bookedProducts.set(canonical, {
        displayName,
        category: cat,
        byFarm: {},
        totalBooked: 0,
      });
    }
    const bp = bookedProducts.get(canonical);
    bp.byFarm[farmId] = (bp.byFarm[farmId] || 0) + cost;
    bp.totalBooked += cost;
  };

  // 3a. Procurement contracts
  try {
    const enterprise = await prisma.farm.findFirst({ where: { is_enterprise: true } });
    if (enterprise) {
      const contractMatrix = await getBuMatrix(enterprise.id, year);
      for (const p of contractMatrix.products) {
        const canonical = buildCanonicalName(p.product_name);
        for (const [farmId, data] of Object.entries(p.by_farm)) {
          if (farmId === '__unassigned__' || !data.cost) continue;
          addBooked(canonical, p.product_name, p.type, farmId, data.cost);
        }
      }
    }
  } catch (err) {
    log.warn('Could not fetch contract data for plan-vs-booked', err.message);
  }

  // 3b. Work orders
  try {
    const woMatrix = await getWorkOrderMatrix(year);
    for (const p of woMatrix.products) {
      const canonical = buildCanonicalName(p.product_name);
      for (const [farmId, data] of Object.entries(p.by_farm)) {
        if (farmId === '__unmapped__' || !data.cost) continue;
        addBooked(canonical, p.product_name, p.type, farmId, data.cost);
      }
    }
  } catch (err) {
    log.warn('Could not fetch work order data for plan-vs-booked', err.message);
  }

  // ─── 4. Merge into categories ─────────────────────────────────────
  const categories = CATEGORIES.map(cat => {
    const byFarm = {};
    let totalPlanned = 0;
    let totalBooked = 0;

    for (const farm of farms) {
      const planned = plannedByFarmCat[farm.id]?.[cat] || 0;
      const booked = bookedByFarmCat[farm.id]?.[cat] || 0;
      byFarm[farm.id] = { planned, booked };
      totalPlanned += planned;
      totalBooked += booked;
    }

    return { category: cat, byFarm, totalPlanned, totalBooked };
  });

  // ─── 5. Merge products using fuzzy matching ─────────────────────
  // Start with all planned products, then match booked products into them
  const MATCH_THRESHOLD = 0.5; // Lower than general matching (0.6) to catch variants like "Urea" ↔ "Treated Urea"
  const mergedProducts = new Map(); // canonical → { displayName, category, plannedByFarm, bookedByFarm, totalPlanned, totalBooked }
  const matchedBookedKeys = new Set();

  // Seed merged map with planned products
  for (const [canonical, pp] of plannedProducts) {
    mergedProducts.set(canonical, {
      displayName: pp.displayName,
      category: pp.category,
      plannedByFarm: { ...pp.byFarm },
      bookedByFarm: {},
      totalPlanned: pp.totalPlanned,
      totalBooked: 0,
    });
  }

  // Match each booked product to best planned product via fuzzy matching
  const plannedEntries = [...plannedProducts.entries()].map(([k, v]) => ({ canonical: k, name: v.displayName }));

  for (const [bookedCanonical, bp] of bookedProducts) {
    // Try exact canonical match first
    if (mergedProducts.has(bookedCanonical)) {
      const m = mergedProducts.get(bookedCanonical);
      for (const [fid, cost] of Object.entries(bp.byFarm)) {
        m.bookedByFarm[fid] = (m.bookedByFarm[fid] || 0) + cost;
      }
      m.totalBooked += bp.totalBooked;
      matchedBookedKeys.add(bookedCanonical);
      continue;
    }

    // Fuzzy match against planned canonical names
    let bestMatch = null;
    let bestScore = 0;
    for (const entry of plannedEntries) {
      const score = diceCoefficient(bookedCanonical, entry.canonical);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = entry.canonical;
      }
    }

    if (bestMatch && bestScore >= MATCH_THRESHOLD) {
      const m = mergedProducts.get(bestMatch);
      for (const [fid, cost] of Object.entries(bp.byFarm)) {
        m.bookedByFarm[fid] = (m.bookedByFarm[fid] || 0) + cost;
      }
      m.totalBooked += bp.totalBooked;
      matchedBookedKeys.add(bookedCanonical);
    }
  }

  // Add unmatched booked products as booked-only entries
  for (const [bookedCanonical, bp] of bookedProducts) {
    if (matchedBookedKeys.has(bookedCanonical)) continue;
    mergedProducts.set(bookedCanonical, {
      displayName: bp.displayName,
      category: bp.category,
      plannedByFarm: {},
      bookedByFarm: { ...bp.byFarm },
      totalPlanned: 0,
      totalBooked: bp.totalBooked,
    });
  }

  // Build final products array
  const products = [];
  for (const [, m] of mergedProducts) {
    const byFarm = {};
    for (const farm of farms) {
      const planned = m.plannedByFarm[farm.id] || 0;
      const booked = m.bookedByFarm[farm.id] || 0;
      if (planned > 0 || booked > 0) {
        byFarm[farm.id] = { planned, booked };
      }
    }

    products.push({
      name: m.displayName,
      category: m.category,
      byFarm,
      totalPlanned: m.totalPlanned,
      totalBooked: m.totalBooked,
    });
  }

  products.sort((a, b) => {
    const catOrder = CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category);
    if (catOrder !== 0) return catOrder;
    return b.totalPlanned - a.totalPlanned;
  });

  const grandTotalPlanned = categories.reduce((s, c) => s + c.totalPlanned, 0);
  const grandTotalBooked = categories.reduce((s, c) => s + c.totalBooked, 0);

  log.info(`Plan vs Booked for ${year}: ${farms.length} farms, ${products.length} products, planned=$${Math.round(grandTotalPlanned)}, booked=$${Math.round(grandTotalBooked)}`);

  return {
    farms,
    categories,
    products,
    grandTotalPlanned,
    grandTotalBooked,
  };
}
