import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Commodity definitions with lbs_per_bu
const COMMODITIES = [
  { name: 'Spring Wheat', code: 'CWRS', lbs_per_bu: 60 },
  { name: 'Durum', code: 'CWAD', lbs_per_bu: 60 },
  { name: 'Chickpeas', code: 'CHKP', lbs_per_bu: 60 },
  { name: 'Lentils SG', code: 'LNSG', lbs_per_bu: 60 },
  { name: 'Lentils SR', code: 'LNSR', lbs_per_bu: 60 },
  { name: 'Yellow Peas', code: 'YPEA', lbs_per_bu: 60 },
  { name: 'Fertilizer', code: 'FERT', lbs_per_bu: 60 },
  { name: 'Canola', code: 'CNLA', lbs_per_bu: 50 },
  { name: 'Canola - L358', code: 'L358', lbs_per_bu: 50 },
  { name: 'Canola - Nexera', code: 'NXRA', lbs_per_bu: 50 },
  { name: 'Canary Seed', code: 'CNRY', lbs_per_bu: 56 },
  { name: 'Barley', code: 'BRLY', lbs_per_bu: 48 },
];

// Location definitions
const LOCATIONS = [
  { name: 'Lewvan', code: 'LEW', cluster: 'central' },
  { name: 'Hyas', code: 'HYA', cluster: 'individual' },
  { name: 'Waldron', code: 'WAL', cluster: 'central' },
  { name: 'Balcarres', code: 'BAL', cluster: 'individual' },
  { name: 'Ridgedale', code: 'RDG', cluster: 'individual' },
  { name: 'Ogema', code: 'OGM', cluster: 'individual' },
  { name: 'Stockholm', code: 'STK', cluster: 'individual' },
  { name: 'LGX', code: 'LGX', cluster: 'transit' },
];

// Map commodity names to codes (for JSON data)
const COMMODITY_NAME_MAP = {
  'Spring Wheat': 'CWRS',
  'Durum': 'CWAD',
  'Chickpeas': 'CHKP',
  'Lentils SG': 'LNSG',
  'Lentils SR': 'LNSR',
  'Yellow Peas': 'YPEA',
  'Fertilizer': 'FERT',
  'Canola': 'CNLA',
  'Canola - L358': 'L358',
  'Canola - Nexera': 'NXRA',
  'Canary': 'CNRY',
  'Canary Seed': 'CNRY',
  'Barley': 'BRLY',
};

// Map contract crop names to commodity codes
const CONTRACT_COMMODITY_MAP = {
  'CWRS': 'CWRS',
  'CWAD': 'CWAD',
  'Canola ': 'CNLA',
  'Canola': 'CNLA',
  'L358': 'L358',
  'Nexera': 'NXRA',
  'SG Lentils': 'LNSG',
  'Chickpeas': 'CHKP',
  'Barley': 'BRLY',
};

// Normalize bin type
function normalizeBinType(raw) {
  if (!raw) return 'hopper';
  const t = raw.toString().trim().toLowerCase();
  if (t.includes('flat')) return 'flat';
  if (t.includes('bag')) return 'bag';
  if (t.includes('hopper') || t.includes('jhopper')) return 'hopper';
  if (t.includes('fert')) return 'hopper';
  if (t.includes('dryer')) return 'dryer';
  return 'other';
}

function convertBuToKg(bushels, lbsPerBu) {
  return bushels * lbsPerBu * 0.45359237;
}

function loadJsonData() {
  const jsonPath = path.join(__dirname, 'inventory-seed-data.json');
  if (!fs.existsSync(jsonPath)) return null;
  console.log('Loading from inventory-seed-data.json...');
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
}

