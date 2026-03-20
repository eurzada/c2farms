import prisma from '../config/database.js';
import { parseCsv } from './ticketImportService.js';
import ExcelJS from 'exceljs';
import createLogger from '../utils/logger.js';

const logger = createLogger('elevator-ticket-import');

/**
 * Auto-detect header columns from buyer portal CSV/Excel exports.
 * Buyer portals (Cargill, Richardson, G3, etc.) use varied column names.
 */
function findHeader(headers, ...candidates) {
  for (const candidate of candidates) {
    const exact = headers.find(h => h === candidate);
    if (exact) return exact;
    const lower = headers.find(h => h.toLowerCase() === candidate.toLowerCase());
    if (lower) return lower;
  }
  for (const candidate of candidates) {
    const partial = headers.find(h => h.toLowerCase().includes(candidate.toLowerCase()));
    if (partial) return partial;
  }
  return null;
}

/**
 * Detect weight unit from values — values > 100 are likely kg, need conversion to MT.
 * Returns 'mt' | 'kg' | 'lbs'
 */
function detectWeightUnit(values) {
  if (values.length === 0) return 'mt';
  const median = [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  if (median > 5000) return 'lbs'; // very large — probably pounds
  if (median > 100) return 'kg';   // moderate — probably kg
  return 'mt';                      // small — already MT
}

function convertToMt(value, unit) {
  if (!value || isNaN(value)) return 0;
  switch (unit) {
    case 'kg': return value / 1000;
    case 'lbs': return value * 0.000453592;
    default: return value;
  }
}

/**
 * Parse an Excel file buffer into row objects (same shape as CSV parse output).
 */
async function parseExcel(fileBuffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) return [];

  const headerRow = sheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = (cell.value || '').toString().trim();
  });

  const rows = [];
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const obj = {};
    let hasData = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber - 1];
      if (key) {
        let val = cell.value;
        if (val && typeof val === 'object' && val.result !== undefined) val = val.result;
        if (val instanceof Date) val = val.toISOString().split('T')[0];
        obj[key] = val != null ? val.toString().trim() : '';
        if (obj[key]) hasData = true;
      }
    });
    if (hasData) rows.push(obj);
  }
  return rows;
}

/**
 * Preview elevator ticket import (dry run).
 * Returns { tickets, errors, summary, column_mappings, detected_unit }
 */
