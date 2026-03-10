import prisma from '../config/database.js';

/**
 * Parse Traction Ag CSV export into DeliveryTicket records.
 *
 * Key column mappings:
 *   Timestamp         → delivery_date
 *   Production cycle  → crop_year
 *   Crop              → commodity (parse before " - ")
 *   Load ID           → source_ref
 *   From              → location + bin (parse "Location: Bin#")
 *   To                → counterparty + destination
 *   Contract          → marketing_contract (parse "Buyer: Contract#")
 *   Settled           → settled (boolean)
 *   Operator          → operator_name
 *   From Ticket #     → ticket_number
 *   From Gross        → gross_weight_kg
 *   From Tare         → tare_weight_kg
 *   From Transfer Qty → net_weight_kg
 *   From Moisture     → moisture_pct
 *   Equipment         → vehicle
 */

/**
 * Parse a CSV string into an array of objects using the header row as keys.
 */
export function parseCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];

  // Handle quoted CSV fields properly
  const parseLine = (line) => {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  };

  const headers = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    if (values.length < 3) continue; // skip blank/malformed rows
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] || '';
    });
    rows.push(obj);
  }
  return rows;
}

/**
 * Parse "From" field: "Lewvan: 508 Bag 1 - Canola 2025 crop"
 * Returns { locationName, binNumber, binLabel }
 *   locationName: "Lewvan"
 *   binNumber: "508" (just the number, for matching to InventoryBin)
 *   binLabel: "508 Bag 1" (full storage identifier including bag/bag#)
 */
export function parseFromField(fromValue) {
  if (!fromValue) return { locationName: null, binNumber: null, binLabel: null };
  // Pattern: "LocationName: BinNumber [Bag N] [- Crop Year crop]"
  const match = fromValue.match(/^([^:]+):\s*(.+?)(?:\s*-\s*.+)?$/);
  if (match) {
    const locationName = match[1].trim();
    const binPart = match[2].trim(); // e.g. "508 Bag 1" or "504" or "LGX Yard"
    // Extract leading number as the bin number for DB matching
    const numMatch = binPart.match(/^(\d+)/);
    const binNumber = numMatch ? numMatch[1] : binPart.split(/\s/)[0];
    return { locationName, binNumber, binLabel: binPart };
  }
  return { locationName: null, binNumber: null, binLabel: null };
}

/**
 * Parse "Contract" field: "G3: 317801" or "Cargill: 2100459885"
 * Returns { buyerName, contractNumber }
 */
export function parseContractField(contractValue) {
  if (!contractValue) return { buyerName: null, contractNumber: null };
  const match = contractValue.match(/^([^:]+):\s*(.+)$/);
  if (match) {
    return { buyerName: match[1].trim(), contractNumber: match[2].trim() };
  }
  return { buyerName: null, contractNumber: null };
}

/**
 * Parse "To" field: "Richardson - Yorkton: Canola"
 * Returns { buyerName, destination }
 */
export function parseToField(toValue) {
  if (!toValue) return { buyerName: null, destination: null };
  const match = toValue.match(/^([^-]+)\s*-\s*([^:]+)/);
  if (match) {
    return { buyerName: match[1].trim(), destination: match[2].trim() };
  }
  return { buyerName: null, destination: toValue.trim() };
}

/**
 * Parse "Crop" field: "Canola - Grain" → "Canola"
 */
export function parseCropName(cropValue) {
  if (!cropValue) return null;
  const match = cropValue.match(/^([^-]+)/);
  return match ? match[1].trim() : cropValue.trim();
}

/**
 * Find the best header match from the CSV for a given canonical name.
 * Traction Ag headers can vary — try exact, then case-insensitive, then contains.
 */
function findHeader(headers, ...candidates) {
  for (const candidate of candidates) {
    const exact = headers.find(h => h === candidate);
    if (exact) return exact;
    const lower = headers.find(h => h.toLowerCase() === candidate.toLowerCase());
    if (lower) return lower;
  }
  // Partial match
  for (const candidate of candidates) {
    const partial = headers.find(h => h.toLowerCase().includes(candidate.toLowerCase()));
    if (partial) return partial;
  }
  return null;
}

/**
 * Preview parsed tickets before committing (dry run).
 * Returns enriched rows with match info.
 */
