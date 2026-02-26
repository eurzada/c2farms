import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getFarmCategories, initFarmCategories, invalidateCache } from '../services/categoryService.js';
import { importGlActuals, rollupGlActuals } from '../services/glRollupService.js';
import { parseYear, isValidMonth, FISCAL_MONTHS } from '../utils/fiscalYear.js';
import { emitDataChange, aiEvents } from '../socket/aiEvents.js';

const router = Router();

// GET chart of accounts: categories + GL accounts + mappings
// Optional ?fiscal_year=XXXX to include YTD amounts from GlActualDetail
router.get('/:farmId/chart-of-accounts', authenticate, async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const fiscalYear = parseYear(req.query.fiscal_year);
    const categories = await getFarmCategories(farmId);
    const glAccounts = await prisma.glAccount.findMany({
      where: { farm_id: farmId, is_active: true },
      include: { category: { select: { id: true, code: true, display_name: true } } },
      orderBy: { account_number: 'asc' },
    });

    // Attach YTD totals and per-month breakdown if fiscal_year provided
    if (fiscalYear) {
      const glAmounts = await prisma.glActualDetail.groupBy({
        by: ['gl_account_id', 'month'],
        where: { farm_id: farmId, fiscal_year: fiscalYear },
        _sum: { amount: true },
      });

      // Build lookup: { gl_account_id: { ytd_total, month_totals: { Mon: amt } } }
      const amountMap = {};
      for (const row of glAmounts) {
        if (!amountMap[row.gl_account_id]) {
          amountMap[row.gl_account_id] = { ytd_total: 0, month_totals: {} };
        }
        const amt = row._sum.amount || 0;
        amountMap[row.gl_account_id].ytd_total += amt;
        amountMap[row.gl_account_id].month_totals[row.month] = amt;
      }

      for (const gl of glAccounts) {
        const amounts = amountMap[gl.id];
        gl.ytd_total = amounts?.ytd_total ?? 0;
        gl.month_totals = amounts?.month_totals ?? {};
      }
    }

    res.json({ categories, glAccounts });
  } catch (err) {
    next(err);
  }
});

// POST initialize chart of accounts from template
router.post('/:farmId/chart-of-accounts/init', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { crops } = req.body;

    // Use provided crops or get from latest assumption
    let cropList = crops;
    if (!cropList) {
      const assumption = await prisma.assumption.findFirst({
        where: { farm_id: farmId },
        orderBy: { fiscal_year: 'desc' },
      });
      cropList = assumption?.crops_json || [];
    }

    await initFarmCategories(farmId, cropList);
    const categories = await getFarmCategories(farmId);
    res.json({ message: 'Chart of accounts initialized', categories });
  } catch (err) {
    next(err);
  }
});

// POST create category
router.post('/:farmId/categories', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { code, display_name, parent_code, category_type, sort_order } = req.body;

    if (!code || !display_name || !category_type) {
      return res.status(400).json({ error: 'code, display_name, and category_type are required' });
    }

    let parentId = null;
    let level = 0;
    let path = code;
    let calculatedSortOrder;

    if (parent_code) {
      const parent = await prisma.farmCategory.findUnique({
        where: { farm_id_code: { farm_id: farmId, code: parent_code } },
      });
      if (!parent) return res.status(404).json({ error: 'Parent category not found' });
      parentId = parent.id;
      level = parent.level + 1;
      path = `${parent.path}.${code}`;

      // Auto-calculate sort_order: max sibling + 1, or parent + 1 if no siblings
      const maxSibling = await prisma.farmCategory.aggregate({
        where: { farm_id: farmId, parent_id: parent.id },
        _max: { sort_order: true },
      });
      calculatedSortOrder = maxSibling._max.sort_order != null
        ? maxSibling._max.sort_order + 1
        : parent.sort_order + 1;
    } else {
      // Top-level: max sort_order + 100
      const maxAll = await prisma.farmCategory.aggregate({
        where: { farm_id: farmId },
        _max: { sort_order: true },
      });
      calculatedSortOrder = (maxAll._max.sort_order ?? 0) + 100;
    }

    const category = await prisma.farmCategory.create({
      data: {
        farm_id: farmId,
        code,
        display_name,
        parent_id: parentId,
        path,
        level,
        sort_order: calculatedSortOrder,
        category_type,
      },
    });

    invalidateCache(farmId);
    res.status(201).json(category);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Category code already exists for this farm' });
    }
    next(err);
  }
});

// PUT update category
router.put('/:farmId/categories/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId, id } = req.params;
    const { display_name, sort_order, is_active } = req.body;

    // Verify category belongs to this farm
    const existing = await prisma.farmCategory.findUnique({ where: { id } });
    if (!existing || existing.farm_id !== farmId) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const category = await prisma.farmCategory.update({
      where: { id },
      data: {
        ...(display_name !== undefined && { display_name }),
        ...(sort_order !== undefined && { sort_order }),
        ...(is_active !== undefined && { is_active }),
      },
    });

    invalidateCache(farmId);
    res.json(category);
  } catch (err) {
    next(err);
  }
});

// DELETE (soft) deactivate category
router.delete('/:farmId/categories/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId, id } = req.params;

    // Verify category belongs to this farm
    const existing = await prisma.farmCategory.findUnique({ where: { id } });
    if (!existing || existing.farm_id !== farmId) {
      return res.status(404).json({ error: 'Category not found' });
    }

    await prisma.farmCategory.update({
      where: { id },
      data: { is_active: false },
    });
    invalidateCache(farmId);
    res.json({ message: 'Category deactivated' });
  } catch (err) {
    next(err);
  }
});