export async function previewElevatorTicketImport(farmId, countPeriodId, fileBuffer, fileType) {
  // Parse file
  let rows;
  if (fileType === 'xlsx' || fileType === 'excel') {
    rows = await parseExcel(fileBuffer);
  } else {
    const csvText = fileBuffer.toString('utf-8');
    rows = parseCsv(csvText);
  }

  const emptySummary = { total: 0, new_count: 0, duplicate_count: 0 };
  if (rows.length === 0) {
    return { tickets: [], errors: ['No data rows found — the file may only contain a header row.'], summary: emptySummary, column_mappings: {}, detected_unit: 'mt' };
  }

  const headers = Object.keys(rows[0]);

  // Auto-detect columns — candidates cover Cargill, Bunge, G3, LDC, Richardson, and standardized CSV formats
  const colMap = {
    ticket_number: findHeader(headers, 'Ticket', 'Ticket #', 'Ticket No', 'Del Ticket', 'Delivery Ticket', 'Ticket Number', 'Receipt', 'Scale Ticket #', 'Scale Ticket', 'Ticket Id', 'Load #', 'Weigh Ticket #', 'ticket_number'),
    delivery_date: findHeader(headers, 'Date', 'Delivery Date', 'Del Date', 'Ship Date', 'Shipment Date', 'Unload Date', 'delivery_date'),
    commodity: findHeader(headers, 'Commodity', 'Crop', 'Product', 'Grain', 'commodity_raw', 'commodity'),
    buyer: findHeader(headers, 'Buyer', 'Company', 'Elevator', 'Facility', 'Counterparty', 'Primary Account Name', 'buyer'),
    net_weight: findHeader(headers, 'Net Weight', 'Net Wt', 'Net', 'Net MT', 'Net Kg', 'Net Lbs', 'Clean Weight', 'Net Quantity', 'Net Quantity (MT)', 'Est Net Dry Weight', 'Adjusted Net Delivery', 'Adjusted Net', 'net_weight_mt'),
    gross_weight: findHeader(headers, 'Gross Weight', 'Gross Wt', 'Gross', 'Gross MT', 'Grain Unloaded', 'gross_weight_mt'),
    tare_weight: findHeader(headers, 'Tare Weight', 'Tare Wt', 'Tare', 'Tare MT', 'tare_weight_mt'),
    grade: findHeader(headers, 'Grade', 'Official Grade', 'Grading', 'Spec', 'QG', 'grade'),
    protein: findHeader(headers, 'Protein', 'Protein %', 'Pro', 'protein_pct'),
    moisture: findHeader(headers, 'Moisture', 'Moisture %', 'Moist', 'Mst', 'Mst %', 'moisture_pct'),
    dockage: findHeader(headers, 'Dockage', 'Dockage %', 'Dock', 'Dkg', 'Dkg %', 'TDK', 'Dockage Percent', 'dockage_pct'),
    contract_number: findHeader(headers, 'Contract', 'Contract #', 'Contract No', 'Contract Number', 'Nomination Number', 'Booking', 'contract_number'),
    destination: findHeader(headers, 'Destination', 'Dest', 'Delivery Point', 'Location', 'Delivered Location', 'destination'),
  };

  // Detect weight unit from net weight values
  const netWeights = rows
    .map(r => parseFloat(r[colMap.net_weight]))
    .filter(v => !isNaN(v) && v > 0);
  const detectedUnit = detectWeightUnit(netWeights);

  // Load lookup data
  const [commodities, counterparties, existingTickets, commodityAliases, counterpartyAliases] = await Promise.all([
    prisma.commodity.findMany({ where: { farm_id: farmId } }),
    prisma.counterparty.findMany({ where: { farm_id: farmId } }),
    prisma.elevatorTicket.findMany({
      where: { farm_id: farmId, count_period_id: countPeriodId },
      select: { ticket_number: true },
    }),
    prisma.commodityAlias.findMany({ where: { farm_id: farmId } }),
    prisma.counterpartyAlias.findMany({ where: { farm_id: farmId } }),
  ]);

  // Build alias maps
  const commodityAliasMap = {};
  for (const a of commodityAliases) commodityAliasMap[a.alias.toLowerCase()] = a.commodity_id;
  const counterpartyAliasMap = {};
  for (const a of counterpartyAliases) counterpartyAliasMap[a.alias.toLowerCase()] = a.counterparty_id;

  const existingTicketSet = new Set(existingTickets.map(t => t.ticket_number));

  const tickets = [];
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const ticketNumber = (row[colMap.ticket_number] || '').toString().trim();
    if (!ticketNumber) {
      errors.push(`Row ${rowNum}: Missing ticket number`);
      continue;
    }

    // Parse net weight and convert
    const rawNet = parseFloat(row[colMap.net_weight]) || 0;
    const netWeightMt = convertToMt(rawNet, detectedUnit);
    const rawGross = parseFloat(row[colMap.gross_weight]) || null;
    const grossWeightMt = rawGross ? convertToMt(rawGross, detectedUnit) : null;
    const rawTare = parseFloat(row[colMap.tare_weight]) || null;
    const tareWeightMt = rawTare ? convertToMt(rawTare, detectedUnit) : null;

    // Parse date — handles ISO, MM/DD/YYYY, Excel serial numbers, JS Date strings
    let deliveryDate = null;
    const dateVal = row[colMap.delivery_date];
    if (dateVal) {
      const dateStr = String(dateVal).trim();
      // Excel serial number (e.g., 46072.749...)
      const numVal = parseFloat(dateStr);
      if (!isNaN(numVal) && numVal > 40000 && numVal < 50000) {
        const d = new Date((numVal - 25569) * 86400 * 1000);
        if (!isNaN(d)) deliveryDate = d.toISOString().slice(0, 10);
      }
      if (!deliveryDate) {
        // Try YYYY-MM-DD first
        const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) {
          deliveryDate = dateStr.substring(0, 10);
        } else {
          // Try MM/DD/YYYY or MM/DD/YY
          const usMatch = dateStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
          if (usMatch) {
            let [, month, day, year] = usMatch;
            if (year.length === 2) year = (parseInt(year) > 50 ? '19' : '20') + year;
            deliveryDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          } else if (dateStr.match(/^\w{3}\s\w{3}\s/)) {
            // JS Date string: "Mon Feb 02 2026 00:00:00 GMT..."
            const d = new Date(dateStr);
            if (!isNaN(d)) deliveryDate = d.toISOString().slice(0, 10);
          }
        }
      }
    }

    const commodityRaw = (row[colMap.commodity] || '').trim();
    const buyerName = (row[colMap.buyer] || '').trim();

    // Match commodity (alias → exact → fuzzy)
    let matchedCommodity = null;
    if (commodityRaw) {
      const aliasTarget = commodityAliasMap[commodityRaw.toLowerCase()];
      if (aliasTarget) {
        matchedCommodity = commodities.find(c => c.id === aliasTarget);
      }
      if (!matchedCommodity) {
        matchedCommodity = commodities.find(c =>
          c.name.toLowerCase() === commodityRaw.toLowerCase() ||
          c.code.toLowerCase() === commodityRaw.toLowerCase()
        ) || commodities.find(c =>
          c.name.toLowerCase().includes(commodityRaw.toLowerCase()) ||
          commodityRaw.toLowerCase().includes(c.name.toLowerCase())
        );
      }
    }

    // Match counterparty (alias → exact → fuzzy)
    let matchedCounterparty = null;
    if (buyerName) {
      const aliasTarget = counterpartyAliasMap[buyerName.toLowerCase()];
      if (aliasTarget) {
        matchedCounterparty = counterparties.find(cp => cp.id === aliasTarget);
      }
      if (!matchedCounterparty) {
        matchedCounterparty = counterparties.find(cp =>
          cp.name.toLowerCase() === buyerName.toLowerCase() ||
          cp.short_code.toLowerCase() === buyerName.toLowerCase()
        ) || counterparties.find(cp =>
          cp.name.toLowerCase().includes(buyerName.toLowerCase()) ||
          buyerName.toLowerCase().includes(cp.name.toLowerCase())
        );
      }
    }

    const isDuplicate = existingTicketSet.has(ticketNumber);

    tickets.push({
      row_number: rowNum,
      ticket_number: ticketNumber,
      delivery_date: deliveryDate,
      commodity_raw: commodityRaw || null,
      buyer_name: buyerName || null,
      net_weight_mt: Math.round(netWeightMt * 1000) / 1000,
      gross_weight_mt: grossWeightMt ? Math.round(grossWeightMt * 1000) / 1000 : null,
      tare_weight_mt: tareWeightMt ? Math.round(tareWeightMt * 1000) / 1000 : null,
      grade: (row[colMap.grade] || '').trim() || null,
      protein_pct: parseFloat(row[colMap.protein]) || null,
      moisture_pct: parseFloat(row[colMap.moisture]) || null,
      dockage_pct: parseFloat(row[colMap.dockage]) || null,
      contract_number: (row[colMap.contract_number] || '').trim() || null,
      destination: (row[colMap.destination] || '').trim() || null,
      // Match results
      commodity_id: matchedCommodity?.id || null,
      commodity_match: matchedCommodity?.name || null,
      counterparty_id: matchedCounterparty?.id || null,
      counterparty_match: matchedCounterparty?.name || null,
      is_duplicate: isDuplicate,
      status: isDuplicate ? 'duplicate' : 'new',
    });
  }

  // Normalize percentages — if all protein or moisture values are < 1, they're decimals (e.g., 0.13 = 13%)
  const proteinVals = tickets.map(t => t.protein_pct).filter(v => v != null && v > 0);
  if (proteinVals.length > 0 && proteinVals.every(v => v < 1)) {
    tickets.forEach(t => { if (t.protein_pct) t.protein_pct = Math.round(t.protein_pct * 1000) / 10; });
  }
  const moistureVals = tickets.map(t => t.moisture_pct).filter(v => v != null && v > 0);
  if (moistureVals.length > 0 && moistureVals.every(v => v < 1)) {
    tickets.forEach(t => { if (t.moisture_pct) t.moisture_pct = Math.round(t.moisture_pct * 1000) / 10; });
  }

  return {
    tickets,
    errors,
    summary: {
      total: tickets.length,
      new_count: tickets.filter(t => t.status === 'new').length,
      duplicate_count: tickets.filter(t => t.status === 'duplicate').length,
    },
    column_mappings: colMap,
    detected_unit: detectedUnit,
  };
}

