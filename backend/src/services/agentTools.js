/**
 * AI Agent Tool Definitions
 *
 * Each tool maps to an existing service function. The agent orchestrator
 * calls these directly — no HTTP overhead, no auth bypass needed.
 *
 * All tools are read-only (Phase 1). Write tools (Phase 2) will require
 * user confirmation before execution.
 */

import { getMarketingDashboard, getPositionByCommodity, getCommitmentMatrix,
  getDeliveredUnsettled, getContractFulfillment, computeSellAnalysis,
  getCashFlowProjection } from './marketingService.js';
import { getDashboardData as getInventoryDashboard } from './inventoryService.js';
import { calculateForecast } from './forecastService.js';
import { calculateVariance, calculateEnterpriseVariance } from './varianceService.js';
import { getExecutiveDashboard as getAgronomyDashboard, getProcurementSummary } from './agronomyService.js';
import { getDashboard as getLabourDashboard } from './labourService.js';
import { getDashboard as getTerminalDashboard } from './terminalDashboardService.js';
import { getLogisticsDashboard } from './logisticsDashboardService.js';
import { resolveInventoryFarm } from './resolveInventoryFarm.js';
import { buildFarmContext, contextToTextSummary } from './farmContextService.js';
import prisma from '../config/database.js';

// Helper: resolve enterprise farm for inventory/marketing/logistics queries
async function withEnterpriseFarm(farmId) {
  const resolved = await resolveInventoryFarm(farmId);
  return resolved.farmId;
}

// Current fiscal year helper
function currentFiscalYear() {
  const now = new Date();
  return now.getMonth() >= 10 ? now.getFullYear() + 1 : now.getFullYear();
}