// GET all GL accounts for a farm
router.get('/:farmId/gl-accounts', authenticate, async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const glAccounts = await prisma.glAccount.findMany({
      where: { farm_id: farmId, is_active: true },
      include: { category: { select: { id: true, code: true, display_name: true } } },
      orderBy: { account_number: 'asc' },
    });
    res.json({ glAccounts });
  } catch (err) {
    next(err);
  }
});

// POST create/bulk-create GL accounts
router.post('/:farmId/gl-accounts', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { accounts } = req.body;

    if (!accounts || !Array.isArray(accounts)) {
      return res.status(400).json({ error: 'accounts array is required' });
    }

    const created = [];
    for (const acct of accounts) {
      const { account_number, account_name, category_code, qb_account_id } = acct;
      if (!account_number || !account_name) continue;

      // Resolve category_code to category_id
      let categoryId = null;
      if (category_code) {
        const cat = await prisma.farmCategory.findUnique({
          where: { farm_id_code: { farm_id: farmId, code: category_code } },
        });
        categoryId = cat?.id || null;
      }

      const gl = await prisma.glAccount.upsert({
        where: { farm_id_account_number: { farm_id: farmId, account_number } },
        update: { account_name, category_id: categoryId, qb_account_id },
        create: {
          farm_id: farmId,
          account_number,
          account_name,
          category_id: categoryId,
          qb_account_id,
        },
      });
      created.push(gl);
    }

    res.status(201).json({ created: created.length, glAccounts: created });
  } catch (err) {
    next(err);
  }
});

// PUT update GL account
router.put('/:farmId/gl-accounts/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId, id } = req.params;
    const { account_name, category_code, is_active, fiscal_year } = req.body;

    // Verify GL account belongs to this farm
    const existing = await prisma.glAccount.findUnique({ where: { id } });
    if (!existing || existing.farm_id !== farmId) {
      return res.status(404).json({ error: 'GL account not found' });
    }

    const updates = {};
    if (account_name !== undefined) updates.account_name = account_name;
    if (is_active !== undefined) updates.is_active = is_active;
    if (category_code !== undefined) {
      const cat = await prisma.farmCategory.findUnique({
        where: { farm_id_code: { farm_id: farmId, code: category_code } },
      });
      updates.category_id = cat?.id || null;
    }

    // When deactivating, clear category_id so rollup excludes this account's amounts
    if (is_active === false) {
      updates.category_id = null;
    }

    const gl = await prisma.glAccount.update({ where: { id }, data: updates });

    // Re-rollup if deactivated and fiscal_year provided
    const fy = parseYear(fiscal_year);
    if (is_active === false && fy) {
      for (const month of FISCAL_MONTHS) {
        await rollupGlActuals(farmId, fy, month);
      }
    }

    res.json(gl);
  } catch (err) {
    next(err);
  }
});

// POST bulk assign GL accounts to categories
router.post('/:farmId/gl-accounts/bulk-assign', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { assignments, fiscal_year } = req.body;
    // assignments: [{ account_number, category_code }]

    if (!assignments || !Array.isArray(assignments)) {
      return res.status(400).json({ error: 'assignments array is required' });
    }

    let updated = 0;
    for (const { account_number, category_code } of assignments) {
      let categoryId = null;
      if (category_code) {
        const cat = await prisma.farmCategory.findUnique({
          where: { farm_id_code: { farm_id: farmId, code: category_code } },
        });
        if (!cat) continue;
        categoryId = cat.id;
      }

      await prisma.glAccount.updateMany({
        where: { farm_id: farmId, account_number },
        data: { category_id: categoryId },
      });
      updated++;
    }

    // Re-rollup all fiscal months if fiscal_year provided
    const fy = parseYear(fiscal_year);
    if (fy) {
      for (const month of FISCAL_MONTHS) {
        await rollupGlActuals(farmId, fy, month);
      }
    }

    const io = req.app.get('io');
    if (io) emitDataChange(io, farmId, aiEvents.glMappingChanged(updated));

    res.json({ message: `Updated ${updated} GL account assignments`, rollup: !!fy });
  } catch (err) {
    next(err);
  }
});

// POST import GL actuals (from QBO CSV/Excel)
router.post('/:farmId/gl-actuals/import', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { fiscal_year, rows, new_accounts } = req.body;
    // rows: [{ account_number, month, amount }]
    // new_accounts: [{ account_number, account_name, category_code }] (optional)

    const fiscalYear = parseYear(fiscal_year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });
    if (!rows || !Array.isArray(rows)) {
      return res.status(400).json({ error: 'rows array is required' });
    }

    // Create any new GL accounts first
    if (new_accounts && Array.isArray(new_accounts)) {
      for (const acct of new_accounts) {
        let categoryId = null;
        if (acct.category_code) {
          const cat = await prisma.farmCategory.findUnique({
            where: { farm_id_code: { farm_id: farmId, code: acct.category_code } },
          });
          categoryId = cat?.id || null;
        }
        await prisma.glAccount.upsert({
          where: { farm_id_account_number: { farm_id: farmId, account_number: acct.account_number } },
          update: { account_name: acct.account_name, category_id: categoryId },
          create: {
            farm_id: farmId,
            account_number: acct.account_number,
            account_name: acct.account_name,
            category_id: categoryId,
          },
        });
      }
    }

    const result = await importGlActuals(farmId, fiscalYear, rows);
    res.json({ message: `Imported GL actuals for ${result.monthsImported} month(s)`, ...result });
  } catch (err) {
    next(err);
  }
});

export default router;
