/**
 * Seed elevator tickets for Feb 2026 from buyer portal exports.
 * Reads 10 files from 5 buyers (Cargill, Bunge, G3, LDC, Richardson),
 * normalizes to ElevatorTicket shape, outputs verification CSV, inserts into DB.
 *
 * Run: cd backend && node src/scripts/seedElevatorTicketsFeb2026.js
 */
import prisma from '../config/database.js';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILES_DIR = path.resolve(__dirname, '../../../2. MarLogInv/Feb Elevator tickets-20260320T205236Z-1-001/Feb Elevator tickets');
const DATA_DIR = path.resolve(__dirname, '../../data');

// ─── Helpers ────────────────────────────────────────────────────────

function excelSerialToDate(serial) {
  // Excel serial date → JS Date (UTC)
  if (typeof serial !== 'number' || serial < 40000 || serial > 50000) return null;
  const utcDays = serial - 25569; // days from Unix epoch
  return new Date(utcDays * 86400 * 1000);
}

function parseDate(val) {
  if (!val) return null;
  // Excel serial number
  if (typeof val === 'number') {
    const d = excelSerialToDate(val);
    return d ? d.toISOString().slice(0, 10) : null;
  }
  const str = String(val).trim();
  // ISO: 2026-02-15
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return str.slice(0, 10);
  // US: MM/DD/YYYY or M/D/YYYY
  const usMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) {
    const [, m, d, y] = usMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // JS Date string: "Mon Dec 15 2025 00:00:00 GMT..."
  if (str.match(/^\w{3}\s\w{3}\s/)) {
    const d = new Date(str);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }
  return null;
}

function isFeb2026(dateStr) {
  return dateStr && dateStr.startsWith('2026-02');
}

function round3(n) {
  return Math.round((n || 0) * 1000) / 1000;
}

// ─── Buyer Parsers ──────────────────────────────────────────────────

function parseCargill(filePath, commodityLabel) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets['Delivery'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  const tickets = [];

  for (const r of rows) {
    const date = parseDate(r['Unload Date']);
    if (!isFeb2026(date)) continue;

    tickets.push({
      source_file: path.basename(filePath),
      buyer: 'Cargill',
      ticket_number: `CARG-${r['Ticket #']}`,
      delivery_date: date,
      commodity_raw: r['Commodity'] || commodityLabel,
      grade: r['Product'] || null,
      net_weight_mt: round3(parseFloat(r['Est Net Dry Weight']) || 0),
      gross_weight_mt: round3(parseFloat(r['Gross MT']) || 0),
      tare_weight_mt: round3(parseFloat(r['Tare MT']) || 0),
      protein_pct: parseFloat(r['Pro']) || null,
      moisture_pct: parseFloat(r['Mst']) || null,
      dockage_pct: parseFloat(r['Dkg']) || null,
      contract_number: r['Nomination Number'] ? String(r['Nomination Number']) : null,
      destination: r['Delivery Point'] || null,
    });
  }
  return tickets;
}

function parseBungePeas(filePath) {
  const wb = XLSX.readFile(filePath);
  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const tickets = [];

  // Find header row (row with "Receipt" in first cell)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
    if (rawRows[i] && String(rawRows[i][0]).toLowerCase().includes('receipt')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return tickets;

  const headers = rawRows[headerIdx];
  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || !row[0]) continue;

    // Map by header position
    const obj = {};
    headers.forEach((h, idx) => { obj[String(h)] = row[idx]; });

    const date = parseDate(obj['Date']);
    if (!isFeb2026(date)) continue;

    tickets.push({
      source_file: path.basename(filePath),
      buyer: 'Bunge',
      ticket_number: `BUNG-${obj['Receipt']}`,
      delivery_date: date,
      commodity_raw: obj['Product'] || 'Peas',
      grade: obj['Spec'] || null,
      net_weight_mt: round3(parseFloat(obj['Net']) || 0),
      gross_weight_mt: null,
      tare_weight_mt: null,
      protein_pct: null,
      moisture_pct: parseFloat(obj['Mst %']) || null,
      dockage_pct: parseFloat(obj['Dkg %']) || null,
      contract_number: obj['Contract'] ? String(obj['Contract']) : null,
      destination: obj['Location'] || null,
    });
  }
  return tickets;
}