async function main() {
  console.log('Seeding inventory data...');

  const jsonData = loadJsonData();
  if (!jsonData) {
    console.error('inventory-seed-data.json not found. Run the export script first.');
    process.exit(1);
  }

  // Find or create the farm
  let farm = await prisma.farm.findFirst({ where: { name: 'Prairie Fields Farm' } });
  if (!farm) {
    farm = await prisma.farm.findFirst();
    if (!farm) {
      farm = await prisma.farm.create({ data: { name: 'Prairie Fields Farm' } });
    }
    console.log(`Using existing farm: ${farm.name}`);
  }
  const farmId = farm.id;
  console.log(`Farm: ${farm.name} (${farmId})`);

  // 1. Upsert Commodities
  console.log('\n1. Seeding commodities...');
  const commodityMap = {};
  for (const c of COMMODITIES) {
    const record = await prisma.commodity.upsert({
      where: { farm_id_code: { farm_id: farmId, code: c.code } },
      update: { name: c.name, lbs_per_bu: c.lbs_per_bu },
      create: { farm_id: farmId, name: c.name, code: c.code, lbs_per_bu: c.lbs_per_bu },
    });
    commodityMap[c.code] = record;
  }
  console.log(`  ${Object.keys(commodityMap).length} commodities upserted`);

  // 2. Upsert Locations
  console.log('\n2. Seeding locations...');
  const locationMap = {};
  for (const loc of LOCATIONS) {
    const record = await prisma.inventoryLocation.upsert({
      where: { farm_id_code: { farm_id: farmId, code: loc.code } },
      update: { name: loc.name, cluster: loc.cluster },
      create: { farm_id: farmId, name: loc.name, code: loc.code, cluster: loc.cluster },
    });
    locationMap[loc.name] = record;
  }
  console.log(`  ${Object.keys(locationMap).length} locations upserted`);

  // 3. Determine unique bins and periods from JSON data
  console.log('\n3. Seeding bins...');
  const binMap = {};
  let binCount = 0;

  // Collect unique bins from all period data
  const seenBins = new Set();
  for (const row of jsonData.bins) {
    const key = `${row.f}|${row.n}`;
    if (seenBins.has(key)) continue;
    seenBins.add(key);

    const location = locationMap[row.f];
    if (!location) continue;

    const commodityCode = row.c ? COMMODITY_NAME_MAP[row.c] : null;
    const commodityId = commodityCode ? commodityMap[commodityCode]?.id : null;

    const record = await prisma.inventoryBin.upsert({
      where: {
        farm_id_location_id_bin_number: {
          farm_id: farmId,
          location_id: location.id,
          bin_number: row.n,
        },
      },
      update: {
        bin_type: normalizeBinType(row.t),
        capacity_bu: row.cap ? parseFloat(row.cap) : null,
        commodity_id: commodityId,
      },
      create: {
        farm_id: farmId,
        location_id: location.id,
        bin_number: row.n,
        bin_type: normalizeBinType(row.t),
        capacity_bu: row.cap ? parseFloat(row.cap) : null,
        commodity_id: commodityId,
      },
    });
    binMap[key] = record;
    binCount++;
  }
  console.log(`  ${binCount} bins upserted`);

  // 4. Create Count Periods
  console.log('\n4. Seeding count periods...');
  const periodDates = [...new Set(jsonData.bins.map(r => r.p))].sort();
  const periodMap = {};
  for (const dateStr of periodDates) {
    const isLast = dateStr === periodDates[periodDates.length - 1];
    const record = await prisma.countPeriod.upsert({
      where: { farm_id_period_date: { farm_id: farmId, period_date: new Date(dateStr) } },
      update: { status: isLast ? 'open' : 'closed', crop_year: 2025 },
      create: { farm_id: farmId, period_date: new Date(dateStr), crop_year: 2025, status: isLast ? 'open' : 'closed' },
    });
    periodMap[dateStr] = record;
  }
  console.log(`  ${Object.keys(periodMap).length} count periods upserted`);

  // 5. Seed BinCounts
  console.log('\n5. Seeding bin counts...');
  let totalCounts = 0;
  const countsByPeriod = {};

  for (const row of jsonData.bins) {
    const key = `${row.f}|${row.n}`;
    const bin = binMap[key];
    const period = periodMap[row.p];
    if (!bin || !period) continue;

    const bushels = typeof row.bu === 'number' ? row.bu : 0;
    const commodityCode = row.c ? COMMODITY_NAME_MAP[row.c] : null;
    const commodity = commodityCode ? commodityMap[commodityCode] : null;
    const lbsPerBu = commodity?.lbs_per_bu || 60;
    const kg = convertBuToKg(bushels, lbsPerBu);

    await prisma.binCount.upsert({
      where: {
        farm_id_count_period_id_bin_id: {
          farm_id: farmId,
          count_period_id: period.id,
          bin_id: bin.id,
        },
      },
      update: {
        commodity_id: commodity?.id || null,
        bushels,
        kg,
        crop_year: row.cy ? parseInt(row.cy) : null,
        notes: row.no || null,
      },
      create: {
        farm_id: farmId,
        count_period_id: period.id,
        bin_id: bin.id,
        commodity_id: commodity?.id || null,
        bushels,
        kg,
        crop_year: row.cy ? parseInt(row.cy) : null,
        notes: row.no || null,
      },
    });
    totalCounts++;
    countsByPeriod[row.p] = (countsByPeriod[row.p] || 0) + 1;
  }
  for (const [p, c] of Object.entries(countsByPeriod)) {
    console.log(`  ${p}: ${c} bin counts`);
  }
  console.log(`  Total: ${totalCounts} bin counts`);

  // 6. Create auto-approved CountSubmissions
  console.log('\n6. Seeding count submissions...');
  let subCount = 0;
  for (const p of Object.values(periodMap)) {
    for (const loc of Object.values(locationMap)) {
      await prisma.countSubmission.upsert({
        where: {
          farm_id_count_period_id_location_id: {
            farm_id: farmId,
            count_period_id: p.id,
            location_id: loc.id,
          },
        },
        update: { status: 'approved' },
        create: {
          farm_id: farmId,
          count_period_id: p.id,
          location_id: loc.id,
          status: 'approved',
          notes: 'Seed data import',
        },
      });
      subCount++;
    }
  }
  console.log(`  ${subCount} submissions upserted`);

  // 7. Seed Contracts + Deliveries
  console.log('\n7. Seeding contracts...');
  await prisma.delivery.deleteMany({ where: { farm_id: farmId } });
  await prisma.contract.deleteMany({ where: { farm_id: farmId } });

  let contractCount = 0;
  for (const c of jsonData.contracts) {
    const commodityCode = CONTRACT_COMMODITY_MAP[c.crop];
    if (!commodityCode || !commodityMap[commodityCode]) {
      console.warn(`  Skipping contract "${c.name}" — unknown crop "${c.crop}"`);
      continue;
    }

    // Values in JSON are in kg, convert to MT
    const contractedMt = (c.contracted || 0) / 1000;
    const hauledMt = (c.hauled || 0) / 1000;
    const status = hauledMt >= contractedMt && contractedMt > 0 ? 'fulfilled' : 'open';

    const contract = await prisma.contract.create({
      data: {
        farm_id: farmId,
        contract_number: `C${String(contractCount + 1).padStart(3, '0')}`,
        buyer: c.name,
        commodity_id: commodityMap[commodityCode].id,
        contracted_mt: contractedMt,
        status,
      },
    });

    if (hauledMt > 0) {
      await prisma.delivery.create({
        data: {
          farm_id: farmId,
          contract_id: contract.id,
          mt_delivered: hauledMt,
          delivery_date: new Date('2025-12-31'),
        },
      });
    }
    contractCount++;
  }
  console.log(`  ${contractCount} contracts seeded`);

  // Summary stats
  console.log('\n--- Summary ---');
  const latestPeriod = periodMap[periodDates[periodDates.length - 1]];
  const totalKg = await prisma.binCount.aggregate({
    where: { farm_id: farmId, count_period_id: latestPeriod.id },
    _sum: { kg: true },
  });
  const totalMt = (totalKg._sum.kg || 0) / 1000;
  console.log(`Total inventory (latest period): ${totalMt.toFixed(0)} MT`);

  const totalContracted = await prisma.contract.aggregate({
    where: { farm_id: farmId },
    _sum: { contracted_mt: true },
  });
  console.log(`Total contracted: ${(totalContracted._sum.contracted_mt || 0).toFixed(0)} MT`);
  console.log(`Available: ${(totalMt - (totalContracted._sum.contracted_mt || 0)).toFixed(0)} MT`);

  console.log('\nDone!');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