export async function previewTicketImport(farmId, csvText) {
  const rows = parseCsv(csvText);
  const emptySummary = { total: 0, new_count: 0, update_count: 0, matched_contracts: 0, unmatched_contracts: 0 };
  if (rows.length === 0) return { tickets: [], errors: ['No data rows found in CSV — the file may only contain a header row.'], summary: emptySummary, column_mappings: {} };

  const headers = Object.keys(rows[0]);

  // Find column mappings
  const colMap = {
    timestamp: findHeader(headers, 'Timestamp', 'Date', 'Transfer Date'),
    cropYear: findHeader(headers, 'Production cycle', 'Production Cycle', 'Crop Year'),
    crop: findHeader(headers, 'Crop'),
    loadId: findHeader(headers, 'Load ID', 'Load Id'),
    from: findHeader(headers, 'From'),
    to: findHeader(headers, 'To'),
    contract: findHeader(headers, 'Contract'),
    settled: findHeader(headers, 'Settled'),
    operator: findHeader(headers, 'Operator'),
    fromTicket: findHeader(headers, 'From Ticket #', 'From Ticket', 'Ticket #'),
    toTicket: findHeader(headers, 'To Ticket #', 'To Ticket'),
    fromGross: findHeader(headers, 'From Gross', 'Gross Weight'),
    fromTare: findHeader(headers, 'From Tare', 'Tare Weight'),
    fromTransferQty: findHeader(headers, 'From Transfer Qty', 'Transfer Qty', 'Net Weight'),
    fromMoisture: findHeader(headers, 'From Moisture', 'Moisture'),
    equipment: findHeader(headers, 'Equipment', 'Vehicle'),
    fromGrade: findHeader(headers, 'From Grade', 'Grade'),
    fromProtein: findHeader(headers, 'From Protein', 'Protein'),
    fromDockage: findHeader(headers, 'From Dockage', 'Dockage'),
  };

  // Load lookup data for matching
  const [commodities, locations, bins, contracts, counterparties, existingTickets] = await Promise.all([
    prisma.commodity.findMany({ where: { farm_id: farmId } }),
    prisma.inventoryLocation.findMany({ where: { farm_id: farmId } }),
    prisma.inventoryBin.findMany({ where: { farm_id: farmId }, include: { location: true } }),
    prisma.marketingContract.findMany({ where: { farm_id: farmId }, include: { counterparty: true } }),
    prisma.counterparty.findMany({ where: { farm_id: farmId } }),
    prisma.deliveryTicket.findMany({ where: { farm_id: farmId }, select: { ticket_number: true } }),
  ]);

  const existingTicketSet = new Set(existingTickets.map(t => t.ticket_number));

  const tickets = [];
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // 1-indexed, +1 for header

    const ticketNumber = row[colMap.fromTicket];
    if (!ticketNumber) {
      errors.push(`Row ${rowNum}: Missing ticket number`);
      continue;
    }

    // Parse fields
    const cropName = parseCropName(row[colMap.crop]);
    const { locationName, binNumber, binLabel } = parseFromField(row[colMap.from]);
    const { buyerName: contractBuyer, contractNumber } = parseContractField(row[colMap.contract]);
    const { buyerName: toBuyer, destination } = parseToField(row[colMap.to]);

    const netWeightKg = parseFloat(row[colMap.fromTransferQty]) || 0;
    const grossWeightKg = parseFloat(row[colMap.fromGross]) || null;
    const tareWeightKg = parseFloat(row[colMap.fromTare]) || null;
    const moisturePct = parseFloat(row[colMap.fromMoisture]) || null;
    const dockagePct = parseFloat(row[colMap.fromDockage]) || null;
    const proteinPct = parseFloat(row[colMap.fromProtein]) || null;

    // Parse date
    let deliveryDate = null;
    const tsValue = row[colMap.timestamp];
    if (tsValue) {
      // Handle MM/DD/YYYY HH:mm:ss or YYYY-MM-DD formats
      const d = new Date(tsValue);
      if (!isNaN(d.getTime())) deliveryDate = d;
    }

    // Match commodity
    const matchedCommodity = cropName
      ? commodities.find(c =>
          c.name.toLowerCase().includes(cropName.toLowerCase()) ||
          cropName.toLowerCase().includes(c.name.toLowerCase())
        )
      : null;

    // Match location
    const matchedLocation = locationName
      ? locations.find(l =>
          l.name.toLowerCase() === locationName.toLowerCase() ||
          l.code.toLowerCase() === locationName.toLowerCase()
        )
      : null;

    // Match bin
    const matchedBin = (matchedLocation && binNumber)
      ? bins.find(b =>
          b.location_id === matchedLocation.id &&
          b.bin_number === binNumber
        )
      : null;

    // Match counterparty
    const buyerNameToMatch = contractBuyer || toBuyer;
    const matchedCounterparty = buyerNameToMatch
      ? counterparties.find(cp =>
          cp.name.toLowerCase().includes(buyerNameToMatch.toLowerCase()) ||
          buyerNameToMatch.toLowerCase().includes(cp.name.toLowerCase()) ||
          cp.short_code.toLowerCase() === buyerNameToMatch.toLowerCase()
        )
      : null;

    // Match marketing contract
    const matchedContract = contractNumber
      ? contracts.find(c => c.contract_number === contractNumber)
      : null;

    const isExisting = existingTicketSet.has(ticketNumber);

    tickets.push({
      row_number: rowNum,
      ticket_number: ticketNumber,
      delivery_date: deliveryDate?.toISOString()?.split('T')[0] || null,
      crop_year: parseInt(row[colMap.cropYear]) || null,
      crop_name: cropName,
      net_weight_kg: netWeightKg,
      net_weight_mt: netWeightKg / 1000,
      gross_weight_kg: grossWeightKg,
      tare_weight_kg: tareWeightKg,
      moisture_pct: moisturePct,
      dockage_pct: dockagePct,
      protein_pct: proteinPct,
      grade: row[colMap.fromGrade] || null,
      operator_name: row[colMap.operator] || null,
      vehicle: row[colMap.equipment] || null,
      source_ref: row[colMap.loadId] || null,
      source_ticket_number: row[colMap.toTicket] || null,
      settled: row[colMap.settled]?.toLowerCase() === 'true',
      destination,
      bin_label: binLabel || null,
      contract_number: contractNumber || null,
      buyer_name: buyerNameToMatch || null,
      // Match results
      commodity_id: matchedCommodity?.id || null,
      commodity_match: matchedCommodity?.name || null,
      location_id: matchedLocation?.id || null,
      location_match: matchedLocation?.name || null,
      bin_id: matchedBin?.id || null,
      bin_match: matchedBin ? `${matchedLocation?.name}: ${matchedBin.bin_number}` : null,
      counterparty_id: matchedCounterparty?.id || null,
      counterparty_match: matchedCounterparty?.name || null,
      marketing_contract_id: matchedContract?.id || null,
      contract_match: matchedContract ? `${matchedContract.counterparty?.name}: ${matchedContract.contract_number}` : null,
      is_existing: isExisting,
      status: isExisting ? 'update' : 'new',
    });
  }

  return {
    tickets,
    errors,
    summary: {
      total: tickets.length,
      new_count: tickets.filter(t => t.status === 'new').length,
      update_count: tickets.filter(t => t.status === 'update').length,
      matched_contracts: tickets.filter(t => t.marketing_contract_id).length,
      unmatched_contracts: tickets.filter(t => !t.marketing_contract_id).length,
    },
    column_mappings: colMap,
  };
}

