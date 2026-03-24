import prisma from '../config/database.js';
import { updatePerUnitCell } from './calculationService.js';
import createLogger from '../utils/logger.js';

const log = createLogger('labour');

// ─── Default Season Template ────────────────────────────────────────

const DEFAULT_SEASONS = [
  {
    name: 'Seeding', sort_order: 1, months: ['May'],
    roles: ['Seeders', 'Truckers', 'Sprayer', 'Roller/Spreader'],
  },
  {
    name: 'Summer', sort_order: 2, months: ['Jun', 'Jul', 'Aug'],
    roles: ['Sprayer', 'Spray Trucker', 'Grain Trucker', 'Yard', 'Mechanic'],
  },
  {
    name: 'Harvest', sort_order: 3, months: ['Sep', 'Oct'],
    roles: ['Combines', 'Trucks/Bagger', 'Grain Carts'],
  },
  {
    name: 'Fall Work', sort_order: 4, months: ['Oct'],
    roles: ['Sprayer Desiccate', 'Sprayer Fall Burn', 'Spreading'],
  },
  {
    name: 'Winter', sort_order: 5, months: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'],
    roles: ['Grain Truckers', 'Winter Yard', 'Mechanic'],
  },
];

// ─── Acre Resolution (always from Assumption — source of truth) ─────

async function resolveAcres(farmId, fiscalYear, fallback) {
  const assumption = await prisma.assumption.findUnique({
    where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
  });
  return Math.round(assumption?.total_acres || fallback || 0);
}

// ─── Plan CRUD ──────────────────────────────────────────────────────

export async function getPlan(farmId, fiscalYear) {
  const plan = await prisma.labourPlan.findUnique({
    where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
    include: {
      seasons: {
        orderBy: { sort_order: 'asc' },
        include: { roles: { orderBy: { sort_order: 'asc' } } },
      },
    },
  });
  if (!plan) return null;

  // Sync acres from Assumption (source of truth set by Agronomy)
  const currentAcres = await resolveAcres(farmId, fiscalYear, plan.total_acres);
  if (currentAcres !== plan.total_acres) {
    await prisma.labourPlan.update({
      where: { id: plan.id },
      data: { total_acres: currentAcres },
    });
    plan.total_acres = currentAcres;
  }

  return plan;
}

export async function createPlan(farmId, fiscalYear, avgWage) {
  // Get total_acres from assumptions
  const assumption = await prisma.assumption.findUnique({
    where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
  });
  const totalAcres = assumption?.total_acres || 0;

  const plan = await prisma.labourPlan.create({
    data: {
      farm_id: farmId,
      fiscal_year: fiscalYear,
      avg_wage: avgWage || 32,
      total_acres: Math.round(totalAcres),
      seasons: {
        create: DEFAULT_SEASONS.map(s => ({
          name: s.name,
          sort_order: s.sort_order,
          months: s.months,
          roles: {
            create: s.roles.map((r, i) => ({
              name: r,
              hours: 0,
              sort_order: i + 1,
            })),
          },
        })),
      },
    },
    include: {
      seasons: {
        orderBy: { sort_order: 'asc' },
        include: { roles: { orderBy: { sort_order: 'asc' } } },
      },
    },
  });

  log.info(`Created labour plan for farm=${farmId} FY${fiscalYear}`);
  return plan;
}

export async function updatePlan(planId, data) {
  const { avg_wage, fuel_rate_per_acre, fuel_cost_per_litre, notes, status, total_acres } = data;
  const updateData = {};
  if (avg_wage !== undefined) updateData.avg_wage = avg_wage;
  if (fuel_rate_per_acre !== undefined) updateData.fuel_rate_per_acre = fuel_rate_per_acre;
  if (fuel_cost_per_litre !== undefined) updateData.fuel_cost_per_litre = fuel_cost_per_litre;
  if (notes !== undefined) updateData.notes = notes;
  if (status !== undefined) updateData.status = status;
  if (total_acres !== undefined) updateData.total_acres = total_acres;

  return prisma.labourPlan.update({
    where: { id: planId },
    data: updateData,
    include: {
      seasons: {
        orderBy: { sort_order: 'asc' },
        include: { roles: { orderBy: { sort_order: 'asc' } } },
      },
    },
  });
}

// ─── Bulk Season/Role Update ────────────────────────────────────────

