/**
 * Seed labour plans for all farms.
 * Extrapolates hours proportionally by acreage from Lewvan-Ogema and Balcarres examples.
 * Run: cd backend && node src/scripts/seedLabour.js
 */
import prisma from '../config/database.js';

const FISCAL_YEAR = 2026;

// ─── Farm acreages (match agronomy seed) ────────────────────────────
const FARM_ACRES = {
  Lewvan: 24384,
  Hyas: 12450,
  Balcarres: 15135,
  Stockholm: 19995,
  Provost: 2800,
  Ridgedale: 8924,
  Ogema: 10120,
};

// ─── Base templates (hours per 1,000 acres) ─────────────────────────

// Template A: "Large dryland" — based on Lewvan-Ogema (35,000 ac combined)
// Used for: Lewvan, Ogema, Stockholm
const TEMPLATE_LARGE = {
  seasons: [
    {
      name: 'Seeding', sort_order: 0, months: ['May'],
      roles: [
        { name: 'Seeders', hpk: 62.9 },
        { name: 'Truckers', hpk: 78.6 },
        { name: 'Sprayer', hpk: 11.4 },
        { name: 'Roller/Spreader', hpk: 7.1 },
      ],
    },
    {
      name: 'Summer', sort_order: 1, months: ['Jun', 'Jul', 'Aug'],
      roles: [
        { name: 'Sprayer', hpk: 28.6 },
        { name: 'Spray Trucker', hpk: 28.6 },
        { name: 'Grain Trucker', hpk: 100.0 },
        { name: 'Yard', hpk: 42.9 },
        { name: 'Mechanic', hpk: 71.4 },
      ],
    },
    {
      name: 'Harvest', sort_order: 2, months: ['Sep', 'Oct'],
      roles: [
        { name: 'Combines', hpk: 100.0 },
        { name: 'Trucks/Bagger', hpk: 77.1 },
        { name: 'Grain Carts', hpk: 25.7 },
      ],
    },
    {
      name: 'Fall Work', sort_order: 3, months: ['Oct'],
      roles: [
        { name: 'Sprayer Desiccate', hpk: 10.0 },
        { name: 'Sprayer Fall Burn', hpk: 10.0 },
      ],
    },
    {
      name: 'Winter', sort_order: 4, months: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'],
      roles: [
        { name: 'Grain Truckers', hpk: 200.0 },
        { name: 'Winter Yard', hpk: 114.3 },
      ],
    },
  ],
};

// Template B: "Mixed operation" — based on Balcarres (12,500 ac)
// Rock picking, ditching, bush push, more field prep
// Used for: Balcarres, Hyas, Ridgedale
const TEMPLATE_MIXED = {
  seasons: [
    {
      name: 'Seeding', sort_order: 0, months: ['May'],
      roles: [
        { name: 'Seeding', hpk: 68.0 },
        { name: 'Sprayer', hpk: 12.8 },
        { name: 'Trucking', hpk: 64.0 },
        { name: 'Field Work', hpk: 24.0 },
        { name: 'Rock Picking', hpk: 24.0 },
        { name: 'Extra', hpk: 16.0 },
      ],
    },
    {
      name: 'Summer', sort_order: 1, months: ['Jun', 'Jul', 'Aug'],
      roles: [
        { name: 'Grain Truck', hpk: 64.0 },
        { name: 'Sprayer', hpk: 32.0 },
        { name: 'Sprayer Truck', hpk: 32.0 },
        { name: 'Yard', hpk: 64.0 },
        { name: 'Mechanic', hpk: 80.0 },
      ],
    },
    {
      name: 'Harvest', sort_order: 2, months: ['Sep', 'Oct'],
      roles: [
        { name: 'Combines', hpk: 124.0 },
        { name: 'Grain Cart', hpk: 36.0 },
        { name: 'Trucking', hpk: 64.0 },
        { name: 'Fall Work', hpk: 40.0 },
        { name: 'Spraying', hpk: 12.8 },
        { name: 'Spreading', hpk: 24.0 },
        { name: 'Ditching', hpk: 48.0 },
        { name: 'Extra', hpk: 16.0 },
      ],
    },
    {
      name: 'Winter', sort_order: 3, months: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'],
      roles: [
        { name: 'Trucking', hpk: 160.0 },
        { name: 'Mechanic', hpk: 120.0 },
        { name: 'Yard', hpk: 16.0 },
        { name: 'Bush Push', hpk: 32.0 },
      ],
    },
  ],
};

