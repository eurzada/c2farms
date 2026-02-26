import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getFarmLeafCategories } from '../services/categoryService.js';
import { rollupGlActuals } from '../services/glRollupService.js';
import { isValidMonth } from '../utils/fiscalYear.js';
import { emitDataChange, aiEvents } from '../socket/aiEvents.js';

const router = Router();

// POST /:farmId/accounting/import-csv
// Accepts: { fiscal_year, accounts: [{ name, category_code, months: { Mon: amount } }] }
// Creates GL accounts + GlActualDetail records, then rolls up to MonthlyData.
// This populates both the executive (category-level) and detail (GL-level) views.
router.post('/:farmId/accounting/import-csv', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { fiscal_year, accounts } = req.body;

    if (!fiscal_year) {
      return res.status(400).json({ error: 'fiscal_year is required' });
    }
    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      return res.status(400).json({ error: 'accounts array is required' });
    }

    const fy = parseInt(fiscal_year);
    console.log(`[CSV Import] farmId=${farmId}, FY=${fy}, ${accounts.length} account(s)`);

    // Validate that assumptions exist for this fiscal year (needed for per-unit calculations)
    const assumption = await prisma.assumption.findUnique({
      where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fy } },
    });
    if (!assumption) {
      return res.status(400).json({
        error: `No assumptions found for FY ${fy}. Please set up assumptions (acres, crops) before importing.`,
      });
    }

    // Get farm's leaf categories for validation
    const leafCategories = await getFarmLeafCategories(farmId);
    const leafCodes = new Set(leafCategories.map(c => c.code));

    // Build category_code → category_id map
    const categoryMap = {};
    const dbCategories = await prisma.farmCategory.findMany({
      where: { farm_id: farmId },
      select: { id: true, code: true },
    });
    for (const cat of dbCategories) {
      categoryMap[cat.code] = cat.id;
    }

    console.log(`[CSV Import] ${leafCodes.size} valid leaf categories for farm`);

    const monthsAffected = new Set();
    const skippedDetails = [];
    let accountsProcessed = 0;

    for (const acct of accounts) {
      const { name, category_code, months } = acct;

      if (!name || !category_code || !months || typeof months !== 'object') {
        skippedDetails.push({ account: name || '?', reason: 'Missing name, category_code, or months' });
        continue;
      }

      if (!leafCodes.has(category_code)) {
        skippedDetails.push({ account: name, reason: `Invalid leaf category "${category_code}"` });
        continue;
      }

      const categoryId = categoryMap[category_code];
      if (!categoryId) {
        skippedDetails.push({ account: name, reason: `Category "${category_code}" not found in database` });
        continue;
      }

      // Find or create GL account for this CSV line item
      const glAccount = await prisma.glAccount.upsert({
        where: { farm_id_account_number: { farm_id: farmId, account_number: name } },
        update: { account_name: name, category_id: categoryId },
        create: { farm_id: farmId, account_number: name, account_name: name, category_id: categoryId },
      });

      // Create GL actual detail for each month
      for (const [month, amount] of Object.entries(months)) {
        if (!isValidMonth(month)) {
          skippedDetails.push({ account: name, reason: `Invalid month "${month}"` });
          continue;
        }

        await prisma.glActualDetail.upsert({
          where: {
            farm_id_fiscal_year_month_gl_account_id: {
              farm_id: farmId, fiscal_year: fy, month, gl_account_id: glAccount.id,
            },
          },
          update: { amount: parseFloat(amount) || 0 },
          create: {
            farm_id: farmId, fiscal_year: fy, month,
            gl_account_id: glAccount.id, amount: parseFloat(amount) || 0,
          },
        });

        monthsAffected.add(month);
      }

      accountsProcessed++;
    }

    // Rollup GL actuals → MonthlyData for all affected months
    for (const month of monthsAffected) {
      await rollupGlActuals(farmId, fy, month);
    }

    console.log(`[CSV Import] Done: ${accountsProcessed} accounts, ${monthsAffected.size} months, ${skippedDetails.length} skipped`);
    if (skippedDetails.length > 0) {
      console.warn('[CSV Import] Skipped details:', JSON.stringify(skippedDetails));
    }

    const io = req.app.get('io');
    if (io) emitDataChange(io, farmId, aiEvents.actualImport(monthsAffected.size, accountsProcessed));

    res.json({
      message: `Imported ${accountsProcessed} account(s) across ${monthsAffected.size} month(s)`,
      imported: accountsProcessed,
      months: monthsAffected.size,
      skipped: skippedDetails.length,
      skippedDetails,
    });
  } catch (err) {
    console.error('[CSV Import] Error:', err);
    next(err);
  }
});

// DELETE /:farmId/accounting/clear-year
// Body: { fiscal_year }
// Clears all GL actual details and resets MonthlyData for a farm + fiscal year.
router.delete('/:farmId/accounting/clear-year', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { fiscal_year } = req.body;

    if (!fiscal_year) {
      return res.status(400).json({ error: 'fiscal_year is required' });
    }

    const fy = parseInt(fiscal_year);
    console.log(`[Clear Year] farmId=${farmId}, FY=${fy}`);

    // Delete all GL actual detail records for this farm + year
    const deletedDetails = await prisma.glActualDetail.deleteMany({
      where: { farm_id: farmId, fiscal_year: fy },
    });

    // Reset MonthlyData for both accounting and per_unit types
    const updatedMonthly = await prisma.monthlyData.updateMany({
      where: { farm_id: farmId, fiscal_year: fy, type: { in: ['accounting', 'per_unit'] } },
      data: { data_json: {}, is_actual: false },
    });

    console.log(`[Clear Year] Deleted ${deletedDetails.count} GL details, reset ${updatedMonthly.count} monthly records`);

    res.json({
      message: `Cleared FY ${fy}: ${deletedDetails.count} GL detail(s) removed, ${updatedMonthly.count} monthly record(s) reset`,
      deletedDetails: deletedDetails.count,
      resetMonthly: updatedMonthly.count,
    });
  } catch (err) {
    console.error('[Clear Year] Error:', err);
    next(err);
  }
});

export default router;