/**
 * Commit parsed tickets to the database. Upserts on farm_id + ticket_number.
 */
export async function commitTicketImport(farmId, tickets) {
  const results = { created: 0, updated: 0, errors: [] };

  for (const t of tickets) {
    try {
      const data = {
        farm_id: farmId,
        ticket_number: t.ticket_number,
        delivery_date: t.delivery_date ? new Date(t.delivery_date) : new Date(),
        net_weight_kg: t.net_weight_kg || 0,
        net_weight_mt: (t.net_weight_kg || 0) / 1000,
        gross_weight_kg: t.gross_weight_kg || null,
        tare_weight_kg: t.tare_weight_kg || null,
        moisture_pct: t.moisture_pct || null,
        dockage_pct: t.dockage_pct || null,
        protein_pct: t.protein_pct || null,
        grade: t.grade || null,
        source_system: 'traction_ag',
        source_ref: t.source_ref || null,
        source_ticket_number: t.source_ticket_number || null,
        operator_name: t.operator_name || null,
        vehicle: t.vehicle || null,
        destination: t.destination || null,
        crop_year: t.crop_year || null,
        bin_label: t.bin_label || null,
        contract_number: t.contract_number || null,
        buyer_name: t.buyer_name || null,
        settled: t.settled || false,
        notes: t.notes || null,
        marketing_contract_id: t.marketing_contract_id || null,
        counterparty_id: t.counterparty_id || null,
        commodity_id: t.commodity_id || null,
        bin_id: t.bin_id || null,
        location_id: t.location_id || null,
      };

      await prisma.deliveryTicket.upsert({
        where: {
          farm_id_ticket_number: { farm_id: farmId, ticket_number: t.ticket_number },
        },
        update: data,
        create: data,
      });

      if (t.is_existing || t.status === 'update') {
        results.updated++;
      } else {
        results.created++;
      }
    } catch (err) {
      results.errors.push(`Ticket ${t.ticket_number}: ${err.message}`);
    }
  }

  return results;
}