// Template C: "Small dryland" — Provost only
// Compact crew, fewer distinct roles, no bush/ditching
const TEMPLATE_SMALL = {
  seasons: [
    {
      name: 'Seeding', sort_order: 0, months: ['May'],
      roles: [
        { name: 'Seeders', hpk: 70.0 },
        { name: 'Truckers', hpk: 60.0 },
        { name: 'Sprayer', hpk: 15.0 },
      ],
    },
    {
      name: 'Summer', sort_order: 1, months: ['Jun', 'Jul', 'Aug'],
      roles: [
        { name: 'Sprayer', hpk: 35.0 },
        { name: 'Grain Trucker', hpk: 70.0 },
        { name: 'Yard/Mechanic', hpk: 90.0 },
      ],
    },
    {
      name: 'Harvest', sort_order: 2, months: ['Sep', 'Oct'],
      roles: [
        { name: 'Combines', hpk: 110.0 },
        { name: 'Trucking', hpk: 80.0 },
        { name: 'Grain Carts', hpk: 30.0 },
      ],
    },
    {
      name: 'Winter', sort_order: 3, months: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'],
      roles: [
        { name: 'Grain Truckers', hpk: 140.0 },
        { name: 'Winter Yard', hpk: 80.0 },
      ],
    },
  ],
};

// ─── Farm config ────────────────────────────────────────────────────
const FARM_CONFIG = {
  Lewvan:    { template: TEMPLATE_LARGE, wage: 32 },
  Ogema:     { template: TEMPLATE_LARGE, wage: 31 },
  Stockholm: { template: TEMPLATE_LARGE, wage: 32 },
  Balcarres: { template: TEMPLATE_MIXED, wage: 33 },
  Hyas:      { template: TEMPLATE_MIXED, wage: 32 },
  Ridgedale: { template: TEMPLATE_MIXED, wage: 31 },
  Provost:   { template: TEMPLATE_SMALL, wage: 30 },
};

async function seed() {
  const farms = await prisma.farm.findMany();
  if (!farms.length) {
    console.error('No farms found. Run the main seed first.');
    process.exit(1);
  }

  const farmMap = Object.fromEntries(farms.map(f => [f.name, f.id]));
  console.log(`Found ${farms.length} farms: ${farms.map(f => f.name).join(', ')}\n`);

  // Clean existing labour data
  console.log('Cleaning existing labour data...');
  await prisma.labourRole.deleteMany({});
  await prisma.labourSeason.deleteMany({});
  await prisma.labourPlan.deleteMany({});

  let totalPlans = 0;

  for (const [farmName, acres] of Object.entries(FARM_ACRES)) {
    const farmId = farmMap[farmName];
    if (!farmId) {
      console.warn(`  SKIP: Farm "${farmName}" not found`);
      continue;
    }

    const cfg = FARM_CONFIG[farmName];
    const kac = acres / 1000;

    const plan = await prisma.labourPlan.create({
      data: {
        farm_id: farmId,
        fiscal_year: FISCAL_YEAR,
        status: 'approved',
        avg_wage: cfg.wage,
        total_acres: acres,
        seasons: {
          create: cfg.template.seasons.map(s => ({
            name: s.name,
            sort_order: s.sort_order,
            months: s.months,
            roles: {
              create: s.roles.map((r, i) => ({
                name: r.name,
                hours: Math.round(r.hpk * kac),
                sort_order: i,
              })),
            },
          })),
        },
      },
      include: { seasons: { include: { roles: true }, orderBy: { sort_order: 'asc' } } },
    });

    totalPlans++;
    console.log(`${farmName} (${acres.toLocaleString()} ac, $${cfg.wage}/hr)`);

    let grandTotal = 0;
    for (const season of plan.seasons) {
      const seasonHrs = season.roles.reduce((s, r) => s + Number(r.hours), 0);
      grandTotal += seasonHrs;
      console.log(`  ${season.name} (${season.months.join(',')}): ${seasonHrs.toLocaleString()} hrs`);
    }
    const totalCost = grandTotal * cfg.wage;
    console.log(`  TOTAL: ${grandTotal.toLocaleString()} hrs = $${totalCost.toLocaleString()}\n`);
  }

  console.log('========================================');
  console.log(`Labour seed complete! ${totalPlans} plans created.`);
  console.log('========================================');
}

seed()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
