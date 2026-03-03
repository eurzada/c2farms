import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // C2 Farms Ltd = enterprise level → inventory + marketing only
  const mainFarm = await prisma.farm.findFirst({ where: { name: 'C2 Farms Ltd' } });
  if (!mainFarm) {
    console.log('No C2 Farms Ltd found');
    return;
  }

  const updated1 = await prisma.userFarmRole.updateMany({
    where: { farm_id: mainFarm.id },
    data: { modules: ['inventory', 'marketing'] },
  });
  console.log(`C2 Farms Ltd roles updated: ${updated1.count}`);

  // All other farms = location level → forecast only
  const updated2 = await prisma.userFarmRole.updateMany({
    where: { NOT: { farm_id: mainFarm.id } },
    data: { modules: ['forecast'] },
  });
  console.log(`Location farm roles updated: ${updated2.count}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