function parseG3(filePath) {
  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const tickets = [];
  const seen = new Set();

  for (const r of rows) {
    const ticketId = String(r['Ticket Id'] || '');
    if (!ticketId || seen.has(ticketId)) continue;
    seen.add(ticketId); // take first occurrence (Pasqua = physical delivery)

    const date = parseDate(r['Delivery Date']);
    if (!isFeb2026(date)) continue;

    // Product field contains grade + protein, e.g., "2 CWAD 11.4"
    const product = r['Product'] || '';
    let protein = null;
    const protMatch = product.match(/(\d+\.?\d*)\s*$/);
    if (protMatch) protein = parseFloat(protMatch[1]);

    tickets.push({
      source_file: path.basename(filePath),
      buyer: 'G3',
      ticket_number: `G3-${ticketId}`,
      delivery_date: date,
      commodity_raw: 'DURUM',
      grade: product,
      net_weight_mt: round3(parseFloat(r['Adjusted Net Delivery']) || parseFloat(r['Grain Unloaded']) || 0),
      gross_weight_mt: round3(parseFloat(r['Grain Unloaded']) || 0),
      tare_weight_mt: null,
      protein_pct: protein,
      moisture_pct: null,
      dockage_pct: null,
      contract_number: null,
      destination: r['Delivered Location'] || null,
    });
  }
  return tickets;
}

function parseLDC(filePath, commodityLabel) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets['Scale Tickets'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  const tickets = [];

  for (const r of rows) {
    const date = parseDate(r['Unload Date']);
    if (!isFeb2026(date)) continue;

    // Weight columns are in kg (Weight Unit = "OTHER"), Gross Quantity is MT
    // Net Weight (kg) / 1000 = net MT
    const netKg = parseFloat(r['Net Weight']) || 0;
    const grossKg = parseFloat(r['Gross Weight']) || 0;
    const tareKg = parseFloat(r['Tare Weight']) || 0;

    tickets.push({
      source_file: path.basename(filePath),
      buyer: 'LDC',
      ticket_number: `LDC-${r['Scale Ticket #']}`,
      delivery_date: date,
      commodity_raw: r['Commodity'] || commodityLabel,
      grade: r['QG'] || null,
      net_weight_mt: round3(netKg / 1000),
      gross_weight_mt: round3(grossKg / 1000),
      tare_weight_mt: round3(tareKg / 1000),
      protein_pct: null, // LDC doesn't have protein column
      moisture_pct: parseFloat(r['MOIST']) || null,
      dockage_pct: parseFloat(r['TDK']) || null,
      contract_number: r['Contract Number'] ? String(r['Contract Number']) : null,
      destination: null,
    });
  }
  return tickets;
}