export const tools = [
  // ─── MARKETING ───
  {
    name: 'get_marketing_dashboard',
    description: 'Get marketing overview — KPIs, position grid, commitment matrix, chart data. Use for broad marketing questions.',
    input_schema: {
      type: 'object',
      properties: {},
    },
    handler: async (farmId) => {
      const eFarmId = await withEnterpriseFarm(farmId);
      return await getMarketingDashboard(eFarmId);
    },
  },

  {
    name: 'get_marketing_position',
    description: 'Get grain marketing position by commodity — inventory MT, committed MT, available MT, value. Use when asking about what grain is sold, unsold, or available to sell.',
    input_schema: {
      type: 'object',
      properties: {},
    },
    handler: async (farmId) => {
      const eFarmId = await withEnterpriseFarm(farmId);
      return await getPositionByCommodity(eFarmId);
    },
  },

  {
    name: 'get_commitment_matrix',
    description: 'Get buyer × commodity commitment matrix — what is committed to which buyer by delivery period. Use for "what do we owe?" questions.',
    input_schema: {
      type: 'object',
      properties: {
        crop_year: { type: 'string', description: 'Crop year like "2025-26". Omit for all.' },
      },
    },
    handler: async (farmId, params) => {
      const eFarmId = await withEnterpriseFarm(farmId);
      return await getCommitmentMatrix(eFarmId, params.crop_year || null);
    },
  },

  {
    name: 'get_delivered_unsettled',
    description: 'Get delivered-but-unsettled grain — shipped but not yet paid. Use for "what settlements are we waiting on?" questions.',
    input_schema: {
      type: 'object',
      properties: {
        crop_year: { type: 'string', description: 'Crop year filter. Omit for all.' },
      },
    },
    handler: async (farmId, params) => {
      const eFarmId = await withEnterpriseFarm(farmId);
      return await getDeliveredUnsettled(eFarmId, params.crop_year || null);
    },
  },

  {
    name: 'get_contract_fulfillment',
    description: 'Get contract fulfillment status — delivered vs contracted MT by contract. Use for "are we on track with deliveries?" questions.',
    input_schema: {
      type: 'object',
      properties: {},
    },
    handler: async (farmId) => {
      const eFarmId = await withEnterpriseFarm(farmId);
      return await getContractFulfillment(eFarmId);
    },
  },

  {
    name: 'get_sell_analysis',
    description: 'Run sell decision analysis — factors in storage cost, basis, carry, price targets. Use when the user asks "should I sell?" or wants pricing analysis for a specific commodity.',
    input_schema: {
      type: 'object',
      properties: {
        commodity_id: { type: 'string', description: 'Commodity UUID' },
        qty_mt: { type: 'number', description: 'Quantity in MT to analyze' },
      },
      required: ['commodity_id'],
    },
    handler: async (farmId, params) => {
      const eFarmId = await withEnterpriseFarm(farmId);
      return await computeSellAnalysis(eFarmId, {
        commodity_id: params.commodity_id,
        qty_mt: params.qty_mt,
      });
    },
  },

  {
    name: 'get_cash_flow',
    description: 'Get 6-month cash flow projection — monthly inflows, outflows, net balance. Use for cash position or liquidity questions.',
    input_schema: {
      type: 'object',
      properties: {
        months: { type: 'integer', description: 'Number of months to project. Default 6.' },
      },
    },
    handler: async (farmId, params) => {
      const eFarmId = await withEnterpriseFarm(farmId);
      return await getCashFlowProjection(eFarmId, params.months || 6);
    },
  },

  {
    name: 'get_marketing_contracts',
    description: 'List marketing contracts with optional filters. Use when asking about specific contracts, buyers, or commodity commitments.',
    input_schema: {
      type: 'object',
      properties: {
        commodity: { type: 'string', description: 'Commodity code filter (e.g. CWRS, CNLA, CWAD)' },
        buyer: { type: 'string', description: 'Buyer/counterparty name filter' },
        status: { type: 'string', enum: ['executed', 'in_delivery', 'delivered', 'fulfilled', 'cancelled'], description: 'Contract status filter' },
        crop_year: { type: 'string', description: 'Crop year filter' },
      },
    },
    handler: async (farmId, params) => {
      const eFarmId = await withEnterpriseFarm(farmId);
      const where = { farm_id: eFarmId };
      if (params.status) where.status = params.status;
      if (params.crop_year) where.crop_year = params.crop_year;
      if (params.commodity) {
        where.commodity = { is: { code: { contains: params.commodity, mode: 'insensitive' } } };
      }

      const contracts = await prisma.marketingContract.findMany({
        where,
        include: {
          commodity: { select: { code: true, name: true } },
          counterparty: { select: { name: true, short_code: true } },
        },
        orderBy: { created_at: 'desc' },
        take: 50,
      });

      // Filter by buyer name if provided (counterparty)
      let filtered = contracts;
      if (params.buyer) {
        const buyerLower = params.buyer.toLowerCase();
        filtered = contracts.filter(c =>
          c.counterparty?.name?.toLowerCase().includes(buyerLower) ||
          c.counterparty?.short_code?.toLowerCase().includes(buyerLower)
        );
      }

      return filtered.map(c => ({
        id: c.id,
        contract_number: c.contract_number,
        buyer: c.counterparty?.name,
        commodity: c.commodity?.code,
        commodity_name: c.commodity?.name,
        contracted_mt: c.contracted_mt,
        delivered_mt: c.delivered_mt,
        status: c.status,
        pricing_type: c.pricing_type,
        price_per_bu: c.price_per_bu,
        delivery_start: c.delivery_start,
        delivery_end: c.delivery_end,
        crop_year: c.crop_year,
      }));
    },
  },

  // ─── INVENTORY ───
  {
    name: 'get_inventory_dashboard',
    description: 'Get inventory summary — total MT by commodity, by location, by bin. Use when asking about grain in bins, storage levels, or inventory counts.',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'Location name to filter by (e.g. Lewvan, Hyas, Balcarres)' },
      },
    },
    handler: async (farmId, params) => {
      const eFarmId = await withEnterpriseFarm(farmId);
      let locationId = null;
      if (params.location) {
        const loc = await prisma.inventoryLocation.findFirst({
          where: { farm_id: eFarmId, name: { contains: params.location, mode: 'insensitive' } },
          select: { id: true },
        });
        locationId = loc?.id;
      }
      return await getInventoryDashboard(eFarmId, { locationId });
    },
  },

  // ─── DELIVERY TICKETS ───
  {
    name: 'get_tickets',
    description: 'List delivery tickets with filters. Use when asking about shipments, loads hauled, or ticket status.',
    input_schema: {
      type: 'object',
      properties: {
        commodity: { type: 'string', description: 'Commodity code filter' },
        buyer: { type: 'string', description: 'Buyer/counterparty name' },
        contract_number: { type: 'string', description: 'Contract number to filter by' },
        settled: { type: 'boolean', description: 'Filter by settled status' },
        date_from: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        date_to: { type: 'string', description: 'End date (YYYY-MM-DD)' },
        limit: { type: 'integer', description: 'Max results. Default 50.' },
      },
    },
    handler: async (farmId, params) => {
      const eFarmId = await withEnterpriseFarm(farmId);
      const where = { farm_id: eFarmId };

      if (params.commodity) {
        where.commodity = { contains: params.commodity, mode: 'insensitive' };
      }
      if (params.contract_number) {
        where.contract_number = { contains: params.contract_number, mode: 'insensitive' };
      }
      if (params.settled !== undefined) {
        where.settled = params.settled;
      }
      if (params.date_from || params.date_to) {
        where.delivery_date = {};
        if (params.date_from) where.delivery_date.gte = new Date(params.date_from);
        if (params.date_to) where.delivery_date.lte = new Date(params.date_to);
      }

      const tickets = await prisma.deliveryTicket.findMany({
        where,
        orderBy: { delivery_date: 'desc' },
        take: params.limit || 50,
        select: {
          id: true,
          ticket_number: true,
          delivery_date: true,
          commodity: true,
          gross_weight_kg: true,
          net_weight_kg: true,
          grade: true,
          buyer_name: true,
          contract_number: true,
          settled: true,
          location_name: true,
        },
      });

      // Filter by buyer name if provided
      let filtered = tickets;
      if (params.buyer) {
        const buyerLower = params.buyer.toLowerCase();
        filtered = tickets.filter(t => t.buyer_name?.toLowerCase().includes(buyerLower));
      }

      return {
        tickets: filtered,
        count: filtered.length,
      };
    },
  },

  // ─── SETTLEMENTS ───
  {
    name: 'get_settlements',
    description: 'List settlements from grain buyers. Use when asking about payments received, settlement status, or amounts paid.',
    input_schema: {
      type: 'object',
      properties: {
        buyer: { type: 'string', description: 'Buyer/counterparty name' },
        status: { type: 'string', description: 'Status filter (pending, approved, etc.)' },
        date_from: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        date_to: { type: 'string', description: 'End date (YYYY-MM-DD)' },
        limit: { type: 'integer', description: 'Max results. Default 30.' },
      },
    },
    handler: async (farmId, params) => {
      const eFarmId = await withEnterpriseFarm(farmId);
      const where = { farm_id: eFarmId };

      if (params.status) where.status = params.status;
      if (params.date_from || params.date_to) {
        where.settlement_date = {};
        if (params.date_from) where.settlement_date.gte = new Date(params.date_from);
        if (params.date_to) where.settlement_date.lte = new Date(params.date_to);
      }

      const settlements = await prisma.settlement.findMany({
        where,
        include: {
          counterparty: { select: { name: true, short_code: true } },
          lines: { select: { id: true, net_amount: true, net_weight_kg: true } },
        },
        orderBy: { settlement_date: 'desc' },
        take: params.limit || 30,
      });

      let filtered = settlements;
      if (params.buyer) {
        const buyerLower = params.buyer.toLowerCase();
        filtered = settlements.filter(s =>
          s.counterparty?.name?.toLowerCase().includes(buyerLower) ||
          s.buyer_name?.toLowerCase().includes(buyerLower)
        );
      }

      return filtered.map(s => ({
        id: s.id,
        settlement_number: s.settlement_number,
        buyer: s.counterparty?.name || s.buyer_name,
        settlement_date: s.settlement_date,
        commodity: s.commodity,
        total_mt: s.total_net_weight_kg ? s.total_net_weight_kg / 1000 : null,
        total_amount: s.total_net_amount,
        line_count: s.lines.length,
        status: s.status,
      }));
    },
  },

  // ─── LOGISTICS ───
  {
    name: 'get_logistics_dashboard',
    description: 'Get logistics overview — shipments, shipped vs settled, pending settlements, monthly trends. Use for transport and delivery operations questions.',
    input_schema: {
      type: 'object',
      properties: {
        fiscal_year: { type: 'integer', description: 'Fiscal year. Defaults to current.' },
      },
    },
    handler: async (farmId, params) => {
      const eFarmId = await withEnterpriseFarm(farmId);
      return await getLogisticsDashboard(eFarmId, {
        fiscalYear: params.fiscal_year || currentFiscalYear(),
      });
    },
  },

  // ─── FORECAST / FINANCIAL ───
  {
    name: 'get_forecast',
    description: 'Get full fiscal year forecast — budget vs actual by category with variance. Use for financial performance, forecast, or P&L questions.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer', description: 'Fiscal year (e.g. 2026). Defaults to current.' },
        farm_id_override: { type: 'string', description: 'Specific BU farm ID. Omit for current context.' },
      },
    },
    handler: async (farmId, params) => {
      const targetFarmId = params.farm_id_override || farmId;
      const year = params.year || currentFiscalYear();
      return await calculateForecast(targetFarmId, year);
    },
  },

  {
    name: 'get_variance_report',
    description: 'Get budget vs actual variance analysis by category — plan total, actual total, variance amount and %. Use when asking about budget performance, overages, or underruns.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer', description: 'Fiscal year. Defaults to current.' },
        farm_id_override: { type: 'string', description: 'Specific BU farm ID for BU-level variance. Omit for current context.' },
      },
    },
    handler: async (farmId, params) => {
      const targetFarmId = params.farm_id_override || farmId;
      return await calculateVariance(targetFarmId, params.year || currentFiscalYear());
    },
  },

  {
    name: 'get_enterprise_rollup',
    description: 'Get enterprise-wide financial rollup across all business units — aggregated revenue, expenses, profit. Use for "how is C2 doing overall?" or cross-BU comparison questions.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer', description: 'Fiscal year. Defaults to current.' },
      },
    },
    handler: async (farmId, params) => {
      return await calculateEnterpriseVariance(params.year || currentFiscalYear());
    },
  },

  {
    name: 'get_farm_context_summary',
    description: 'Get a text summary of farm financial context — assumptions, crops, acres, budget status, key totals. Good as a starting point for broad questions about a specific farm.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer', description: 'Fiscal year. Defaults to current.' },
        farm_id_override: { type: 'string', description: 'Specific farm ID. Omit for current context.' },
      },
    },
    handler: async (farmId, params) => {
      const targetFarmId = params.farm_id_override || farmId;
      const context = await buildFarmContext(targetFarmId, params.year || currentFiscalYear());
      return { summary: contextToTextSummary(context) };
    },
  },

  // ─── AGRONOMY ───
  {
    name: 'get_agronomy_dashboard',
    description: 'Get agronomy executive overview — crop allocations, seed/fertilizer/chemical costs per crop, total input costs, margins. Use for crop plan, agronomy, or input cost questions.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer', description: 'Crop year. Defaults to current fiscal year.' },
        farm_id_override: { type: 'string', description: 'Specific BU farm ID. Omit for current context.' },
      },
    },
    handler: async (farmId, params) => {
      const targetFarmId = params.farm_id_override || farmId;
      return await getAgronomyDashboard(targetFarmId, params.year || currentFiscalYear());
    },
  },

  {
    name: 'get_procurement_summary',
    description: 'Get procurement summary — products needed, quantities, costs, which crops use them. Use for "what do we need to buy?" or input purchasing questions.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer', description: 'Crop year. Defaults to current fiscal year.' },
        farm_id_override: { type: 'string', description: 'Specific BU farm ID. Omit for current context.' },
      },
    },
    handler: async (farmId, params) => {
      const targetFarmId = params.farm_id_override || farmId;
      return await getProcurementSummary(targetFarmId, params.year || currentFiscalYear());
    },
  },

  // ─── LABOUR ───
  {
    name: 'get_labour_dashboard',
    description: 'Get labour plan summary — total hours, costs, seasonal allocation, fuel costs, cost per acre. Use for payroll, staffing, or labour budget questions.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer', description: 'Fiscal year. Defaults to current.' },
        farm_id_override: { type: 'string', description: 'Specific BU farm ID. Omit for current context.' },
      },
    },
    handler: async (farmId, params) => {
      const targetFarmId = params.farm_id_override || farmId;
      return await getLabourDashboard(targetFarmId, params.year || currentFiscalYear());
    },
  },

  // ─── TERMINAL (LGX) ───
  {
    name: 'get_terminal_dashboard',
    description: 'Get LGX terminal dashboard — bin status, inbound/outbound volumes, active contracts, recent tickets. Use for LGX-specific questions.',
    input_schema: {
      type: 'object',
      properties: {},
    },
    handler: async (_farmId) => {
      // Terminal uses its own farm record (farm_type='terminal')
      const terminalFarm = await prisma.farm.findFirst({
        where: { farm_type: 'terminal' },
        select: { id: true },
      });
      if (!terminalFarm) return { error: 'No terminal farm configured' };
      return await getTerminalDashboard(terminalFarm.id);
    },
  },

  // ─── MONTHLY RECON ───
  {
    name: 'get_monthly_recon',
    description: 'Get monthly reconciliation — shipped vs settled vs bin count deltas by commodity. Use for inventory discrepancy or reconciliation questions.',
    input_schema: {
      type: 'object',
      properties: {
        fiscal_year: { type: 'integer', description: 'Fiscal year. Defaults to current.' },
      },
    },
    handler: async (farmId, _params) => {
      const eFarmId = await withEnterpriseFarm(farmId);
      // Monthly recon is computed from settlements report
      const settlements = await prisma.settlement.findMany({
        where: {
          farm_id: eFarmId,
          status: { in: ['approved', 'exported'] },
        },
        include: {
          lines: {
            select: { net_weight_kg: true, net_amount: true, commodity: true },
          },
          counterparty: { select: { name: true } },
        },
        orderBy: { settlement_date: 'desc' },
        take: 100,
      });

      // Aggregate by commodity
      const byCommodity = {};
      for (const s of settlements) {
        for (const line of s.lines) {
          const key = line.commodity || s.commodity || 'Unknown';
          if (!byCommodity[key]) byCommodity[key] = { commodity: key, settled_mt: 0, total_amount: 0, settlement_count: 0 };
          byCommodity[key].settled_mt += (line.net_weight_kg || 0) / 1000;
          byCommodity[key].total_amount += line.net_amount || 0;
        }
        const key = s.commodity || 'Unknown';
        if (!byCommodity[key]) byCommodity[key] = { commodity: key, settled_mt: 0, total_amount: 0, settlement_count: 0 };
        byCommodity[key].settlement_count++;
      }

      return {
        summary: Object.values(byCommodity),
        total_settlements: settlements.length,
      };
    },
  },

  // ─── UTILITY: LIST FARMS ───
  {
    name: 'list_farms',
    description: 'List all business unit farms with their names and IDs. Use when you need to look up a specific farm to query its data, or when the user asks about a specific location/BU.',
    input_schema: {
      type: 'object',
      properties: {},
    },
    handler: async (_farmId) => {
      const farms = await prisma.farm.findMany({
        where: { is_enterprise: false },
        select: { id: true, name: true, total_acres: true, farm_type: true },
        orderBy: { name: 'asc' },
      });
      return farms;
    },
  },

  // ─── UTILITY: LIST COMMODITIES ───
  {
    name: 'list_commodities',
    description: 'List all commodities with their codes, names, and IDs. Use when you need commodity IDs for other tool calls like sell analysis.',
    input_schema: {
      type: 'object',
      properties: {},
    },
    handler: async (farmId) => {
      const eFarmId = await withEnterpriseFarm(farmId);
      const commodities = await prisma.commodity.findMany({
        where: { farm_id: eFarmId },
        select: { id: true, code: true, name: true, lbs_per_bu: true },
        orderBy: { name: 'asc' },
      });
      return commodities;
    },
  },
];

// Export tool definitions in Claude API format (without handlers)
export function getToolDefinitions() {
  return tools.map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema,
  }));
}

// Execute a tool by name
export async function executeTool(toolName, farmId, params = {}) {
  const tool = tools.find(t => t.name === toolName);
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);
  return await tool.handler(farmId, params);
}
