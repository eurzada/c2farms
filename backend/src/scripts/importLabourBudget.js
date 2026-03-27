/**
 * Import Labour Budget from Excel workbook: "2026 HR budget sanas pro and sto.xlsx"
 *
 * Updates labour plans for: Balcarres, Lewvan, Ogema, Hyas, Ridgedale
 * - Replaces all seasons/roles with spreadsheet data
 * - Updates avg_wage to weighted average (total $ / total hours)
 * - Does NOT change fuel_rate_per_acre
 * - Does NOT push to forecast (user reviews first)
 */

import prisma from '../config/database.js';
import { bulkUpdateSeasons, updatePlan, getPlan } from '../services/labourService.js';

const FISCAL_YEAR = 2026;

// ─── Spreadsheet Data (extracted from Excel) ────────────────────────────

const FARM_DATA = {
  Balcarres: {
    avg_wage: 33.00, // 484110 / 14670
    seasons: [
      {
        name: 'Winter', sort_order: 1, months: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'],
        roles: [
          { name: 'Trucking', hours: 2000 },
          { name: 'Mechanic', hours: 1500 },
          { name: 'Yard', hours: 200 },
          { name: 'Bush Push', hours: 400 },
        ],
      },
      {
        name: 'Seeding', sort_order: 2, months: ['May'],
        roles: [
          { name: 'Seeding', hours: 850 },
          { name: 'Sprayer', hours: 160 },
          { name: 'Trucking', hours: 800 },
          { name: 'Field Work', hours: 300 },
          { name: 'Rock Picking', hours: 300 },
          { name: 'Extra', hours: 200 },
        ],
      },
      {
        name: 'Summer', sort_order: 3, months: ['Jun', 'Jul', 'Aug'],
        roles: [
          { name: 'Grain Truck', hours: 800 },
          { name: 'Sprayer', hours: 400 },
          { name: 'Spray Truck', hours: 400 },
          { name: 'Yard', hours: 800 },
          { name: 'Mechanic', hours: 1000 },
        ],
      },
      {
        name: 'Harvest', sort_order: 4, months: ['Sep', 'Oct'],
        roles: [
          { name: 'Combines', hours: 1550 },
          { name: 'Grain Cart', hours: 450 },
          { name: 'Trucking', hours: 800 },
          { name: 'Fall Work', hours: 500 },
          { name: 'Spraying', hours: 160 },
          { name: 'Spreading', hours: 300 },
          { name: 'Ditching', hours: 600 },
          { name: 'Extra', hours: 200 },
        ],
      },
    ],
  },

  Lewvan: {
    avg_wage: 32.00, // 782459 / 24452
    seasons: [
      {
        name: 'Winter', sort_order: 1, months: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'],
        roles: [
          { name: 'Grain Truckers', hours: 4947 },
          { name: 'Winter Yard Guys', hours: 2827 },
        ],
      },
      {
        name: 'Seeding', sort_order: 2, months: ['May'],
        roles: [
          { name: 'Seeders', hours: 1555 },
          { name: 'Truckers', hours: 1943 },
          { name: 'Sprayer', hours: 283 },
          { name: 'Roller/Spreader', hours: 177 },
        ],
      },
      {
        name: 'Summer', sort_order: 3, months: ['Jun', 'Jul', 'Aug'],
        roles: [
          { name: 'Sprayer', hours: 707 },
          { name: 'Spray Trucker', hours: 707 },
          { name: 'Grain Trucker', hours: 2473 },
          { name: 'Yard', hours: 1060 },
          { name: 'Mechanic', hours: 1767 },
        ],
      },
      {
        name: 'Harvest', sort_order: 4, months: ['Sep', 'Oct'],
        roles: [
          { name: 'Combines', hours: 2473 },
          { name: 'Trucks/Bagger', hours: 1908 },
          { name: 'Grain Carts', hours: 636 },
        ],
      },
      {
        name: 'Fall Work', sort_order: 5, months: ['Oct'],
        roles: [
          { name: 'Sprayer Desiccate', hours: 247 },
          { name: 'Sprayer Fall Burn', hours: 247 },
        ],
      },
    ],
  },

  Ogema: {
    avg_wage: 32.00, // 324741 / 10148
    seasons: [
      {
        name: 'Winter', sort_order: 1, months: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'],
        roles: [
          { name: 'Grain Truckers', hours: 2053 },
          { name: 'Winter Yard Guys', hours: 1173 },
        ],
      },
      {
        name: 'Seeding', sort_order: 2, months: ['May'],
        roles: [
          { name: 'Seeders', hours: 645 },
          { name: 'Truckers', hours: 807 },
          { name: 'Sprayer', hours: 117 },
          { name: 'Roller/Spreader', hours: 73 },
        ],
      },
      {
        name: 'Summer', sort_order: 3, months: ['Jun', 'Jul', 'Aug'],
        roles: [
          { name: 'Sprayer', hours: 293 },
          { name: 'Spray Trucker', hours: 293 },
          { name: 'Grain Trucker', hours: 1027 },
          { name: 'Yard', hours: 440 },
          { name: 'Mechanic', hours: 733 },
        ],
      },
      {
        name: 'Harvest', sort_order: 4, months: ['Sep', 'Oct'],
        roles: [
          { name: 'Combines', hours: 1027 },
          { name: 'Trucks/Bagger', hours: 792 },
          { name: 'Grain Carts', hours: 264 },
        ],
      },
      {
        name: 'Fall Work', sort_order: 5, months: ['Oct'],
        roles: [
          { name: 'Sprayer Desiccate', hours: 103 },
          { name: 'Sprayer Fall Burn', hours: 103 },
        ],
      },
    ],
  },

  Hyas: {
    avg_wage: 32.00, // 422400 / 13200
    seasons: [
      {
        name: 'Winter', sort_order: 1, months: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'],
        roles: [
          { name: 'Trucking', hours: 2350 },
          { name: 'Yard', hours: 300 },
          { name: 'Mechanic', hours: 1170 },
        ],
      },
      {
        name: 'Seeding', sort_order: 2, months: ['May'],
        roles: [
          { name: 'Seeding', hours: 800 },
          { name: 'Sprayer', hours: 140 },
          { name: 'Trucking', hours: 800 },
          { name: 'Field Work', hours: 400 },
          { name: 'Rock Picking', hours: 400 },
        ],
      },
      {
        name: 'Summer', sort_order: 3, months: ['Jun', 'Jul', 'Aug'],
        roles: [
          { name: 'Sprayer', hours: 300 },
          { name: 'Spray Truck', hours: 300 },
          { name: 'Grain Truck', hours: 950 },
          { name: 'Yard', hours: 600 },
          { name: 'Mechanic', hours: 800 },
        ],
      },
      {
        name: 'Harvest', sort_order: 4, months: ['Sep', 'Oct'],
        roles: [
          { name: 'Combines', hours: 1260 },
          { name: 'Grain Cart', hours: 450 },
          { name: 'Trucking', hours: 1000 },
          { name: 'Spraying', hours: 280 },
          { name: 'Spreading', hours: 400 },
          { name: 'Fall Work', hours: 500 },
        ],
      },
    ],
  },

  Ridgedale: {
    avg_wage: 31.56, // 230400 / 7300
    seasons: [
      {
        name: 'Winter', sort_order: 1, months: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'],
        roles: [
          { name: 'Haul Grain to Elevators', hours: 800 },
          { name: 'Equipment Maint+Services', hours: 500 },
          { name: 'Clearing Snow', hours: 160 },
          { name: 'Applying Anhydrous', hours: 280 },
        ],
      },
      {
        name: 'Seeding', sort_order: 2, months: ['May'],
        roles: [
          { name: 'Seeding', hours: 500 },
          { name: 'Haul Tender+Fuel Drill', hours: 500 },
          { name: 'Harrowing', hours: 200 },
        ],
      },
      {
        name: 'Summer', sort_order: 3, months: ['Jun', 'Jul', 'Aug'],
        roles: [
          { name: 'Spraying', hours: 500 },
          { name: 'Haul Sprayer Trailer', hours: 500 },
          { name: 'Fertilizer Floating', hours: 400 },
          { name: 'Field Work+Landrolling', hours: 300 },
          { name: 'General Yard Work', hours: 200 },
          { name: 'Wash Equipment', hours: 200 },
          { name: 'Extra', hours: 200 },
        ],
      },
      {
        name: 'Harvest', sort_order: 4, months: ['Sep', 'Oct'],
        roles: [
          { name: 'Combines (FT)', hours: 340 },
          { name: 'Combines (PT @$28)', hours: 800 },
          { name: 'Combine Maint+Fueling', hours: 80 },
          { name: 'Grain Cart', hours: 340 },
          { name: 'Haul Grain to Bins', hours: 340 },
          { name: 'Haul Grainbags out Fields', hours: 160 },
        ],
      },
    ],
  },
};

