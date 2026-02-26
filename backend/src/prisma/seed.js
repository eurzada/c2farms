import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { FISCAL_MONTHS } from '../utils/fiscalYear.js';
import { DEFAULT_CATEGORIES, generateCropRevenueCategories, DEFAULT_GL_ACCOUNTS } from '../utils/defaultCategoryTemplate.js';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create sample user
  const passwordHash = await bcrypt.hash('password123', 10);
  const user = await prisma.user.upsert({
    where: { email: 'farmer@c2farms.com' },
    update: {},
    create: {
      email: 'farmer@c2farms.com',
      password_hash: passwordHash,
      name: 'John Prairie',
      role: 'farm_manager',
    },
  });
  console.log(`User: ${user.email}`);

  // Create sample farm
  let farm = await prisma.farm.findFirst({ where: { name: 'Prairie Fields Farm' } });
  if (!farm) {
    farm = await prisma.farm.create({
      data: { name: 'Prairie Fields Farm' },
    });
  }
  console.log(`Farm: ${farm.name} (${farm.id})`);

  // Link user to farm
  await prisma.userFarmRole.upsert({
    where: { user_id_farm_id: { user_id: user.id, farm_id: farm.id } },
    update: {},
    create: { user_id: user.id, farm_id: farm.id, role: 'admin' },
  });

  // Create manager user
  const managerUser = await prisma.user.upsert({
    where: { email: 'manager@c2farms.com' },
    update: {},
    create: {
      email: 'manager@c2farms.com',
      password_hash: passwordHash,
      name: 'Jane Manager',
      role: 'farm_manager',
    },
  });
  await prisma.userFarmRole.upsert({
    where: { user_id_farm_id: { user_id: managerUser.id, farm_id: farm.id } },
    update: {},
    create: { user_id: managerUser.id, farm_id: farm.id, role: 'manager' },
  });
  console.log(`Manager: ${managerUser.email}`);

  // Create viewer user
  const viewerUser = await prisma.user.upsert({
    where: { email: 'viewer@c2farms.com' },
    update: {},
    create: {
      email: 'viewer@c2farms.com',
      password_hash: passwordHash,
      name: 'Bob Viewer',
      role: 'farm_manager',
    },
  });
  await prisma.userFarmRole.upsert({
    where: { user_id_farm_id: { user_id: viewerUser.id, farm_id: farm.id } },
    update: {},
    create: { user_id: viewerUser.id, farm_id: farm.id, role: 'viewer' },
  });
  console.log(`Viewer: ${viewerUser.email}`);

  const FISCAL_YEAR = 2026;
  const crops = [
    { name: 'Canola', acres: 1500, target_yield: 45, price_per_unit: 14 },
    { name: 'Durum', acres: 1200, target_yield: 50, price_per_unit: 10 },
    { name: 'Chickpeas', acres: 800, target_yield: 35, price_per_unit: 16 },
    { name: 'Small Red Lentils', acres: 1500, target_yield: 30, price_per_unit: 12 },
  ];
  const bins = [
    { name: 'Bin A - Main', capacity: 50000, opening_balance: 12000, grain_type: 'Canola' },
    { name: 'Bin B - East', capacity: 35000, opening_balance: 8000, grain_type: 'Durum' },
    { name: 'Bin C - West', capacity: 40000, opening_balance: 15000, grain_type: 'Lentils' },
  ];

  // Create assumptions
  await prisma.assumption.upsert({
    where: { farm_id_fiscal_year: { farm_id: farm.id, fiscal_year: FISCAL_YEAR } },
    update: { total_acres: 5000, crops_json: crops, bins_json: bins },
    create: {
      farm_id: farm.id,
      fiscal_year: FISCAL_YEAR,
      total_acres: 5000,
      crops_json: crops,
      bins_json: bins,
    },
  });

  // ============ Seed FarmCategory records ============
  console.log('Seeding farm categories...');

  // Generate crop revenue categories
  const cropCategories = generateCropRevenueCategories(crops);
  const allTemplateCategories = [...DEFAULT_CATEGORIES];

  // Insert crop revenue categories before rev_other_income
  const revenueIdx = allTemplateCategories.findIndex(c => c.code === 'rev_other_income');
  if (revenueIdx >= 0) {
    allTemplateCategories.splice(revenueIdx, 0, ...cropCategories);
  }

  // Renumber revenue sort_orders
  let revSortOrder = 2;
  for (const cat of allTemplateCategories) {
    if (cat.ref === 'revenue') {
      cat.sort_order = revSortOrder++;
    }
  }

  // Create top-level parents first
  const codeToId = {};
  for (const cat of allTemplateCategories) {
    if (cat.ref !== null) continue;
    const created = await prisma.farmCategory.upsert({
      where: { farm_id_code: { farm_id: farm.id, code: cat.code } },
      update: { display_name: cat.display_name, level: cat.level, sort_order: cat.sort_order, category_type: cat.category_type, path: cat.code, is_active: true },
      create: {
        farm_id: farm.id, code: cat.code, display_name: cat.display_name,
        parent_id: null, path: cat.code, level: cat.level,
        sort_order: cat.sort_order, category_type: cat.category_type,
      },
    });
    codeToId[cat.code] = created.id;
  }

  // Create children
  for (const cat of allTemplateCategories) {
    if (cat.ref === null) continue;
    const parentId = codeToId[cat.ref];
    if (!parentId) continue;
    const created = await prisma.farmCategory.upsert({
      where: { farm_id_code: { farm_id: farm.id, code: cat.code } },
      update: { display_name: cat.display_name, parent_id: parentId, level: cat.level, sort_order: cat.sort_order, category_type: cat.category_type, path: `${cat.ref}.${cat.code}`, is_active: true },
      create: {
        farm_id: farm.id, code: cat.code, display_name: cat.display_name,
        parent_id: parentId, path: `${cat.ref}.${cat.code}`, level: cat.level,
        sort_order: cat.sort_order, category_type: cat.category_type,
      },
    });
    codeToId[cat.code] = created.id;
  }

  const catCount = Object.keys(codeToId).length;
  console.log(`Seeded ${catCount} farm categories`);

  // ============ Seed GL Accounts ============
  console.log('Seeding GL accounts...');
  let glCount = 0;
  for (const gl of DEFAULT_GL_ACCOUNTS) {
    const categoryId = codeToId[gl.category_code] || null;
    await prisma.glAccount.upsert({
      where: { farm_id_account_number: { farm_id: farm.id, account_number: gl.account_number } },
      update: { account_name: gl.account_name, category_id: categoryId },
      create: {
        farm_id: farm.id, account_number: gl.account_number,
        account_name: gl.account_name, category_id: categoryId,
      },
    });
    glCount++;
  }
  console.log(`Seeded ${glCount} GL accounts`);

  // ============ Seed FinancialCategory (legacy, for backward compat) ============
  // Keep old financial_categories table populated
  const { CATEGORY_HIERARCHY } = await import('../utils/categories.js');
  for (const cat of CATEGORY_HIERARCHY) {
    await prisma.financialCategory.upsert({
      where: { id: cat.id },
      update: cat,
      create: cat,
    });
  }
  console.log(`Seeded ${CATEGORY_HIERARCHY.length} legacy financial categories`);

  // ============ Monthly Budget Data (new category codes) ============
  // Per-unit budget data ($/acre/month) using new category structure
  const monthlyBudgets = {
    Nov: { rev_canola: 0, rev_durum: 0, rev_chickpeas: 0, rev_small_red_lentils: 0, rev_other_income: 0, input_seed: 0, input_fert: 0, input_chem: 0, lpm_personnel: 8, lpm_fog: 3, lpm_repairs: 2.3, lpm_shop: 5.5, lbf_rent_interest: 13.5, ins_crop: 2.5, ins_other: 1.2 },
    Dec: { rev_canola: 0, rev_durum: 0, rev_chickpeas: 0, rev_small_red_lentils: 0, rev_other_income: 0, input_seed: 0, input_fert: 0, input_chem: 0, lpm_personnel: 7, lpm_fog: 1.5, lpm_repairs: 1.7, lpm_shop: 5.3, lbf_rent_interest: 13.5, ins_crop: 2.5, ins_other: 1.2 },
    Jan: { rev_canola: 4, rev_durum: 3, rev_chickpeas: 3, rev_small_red_lentils: 5, rev_other_income: 0, input_seed: 0, input_fert: 0, input_chem: 0, lpm_personnel: 7, lpm_fog: 1, lpm_repairs: 1.2, lpm_shop: 6.5, lbf_rent_interest: 13.5, ins_crop: 2.5, ins_other: 1.2 },
    Feb: { rev_canola: 5, rev_durum: 5, rev_chickpeas: 4, rev_small_red_lentils: 6, rev_other_income: 0, input_seed: 0, input_fert: 11, input_chem: 0, lpm_personnel: 8, lpm_fog: 2, lpm_repairs: 1.8, lpm_shop: 5.4, lbf_rent_interest: 13.5, ins_crop: 2.5, ins_other: 1.2 },
    Mar: { rev_canola: 3, rev_durum: 2, rev_chickpeas: 2, rev_small_red_lentils: 3, rev_other_income: 0, input_seed: 8, input_fert: 19.5, input_chem: 4, lpm_personnel: 10, lpm_fog: 5, lpm_repairs: 3.3, lpm_shop: 6.2, lbf_rent_interest: 13.5, ins_crop: 2.5, ins_other: 1.2 },
    Apr: { rev_canola: 1, rev_durum: 1, rev_chickpeas: 1, rev_small_red_lentils: 2, rev_other_income: 0, input_seed: 12, input_fert: 24, input_chem: 8, lpm_personnel: 11, lpm_fog: 8, lpm_repairs: 4.3, lpm_shop: 6.7, lbf_rent_interest: 13.5, ins_crop: 2.5, ins_other: 1.2 },
    May: { rev_canola: 1, rev_durum: 1, rev_chickpeas: 1, rev_small_red_lentils: 2, rev_other_income: 0, input_seed: 5, input_fert: 15, input_chem: 10, lpm_personnel: 10, lpm_fog: 7, lpm_repairs: 3.8, lpm_shop: 6.3, lbf_rent_interest: 13.5, ins_crop: 2.5, ins_other: 1.2 },
    Jun: { rev_canola: 1, rev_durum: 1, rev_chickpeas: 1, rev_small_red_lentils: 2, rev_other_income: 0, input_seed: 0, input_fert: 8.5, input_chem: 6, lpm_personnel: 9, lpm_fog: 6, lpm_repairs: 3.3, lpm_shop: 5.7, lbf_rent_interest: 13.5, ins_crop: 2.5, ins_other: 1.2 },
    Jul: { rev_canola: 3, rev_durum: 2, rev_chickpeas: 2, rev_small_red_lentils: 3, rev_other_income: 0, input_seed: 0, input_fert: 3.5, input_chem: 4, lpm_personnel: 9, lpm_fog: 5, lpm_repairs: 2.8, lpm_shop: 5.2, lbf_rent_interest: 13.5, ins_crop: 2.5, ins_other: 1.2 },
    Aug: { rev_canola: 18, rev_durum: 14, rev_chickpeas: 12, rev_small_red_lentils: 16, rev_other_income: 0, input_seed: 0, input_fert: 0, input_chem: 2, lpm_personnel: 13, lpm_fog: 10, lpm_repairs: 5.5, lpm_shop: 9.5, lbf_rent_interest: 13.5, ins_crop: 2.5, ins_other: 1.2 },
    Sep: { rev_canola: 22, rev_durum: 18, rev_chickpeas: 16, rev_small_red_lentils: 24, rev_other_income: 0, input_seed: 0, input_fert: 0, input_chem: 0, lpm_personnel: 12, lpm_fog: 8, lpm_repairs: 4.4, lpm_shop: 12.1, lbf_rent_interest: 13.5, ins_crop: 2.5, ins_other: 1.2 },
    Oct: { rev_canola: 14, rev_durum: 10, rev_chickpeas: 10, rev_small_red_lentils: 16, rev_other_income: 0, input_seed: 0, input_fert: 0, input_chem: 0, lpm_personnel: 9, lpm_fog: 4, lpm_repairs: 3.3, lpm_shop: 9.7, lbf_rent_interest: 13.5, ins_crop: 2.5, ins_other: 1.2 },
  };

  // Helper: recalc parent sums for new hierarchy
  function recalcParents(data) {
    const result = { ...data };
    // Revenue = sum of all rev_ codes
    const revKeys = Object.keys(result).filter(k => k.startsWith('rev_'));
    result.revenue = revKeys.reduce((sum, k) => sum + (result[k] || 0), 0);
    // Inputs = seed + fert + chem
    result.inputs = (result.input_seed || 0) + (result.input_fert || 0) + (result.input_chem || 0);
    // LPM = personnel + fog + repairs + shop
    result.lpm = (result.lpm_personnel || 0) + (result.lpm_fog || 0) + (result.lpm_repairs || 0) + (result.lpm_shop || 0);
    // LBF
    result.lbf = result.lbf_rent_interest || 0;
    // Insurance
    result.insurance = (result.ins_crop || 0) + (result.ins_other || 0);
    return result;
  }

  const TOTAL_ACRES = 5000;
  const actualMonths = ['Nov', 'Dec', 'Jan', 'Feb'];

  for (const month of FISCAL_MONTHS) {
    const rawData = monthlyBudgets[month];
    const perUnitData = recalcParents(rawData);
    const isActual = actualMonths.includes(month);

    // Slightly adjust actuals to differ from budget
    const adjustedPerUnit = { ...perUnitData };
    if (isActual) {
      for (const key of Object.keys(adjustedPerUnit)) {
        adjustedPerUnit[key] = adjustedPerUnit[key] * (0.95 + Math.random() * 0.1);
      }
      Object.assign(adjustedPerUnit, recalcParents(adjustedPerUnit));
    }

    const finalPerUnit = isActual ? adjustedPerUnit : perUnitData;

    await prisma.monthlyData.upsert({
      where: {
        farm_id_fiscal_year_month_type: {
          farm_id: farm.id, fiscal_year: FISCAL_YEAR, month, type: 'per_unit',
        },
      },
      update: { data_json: finalPerUnit, is_actual: isActual },
      create: {
        farm_id: farm.id, fiscal_year: FISCAL_YEAR, month, type: 'per_unit',
        data_json: finalPerUnit, is_actual: isActual, comments_json: {},
      },
    });

    const accountingData = {};
    for (const [key, val] of Object.entries(finalPerUnit)) {
      accountingData[key] = val * TOTAL_ACRES;
    }

    await prisma.monthlyData.upsert({
      where: {
        farm_id_fiscal_year_month_type: {
          farm_id: farm.id, fiscal_year: FISCAL_YEAR, month, type: 'accounting',
        },
      },
      update: { data_json: accountingData, is_actual: isActual },
      create: {
        farm_id: farm.id, fiscal_year: FISCAL_YEAR, month, type: 'accounting',
        data_json: accountingData, is_actual: isActual, comments_json: {},
      },
    });
  }
  console.log('Seeded monthly data for FY2026');

  // ============ Frozen budget snapshot ============
  await prisma.monthlyDataFrozen.deleteMany({
    where: { farm_id: farm.id, fiscal_year: FISCAL_YEAR },
  });

  for (const month of FISCAL_MONTHS) {
    const rawData = monthlyBudgets[month];
    const perUnitData = recalcParents(rawData);
    const accountingData = {};
    for (const [key, val] of Object.entries(perUnitData)) {
      accountingData[key] = val * TOTAL_ACRES;
    }

    await prisma.monthlyDataFrozen.create({
      data: {
        farm_id: farm.id, fiscal_year: FISCAL_YEAR, month, type: 'per_unit',
        data_json: perUnitData, comments_json: {},
      },
    });
    await prisma.monthlyDataFrozen.create({
      data: {
        farm_id: farm.id, fiscal_year: FISCAL_YEAR, month, type: 'accounting',
        data_json: accountingData, comments_json: {},
      },
    });
  }

  await prisma.assumption.update({
    where: { farm_id_fiscal_year: { farm_id: farm.id, fiscal_year: FISCAL_YEAR } },
    data: { is_frozen: true, frozen_at: new Date() },
  });
  console.log('Created frozen budget snapshot');

  // ============ Sample GL Actual Detail records ============
  console.log('Seeding sample GL actuals...');
  const glAccounts = await prisma.glAccount.findMany({
    where: { farm_id: farm.id },
    include: { category: true },
  });

  for (const month of actualMonths) {
    for (const gl of glAccounts) {
      if (!gl.category) continue;
      // Generate a plausible amount based on the category budget
      const catCode = gl.category.code;
      const budgetData = recalcParents(monthlyBudgets[month]);
      const catBudget = (budgetData[catCode] || 0) * TOTAL_ACRES;
      if (catBudget === 0) continue;

      // Count GL accounts mapped to this category to split the budget
      const sameCategory = glAccounts.filter(a => a.category_id === gl.category_id);
      const share = catBudget / sameCategory.length;
      const amount = share * (0.9 + Math.random() * 0.2); // +/- 10% variation

      await prisma.glActualDetail.upsert({
        where: {
          farm_id_fiscal_year_month_gl_account_id: {
            farm_id: farm.id, fiscal_year: FISCAL_YEAR, month, gl_account_id: gl.id,
          },
        },
        update: { amount },
        create: {
          farm_id: farm.id, fiscal_year: FISCAL_YEAR, month, gl_account_id: gl.id, amount,
        },
      });
    }
  }
  console.log('Seeded GL actual details for actual months');

  // ============ Prior year data (FY2025) ============
  const PRIOR_YEAR = 2025;
  await prisma.assumption.upsert({
    where: { farm_id_fiscal_year: { farm_id: farm.id, fiscal_year: PRIOR_YEAR } },
    update: {},
    create: {
      farm_id: farm.id,
      fiscal_year: PRIOR_YEAR,
      total_acres: 4800,
      crops_json: [
        { name: 'Canola', acres: 1500, target_yield: 42, price_per_unit: 13 },
        { name: 'Durum', acres: 1200, target_yield: 48, price_per_unit: 9.5 },
        { name: 'Chickpeas', acres: 800, target_yield: 32, price_per_unit: 15 },
        { name: 'Small Red Lentils', acres: 1300, target_yield: 28, price_per_unit: 11 },
      ],
      bins_json: bins,
      is_frozen: true,
      frozen_at: new Date('2024-11-01'),
    },
  });

  for (const month of FISCAL_MONTHS) {
    const rawData = monthlyBudgets[month];
    const perUnitData = recalcParents(rawData);
    const adjustedData = {};
    for (const [key, val] of Object.entries(perUnitData)) {
      adjustedData[key] = val * 0.92;
    }
    Object.assign(adjustedData, recalcParents(adjustedData));

    const accountingData = {};
    for (const [key, val] of Object.entries(adjustedData)) {
      accountingData[key] = val * 4800;
    }

    await prisma.monthlyData.upsert({
      where: {
        farm_id_fiscal_year_month_type: { farm_id: farm.id, fiscal_year: PRIOR_YEAR, month, type: 'per_unit' },
      },
      update: { data_json: adjustedData, is_actual: true },
      create: {
        farm_id: farm.id, fiscal_year: PRIOR_YEAR, month, type: 'per_unit',
        data_json: adjustedData, is_actual: true, comments_json: {},
      },
    });

    await prisma.monthlyData.upsert({
      where: {
        farm_id_fiscal_year_month_type: { farm_id: farm.id, fiscal_year: PRIOR_YEAR, month, type: 'accounting' },
      },
      update: { data_json: accountingData, is_actual: true },
      create: {
        farm_id: farm.id, fiscal_year: PRIOR_YEAR, month, type: 'accounting',
        data_json: accountingData, is_actual: true, comments_json: {},
      },
    });
  }
  console.log('Seeded prior year (FY2025) data');

  console.log('\n--- Seed Complete ---');
  console.log(`Admin:   farmer@c2farms.com / password123`);
  console.log(`Manager: manager@c2farms.com / password123`);
  console.log(`Viewer:  viewer@c2farms.com / password123`);
  console.log(`Farm ID: ${farm.id}`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
