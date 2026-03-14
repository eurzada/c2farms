import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';
import { fiscalToCalendar } from '../utils/fiscalYear.js';
import ExcelJS from 'exceljs';

const log = createLogger('farm-unit-report');

function round2(v) { return Math.round((v || 0) * 100) / 100; }

/**
 * Settlement by Farm Unit report.
 * Joins approved settlement lines → matched delivery tickets → inventory location
 * to break down settled MT and $ by farm unit (location), commodity, and buyer.
 */
export async function getSettlementsByFarmUnit(farmId, fiscalYear, { startDate, endDate } = {}) {
  const fy = parseInt(fiscalYear, 10);
  const fyStart = startDate ? new Date(startDate) : fiscalToCalendar(fy, 'Nov');
  const fyEnd = endDate ? new Date(new Date(endDate).getTime() + 86400000) : new Date(fy, 10, 1);

  log.info('Settlement by Farm Unit report', { farmId, fiscalYear: fy });

  // All approved settlement lines with matched tickets in this FY
  const lines = await prisma.settlementLine.findMany({
    where: {
      settlement: {
        farm_id: farmId,
        status: 'approved',
        settlement_date: { gte: fyStart, lt: fyEnd },
      },
    },
    select: {
      net_weight_mt: true,
      gross_weight_mt: true,
      line_net: true,
      line_gross: true,
      price_per_mt: true,
      delivery_date: true,
      match_status: true,
      delivery_ticket: {
        select: {
          ticket_number: true,
          net_weight_mt: true,
          delivery_date: true,
          location: { select: { id: true, name: true } },
          commodity: { select: { id: true, name: true, code: true } },
          buyer_name: true,
        },
      },
      settlement: {
        select: {
          settlement_number: true,
          settlement_date: true,
          counterparty: { select: { name: true, short_code: true } },
          marketing_contract: {
            select: {
              contract_number: true,
              commodity: { select: { name: true, code: true } },
            },
          },
        },
      },
    },
  });

  // Also get unmatched/unsettled tickets for the "Shipped, Not Settled" section
  const unmatched = await prisma.deliveryTicket.findMany({
    where: {
      farm_id: farmId,
      delivery_date: { gte: fyStart, lt: fyEnd },
      settled: false,
    },
    select: {
      ticket_number: true,
      net_weight_mt: true,
      delivery_date: true,
      buyer_name: true,
      location: { select: { id: true, name: true } },
      commodity: { select: { id: true, name: true, code: true } },
    },
  });

  // Aggregate settled lines by location + commodity + buyer
  const settledMap = {};
  let totalSettledMt = 0;
  let totalSettledAmount = 0;
  let totalLines = 0;
  let unmatchedLines = 0;

  for (const line of lines) {
    const ticket = line.delivery_ticket;
    const locationName = ticket?.location?.name || 'Unknown Location';
    const commodityName = line.settlement.marketing_contract?.commodity?.name
      || ticket?.commodity?.name || 'Unknown';
    const buyer = line.settlement.counterparty?.name || ticket?.buyer_name || 'Unknown';
    const contractNum = line.settlement.marketing_contract?.contract_number || '';

    if (!ticket) {
      unmatchedLines++;
      continue;
    }

    const key = `${locationName}|${commodityName}|${buyer}`;
    if (!settledMap[key]) {
      settledMap[key] = {
        location: locationName,
        commodity: commodityName,
        buyer,
        contracts: new Set(),
        settled_mt: 0,
        settled_amount: 0,
        ticket_count: 0,
        line_count: 0,
        avg_price_per_mt: 0,
        _price_sum: 0,
        _price_count: 0,
      };
    }

    const row = settledMap[key];
    const mt = line.net_weight_mt || line.gross_weight_mt || 0;
    const amount = line.line_net || line.line_gross || 0;

    row.settled_mt += mt;
    row.settled_amount += amount;
    row.line_count++;
    if (contractNum) row.contracts.add(contractNum);
    if (line.price_per_mt) {
      row._price_sum += line.price_per_mt;
      row._price_count++;
    }

    totalSettledMt += mt;
    totalSettledAmount += amount;
    totalLines++;
  }

  // Aggregate unsettled tickets by location + commodity
  const unshippedMap = {};
  let totalUnshippedMt = 0;
  let totalUnshippedTickets = 0;

  for (const t of unmatched) {
    const locationName = t.location?.name || 'Unknown Location';
    const commodityName = t.commodity?.name || 'Unknown';
    const key = `${locationName}|${commodityName}`;
    if (!unshippedMap[key]) {
      unshippedMap[key] = {
        location: locationName,
        commodity: commodityName,
        shipped_mt: 0,
        ticket_count: 0,
      };
    }
    unshippedMap[key].shipped_mt += t.net_weight_mt || 0;
    unshippedMap[key].ticket_count++;
    totalUnshippedMt += t.net_weight_mt || 0;
    totalUnshippedTickets++;
  }

  // Build settled detail rows
  const settledRows = Object.values(settledMap).map(r => ({
    location: r.location,
    commodity: r.commodity,
    buyer: r.buyer,
    contracts: [...r.contracts].sort(),
    settled_mt: round2(r.settled_mt),
    settled_amount: round2(r.settled_amount),
    line_count: r.line_count,
    avg_price_per_mt: r._price_count > 0 ? round2(r._price_sum / r._price_count) : null,
  }));
  settledRows.sort((a, b) => a.location.localeCompare(b.location) || a.commodity.localeCompare(b.commodity) || a.buyer.localeCompare(b.buyer));

  // Build unsettled rows
  const unsettledRows = Object.values(unshippedMap).map(r => ({
    location: r.location,
    commodity: r.commodity,
    shipped_mt: round2(r.shipped_mt),
    ticket_count: r.ticket_count,
  }));
  unsettledRows.sort((a, b) => a.location.localeCompare(b.location) || a.commodity.localeCompare(b.commodity));

  // Location summary (rolled up from settled)
  const locationSummary = {};
  for (const r of settledRows) {
    if (!locationSummary[r.location]) {
      locationSummary[r.location] = { location: r.location, settled_mt: 0, settled_amount: 0, commodities: new Set(), buyers: new Set(), line_count: 0 };
    }
    const ls = locationSummary[r.location];
    ls.settled_mt += r.settled_mt;
    ls.settled_amount += r.settled_amount;
    ls.line_count += r.line_count;
    ls.commodities.add(r.commodity);
    ls.buyers.add(r.buyer);
  }
  const locationRows = Object.values(locationSummary).map(r => ({
    location: r.location,
    settled_mt: round2(r.settled_mt),
    settled_amount: round2(r.settled_amount),
    line_count: r.line_count,
    commodities: [...r.commodities].sort(),
    buyers: [...r.buyers].sort(),
  }));
  locationRows.sort((a, b) => b.settled_mt - a.settled_mt);

  const periodLabel = startDate || endDate
    ? `${fyStart.toLocaleDateString('en-CA')} – ${new Date(fyEnd.getTime() - 86400000).toLocaleDateString('en-CA')}`
    : `Nov ${fy - 1} – Oct ${fy}`;

  return {
    fiscal_year: fy,
    period: periodLabel,
    summary: {
      total_settled_mt: round2(totalSettledMt),
      total_settled_amount: round2(totalSettledAmount),
      total_lines: totalLines,
      unmatched_lines: unmatchedLines,
      total_unsettled_mt: round2(totalUnshippedMt),
      total_unsettled_tickets: totalUnshippedTickets,
      locations: locationRows.length,
      commodities: [...new Set(settledRows.map(r => r.commodity))].sort(),
      buyers: [...new Set(settledRows.map(r => r.buyer))].sort(),
    },
    by_location: locationRows,
    detail: settledRows,
    unsettled: unsettledRows,
  };
}