// ─── Main Import ─────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Labour Budget Import — FY2026');
  console.log('  Source: 2026 HR budget sanas pro and sto.xlsx');
  console.log('═══════════════════════════════════════════════════════════\n');

  for (const [farmName, data] of Object.entries(FARM_DATA)) {
    console.log(`\n── ${farmName} ──────────────────────────────────────`);

    // Find farm
    const farm = await prisma.farm.findFirst({ where: { name: farmName } });
    if (!farm) {
      console.log(`  ❌ Farm "${farmName}" not found — skipping`);
      continue;
    }

    // Get existing plan
    const plan = await getPlan(farm.id, FISCAL_YEAR);
    if (!plan) {
      console.log(`  ❌ No labour plan for FY${FISCAL_YEAR} — skipping`);
      continue;
    }

    // Show before state
    const beforeHours = plan.seasons.reduce(
      (sum, s) => sum + s.roles.reduce((rs, r) => rs + Number(r.hours), 0), 0
    );
    const beforeWage = Number(plan.avg_wage);
    console.log(`  Before: ${beforeHours} hrs × $${beforeWage}/hr = $${(beforeHours * beforeWage).toLocaleString()}`);

    // 1. Unlock plan
    await updatePlan(plan.id, { status: 'draft' });

    // 2. Update avg_wage (do NOT touch fuel_rate_per_acre)
    await updatePlan(plan.id, { avg_wage: data.avg_wage });

    // 3. Replace seasons/roles
    const seasonsPayload = data.seasons.map(s => ({
      name: s.name,
      sort_order: s.sort_order,
      months: s.months,
      roles: s.roles.map((r, i) => ({
        name: r.name,
        hours: r.hours,
        sort_order: i + 1,
      })),
    }));

    await bulkUpdateSeasons(plan.id, seasonsPayload);

    // 4. Re-lock plan
    await updatePlan(plan.id, { status: 'locked' });

    // Show after state
    const afterHours = data.seasons.reduce(
      (sum, s) => sum + s.roles.reduce((rs, r) => rs + r.hours, 0), 0
    );
    const afterCost = afterHours * data.avg_wage;
    console.log(`  After:  ${afterHours} hrs × $${data.avg_wage}/hr = $${afterCost.toLocaleString()}`);
    console.log(`  Δ Hours: ${afterHours - beforeHours} | Δ Wage: $${(data.avg_wage - beforeWage).toFixed(2)}`);

    // Detail per season
    for (const s of data.seasons) {
      const sHours = s.roles.reduce((sum, r) => sum + r.hours, 0);
      console.log(`    ${s.name} (${s.months.join(',')}): ${sHours}h — ${s.roles.map(r => `${r.name}:${r.hours}h`).join(', ')}`);
    }

    console.log(`  ✅ Done`);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Import complete. Review in UI → push to forecast when ready.');
  console.log('═══════════════════════════════════════════════════════════\n');

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Import failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