export async function bulkUpdateSeasons(planId, seasons) {
  // Delete existing seasons (cascade deletes roles)
  await prisma.labourSeason.deleteMany({ where: { plan_id: planId } });

  // Re-create all seasons and roles
  for (const s of seasons) {
    await prisma.labourSeason.create({
      data: {
        plan_id: planId,
        name: s.name,
        sort_order: s.sort_order,
        months: s.months,
        roles: {
          create: (s.roles || []).map((r, i) => ({
            name: r.name,
            hours: r.hours || 0,
            sort_order: r.sort_order ?? (i + 1),
          })),
        },
      },
    });
  }

  log.info(`Bulk updated seasons for plan=${planId}`);
  return getPlanById(planId);
}

async function getPlanById(planId) {
  const plan = await prisma.labourPlan.findUnique({
    where: { id: planId },
    include: {
      seasons: {
        orderBy: { sort_order: 'asc' },
        include: { roles: { orderBy: { sort_order: 'asc' } } },
      },
    },
  });
  if (!plan) return null;

  // Sync acres from Assumption
  const currentAcres = await resolveAcres(plan.farm_id, plan.fiscal_year, plan.total_acres);
  if (currentAcres !== plan.total_acres) {
    await prisma.labourPlan.update({
      where: { id: plan.id },
      data: { total_acres: currentAcres },
    });
    plan.total_acres = currentAcres;
  }

  return plan;
}

// ─── Push to Forecast ───────────────────────────────────────────────

export async function pushToForecast(planId) {
  const plan = await getPlanById(planId);
  if (!plan) throw new Error('Labour plan not found');

  const { farm_id, fiscal_year, avg_wage, fuel_rate_per_acre, total_acres } = plan;
  const wage = Number(avg_wage);
  const fuelRate = Number(fuel_rate_per_acre) || 0;

  if (!total_acres || total_acres === 0) {
    return { pushed: false, reason: 'No total acres set on plan' };
  }

  // Accumulate total hours per fiscal month across all seasons
  const monthHours = {};
  let grandTotalHours = 0;
  for (const season of plan.seasons) {
    const seasonHours = season.roles.reduce((sum, r) => sum + Number(r.hours), 0);
    const monthCount = season.months.length;
    if (monthCount === 0 || seasonHours === 0) continue;

    grandTotalHours += seasonHours;
    const hoursPerMonth = seasonHours / monthCount;
    for (const month of season.months) {
      monthHours[month] = (monthHours[month] || 0) + hoursPerMonth;
    }
  }

  // Zero out lpm_personnel (and lpm_fog if fuel push active) across all 12 months first
  const ALL_MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
  for (const month of ALL_MONTHS) {
    await updatePerUnitCell(farm_id, fiscal_year, month, 'lpm_personnel', 0);
    if (fuelRate > 0) {
      await updatePerUnitCell(farm_id, fiscal_year, month, 'lpm_fog', 0);
    }
  }

  // Write labour (lpm_personnel) and fuel (lpm_fog) to MonthlyData for each month
  const totalFuelCost = fuelRate * total_acres;
  const updated = [];
  for (const [month, hours] of Object.entries(monthHours)) {
    // Labour: plan is always writable (Two Books — actuals live in MonthlyActual)
    const totalCost = hours * wage;
    const perAcre = totalCost / total_acres;

    await updatePerUnitCell(
      farm_id, fiscal_year, month, 'lpm_personnel', perAcre,
      `From labour plan (FY${fiscal_year})`
    );

    // Fuel: allocate proportionally to hours
    if (fuelRate > 0 && grandTotalHours > 0) {
      const monthFuelCost = totalFuelCost * (hours / grandTotalHours);
      const fuelPerAcre = monthFuelCost / total_acres;
      await updatePerUnitCell(
        farm_id, fiscal_year, month, 'lpm_fog', fuelPerAcre,
        `From labour & fuel plan (FY${fiscal_year})`
      );
    }

    updated.push(month);
  }

  log.info(`Pushed labour & fuel to forecast: farm=${farm_id}, FY=${fiscal_year}, months=${updated.join(',')}`);
  return { pushed: true, fiscalYear: fiscal_year, monthsUpdated: updated, fuelPushed: fuelRate > 0 };
}

// ─── Bulk Status Update ─────────────────────────────────────────────

export async function bulkUpdatePlanStatus(fiscalYear, status) {
  const plans = await prisma.labourPlan.findMany({ where: { fiscal_year: fiscalYear } });
  const results = [];
  for (const plan of plans) {
    await prisma.labourPlan.update({ where: { id: plan.id }, data: { status } });
    results.push({ farm_id: plan.farm_id, plan_id: plan.id, old_status: plan.status, new_status: status });
  }
  log.info(`Bulk labour status update: ${results.length} plans → ${status} for FY${fiscalYear}`);
  return { updated: results.length, status, fiscal_year: fiscalYear, details: results };
}

