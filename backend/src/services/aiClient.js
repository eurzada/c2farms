/**
 * Shared Anthropic AI client utilities.
 *
 * Models:
 *   - Detection/classification: claude-haiku-4-5-20251001 (cheap, fast)
 *   - Extraction/analysis: claude-sonnet-4-20250514 (accurate)
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 */

export const MODELS = {
  detection: 'claude-haiku-4-5-20251001',
  extraction: 'claude-sonnet-4-20250514',
};

export const PRICING = {
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
};

export function computeUsage(model, response) {
  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  const rates = PRICING[model] || { input: 3.00, output: 15.00 };
  const costUsd = (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
  return {
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    estimated_cost_usd: Math.round(costUsd * 10000) / 10000,
  };
}

export function classifyApiError(err) {
  const status = err.status || err.statusCode;
  const msg = err.message || '';

  if (!process.env.ANTHROPIC_API_KEY) {
    return { code: 'NO_API_KEY', message: 'Anthropic API key is not configured. Add ANTHROPIC_API_KEY to backend/.env' };
  }
  if (status === 401 || msg.includes('invalid x-api-key') || msg.includes('authentication')) {
    return { code: 'INVALID_API_KEY', message: 'Anthropic API key is invalid. Check ANTHROPIC_API_KEY in backend/.env' };
  }
  if (status === 429 || msg.includes('rate_limit')) {
    return { code: 'RATE_LIMITED', message: 'Anthropic API rate limit reached. Wait a moment and try again.' };
  }
  if (status === 502 || status === 503 || status === 529 || msg.includes('overloaded') || msg.includes('Bad Gateway')) {
    return { code: 'API_OVERLOADED', message: 'Claude API is temporarily overloaded. Try again in a few minutes.' };
  }
  if (msg.includes('credit') || msg.includes('billing') || msg.includes('insufficient')) {
    return { code: 'INSUFFICIENT_CREDITS', message: 'Anthropic account has insufficient credits. Add funds at console.anthropic.com/settings/billing' };
  }
  if (msg.includes('too many tokens') || msg.includes('context_length') || msg.includes('max_tokens')) {
    return { code: 'TOKEN_LIMIT', message: 'Document is too large for a single extraction. Try a smaller PDF or fewer pages.' };
  }
  return { code: 'API_ERROR', message: `Claude API error: ${msg.substring(0, 200)}` };
}

export async function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw Object.assign(new Error('Anthropic API key is not configured. Add ANTHROPIC_API_KEY to backend/.env'), { code: 'NO_API_KEY' });
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/**
 * Parse JSON from a Claude response, handling markdown code blocks.
 */
export function parseJsonResponse(text) {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  return JSON.parse(jsonMatch[1].trim());
}