function parseRichardson(filePath, commodityLabel) {
  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const tickets = [];

  for (const r of rows) {
    const date = parseDate(r['Date']);
    if (!isFeb2026(date)) continue;

    // Protein and Moisture stored as decimals (0.13 = 13%), Dockage as percentage already
    const rawProtein = parseFloat(r['Protein']);
    const rawMoisture = parseFloat(r['Moisture Percent']);
    const protein = rawProtein && rawProtein < 1 ? round3(rawProtein * 100) : rawProtein || null;
    const moisture = rawMoisture && rawMoisture < 1 ? round3(rawMoisture * 100) : rawMoisture || null;

    tickets.push({
      source_file: path.basename(filePath),
      buyer: 'Richardson',
      ticket_number: `RICH-${r['Load #']}`,
      delivery_date: date,
      commodity_raw: r['Commodity'] || commodityLabel,
      grade: r['Grade'] || null,
      net_weight_mt: round3(parseFloat(r['Net Quantity (MT)']) || 0),
      gross_weight_mt: null,
      tare_weight_mt: null,
      protein_pct: protein,
      moisture_pct: moisture,
      dockage_pct: parseFloat(r['Dockage Percent']) || null,
      contract_number: r['Contract #'] ? String(r['Contract #']) : null,
      destination: r['Location'] || null,
    });
  }
  return tickets;
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log('=== Elevator Ticket Seed: Feb 2026 ===\n');

  // 1. Parse all files
  const allTickets = [];

  const files = [
    { parse: () => parseCargill(path.join(FILES_DIR, 'Cargill Durum.xlsx'), 'DURUM'), label: 'Cargill Durum' },
    { parse: () => parseCargill(path.join(FILES_DIR, 'Cargill IP.xlsx'), 'SPECIALTY_CANOLA'), label: 'Cargill IP' },
    { parse: () => parseBungePeas(path.join(FILES_DIR, 'Bunge Peas.csv')), label: 'Bunge Peas' },
    // Bunge.csv is a settlement summary — SKIP
    { parse: () => parseG3(path.join(FILES_DIR, 'G3 Durum.csv')), label: 'G3 Durum' },
    { parse: () => parseLDC(path.join(FILES_DIR, 'LDC Canola.xlsx'), 'Canola Seed'), label: 'LDC Canola' },
    { parse: () => parseLDC(path.join(FILES_DIR, 'LDC Nexera.xlsx'), 'Nexera Seed'), label: 'LDC Nexera' },
    { parse: () => parseRichardson(path.join(FILES_DIR, 'Rich CWRS.xls'), 'WHEAT CWRS'), label: 'Rich CWRS' },
    { parse: () => parseRichardson(path.join(FILES_DIR, 'Rich Canola.xls'), 'CANOLA'), label: 'Rich Canola' },
    { parse: () => parseRichardson(path.join(FILES_DIR, 'Rich Peas.xls'), 'YELLOW PEAS'), label: 'Rich Peas' },
  ];

  console.log('Parsing files...');
  for (const { parse, label } of files) {
    try {
      const tickets = parse();
      console.log(`  ${label}: ${tickets.length} Feb tickets`);
      allTickets.push(...tickets);
    } catch (err) {
      console.error(`  ${label}: ERROR — ${err.message}`);
    }
  }

  // Dedup by ticket_number
  const dedupMap = new Map();
  for (const t of allTickets) {
    if (!dedupMap.has(t.ticket_number)) {
      dedupMap.set(t.ticket_number, t);
    }
  }
  const tickets = [...dedupMap.values()];
  console.log(`\nTotal: ${allTickets.length} raw → ${tickets.length} unique after dedup\n`);

  // 2. Write verification CSV
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const csvPath = path.join(DATA_DIR, 'feb-2026-elevator-tickets-verification.csv');
  const csvHeaders = ['source_file', 'buyer', 'ticket_number', 'delivery_date', 'commodity_raw', 'grade', 'net_weight_mt', 'gross_weight_mt', 'tare_weight_mt', 'protein_pct', 'moisture_pct', 'dockage_pct', 'contract_number', 'destination'];
  const csvRows = tickets.map(t =>
    csvHeaders.map(h => {
      const v = t[h];
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  );
  fs.writeFileSync(csvPath, [csvHeaders.join(','), ...csvRows].join('\n'));
  console.log(`Verification CSV: ${csvPath}\n`);

  // 3. Print summaries
  // Per buyer
  const byBuyer = {};
  for (const t of tickets) {
    if (!byBuyer[t.buyer]) byBuyer[t.buyer] = { count: 0, mt: 0 };
    byBuyer[t.buyer].count++;
    byBuyer[t.buyer].mt += t.net_weight_mt;
  }
  console.log('=== Per Buyer ===');
  for (const [buyer, v] of Object.entries(byBuyer).sort((a, b) => b[1].mt - a[1].mt)) {
    console.log(`  ${buyer.padEnd(15)} ${String(v.count).padStart(4)} tickets, ${v.mt.toFixed(1).padStart(10)} MT`);
  }

  // Per commodity
  const byCommodity = {};
  for (const t of tickets) {
    const key = t.commodity_raw || 'UNKNOWN';
    if (!byCommodity[key]) byCommodity[key] = { count: 0, mt: 0 };
    byCommodity[key].count++;
    byCommodity[key].mt += t.net_weight_mt;
  }
  console.log('\n=== Per Commodity ===');
  for (const [comm, v] of Object.entries(byCommodity).sort((a, b) => b[1].mt - a[1].mt)) {
    console.log(`  ${comm.padEnd(20)} ${String(v.count).padStart(4)} tickets, ${v.mt.toFixed(1).padStart(10)} MT`);
  }

  const totalMT = tickets.reduce((s, t) => s + t.net_weight_mt, 0);
  console.log(`\n=== Total: ${tickets.length} tickets, ${totalMT.toFixed(1)} MT ===\n`);

  // 4. Database operations
  const enterprise = await prisma.farm.findFirst({ where: { is_enterprise: true } });
  if (!enterprise) throw new Error('Enterprise farm not found');
  const farmId = enterprise.id;

  // Find or create Feb 2026 count period
  let febPeriod = await prisma.countPeriod.findFirst({
    where: { farm_id: farmId, period_date: new Date('2026-02-28') },
  });
  if (!febPeriod) {
    febPeriod = await prisma.countPeriod.create({
      data: { farm_id: farmId, period_date: new Date('2026-02-28'), crop_year: 2026 },
    });
    console.log('Created Feb 2026 count period:', febPeriod.id);
  } else {
    console.log('Found Feb 2026 count period:', febPeriod.id);
  }

  // Load commodities and counterparties
  const commodities = await prisma.commodity.findMany({ where: { farm_id: farmId } });
  const counterparties = await prisma.counterparty.findMany({ where: { farm_id: farmId } });

  // Commodity mapping: raw name → commodity record
  const commodityMap = {
    'DURUM': commodities.find(c => c.code === 'CWAD'),
    'SPECIALTY_CANOLA': commodities.find(c => c.code === 'CNLA'), // map to generic Canola
    'Peas, Large Yellow': commodities.find(c => c.code === 'YPEA'),
    'YELLOW PEAS': commodities.find(c => c.code === 'YPEA'),
    'Canola Seed': commodities.find(c => c.code === 'CNLA'),
    'CANOLA': commodities.find(c => c.code === 'CNLA'),
    'Nexera Seed': commodities.find(c => c.code === 'NXRA'),
    'WHEAT CWRS': commodities.find(c => c.code === 'CWRS'),
  };

  // Counterparty mapping: buyer name → counterparty record
  const counterpartyMap = {
    'Cargill': counterparties.find(c => c.short_code === 'CARGILLLIM'),
    'Bunge': counterparties.find(c => c.short_code === 'BUNGECANAD'),
    'G3': counterparties.find(c => c.short_code === 'G3CANADALI'),
    'LDC': counterparties.find(c => c.short_code === 'LOUISDREYF'),
    'Richardson': counterparties.find(c => c.short_code === 'RICHARDSON'),
  };

  // Report mapping results
  console.log('\nCommodity mappings:');
  for (const [raw, mapped] of Object.entries(commodityMap)) {
    console.log(`  ${raw.padEnd(20)} → ${mapped ? `${mapped.code} (${mapped.name})` : '⚠ NOT FOUND'}`);
  }
  console.log('\nCounterparty mappings:');
  for (const [raw, mapped] of Object.entries(counterpartyMap)) {
    console.log(`  ${raw.padEnd(15)} → ${mapped ? `${mapped.name}` : '⚠ NOT FOUND'}`);
  }

  // Check for unmapped
  const unmappedComm = tickets.filter(t => t.commodity_raw && !commodityMap[t.commodity_raw]);
  if (unmappedComm.length > 0) {
    const unique = [...new Set(unmappedComm.map(t => t.commodity_raw))];
    console.warn(`\n⚠ Unmapped commodities: ${unique.join(', ')}`);
  }

  // 5. Insert into DB
  console.log('\nInserting into database...');
  await prisma.$transaction(async (tx) => {
    // Delete existing elevator tickets for this period
    const deleted = await tx.elevatorTicket.deleteMany({
      where: { farm_id: farmId, count_period_id: febPeriod.id },
    });
    if (deleted.count > 0) {
      console.log(`  Deleted ${deleted.count} existing elevator tickets for Feb 2026`);
    }

    let created = 0;
    const errors = [];
    for (const t of tickets) {
      try {
        await tx.elevatorTicket.create({
          data: {
            farm_id: farmId,
            count_period_id: febPeriod.id,
            ticket_number: t.ticket_number,
            delivery_date: t.delivery_date ? new Date(t.delivery_date + 'T12:00:00Z') : null,
            commodity_raw: t.commodity_raw || null,
            buyer_name: t.buyer,
            net_weight_mt: t.net_weight_mt,
            gross_weight_mt: t.gross_weight_mt || null,
            tare_weight_mt: t.tare_weight_mt || null,
            grade: t.grade || null,
            protein_pct: t.protein_pct || null,
            moisture_pct: t.moisture_pct || null,
            dockage_pct: t.dockage_pct || null,
            contract_number: t.contract_number || null,
            destination: t.destination || null,
            commodity_id: commodityMap[t.commodity_raw]?.id || null,
            counterparty_id: counterpartyMap[t.buyer]?.id || null,
            source_system: 'portal_seed',
            source_file: t.source_file,
          },
        });
        created++;
      } catch (err) {
        errors.push(`${t.ticket_number}: ${err.message}`);
      }
    }

    console.log(`  Created ${created} elevator tickets`);
    if (errors.length > 0) {
      console.error(`  ${errors.length} errors:`);
      errors.forEach(e => console.error(`    ${e}`));
    }
  });

  console.log('\nDone!');
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
