#!/usr/bin/env node
/**
 * Bulk upload settlement PDFs directly via the service layer (bypasses HTTP).
 * Usage: node src/scripts/uploadSettlements.js <directory>
 */
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import prisma from '../config/database.js';
import { extractSettlementFromPdf, saveSettlement } from '../services/settlementService.js';

const DIR = process.argv[2];
if (!DIR) {
  console.error('Usage: node src/scripts/uploadSettlements.js <directory>');
  process.exit(1);
}

// Enterprise farm
const enterpriseFarm = await prisma.farm.findFirst({ where: { is_enterprise: true } });
if (!enterpriseFarm) {
  console.error('No enterprise farm found');
  process.exit(1);
}
const FARM_ID = enterpriseFarm.id;
console.log(`Using enterprise farm: ${enterpriseFarm.name} (${FARM_ID})\n`);

const files = (await readdir(DIR)).filter(f => /\.(pdf|jpg|jpeg|png)$/i.test(f)).sort();
console.log(`Found ${files.length} files to process\n`);

let success = 0;
let errors = 0;

for (let i = 0; i < files.length; i++) {
  const fname = files[i];
  const fpath = join(DIR, fname);
  console.log(`[${i + 1}/${files.length}] ${fname}`);

  try {
    const buffer = await readFile(fpath);
    const { extraction, buyerFormat, usage } = await extractSettlementFromPdf(buffer);
    const settlement = await saveSettlement(FARM_ID, extraction, buyerFormat, { usage });
    console.log(`  ✓ #${settlement.settlement_number} | ${buyerFormat} | ${settlement.lines.length} lines | $${settlement.total_amount || 0}`);
    success++;
  } catch (err) {
    errors++;
    console.log(`  ✗ ${err.code || 'ERROR'}: ${err.message}`);
  }
}

console.log(`\nDone: ${success} uploaded, ${errors} errors out of ${files.length} files`);
await prisma.$disconnect();
