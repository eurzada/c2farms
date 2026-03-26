/**
 * AI Agent Orchestrator
 *
 * Implements the agentic loop: user message → Claude with tools →
 * execute tool calls → feed results back → loop until final answer.
 *
 * Supports both synchronous (chat) and streaming (chatStream) modes.
 */

import { getAnthropicClient, MODELS, computeUsage, classifyApiError } from './aiClient.js';
import { getToolDefinitions, executeTool } from './agentTools.js';
import { buildFarmContext, contextToTextSummary } from './farmContextService.js';
import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('agent');

const MAX_TOOL_LOOPS = 8; // Safety limit on tool call iterations
const AGENT_MODEL = MODELS.extraction; // claude-sonnet for accuracy + speed

function buildSystemPrompt(farmContextSummary, farmName, pageContext) {
  return `You are the C2 Farms AI assistant — an expert on grain farming operations in western Canada. You help farm managers, control managers, and executives understand their grain operation by querying live data from the C2 Farms system.

You have access to tools that query inventory, marketing contracts, delivery tickets, settlements, financial forecasts, agronomy plans, labour budgets, and terminal operations.

RULES:
- Always use tools to get current data. Never guess or make up numbers.
- When asked about quantities, always specify the unit (MT, bu, acres, $/acre, $/bu).
- Prices are in CAD $/bu unless stated otherwise. Quantities default to metric tonnes (MT).
- The fiscal year runs Nov–Oct (e.g. FY2026 = Nov 2025 – Oct 2026).
- There are 7 business units: Balcarres, Hyas, Lewvan, Stockholm, Provost, Ridgedale, Ogema.
- LGX is a terminal facility (blending/transloading), not a business unit.
- Be concise. Lead with the answer, then supporting detail.
- If you need multiple pieces of data, call multiple tools in parallel.
- Format currency as CAD with commas (e.g. $142,500). Format MT with commas.
- When comparing BUs, use the farm_id_override parameter to query each one.
- For inventory, marketing, logistics, and settlement questions, data is enterprise-wide (all locations).
- For forecast, agronomy, and labour questions, data is per-BU — ask which BU if ambiguous.

FARM CONTEXT:
Farm: ${farmName}
${farmContextSummary}

${pageContext ? `USER CONTEXT: The user is currently viewing the ${pageContext} page.` : ''}

Today: ${new Date().toISOString().split('T')[0]}`;
}

/**
 * Synchronous chat — returns full response after all tool calls complete.
 */