/**
 * Commit elevator tickets to the database.
 * Replaces all elevator tickets for the given farm+period, then inserts new records.
 */
export async function commitElevatorTicketImport(farmId, countPeriodId, tickets, resolutions, sourceFile) {
  const results = { created: 0, deleted: 0, errors: [] };

  // Save alias mappings
  if (resolutions) {
    for (const [alias, res] of Object.entries(resolutions.commodityMap || {})) {
      const targetId = res.action === 'map' ? res.targetId : res.createdId;
      if (targetId && alias) {
        try {
          await prisma.commodityAlias.upsert({
            where: { farm_id_alias: { farm_id: farmId, alias } },
            update: { commodity_id: targetId },
            create: { farm_id: farmId, alias, commodity_id: targetId, source: 'import' },
          });
        } catch { /* duplicate or missing — skip */ }
      }
    }
    for (const [alias, res] of Object.entries(resolutions.counterpartyMap || {})) {
      const targetId = res.action === 'map' ? res.targetId : res.createdId;
      if (targetId && alias) {
        try {
          await prisma.counterpartyAlias.upsert({
            where: { farm_id_alias: { farm_id: farmId, alias } },
            update: { counterparty_id: targetId },
            create: { farm_id: farmId, alias, counterparty_id: targetId, source: 'import' },
          });
        } catch { /* duplicate or missing — skip */ }
      }
    }
  }

  // Transaction: delete existing elevator tickets for this period, then insert new
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.elevatorTicket.deleteMany({
      where: { farm_id: farmId, count_period_id: countPeriodId },
    });
    results.deleted = deleted.count;

    const sourceSystem = sourceFile?.endsWith('.xlsx') ? 'portal_excel' : 'portal_csv';

    for (const t of tickets) {
      try {
        await tx.elevatorTicket.create({
          data: {
            farm_id: farmId,
            count_period_id: countPeriodId,
            ticket_number: t.ticket_number,
            delivery_date: t.delivery_date ? new Date(t.delivery_date + 'T12:00:00Z') : null,
            commodity_raw: t.commodity_raw || null,
            buyer_name: t.buyer_name || null,
            net_weight_mt: t.net_weight_mt || 0,
            gross_weight_mt: t.gross_weight_mt || null,
            tare_weight_mt: t.tare_weight_mt || null,
            grade: t.grade || null,
            protein_pct: t.protein_pct || null,
            moisture_pct: t.moisture_pct || null,
            dockage_pct: t.dockage_pct || null,
            contract_number: t.contract_number || null,
            destination: t.destination || null,
            counterparty_id: t.counterparty_id || null,
            commodity_id: t.commodity_id || null,
            source_system: sourceSystem,
            source_file: sourceFile || null,
          },
        });
        results.created++;
      } catch (err) {
        results.errors.push(`Ticket ${t.ticket_number}: ${err.message}`);
      }
    }
  });

  logger.info(`Elevator ticket import: ${results.created} created, ${results.deleted} replaced for period ${countPeriodId}`);
  return results;
}
