import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { buildFarmContext, contextToTextSummary } from '../services/farmContextService.js';
import { parseYear } from '../utils/fiscalYear.js';

const router = Router();

// GET /:farmId/ai/context/:year — full structured farm context
router.get('/:farmId/ai/context/:year', authenticate, async (req, res, next) => {
  try {
    const { farmId, year } = req.params;
    const fiscalYear = parseYear(year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });

    const includeGlDetail = req.query.gl_detail === 'true';
    const context = await buildFarmContext(farmId, fiscalYear, { includeGlDetail });
    if (!context) return res.status(404).json({ error: 'Farm not found' });

    res.json(context);
  } catch (err) {
    next(err);
  }
});

// GET /:farmId/ai/context/:year/summary — text summary for LLM prompts
router.get('/:farmId/ai/context/:year/summary', authenticate, async (req, res, next) => {
  try {
    const { farmId, year } = req.params;
    const fiscalYear = parseYear(year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });

    const context = await buildFarmContext(farmId, fiscalYear);
    if (!context) return res.status(404).json({ error: 'Farm not found' });

    const summary = contextToTextSummary(context);
    res.json({ summary });
  } catch (err) {
    next(err);
  }
});

// POST /:farmId/ai/query — natural language query with keyword-based intent detection
router.post('/:farmId/ai/query', authenticate, async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { query, fiscal_year, conversation_id } = req.body;

    if (!query) return res.status(400).json({ error: 'query is required' });

    const fiscalYear = parseYear(fiscal_year) || new Date().getFullYear();
    const context = await buildFarmContext(farmId, fiscalYear);
    if (!context) return res.status(404).json({ error: 'Farm not found' });

    // Simple keyword-based intent detection
    const q = query.toLowerCase();
    let intent = 'general';
    let responseData = {};
    let responseText = '';

    if (q.includes('profit') || q.includes('bottom line') || q.includes('net')) {
      intent = 'profit';
      const revCodes = Object.keys(context.ytdTotals).filter(k => k.startsWith('rev_'));
      const totalRevenue = revCodes.reduce((sum, k) => sum + (context.ytdTotals[k] || 0), 0);
      const expCodes = Object.keys(context.ytdTotals).filter(k => !k.startsWith('rev_'));
      const totalExpense = expCodes.reduce((sum, k) => sum + (context.ytdTotals[k] || 0), 0);
      const profit = totalRevenue - totalExpense;
      responseData = { revenue: totalRevenue, expense: totalExpense, profit, perAcre: true };
      responseText = `For FY${fiscalYear}, total revenue is $${totalRevenue.toFixed(2)}/acre, total expenses are $${totalExpense.toFixed(2)}/acre, resulting in a profit of $${profit.toFixed(2)}/acre.`;
      if (context.assumptions) {
        const totalProfit = profit * context.assumptions.totalAcres;
        responseText += ` With ${context.assumptions.totalAcres.toLocaleString()} acres, that's $${totalProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })} total.`;
      }
    } else if (q.includes('forecast') || q.includes('projection')) {
      intent = 'forecast';
      if (context.forecast) {
        responseData = context.forecast;
        const rev = context.forecast['revenue'];
        responseText = rev
          ? `Forecast revenue: $${rev.forecastTotal.toFixed(2)}/acre (budget: $${rev.frozenBudgetTotal.toFixed(2)}/acre, variance: $${rev.variance.toFixed(2)}/acre).`
          : 'Forecast data available but no revenue category found.';
      } else {
        responseText = 'No forecast available. Budget may not be frozen yet.';
      }
    } else if (q.includes('crop') || q.includes('acre')) {
      intent = 'crops';
      if (context.assumptions?.crops) {
        responseData = { crops: context.assumptions.crops, totalAcres: context.assumptions.totalAcres };
        const cropLines = context.assumptions.crops.map(c => `${c.name}: ${c.acres} acres`).join(', ');
        responseText = `Total acres: ${context.assumptions.totalAcres.toLocaleString()}. Crops: ${cropLines}.`;
      } else {
        responseText = 'No crop data available for this fiscal year.';
      }
    } else if (q.includes('budget') || q.includes('frozen')) {
      intent = 'budget';
      responseData = { isFrozen: context.assumptions?.isFrozen, frozenTotals: context.frozenBudget.totals };
      responseText = context.assumptions?.isFrozen
        ? `Budget is frozen (as of ${context.assumptions.frozenAt ? new Date(context.assumptions.frozenAt).toLocaleDateString() : 'unknown'}).`
        : 'Budget is currently in draft (not frozen).';
    } else if (q.includes('expense') || q.includes('cost') || q.includes('spend')) {
      intent = 'expenses';
      const inputCodes = Object.keys(context.ytdTotals).filter(k => k.startsWith('input_'));
      const lpmCodes = Object.keys(context.ytdTotals).filter(k => k.startsWith('lpm_'));
      const lbfCodes = Object.keys(context.ytdTotals).filter(k => k.startsWith('lbf_'));
      const insCodes = Object.keys(context.ytdTotals).filter(k => k.startsWith('ins_'));
      const breakdown = {
        inputs: inputCodes.reduce((s, k) => s + (context.ytdTotals[k] || 0), 0),
        lpm: lpmCodes.reduce((s, k) => s + (context.ytdTotals[k] || 0), 0),
        lbf: lbfCodes.reduce((s, k) => s + (context.ytdTotals[k] || 0), 0),
        insurance: insCodes.reduce((s, k) => s + (context.ytdTotals[k] || 0), 0),
      };
      breakdown.total = breakdown.inputs + breakdown.lpm + breakdown.lbf + breakdown.insurance;
      responseData = breakdown;
      responseText = `Total expenses: $${breakdown.total.toFixed(2)}/acre. Inputs: $${breakdown.inputs.toFixed(2)}, LPM: $${breakdown.lpm.toFixed(2)}, LBF: $${breakdown.lbf.toFixed(2)}, Insurance: $${breakdown.insurance.toFixed(2)}.`;
    } else {
      intent = 'general';
      responseData = { summary: contextToTextSummary(context) };
      responseText = contextToTextSummary(context);
    }

    // Log conversation
    let conversation;
    if (conversation_id) {
      conversation = await prisma.aiConversation.findFirst({
        where: { id: conversation_id, farm_id: farmId, user_id: req.userId },
      });
    }

    if (!conversation) {
      conversation = await prisma.aiConversation.create({
        data: {
          farm_id: farmId,
          user_id: req.userId,
          title: query.slice(0, 100),
        },
      });
    }

    // Log user message
    await prisma.aiMessage.create({
      data: {
        conversation_id: conversation.id,
        role: 'user',
        content: query,
        metadata_json: { intent, fiscal_year: fiscalYear },
      },
    });

    // Log assistant response
    await prisma.aiMessage.create({
      data: {
        conversation_id: conversation.id,
        role: 'assistant',
        content: responseText,
        context_json: responseData,
        metadata_json: { intent },
      },
    });

    res.json({
      intent,
      response: responseText,
      data: responseData,
      conversation_id: conversation.id,
    });
  } catch (err) {
    next(err);
  }
});

// GET /:farmId/ai/conversations — list conversation history
router.get('/:farmId/ai/conversations', authenticate, async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const conversations = await prisma.aiConversation.findMany({
      where: { farm_id: farmId, user_id: req.userId },
      orderBy: { updated_at: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        created_at: true,
        updated_at: true,
        _count: { select: { messages: true } },
      },
    });

    res.json({ conversations });
  } catch (err) {
    next(err);
  }
});

// GET /:farmId/ai/conversations/:id — full conversation with messages
router.get('/:farmId/ai/conversations/:id', authenticate, async (req, res, next) => {
  try {
    const { farmId, id } = req.params;
    const conversation = await prisma.aiConversation.findFirst({
      where: { id, farm_id: farmId, user_id: req.userId },
      include: {
        messages: { orderBy: { created_at: 'asc' } },
      },
    });

    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    res.json(conversation);
  } catch (err) {
    next(err);
  }
});

export default router;
