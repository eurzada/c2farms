/**
 * Add new users to ALL production farms (Enterprise + BUs).
 * Safe to re-run — uses upsert throughout.
 *
 * Usage: cd backend && node src/scripts/addUsers.js
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const NEW_USERS = [
  { email: 'kevin@c2farms.ca', name: 'Kevin Carter', role: 'viewer' },
  { email: 'andre@c2farms.ca', name: 'Andre Pretorius', role: 'viewer' },
];

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10);

  // Get all real farms (Enterprise + BUs + terminal)
  const allFarms = await prisma.farm.findMany({ select: { id: true, name: true, is_enterprise: true } });
  console.log(`Found ${allFarms.length} farms: ${allFarms.map(f => f.name).join(', ')}`);

  // Also clean up the demo "C2 Farms Ltd" if it exists (created by seed script)
  const demoFarm = allFarms.find(f => f.name === 'C2 Farms Ltd' && !f.is_enterprise);
  if (demoFarm) {
    // Remove roles, then the farm itself
    const deleted = await prisma.userFarmRole.deleteMany({ where: { farm_id: demoFarm.id } });
    console.log(`Removed ${deleted.count} role(s) from demo farm "C2 Farms Ltd"`);
    // Check for any dependent records before deleting
    try {
      await prisma.farm.delete({ where: { id: demoFarm.id } });
      console.log('Deleted demo farm "C2 Farms Ltd"');
    } catch (e) {
      console.warn('Could not delete demo farm (has dependent records) — removed roles only:', e.message);
    }
  }

  // Real farms to assign users to
  const realFarms = allFarms.filter(f => f.id !== demoFarm?.id);

  for (const u of NEW_USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name },
      create: {
        email: u.email,
        password_hash: passwordHash,
        name: u.name,
        role: 'farm_manager',
      },
    });
    console.log(`\nUser: ${u.email} (id: ${user.id})`);

    for (const farm of realFarms) {
      await prisma.userFarmRole.upsert({
        where: { user_id_farm_id: { user_id: user.id, farm_id: farm.id } },
        update: { role: u.role, modules: ['forecast', 'inventory', 'marketing', 'logistics', 'agronomy', 'enterprise'] },
        create: {
          user_id: user.id,
          farm_id: farm.id,
          role: u.role,
          modules: ['forecast', 'inventory', 'marketing', 'logistics', 'agronomy', 'enterprise'],
        },
      });
      console.log(`  → ${farm.name}: ${u.role}`);
    }
  }

  console.log('\nDone!');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