// ─── Copy from Prior Year ────────────────────────────────────────────

export async function copyFromPriorYear(farmId, targetYear) {
  const sourceYear = targetYear - 1;
  const source = await getPlan(farmId, sourceYear);
  if (!source) return null;

  // Get total_acres from target year assumptions
  const assumption = await prisma.assumption.findUnique({
    where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: targetYear } },
  });
  const totalAcres = assumption?.total_acres || source.total_acres || 0;

  const plan = await prisma.labourPlan.create({
    data: {
      farm_id: farmId,
      fiscal_year: targetYear,
      avg_wage: source.avg_wage,
      fuel_rate_per_acre: source.fuel_rate_per_acre,
      fuel_cost_per_litre: source.fuel_cost_per_litre,
      total_acres: Math.round(totalAcres),
      seasons: {
        create: source.seasons.map(s => ({
          name: s.name,
          sort_order: s.sort_order,
          months: s.months,
          roles: {
            create: s.roles.map(r => ({
              name: r.name,
              hours: Number(r.hours),
              sort_order: r.sort_order,
            })),
          },
        })),
      },
    },
    include: {
      seasons: {
        orderBy: { sort_order: 'asc' },
        include: { roles: { orderBy: { sort_order: 'asc' } } },
      },
    },
  });

  log.info(`Copied labour plan from FY${sourceYear} → FY${targetYear} for farm=${farmId}`);
  return plan;
}

// ─── Bulk Push to Forecast ───────────────────────────────────────────

export async function bulkPushToForecast(fiscalYear) {
  const plans = await prisma.labourPlan.findMany({
    where: { fiscal_year: fiscalYear },
    select: { id: true, farm_id: true },
  });
  const results = [];
  for (const plan of plans) {
    try {
      const result = await pushToForecast(plan.id);
      results.push({ farm_id: plan.farm_id, plan_id: plan.id, ...result });
    } catch (err) {
      results.push({ farm_id: plan.farm_id, plan_id: plan.id, pushed: false, reason: err.message });
    }
  }
  const pushed = results.filter(r => r.pushed).length;
  log.info(`Bulk push to forecast: ${pushed}/${plans.length} plans for FY${fiscalYear}`);
  return { total: plans.length, pushed, fiscal_year: fiscalYear, details: results };
}

// ─── Dashboard (for enterprise rollup) ──────────────────────────────

export async function getDashboard(farmId, fiscalYear) {
  const plan = await getPlan(farmId, fiscalYear);
  if (!plan) return null;

  const wage = Number(plan.avg_wage);
  const fuelRate = Number(plan.fuel_rate_per_acre) || 0;
  const fuelCostPerLitre = Number(plan.fuel_cost_per_litre) || 1;
  let totalHours = 0;
  const seasonSummary = plan.seasons.map(s => {
    const hours = s.roles.reduce((sum, r) => sum + Number(r.hours), 0);
    totalHours += hours;
    return { name: s.name, hours, cost: hours * wage, role_count: s.roles.length };
  });

  // Add fuel allocation per season (proportional to hours)
  if (totalHours > 0 && fuelRate > 0) {
    const totalFuelCost = fuelRate * plan.total_acres;
    for (const s of seasonSummary) {
      s.fuel_cost = totalFuelCost * (s.hours / totalHours);
      s.fuel_pct = s.hours / totalHours;
    }
  }

  const totalCost = totalHours * wage;
  const totalFuelCost = fuelRate * (plan.total_acres || 0);
  const totalFuelLitres = fuelCostPerLitre > 0 ? totalFuelCost / fuelCostPerLitre : 0;
  return {
    plan_id: plan.id,
    status: plan.status,
    avg_wage: wage,
    fuel_rate_per_acre: fuelRate,
    fuel_cost_per_litre: fuelCostPerLitre,
    total_acres: plan.total_acres,
    total_hours: totalHours,
    total_cost: totalCost,
    total_fuel_cost: totalFuelCost,
    total_fuel_litres: totalFuelLitres,
    litres_per_acre: plan.total_acres ? totalFuelLitres / plan.total_acres : 0,
    cost_per_acre: plan.total_acres ? totalCost / plan.total_acres : 0,
    hours_per_acre: plan.total_acres ? totalHours / plan.total_acres : 0,
    seasons: seasonSummary,
  };
}