export async function chat(farmId, userId, conversationId, userMessage, options = {}) {
  const { pageContext, fiscalYear } = options;
  const client = await getAnthropicClient();

  // 1. Load or create conversation
  let conversation;
  if (conversationId) {
    conversation = await prisma.aiConversation.findFirst({
      where: { id: conversationId, farm_id: farmId, user_id: userId },
      include: { messages: { orderBy: { created_at: 'asc' }, take: 50 } },
    });
  }
  if (!conversation) {
    conversation = await prisma.aiConversation.create({
      data: { farm_id: farmId, user_id: userId },
      include: { messages: true },
    });
  }

  // 2. Save user message
  await prisma.aiMessage.create({
    data: {
      conversation_id: conversation.id,
      role: 'user',
      content: userMessage,
    },
  });

  // 3. Build system prompt with farm context
  const fy = fiscalYear || (new Date().getMonth() >= 10 ? new Date().getFullYear() + 1 : new Date().getFullYear());
  let farmName = 'C2 Farms';
  let contextSummary = '';
  try {
    const farm = await prisma.farm.findUnique({ where: { id: farmId }, select: { name: true } });
    farmName = farm?.name || farmName;
    const context = await buildFarmContext(farmId, fy, { includeGlDetail: false });
    if (context) contextSummary = contextToTextSummary(context);
  } catch (err) {
    logger.warn('Failed to build farm context for agent', err.message);
  }

  const systemPrompt = buildSystemPrompt(contextSummary, farmName, pageContext);

  // 4. Build message history
  const messages = [];
  for (const m of conversation.messages) {
    if (m.role === 'user' || m.role === 'assistant') {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: 'user', content: userMessage });

  // 5. Tool definitions
  const claudeTools = getToolDefinitions();

  // 6. Agent loop
  let loopMessages = [...messages];
  let toolsUsed = [];
  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  let response;

  for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
    try {
      response = await client.messages.create({
        model: AGENT_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: loopMessages,
        tools: claudeTools,
      });
    } catch (err) {
      const apiErr = classifyApiError(err);
      logger.error('Agent Claude API error', apiErr);
      throw new Error(apiErr.message, { cause: err });
    }

    // Track token usage
    if (response.usage) {
      totalUsage.input_tokens += response.usage.input_tokens || 0;
      totalUsage.output_tokens += response.usage.output_tokens || 0;
    }

    // Check for tool calls
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) break;

    // Execute tool calls in parallel
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const startTime = Date.now();
        try {
          logger.info(`Agent tool: ${block.name}`, { input: block.input });
          const result = await executeTool(block.name, farmId, block.input);
          const duration = Date.now() - startTime;
          toolsUsed.push({ name: block.name, input: block.input, duration_ms: duration });
          // Truncate large results to avoid token bloat
          const resultStr = JSON.stringify(result);
          const truncated = resultStr.length > 15000
            ? resultStr.slice(0, 15000) + '... [truncated, ' + resultStr.length + ' chars total]'
            : resultStr;
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: truncated,
          };
        } catch (err) {
          logger.error(`Agent tool error: ${block.name}`, err.message);
          toolsUsed.push({ name: block.name, input: block.input, error: err.message });
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ error: err.message }),
            is_error: true,
          };
        }
      })
    );

    // Append to conversation and continue
    loopMessages.push({ role: 'assistant', content: response.content });
    loopMessages.push({ role: 'user', content: toolResults });
  }

  // 7. Extract final text
  const assistantText = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  // 8. Save assistant message
  const usage = computeUsage(AGENT_MODEL, { usage: totalUsage });
  await prisma.aiMessage.create({
    data: {
      conversation_id: conversation.id,
      role: 'assistant',
      content: assistantText,
      metadata_json: {
        model: AGENT_MODEL,
        tools_used: toolsUsed,
        usage,
      },
    },
  });

  // 9. Auto-title on first exchange
  if (conversation.messages.length <= 1) {
    const title = await generateTitle(client, userMessage, assistantText);
    await prisma.aiConversation.update({
      where: { id: conversation.id },
      data: { title, updated_at: new Date() },
    });
  } else {
    await prisma.aiConversation.update({
      where: { id: conversation.id },
      data: { updated_at: new Date() },
    });
  }

  return {
    conversation_id: conversation.id,
    response: assistantText,
    tools_used: toolsUsed,
    usage,
  };
}

/**
 * Streaming chat — sends SSE events as tool calls and text chunks arrive.
 */
