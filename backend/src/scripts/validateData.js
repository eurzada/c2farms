/**
 * Data validation snapshot — run locally and on Render, compare output.
 * Usage: cd backend && node src/scripts/validateData.js
 */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function validate() {
  console.log('=== DATA VALIDATION SNAPSHOT ===');
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  // 1. Farms
  const farms = await p.farm.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, is_enterprise: true, farm_type: true } });
  console.log('── Farms ──');
  for (const f of farms) console.log(`  ${f.name} | enterprise=${f.is_enterprise} | type=${f.farm_type || 'farm'}`);
  console.log(`  Total: ${farms.length}\n`);

  // 2. Users & Roles
  const users = await p.user.findMany({ orderBy: { email: 'asc' }, select: { email: true, name: true, _count: { select: { farm_roles: true } } } });
  console.log('── Users ──');
  for (const u of users) console.log(`  ${u.email} (${u.name}) — ${u._count.farm_roles} farm role(s)`);
  console.log(`  Total: ${users.length}\n`);

  // 3. Assumptions per farm
  const farmMap = Object.fromEntries(farms.map(f => [f.id, f.name]));
  const assumptions = await p.assumption.findMany({ orderBy: [{ fiscal_year: 'asc' }] });
  console.log('── Assumptions ──');
  for (const a of assumptions) {
    const crops = a.crops_json?.length || 0;
    console.log(`  ${farmMap[a.farm_id] || a.farm_id} FY${a.fiscal_year} | ${a.total_acres} acres | ${crops} crops`);
  }
  console.log(`  Total: ${assumptions.length}\n`);

  // 4. Labour Plans
  const plans = await p.labourPlan.findMany({
    orderBy: [{ fiscal_year: 'asc' }],
    include: {
      farm: { select: { name: true } },
      seasons: { include: { roles: true } },
    },
  });
  console.log('── Labour Plans ──');
  for (const pl of plans) {
    const totalHrs = pl.seasons.reduce((s, sn) => s + sn.roles.reduce((s2, r) => s2 + Number(r.hours), 0), 0);
    console.log(`  ${pl.farm.name} FY${pl.fiscal_year} | wage=$${pl.avg_wage} | fuel_rate/ac=$${pl.fuel_rate_per_acre} | fuel_cost/L=$${pl.fuel_cost_per_litre} | ${totalHrs} hrs | status=${pl.status}`);
  }
  console.log(`  Total: ${plans.length}\n`);

  // 5. Monthly Data summary per farm
  const buFarms = farms.filter(f => !f.is_enterprise);
  console.log('── MonthlyData (row counts per farm) ──');
  for (const f of buFarms) {
    const count = await p.monthlyData.count({ where: { farm_id: f.id } });
    const actuals = await p.monthlyData.count({ where: { farm_id: f.id, is_actual: true } });
    console.log(`  ${f.name}: ${count} rows (${actuals} actuals)`);
  }

  // 6. Farm Categories per farm
  console.log('\n── FarmCategories (counts per farm) ──');
  for (const f of buFarms) {
    const count = await p.farmCategory.count({ where: { farm_id: f.id } });
    console.log(`  ${f.name}: ${count} categories`);
  }

  // 7. GL Accounts
  const glCount = await p.glAccount.count();
  const glMapped = await p.glAccount.count({ where: { category_id: { not: null } } });
  console.log(`\n── GL Accounts ──`);
  console.log(`  Total: ${glCount} | Mapped: ${glMapped}\n`);

  // 8. Inventory
  const bins = await p.inventoryBin.count();
  const commodities = await p.commodity.count();
  const locations = await p.inventoryLocation.count();
  console.log('── Inventory ──');
  console.log(`  Bins: ${bins} | Commodities: ${commodities} | Locations: ${locations}\n`);

  // 9. Marketing Contracts
  const mktContracts = await p.marketingContract.count();
  const counterparties = await p.counterparty.count();
  const prices = await p.marketPrice.count();
  console.log('── Marketing ──');
  console.log(`  Contracts: ${mktContracts} | Counterparties: ${counterparties} | Prices: ${prices}\n`);

  // 10. Delivery Tickets & Settlements
  const tickets = await p.deliveryTicket.count();
  const settlements = await p.settlement.count();
  console.log('── Logistics ──');
  console.log(`  Tickets: ${tickets} | Settlements: ${settlements}\n`);

  // 11. Agronomy
  try {
    const cropPlans = await p.cropPlan.count();
    const inputPlans = await p.cropInputPlan.count();
    console.log('── Agronomy ──');
    console.log(`  CropPlans: ${cropPlans} | InputPlans: ${inputPlans}\n`);
  } catch {
    console.log('── Agronomy ── (models not found, skipping)\n');
  }

  console.log('=== END SNAPSHOT ===');
}

validate()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => p.$disconnect());
