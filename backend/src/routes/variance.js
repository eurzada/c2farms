import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { calculateEnterpriseVariance } from '../services/varianceService.js';
import { parseYear } from '../utils/fiscalYear.js';

const router = Router();

// Enterprise-wide variance waterfall
router.get('/variance/:year', authenticate, async (req, res, next) => {
  try {
    const fiscalYear = parseYear(req.params.year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });

    const variance = await calculateEnterpriseVariance(fiscalYear);
    res.json(variance);
  } catch (err) {
    next(err);
  }
});

export default router;
