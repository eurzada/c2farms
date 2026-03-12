import prisma from '../config/database.js';
import { parseCsv } from './ticketImportService.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('terminal:ticket-import');

/**
 * Flexible column detection for unknown weigh scale CSV formats.
 * Tries common aliases for each logical field.
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

export function detectColumnMapping(headers) {
  return {
    date: findHeader(headers, 'Date', 'Ticket Date', 'DateTime', 'Timestamp'),
    ticketNum: findHeader(headers, 'Ticket', 'Ticket#', 'Ticket No', 'Number', 'Ticket Number'),
    gross: findHeader(headers, 'Gross', 'Gross Weight'),
    tare: findHeader(headers, 'Tare', 'Tare Weight'),
    net: findHeader(headers, 'Net', 'Net Weight', 'Net Wt'),
    product: findHeader(headers, 'Product', 'Commodity', 'Crop', 'Grain'),
    grower: findHeader(headers, 'Grower', 'Customer', 'Shipper'),
    dockage: findHeader(headers, 'Dockage', 'Dock%'),
    moisture: findHeader(headers, 'Moisture', 'MC', 'Moisture%'),
    testWeight: findHeader(headers, 'TW', 'Test Weight'),
    protein: findHeader(headers, 'Protein', 'Protein%'),
    hvk: findHeader(headers, 'HVK', 'HVK%'),
    fmo: findHeader(headers, 'FMO', 'FMO#'),
    buyer: findHeader(headers, 'Buyer', 'Sold To'),
  };
}

function isC2Farms(growerName) {
  if (!growerName) return false;
  const lower = growerName.toLowerCase();
  return lower.includes('c2 farms') || lower.includes('2 century');
}

/**
 * Preview parsed terminal tickets before committing.
 */
export async function previewTerminalImport(farmId, csvText) {
  const rows = parseCsv(csvText);
  const emptySummary = { total: 0, new_count: 0, duplicate_count: 0 };
  if (rows.length === 0) {
    return { tickets: [], errors: ['No data rows found in CSV.'], summary: emptySummary, column_mappings: {} };
  }

  const headers = Object.keys(rows[0]);
  const colMap = detectColumnMapping(headers);

  // Load existing terminal tickets for duplicate detection
  const existingTickets = await prisma.terminalTicket.findMany({
    where: { farm_id: farmId },
    select: { ticket_number: true },
  });
  const existingSet = new Set(existingTickets.map(t => t.ticket_number));

  const tickets = [];
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // 1-indexed + header

    // Parse ticket number
    const rawTicketNum = row[colMap.ticketNum];
    const ticketNum = rawTicketNum ? parseInt(rawTicketNum) : null;
    if (!ticketNum) {
      errors.push(`Row ${rowNum}: Missing or invalid ticket number`);
      continue;
    }

    // Parse weights
    const gross = parseFloat(row[colMap.gross]) || null;
    const tare = parseFloat(row[colMap.tare]) || null;
    let net = parseFloat(row[colMap.net]) || null;
    if (!net && gross && tare) {
      net = gross - tare;
    }
    if (!net) {
      errors.push(`Row ${rowNum}: Missing net weight (ticket #${ticketNum})`);
      continue;
    }

    // Parse date
    let ticketDate = null;
    const dateVal = row[colMap.date];
    if (dateVal) {
      const d = new Date(dateVal);
      if (!isNaN(d.getTime())) ticketDate = d.toISOString().split('T')[0];
    }

    const growerName = row[colMap.grower] || null;
    const product = row[colMap.product] || null;
    const isDuplicate = existingSet.has(ticketNum);

    tickets.push({
      row_number: rowNum,
      ticket_number: ticketNum,
      ticket_date: ticketDate,
      grower_name: growerName,
      product: product,
      weight_kg: net,
      gross_kg: gross,
      tare_kg: tare,
      dockage_pct: parseFloat(row[colMap.dockage]) || null,
      moisture_pct: parseFloat(row[colMap.moisture]) || null,
      test_weight: parseFloat(row[colMap.testWeight]) || null,
      protein_pct: parseFloat(row[colMap.protein]) || null,
      hvk_pct: parseFloat(row[colMap.hvk]) || null,
      fmo_number: row[colMap.fmo] || null,
      buyer: row[colMap.buyer] || null,
      is_c2_farms: isC2Farms(growerName),
      status: isDuplicate ? 'duplicate' : 'new',
    });
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
  };
}

/**
 * Commit parsed terminal tickets to the database.
 * Only creates tickets with status === 'new' (skips duplicates).
 */
export async function commitTerminalImport(farmId, tickets) {
  const newTickets = tickets.filter(t => t.status === 'new');
  if (newTickets.length === 0) {
    return { created: 0, skipped: tickets.length, errors: [] };
  }

  const importErrors = [];
  let created = 0;

  await prisma.$transaction(async (tx) => {
    for (const t of newTickets) {
      try {
        await tx.terminalTicket.create({
          data: {
            farm_id: farmId,
            ticket_number: t.ticket_number,
            direction: 'inbound',
            ticket_date: t.ticket_date ? new Date(t.ticket_date) : new Date(),
            grower_name: t.grower_name || null,
            product: t.product || 'Unknown',
            weight_kg: t.weight_kg,
            fmo_number: t.fmo_number || null,
            buyer: t.buyer || null,
            dockage_pct: t.dockage_pct ?? null,
            moisture_pct: t.moisture_pct ?? null,
            test_weight: t.test_weight ?? null,
            protein_pct: t.protein_pct ?? null,
            hvk_pct: t.hvk_pct ?? null,
            is_c2_farms: t.is_c2_farms || false,
            bin_id: null,
            scale_source: 'csv_import',
          },
        });
        created++;
      } catch (err) {
        importErrors.push(`Ticket #${t.ticket_number}: ${err.message}`);
      }
    }
  });

  logger.info('Terminal CSV import committed', {
    farmId,
    created,
    skipped: tickets.length - newTickets.length,
    errors: importErrors.length,
  });

  return {
    created,
    skipped: tickets.length - newTickets.length,
    errors: importErrors,
  };
}
