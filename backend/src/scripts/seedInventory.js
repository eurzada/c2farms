import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
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

// Map Excel commodity names to our codes
const COMMODITY_MAP = {
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

// Normalize bin type from Excel
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
  return bushels * lbsPerBu * 0.45359237; // bushels × lbs/bu × kg/lb = kg
}

async function main() {
  console.log('Seeding inventory data...');

  // Find or create the farm
  let farm = await prisma.farm.findFirst({ where: { name: 'Prairie Fields Farm' } });
  if (!farm) {
    // Use first existing farm, or create one
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

  // 3. Read Excel workbook
  const xlPath = path.join(__dirname, '../../../2026 SK Inventory.xlsx');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlPath);

  // Use Dec sheet as the master bin list (most complete)
  const decSheet = wb.getWorksheet('Dec 31, 25');
  if (!decSheet) {
    console.error('Dec 31, 25 sheet not found');
    process.exit(1);
  }

  // 3. Upsert Bins from Dec sheet
  console.log('\n3. Seeding bins...');
  const binMap = {}; // key: "Farm|BinNumber" → record
  let binCount = 0;
  for (let r = 2; r <= decSheet.rowCount; r++) {
    const row = decSheet.getRow(r);
    const farmName = row.getCell(1).value?.toString().trim();
    const binNum = row.getCell(2).value;
    const binType = row.getCell(3).value;
    const capacity = row.getCell(4).value;

    if (!farmName || !locationMap[farmName]) continue;
    const location = locationMap[farmName];

    // Skip rows with no bin number — use row index as fallback
    const binNumber = binNum != null ? binNum.toString().trim() : `R${r}`;
    if (!binNumber) continue;

    const commodityShort = (row.getCell(5).value || row.getCell(6).value)?.toString().trim();
    const commodityCode = commodityShort ? COMMODITY_MAP[commodityShort] : null;
    const commodityId = commodityCode ? commodityMap[commodityCode]?.id : null;

    const key = `${farmName}|${binNumber}`;
    if (!binMap[key]) {
      const record = await prisma.inventoryBin.upsert({
        where: {
          farm_id_location_id_bin_number: {
            farm_id: farmId,
            location_id: location.id,
            bin_number: binNumber,
          },
        },
        update: {
          bin_type: normalizeBinType(binType),
          capacity_bu: capacity ? parseFloat(capacity) : null,
          commodity_id: commodityId,
        },
        create: {
          farm_id: farmId,
          location_id: location.id,
          bin_number: binNumber,
          bin_type: normalizeBinType(binType),
          capacity_bu: capacity ? parseFloat(capacity) : null,
          commodity_id: commodityId,
        },
      });
      binMap[key] = record;
      binCount++;
    }
  }
  console.log(`  ${binCount} bins upserted`);

  // 4. Create Count Periods
  console.log('\n4. Seeding count periods...');
  const periods = [
    { date: new Date('2025-10-31'), status: 'closed' },
    { date: new Date('2025-11-30'), status: 'closed' },
    { date: new Date('2025-12-31'), status: 'open' },
  ];
  const periodMap = {};
  for (const p of periods) {
    const record = await prisma.countPeriod.upsert({
      where: { farm_id_period_date: { farm_id: farmId, period_date: p.date } },
      update: { status: p.status, crop_year: 2025 },
      create: { farm_id: farmId, period_date: p.date, crop_year: 2025, status: p.status },
    });
    periodMap[p.date.toISOString().slice(0, 10)] = record;
  }
  console.log(`  ${Object.keys(periodMap).length} count periods upserted`);

  // 5. Seed BinCounts from each snapshot sheet
  const sheetConfig = [
    { name: 'Oct 31, 25', periodKey: '2025-10-31' },
    { name: 'Nov 30, 25', periodKey: '2025-11-30' },
    { name: 'Dec 31, 25', periodKey: '2025-12-31' },
  ];

  console.log('\n5. Seeding bin counts...');
  let totalCounts = 0;
  for (const sc of sheetConfig) {
    const sheet = wb.getWorksheet(sc.name);
    if (!sheet) {
      console.warn(`  Sheet "${sc.name}" not found, skipping`);
      continue;
    }
    const period = periodMap[sc.periodKey];
    let sheetCounts = 0;

    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const farmName = row.getCell(1).value?.toString().trim();
      const binNum = row.getCell(2).value;
      const bushelsRaw = row.getCell(7).value;
      const cropYear = row.getCell(9).value;
      const notes = row.getCell(10).value?.toString().trim() || null;

      if (!farmName || !locationMap[farmName]) continue;

      const binNumber = binNum != null ? binNum.toString().trim() : `R${r}`;
      const key = `${farmName}|${binNumber}`;
      const bin = binMap[key];
      if (!bin) continue;

      const bushels = typeof bushelsRaw === 'number' ? bushelsRaw : 0;

      // Determine commodity for this count
      const commodityShort = (row.getCell(5).value || row.getCell(6).value)?.toString().trim();
      const commodityCode = commodityShort ? COMMODITY_MAP[commodityShort] : null;
      const commodity = commodityCode ? commodityMap[commodityCode] : null;

      // Compute kg from bushels
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
          crop_year: cropYear ? parseInt(cropYear) : null,
          notes,
        },
        create: {
          farm_id: farmId,
          count_period_id: period.id,
          bin_id: bin.id,
          commodity_id: commodity?.id || null,
          bushels,
          kg,
          crop_year: cropYear ? parseInt(cropYear) : null,
          notes,
        },
      });
      sheetCounts++;
    }
    totalCounts += sheetCounts;
    console.log(`  ${sc.name}: ${sheetCounts} bin counts`);
  }
  console.log(`  Total: ${totalCounts} bin counts`);

  // 6. Create auto-approved CountSubmissions for seed data
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

  // 7. Seed Contracts + Deliveries from YTD Contracts sheet
  console.log('\n7. Seeding contracts...');
  // Clear existing contracts for idempotency
  await prisma.delivery.deleteMany({ where: { farm_id: farmId } });
  await prisma.contract.deleteMany({ where: { farm_id: farmId } });
  const contractSheet = wb.getWorksheet('YTD Contracts');
  if (!contractSheet) {
    console.warn('  YTD Contracts sheet not found, skipping');
  } else {
    // Parse contracts — skip total rows
    let contractCount = 0;
    for (let r = 2; r <= contractSheet.rowCount; r++) {
      const row = contractSheet.getRow(r);
      const name = row.getCell(1).value?.toString().trim();
      const cropRaw = row.getCell(2).value?.toString().trim();
      const contractedRaw = row.getCell(3).value;
      const tractionRaw = row.getCell(4).value;
      const hauledRaw = row.getCell(5).value;

      // Skip total/empty rows
      if (!name || !cropRaw || name.includes('Total')) continue;

      const commodityCode = CONTRACT_COMMODITY_MAP[cropRaw];
      if (!commodityCode || !commodityMap[commodityCode]) {
        console.warn(`  Skipping contract "${name}" — unknown crop "${cropRaw}"`);
        continue;
      }

      // Extract contracted amount (kg) — use traction or contracted column
      const contracted = typeof contractedRaw === 'number' ? contractedRaw :
        (contractedRaw?.result ? contractedRaw.result : 0);
      const hauled = typeof hauledRaw === 'number' ? hauledRaw :
        (hauledRaw?.result ? hauledRaw.result : 0);

      // Values are in kg, convert to MT
      const contractedMt = contracted / 1000;
      const hauledMt = hauled / 1000;

      const status = hauledMt >= contractedMt && contractedMt > 0 ? 'fulfilled' : 'open';

      const contract = await prisma.contract.create({
        data: {
          farm_id: farmId,
          contract_number: `C${String(contractCount + 1).padStart(3, '0')}`,
          buyer: name,
          commodity_id: commodityMap[commodityCode].id,
          contracted_mt: contractedMt,
          status,
        },
      });

      // Create delivery if hauled > 0
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
  }

  // Summary stats
  console.log('\n--- Summary ---');
  const totalBushels = await prisma.binCount.aggregate({
    where: { farm_id: farmId, count_period_id: periodMap['2025-12-31'].id },
    _sum: { kg: true },
  });
  const totalMt = (totalBushels._sum.kg || 0) / 1000;
  console.log(`Total inventory (Dec 31): ${totalMt.toFixed(0)} MT`);

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