/**
 * Generate Excel workbook for Settlement by Farm Unit report.
 */
export async function generateFarmUnitExcel(farmId, fiscalYear, opts = {}) {
  const data = await getSettlementsByFarmUnit(farmId, fiscalYear, opts);
  const wb = new ExcelJS.Workbook();

  // --- Summary sheet ---
  const summarySheet = wb.addWorksheet('Summary by Location');
  summarySheet.columns = [
    { header: 'Location', key: 'location', width: 20 },
    { header: 'Settled MT', key: 'settled_mt', width: 14 },
    { header: 'Settled $', key: 'settled_amount', width: 16 },
    { header: 'Lines', key: 'line_count', width: 8 },
    { header: 'Commodities', key: 'commodities', width: 30 },
    { header: 'Buyers', key: 'buyers', width: 30 },
  ];
  summarySheet.getRow(1).font = { bold: true };
  for (const r of data.by_location) {
    summarySheet.addRow({
      ...r,
      commodities: r.commodities.join(', '),
      buyers: r.buyers.join(', '),
    });
  }
  // Totals row
  summarySheet.addRow({});
  summarySheet.addRow({
    location: 'TOTAL',
    settled_mt: data.summary.total_settled_mt,
    settled_amount: data.summary.total_settled_amount,
    line_count: data.summary.total_lines,
  }).font = { bold: true };

  // Format currency columns
  summarySheet.getColumn('settled_amount').numFmt = '$#,##0.00';
  summarySheet.getColumn('settled_mt').numFmt = '#,##0.00';

  // --- Detail sheet ---
  const detailSheet = wb.addWorksheet('Detail');
  detailSheet.columns = [
    { header: 'Location', key: 'location', width: 18 },
    { header: 'Commodity', key: 'commodity', width: 16 },
    { header: 'Buyer', key: 'buyer', width: 20 },
    { header: 'Contract(s)', key: 'contracts', width: 22 },
    { header: 'Settled MT', key: 'settled_mt', width: 14 },
    { header: 'Settled $', key: 'settled_amount', width: 16 },
    { header: 'Avg $/MT', key: 'avg_price_per_mt', width: 12 },
    { header: 'Lines', key: 'line_count', width: 8 },
  ];
  detailSheet.getRow(1).font = { bold: true };
  for (const r of data.detail) {
    detailSheet.addRow({
      ...r,
      contracts: r.contracts.join(', '),
    });
  }
  detailSheet.getColumn('settled_amount').numFmt = '$#,##0.00';
  detailSheet.getColumn('avg_price_per_mt').numFmt = '$#,##0.00';
  detailSheet.getColumn('settled_mt').numFmt = '#,##0.00';

  // --- Unsettled sheet ---
  if (data.unsettled.length > 0) {
    const unsettledSheet = wb.addWorksheet('Shipped Not Settled');
    unsettledSheet.columns = [
      { header: 'Location', key: 'location', width: 18 },
      { header: 'Commodity', key: 'commodity', width: 16 },
      { header: 'Shipped MT', key: 'shipped_mt', width: 14 },
      { header: 'Tickets', key: 'ticket_count', width: 10 },
    ];
    unsettledSheet.getRow(1).font = { bold: true };
    for (const r of data.unsettled) {
      unsettledSheet.addRow(r);
    }
    unsettledSheet.getColumn('shipped_mt').numFmt = '#,##0.00';
  }

  return wb;
}
