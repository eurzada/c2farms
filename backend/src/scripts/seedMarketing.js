import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding marketing module data...\n');

  // Find the farm
  let farm = await prisma.farm.findFirst({ where: { name: 'C2 Farms Ltd' } });
  if (!farm) {
    farm = await prisma.farm.findFirst();
    if (!farm) throw new Error('No farm found. Run main seed first.');
  }
  const farmId = farm.id;
  console.log(`Farm: ${farm.name} (${farmId})`);

  // 0. Update existing UserFarmRole records to include "marketing" module
  console.log('\n0. Updating user modules to include marketing...');
  const roles = await prisma.userFarmRole.findMany({ where: { farm_id: farmId } });
  for (const role of roles) {
    const modules = Array.isArray(role.modules) ? role.modules : JSON.parse(role.modules || '[]');
    if (!modules.includes('marketing')) {
      modules.push('marketing');
      await prisma.userFarmRole.update({
        where: { id: role.id },
        data: { modules },
      });
    }
  }
  console.log(`  Updated ${roles.length} user role(s)`);

  // 1. Marketing Settings
  console.log('\n1. Seeding marketing settings...');
  await prisma.marketingSettings.upsert({
    where: { farm_id: farmId },
    update: {
      loc_interest_rate: 0.0725,
      storage_cost_per_mt_month: 3.5,
      contract_prefix: 'MKT',
      next_contract_seq: 16,
      loc_available: 8000000,
    },
    create: {
      farm_id: farmId,
      loc_interest_rate: 0.0725,
      storage_cost_per_mt_month: 3.5,
      default_currency: 'CAD',
      contract_prefix: 'MKT',
      next_contract_seq: 16,
      loc_available: 8000000,
      fiscal_year_start_month: 11,
    },
  });
  console.log('  Settings upserted');

  // 2. Counterparties
  console.log('\n2. Seeding counterparties...');
  const COUNTERPARTIES = [
    { name: 'Cargill', short_code: 'CGI', type: 'buyer', contact_name: 'Mike Chen', contact_email: 'mchen@cargill.com', default_elevator_site: 'Regina' },
    { name: 'Richardson', short_code: 'RPI', type: 'buyer', contact_name: 'Sarah J.', contact_email: 'sjohnson@rpi.ca', default_elevator_site: 'Yorkton' },
    { name: 'Bunge', short_code: 'BNG', type: 'buyer', contact_name: 'Tom W.', contact_email: 'twatson@bunge.com', default_elevator_site: 'Altona' },
    { name: 'LGX Exports', short_code: 'LGX', type: 'terminal', contact_name: 'Dave L.', contact_email: 'dlane@lgx.ca', default_elevator_site: 'LGX Terminal' },
    { name: 'G3 Global Grain', short_code: 'G3G', type: 'elevator', contact_name: 'Pat R.', contact_email: 'preed@g3.ca', default_elevator_site: 'Pasqua' },
    { name: 'Louis Dreyfus', short_code: 'LDC', type: 'buyer', contact_name: 'Anna K.', contact_email: 'akumar@ldc.com', default_elevator_site: 'Yorkton' },
    { name: 'Ceres GSL JGL', short_code: 'CER', type: 'broker', contact_name: 'Jim G.', contact_email: 'jg@ceresgsl.ca', default_elevator_site: null },
    { name: 'MB Agri', short_code: 'MBA', type: 'buyer', contact_name: 'Ray M.', contact_email: 'ray@mbagri.ca', default_elevator_site: 'Winnipeg' },
  ];

  const counterpartyMap = {};
  for (const cp of COUNTERPARTIES) {
    const record = await prisma.counterparty.upsert({
      where: { farm_id_name: { farm_id: farmId, name: cp.name } },
      update: { short_code: cp.short_code, type: cp.type, contact_name: cp.contact_name, contact_email: cp.contact_email, default_elevator_site: cp.default_elevator_site },
      create: { farm_id: farmId, ...cp },
    });
    counterpartyMap[cp.short_code] = record;
  }
  console.log(`  ${Object.keys(counterpartyMap).length} counterparties upserted`);

  // 3. Get commodity map
  const commodities = await prisma.commodity.findMany({ where: { farm_id: farmId } });
  const commodityMap = {};
  for (const c of commodities) {
    commodityMap[c.code] = c;
  }

  // Helper: compute price_per_mt from price_per_bu
  function buToMtFactor(lbsPerBu) {
    return 1000 / (lbsPerBu * 0.45359237);
  }

  // 4. Market Prices (latest, one per non-FERT commodity)
  console.log('\n3. Seeding market prices...');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const PRICES = [
    { code: 'CNLA', bid: 14.10, basis: -1.20, futures_ref: 'ICE RS May26', futures: 15.30, outlook: 'sideways', cop: 12.50, target: 15.00 },
    { code: 'CWAD', bid: 9.50, basis: -0.50, futures_ref: 'MGE May26', futures: 10.00, outlook: 'bullish', cop: 8.25, target: 10.50 },
    { code: 'CWRS', bid: 9.75, basis: -0.60, futures_ref: 'MGE May26', futures: 10.35, outlook: 'sideways', cop: 8.00, target: 10.50 },
    { code: 'CHKP', bid: 0.42, basis: null, futures_ref: null, futures: null, outlook: 'bullish', cop: 0.35, target: 0.50 },
    { code: 'LNSG', bid: 0.38, basis: null, futures_ref: null, futures: null, outlook: 'sideways', cop: 0.32, target: 0.42 },
    { code: 'LNSR', bid: 0.42, basis: null, futures_ref: null, futures: null, outlook: 'bearish', cop: 0.34, target: 0.48 },
    { code: 'YPEA', bid: 9.25, basis: null, futures_ref: null, futures: null, outlook: 'sideways', cop: 7.50, target: 10.00 },
    { code: 'L358', bid: 14.50, basis: -1.10, futures_ref: 'ICE RS May26', futures: 15.60, outlook: 'bullish', cop: 12.50, target: 15.50 },
    { code: 'NXRA', bid: 15.00, basis: -0.80, futures_ref: 'ICE RS May26', futures: 15.80, outlook: 'bullish', cop: 12.50, target: 16.00 },
    { code: 'CNRY', bid: 0.34, basis: null, futures_ref: null, futures: null, outlook: 'sideways', cop: 0.28, target: 0.38 },
    { code: 'BRLY', bid: 6.50, basis: -0.40, futures_ref: null, futures: null, outlook: 'bearish', cop: 5.00, target: 7.00 },
  ];

  let priceCount = 0;
  for (const p of PRICES) {
    const commodity = commodityMap[p.code];
    if (!commodity) continue;
    await prisma.marketPrice.upsert({
      where: { farm_id_commodity_id_price_date: { farm_id: farmId, commodity_id: commodity.id, price_date: today } },
      update: { bid_per_bu: p.bid, basis_per_bu: p.basis, futures_reference: p.futures_ref, futures_close: p.futures, outlook: p.outlook, cop_per_bu: p.cop, target_price_bu: p.target },
      create: {
        farm_id: farmId,
        commodity_id: commodity.id,
        price_date: today,
        bid_per_bu: p.bid,
        basis_per_bu: p.basis,
        futures_reference: p.futures_ref,
        futures_close: p.futures,
        buyer_name: 'Market',
        outlook: p.outlook,
        cop_per_bu: p.cop,
        target_price_bu: p.target,
      },
    });
    priceCount++;
  }
  console.log(`  ${priceCount} market prices upserted`);

  // 5. Marketing Contracts
  console.log('\n4. Seeding marketing contracts...');
  const CONTRACTS = [
    // Fulfilled contracts (9)
    { num: 'MKT-001', crop_year: '2025', code: 'CNLA', cp: 'CGI', mt: 500, delivered: 500, type: 'flat', status: 'fulfilled', price_bu: 14.50, elevator: 'Regina', settled_amt: 319200, grade: '#1' },
    { num: 'MKT-002', crop_year: '2025', code: 'CWAD', cp: 'RPI', mt: 300, delivered: 300, type: 'flat', status: 'fulfilled', price_bu: 9.80, elevator: 'Yorkton', settled_amt: 129528, grade: '#1 CWAD' },
    { num: 'MKT-003', crop_year: '2025', code: 'CWRS', cp: 'G3G', mt: 400, delivered: 400, type: 'basis', status: 'fulfilled', price_bu: 9.50, basis: -0.55, futures_ref: 'MGE Mar26', elevator: 'Pasqua', settled_amt: 167200, grade: '#1 CWRS' },
    { num: 'MKT-004', crop_year: '2025', code: 'LNSR', cp: 'LGX', mt: 200, delivered: 200, type: 'flat', status: 'fulfilled', price_bu: 0.45, elevator: 'LGX Terminal', settled_amt: 39600, grade: '#2' },
    { num: 'MKT-005', crop_year: '2025', code: 'YPEA', cp: 'BNG', mt: 350, delivered: 350, type: 'flat', status: 'fulfilled', price_bu: 9.00, elevator: 'Altona', settled_amt: 138600, grade: '#2' },
    { num: 'MKT-006', crop_year: '2025', code: 'L358', cp: 'CGI', mt: 250, delivered: 250, type: 'hta', status: 'fulfilled', price_bu: 15.00, futures_ref: 'ICE RS Mar26', futures_price: 15.80, elevator: 'Regina', settled_amt: 165000, grade: '#1' },
    { num: 'MKT-007', crop_year: '2025', code: 'CHKP', cp: 'LDC', mt: 150, delivered: 150, type: 'flat', status: 'fulfilled', price_bu: 0.44, elevator: 'Yorkton', settled_amt: 29040, grade: '#1' },
    { num: 'MKT-008', crop_year: '2025', code: 'CNRY', cp: 'CER', mt: 100, delivered: 100, type: 'flat', status: 'fulfilled', price_bu: 0.36, elevator: null, settled_amt: 15840, grade: '#1' },
    { num: 'MKT-009', crop_year: '2025', code: 'BRLY', cp: 'MBA', mt: 200, delivered: 200, type: 'flat', status: 'fulfilled', price_bu: 6.80, elevator: 'Winnipeg', settled_amt: 59840, grade: '#1' },
    // In-delivery contracts (3)
    { num: 'MKT-010', crop_year: '2025', code: 'CNLA', cp: 'RPI', mt: 600, delivered: 350, type: 'flat', status: 'in_delivery', price_bu: 14.20, elevator: 'Yorkton', grade: '#1' },
    { num: 'MKT-011', crop_year: '2025', code: 'CWAD', cp: 'G3G', mt: 400, delivered: 150, type: 'basis', status: 'in_delivery', price_bu: null, basis: -0.45, futures_ref: 'MGE May26', pricing_status: 'unpriced', elevator: 'Pasqua', grade: '#1 CWAD' },
    { num: 'MKT-012', crop_year: '2025', code: 'LNSG', cp: 'LGX', mt: 250, delivered: 80, type: 'flat', status: 'in_delivery', price_bu: 0.39, elevator: 'LGX Terminal', grade: '#2' },
    // Executed contracts (3) — not yet started delivery
    { num: 'MKT-013', crop_year: '2025', code: 'NXRA', cp: 'CGI', mt: 300, delivered: 0, type: 'hta', status: 'executed', price_bu: null, futures_ref: 'ICE RS Jul26', futures_price: 16.10, pricing_status: 'unpriced', elevator: 'Regina', grade: '#1', delivery_start: '2026-04-01', delivery_end: '2026-06-30' },
    { num: 'MKT-014', crop_year: '2025', code: 'CWRS', cp: 'BNG', mt: 500, delivered: 0, type: 'flat', status: 'executed', price_bu: 10.00, elevator: 'Altona', grade: '#1 CWRS', delivery_start: '2026-03-15', delivery_end: '2026-05-31' },
    { num: 'MKT-015', crop_year: '2025', code: 'CHKP', cp: 'LDC', mt: 200, delivered: 0, type: 'deferred', status: 'executed', price_bu: 0.43, pricing_status: 'partially_priced', elevator: 'Yorkton', grade: '#1', delivery_start: '2026-04-01', delivery_end: '2026-07-31' },
  ];

  let contractCount = 0;
  for (const c of CONTRACTS) {
    const commodity = commodityMap[c.code];
    const counterparty = counterpartyMap[c.cp];
    if (!commodity || !counterparty) {
      console.warn(`  Skipping ${c.num}: commodity ${c.code} or counterparty ${c.cp} not found`);
      continue;
    }

    const factor = buToMtFactor(commodity.lbs_per_bu);
    const priceMt = c.price_bu ? c.price_bu * factor : null;
    const contractValue = priceMt ? priceMt * c.mt : null;

    await prisma.marketingContract.upsert({
      where: { farm_id_contract_number: { farm_id: farmId, contract_number: c.num } },
      update: {
        crop_year: c.crop_year,
        commodity_id: commodity.id,
        counterparty_id: counterparty.id,
        grade: c.grade || null,
        contracted_mt: c.mt,
        delivered_mt: c.delivered,
        remaining_mt: c.mt - c.delivered,
        pricing_type: c.type,
        pricing_status: c.pricing_status || 'priced',
        price_per_bu: c.price_bu || null,
        price_per_mt: priceMt,
        basis_level: c.basis || null,
        futures_reference: c.futures_ref || null,
        futures_price: c.futures_price || null,
        elevator_site: c.elevator || null,
        status: c.status,
        settlement_date: c.status === 'fulfilled' ? new Date('2026-02-15') : null,
        settlement_amount: c.settled_amt || null,
        contract_value: contractValue,
        delivery_start: c.delivery_start ? new Date(c.delivery_start) : null,
        delivery_end: c.delivery_end ? new Date(c.delivery_end) : null,
      },
      create: {
        farm_id: farmId,
        contract_number: c.num,
        crop_year: c.crop_year,
        commodity_id: commodity.id,
        counterparty_id: counterparty.id,
        grade: c.grade || null,
        contracted_mt: c.mt,
        delivered_mt: c.delivered,
        remaining_mt: c.mt - c.delivered,
        pricing_type: c.type,
        pricing_status: c.pricing_status || 'priced',
        price_per_bu: c.price_bu || null,
        price_per_mt: priceMt,
        basis_level: c.basis || null,
        futures_reference: c.futures_ref || null,
        futures_price: c.futures_price || null,
        elevator_site: c.elevator || null,
        status: c.status,
        settlement_date: c.status === 'fulfilled' ? new Date('2026-02-15') : null,
        settlement_amount: c.settled_amt || null,
        contract_value: contractValue,
        delivery_start: c.delivery_start ? new Date(c.delivery_start) : null,
        delivery_end: c.delivery_end ? new Date(c.delivery_end) : null,
      },
    });
    contractCount++;
  }
  console.log(`  ${contractCount} marketing contracts upserted`);

  // 6. Cash Flow Entries (6 months of requirements + receipts)
  console.log('\n5. Seeding cash flow entries...');
  const CASH_FLOW = [
    // Requirements (negative = outflow)
    { month: '2026-03-01', type: 'requirement', category: 'fertilizer', desc: 'Spring fertilizer pre-pay', amount: -2800000 },
    { month: '2026-03-01', type: 'requirement', category: 'seed', desc: 'Seed purchase', amount: -950000 },
    { month: '2026-03-01', type: 'requirement', category: 'chemical', desc: 'Pre-seed herbicide', amount: -620000 },
    { month: '2026-04-01', type: 'requirement', category: 'chemical', desc: 'In-crop herbicide', amount: -480000 },
    { month: '2026-04-01', type: 'requirement', category: 'equipment', desc: 'Equipment payments', amount: -350000 },
    { month: '2026-04-01', type: 'requirement', category: 'loc_interest', desc: 'LOC interest', amount: -48000 },
    { month: '2026-05-01', type: 'requirement', category: 'chemical', desc: 'Fungicide application', amount: -380000 },
    { month: '2026-05-01', type: 'requirement', category: 'land_rent', desc: 'Land rent payment', amount: -1200000 },
    { month: '2026-06-01', type: 'requirement', category: 'overhead', desc: 'Operating overhead', amount: -180000 },
    { month: '2026-06-01', type: 'requirement', category: 'equipment', desc: 'Harvest prep', amount: -250000 },
    { month: '2026-07-01', type: 'requirement', category: 'overhead', desc: 'Operating overhead', amount: -180000 },
    { month: '2026-07-01', type: 'requirement', category: 'loc_interest', desc: 'LOC interest', amount: -52000 },
    { month: '2026-08-01', type: 'requirement', category: 'equipment', desc: 'Harvest fuel & labour', amount: -420000 },
    { month: '2026-08-01', type: 'requirement', category: 'overhead', desc: 'Operating overhead', amount: -180000 },
    // Receipts (positive = inflow)
    { month: '2026-03-01', type: 'receipt', category: 'grain_sale', desc: 'Canola delivery - RPI MKT-010', amount: 1100000 },
    { month: '2026-04-01', type: 'receipt', category: 'grain_sale', desc: 'Durum delivery - G3 MKT-011', amount: 650000 },
    { month: '2026-05-01', type: 'receipt', category: 'grain_sale', desc: 'Wheat delivery - BNG MKT-014', amount: 900000 },
    { month: '2026-06-01', type: 'receipt', category: 'grain_sale', desc: 'Lentils/Chickpeas deliveries', amount: 850000 },
  ];

  let cfCount = 0;
  for (const cf of CASH_FLOW) {
    // Use a deterministic approach - delete existing for this month/type/category, then create
    const periodDate = new Date(cf.month);
    const existing = await prisma.cashFlowEntry.findFirst({
      where: {
        farm_id: farmId,
        period_date: periodDate,
        entry_type: cf.type,
        category: cf.category,
        description: cf.desc,
      },
    });

    if (existing) {
      await prisma.cashFlowEntry.update({
        where: { id: existing.id },
        data: { amount: cf.amount },
      });
    } else {
      await prisma.cashFlowEntry.create({
        data: {
          farm_id: farmId,
          period_date: periodDate,
          entry_type: cf.type,
          category: cf.category,
          description: cf.desc,
          amount: cf.amount,
        },
      });
    }
    cfCount++;
  }
  console.log(`  ${cfCount} cash flow entries upserted`);

  console.log('\nMarketing seed complete!');

  // Summary
  const counts = await Promise.all([
    prisma.marketingContract.count({ where: { farm_id: farmId } }),
    prisma.counterparty.count({ where: { farm_id: farmId } }),
    prisma.marketPrice.count({ where: { farm_id: farmId } }),
    prisma.cashFlowEntry.count({ where: { farm_id: farmId } }),
  ]);
  console.log(`\nSummary: ${counts[0]} contracts, ${counts[1]} counterparties, ${counts[2]} prices, ${counts[3]} cash flow entries`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