export async function chatStream(farmId, userId, conversationId, userMessage, callbacks, options = {}) {
  const { onToolCall, onText, onDone, onError } = callbacks;
  const { pageContext, fiscalYear } = options;
  const client = await getAnthropicClient();

  // 1. Load or create conversation
  let conversation;
  if (conversationId) {
    conversation = await prisma.aiConversation.findFirst({
      where: { id: conversationId, farm_id: farmId, user_id: userId },
      include: { messages: { orderBy: { created_at: 'asc' }, take: 50 } },
    });
  }
  if (!conversation) {
    conversation = await prisma.aiConversation.create({
      data: { farm_id: farmId, user_id: userId },
      include: { messages: true },
    });
  }

  // 2. Save user message
  await prisma.aiMessage.create({
    data: {
      conversation_id: conversation.id,
      role: 'user',
      content: userMessage,
    },
  });

  // 3. Build context
  const fy = fiscalYear || (new Date().getMonth() >= 10 ? new Date().getFullYear() + 1 : new Date().getFullYear());
  let farmName = 'C2 Farms';
  let contextSummary = '';
  try {
    const farm = await prisma.farm.findUnique({ where: { id: farmId }, select: { name: true } });
    farmName = farm?.name || farmName;
    const context = await buildFarmContext(farmId, fy, { includeGlDetail: false });
    if (context) contextSummary = contextToTextSummary(context);
  } catch (err) {
    logger.warn('Failed to build farm context for agent stream', err.message);
  }

  const systemPrompt = buildSystemPrompt(contextSummary, farmName, pageContext);

  // 4. Message history
  const messages = [];
  for (const m of conversation.messages) {
    if (m.role === 'user' || m.role === 'assistant') {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: 'user', content: userMessage });

  const claudeTools = getToolDefinitions();
  let loopMessages = [...messages];
  let toolsUsed = [];
  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  let finalText = '';

  try {
    for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
      // Use streaming for the final response, non-streaming for tool loops
      const response = await client.messages.create({
        model: AGENT_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: loopMessages,
        tools: claudeTools,
      });

      if (response.usage) {
        totalUsage.input_tokens += response.usage.input_tokens || 0;
        totalUsage.output_tokens += response.usage.output_tokens || 0;
      }

      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const textBlocks = response.content.filter(b => b.type === 'text');

      // If no tool calls, stream the text and we're done
      if (toolUseBlocks.length === 0) {
        for (const block of textBlocks) {
          finalText += block.text;
          onText(block.text);
        }
        break;
      }

      // Notify about tool calls
      for (const block of toolUseBlocks) {
        onToolCall(block.name, block.input);
      }

      // Execute tools
      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => {
          const startTime = Date.now();
          try {
            const result = await executeTool(block.name, farmId, block.input);
            const duration = Date.now() - startTime;
            toolsUsed.push({ name: block.name, input: block.input, duration_ms: duration });
            const resultStr = JSON.stringify(result);
            const truncated = resultStr.length > 15000
              ? resultStr.slice(0, 15000) + '... [truncated]'
              : resultStr;
            return { type: 'tool_result', tool_use_id: block.id, content: truncated };
          } catch (err) {
            toolsUsed.push({ name: block.name, input: block.input, error: err.message });
            return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: err.message }), is_error: true };
          }
        })
      );

      loopMessages.push({ role: 'assistant', content: response.content });
      loopMessages.push({ role: 'user', content: toolResults });
    }

    // Save assistant response
    const usage = computeUsage(AGENT_MODEL, { usage: totalUsage });
    await prisma.aiMessage.create({
      data: {
        conversation_id: conversation.id,
        role: 'assistant',
        content: finalText,
        metadata_json: { model: AGENT_MODEL, tools_used: toolsUsed, usage },
      },
    });

    // Auto-title
    if (conversation.messages.length <= 1) {
      const title = await generateTitle(client, userMessage, finalText);
      await prisma.aiConversation.update({
        where: { id: conversation.id },
        data: { title, updated_at: new Date() },
      });
    } else {
      await prisma.aiConversation.update({
        where: { id: conversation.id },
        data: { updated_at: new Date() },
      });
    }

    onDone({
      conversation_id: conversation.id,
      tools_used: toolsUsed,
      usage,
    });
  } catch (err) {
    const apiErr = classifyApiError(err);
    logger.error('Agent stream error', apiErr);
    if (onError) onError(apiErr);
    else onDone({ conversation_id: conversation.id, error: apiErr.message });
  }
}

/**
 * Generate a short conversation title using Haiku (cheap + fast).
 */
async function generateTitle(client, userMessage, assistantResponse) {
  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 30,
      messages: [{
        role: 'user',
        content: `Generate a 3-6 word title for this conversation. Return ONLY the title, no quotes or punctuation.\n\nUser: ${userMessage.slice(0, 200)}\nAssistant: ${assistantResponse.slice(0, 200)}`,
      }],
    });
    const title = resp.content[0]?.text?.trim();
    return title || userMessage.slice(0, 80);
  } catch {
    return userMessage.slice(0, 80);
  }
}

/**
 * Delete a conversation and all its messages.
 */
export async function deleteConversation(conversationId, userId) {
  const conversation = await prisma.aiConversation.findFirst({
    where: { id: conversationId, user_id: userId },
  });
  if (!conversation) throw new Error('Conversation not found');

  await prisma.aiMessage.deleteMany({ where: { conversation_id: conversationId } });
  await prisma.aiConversation.delete({ where: { id: conversationId } });
  return { deleted: true };
}
