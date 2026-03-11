#!/usr/bin/env node
/**
 * Seed LGX terminal data from the Excel spreadsheet.
 * Usage: node backend/src/scripts/seedTerminal.js [path-to-xlsx]
 */
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import ExcelJS from 'exceljs';
import prisma from '../config/database.js';

const XLSX_PATH = process.argv[2] || resolve('terminalLGX/LGX Bin Loads & Inventory 2025.xlsx');

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const yr = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
    return new Date(yr, parseInt(m[1]) - 1, parseInt(m[2]));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function isC2(name) {
  return /c2\s*farms|2\s*century/i.test(name || '');
}

async function main() {
  console.log('Loading workbook:', XLSX_PATH);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);

  // Find or create the LGX farm
  let farm = await prisma.farm.findFirst({ where: { name: { contains: 'LGX', mode: 'insensitive' } } });
  if (!farm) {
    // Find the enterprise farm to get existing user roles
    const enterprise = await prisma.farm.findFirst({ where: { is_enterprise: true } });
    farm = await prisma.farm.create({
      data: {
        name: 'LGX Terminals Ltd',
        farm_type: 'terminal',
        is_enterprise: false,
      },
    });
    // Copy user roles from enterprise farm if available
    if (enterprise) {
      const roles = await prisma.userFarmRole.findMany({ where: { farm_id: enterprise.id } });
      for (const role of roles) {
        await prisma.userFarmRole.create({
          data: { user_id: role.user_id, farm_id: farm.id, role: role.role },
        });
      }
    }
    console.log('Created farm:', farm.name, farm.id);
  } else {
    await prisma.farm.update({ where: { id: farm.id }, data: { farm_type: 'terminal' } });
    console.log('Using existing farm:', farm.name, farm.id);
  }

  const farmId = farm.id;

  // Clear existing terminal data for this farm
  await prisma.terminalSample.deleteMany({ where: { ticket: { farm_id: farmId } } });
  await prisma.terminalTicket.deleteMany({ where: { farm_id: farmId } });
  await prisma.terminalBlendEvent.deleteMany({ where: { farm_id: farmId } });
  await prisma.dailyPosition.deleteMany({ where: { farm_id: farmId } });
  await prisma.terminalBin.deleteMany({ where: { farm_id: farmId } });
  console.log('Cleared existing terminal data');

  // Create bins
  const binDefs = [
    { bin_number: 1, name: 'Bin 1', current_product_label: 'Canary Seed' },
    { bin_number: 2, name: 'Bin 2', current_product_label: '#1 CWAD' },
    { bin_number: 3, name: 'Bin 3', current_product_label: 'CWRS Lo Pro' },
    { bin_number: 4, name: 'Bin 4', current_product_label: '#2 OB CWRS Hi Pro' },
  ];

  const binMap = {};
  for (const def of binDefs) {
    const bin = await prisma.terminalBin.create({
      data: { farm_id: farmId, ...def, balance_kg: 0, c2_balance_kg: 0, non_c2_balance_kg: 0 },
    });
    binMap[def.bin_number] = bin;
    console.log(`  Created ${def.name} (${def.current_product_label})`);
  }

  // Product-to-bin mapping (based on spreadsheet analysis)
  function guessBin(product, grower) {
    const p = (product || '').toLowerCase().trim();
    if (p.includes('canary')) return binMap[1];
    if (p.includes('cwad') || p.includes('durum')) return binMap[2];
    if (p.includes('cwrs') || p.includes('wheat')) {
      if (isC2(grower)) return binMap[3]; // C2 CWRS goes to Lo Pro
      return binMap[4]; // Outside CWRS goes to Hi Pro
    }
    if (p.includes('flax')) return binMap[3]; // Flax was in Bin 3 initially
    return null;
  }

  // Parse Incoming sheet
  const incoming = wb.getWorksheet('Incoming');
  let ticketCount = 0;
  const sampleBatch = [];

  for (let r = 3; r <= incoming.rowCount; r++) {
    const row = incoming.getRow(r);
    const date = parseDate(row.getCell(1).value);
    const grower = row.getCell(2).value?.toString()?.trim();
    const product = row.getCell(3).value?.toString()?.trim();
    const kg = parseFloat(row.getCell(4).value) || 0;
    const ticketNum = parseInt(row.getCell(5).value);
    const fmo = row.getCell(6).value?.toString()?.trim() || null;
    const buyer = row.getCell(7).value?.toString()?.trim() || null;
    const sampleTo = row.getCell(8).value?.toString()?.trim() || null;
    const sampleDate = parseDate(row.getCell(9).value);
    const tracking = row.getCell(10).value?.toString()?.trim() || null;

    if (!date || !grower || !kg || !ticketNum) continue;

    const bin = guessBin(product, grower);

    const ticket = await prisma.terminalTicket.create({
      data: {
        farm_id: farmId,
        bin_id: bin?.id || null,
        ticket_number: ticketNum,
        direction: 'inbound',
        ticket_date: date,
        grower_name: grower,
        product: product || 'Unknown',
        weight_kg: kg,
        fmo_number: fmo,
        buyer,
        is_c2_farms: isC2(grower),
      },
    });

    // Update bin balance
    if (bin) {
      const incr = { balance_kg: { increment: kg } };
      if (isC2(grower)) incr.c2_balance_kg = { increment: kg };
      else incr.non_c2_balance_kg = { increment: kg };
      await prisma.terminalBin.update({ where: { id: bin.id }, data: incr });
    }

    // Queue sample creation
    if (sampleTo) {
      sampleBatch.push({
        ticket_id: ticket.id,
        inspector: sampleTo,
        sample_type: 'shipped',
        send_date: sampleDate,
        tracking_number: tracking,
      });
    }

    ticketCount++;
  }
  console.log(`Imported ${ticketCount} incoming tickets`);

  // Parse Outgoing sheet
  const outgoing = wb.getWorksheet('Outgoing');
  let outCount = 0;

  for (let r = 3; r <= outgoing.rowCount; r++) {
    const row = outgoing.getRow(r);
    const date = parseDate(row.getCell(1).value);
    const crop = row.getCell(2).value?.toString()?.trim();
    const railCar = row.getCell(3).value?.toString()?.trim() || null;
    const loaderTicket = row.getCell(4).value?.toString()?.trim() || null;
    const fmo = row.getCell(5).value?.toString()?.trim() || null;
    const kg = parseFloat(row.getCell(6).value) || 0;
    const soldTo = row.getCell(7).value?.toString()?.trim() || null;
    const seals = row.getCell(8).value?.toString()?.trim() || null;
    const sampleType = row.getCell(9).value?.toString()?.trim() || null;
    const sampleBy = row.getCell(10).value?.toString()?.trim() || null;

    if (!date || !kg) continue;

    // Determine which bin this came from
    const p = (crop || '').toLowerCase();
    let bin = null;
    if (p.includes('canary')) bin = binMap[1];
    else if (p.includes('cwad') || p.includes('durum')) bin = binMap[2];
    else if (p.includes('cwrs') || p.includes('wheat')) bin = binMap[3]; // outbound CWRS primarily from Lo Pro (blends handled separately)

    // Generate a ticket number for outgoing (use loader ticket or auto)
    const maxTicket = await prisma.terminalTicket.findFirst({
      where: { farm_id: farmId },
      orderBy: { ticket_number: 'desc' },
      select: { ticket_number: true },
    });
    const nextNum = (maxTicket?.ticket_number || 9000) + 1;

    const ticket = await prisma.terminalTicket.create({
      data: {
        farm_id: farmId,
        bin_id: bin?.id || null,
        ticket_number: nextNum,
        direction: 'outbound',
        ticket_date: date,
        product: crop || 'Unknown',
        weight_kg: kg,
        outbound_kg: kg,
        rail_car_number: railCar,
        vehicle_id: loaderTicket,
        fmo_number: fmo,
        sold_to: soldTo,
        seal_numbers: seals,
        is_c2_farms: false,
      },
    });

    // Deduct from bin
    if (bin) {
      await prisma.terminalBin.update({
        where: { id: bin.id },
        data: { balance_kg: { decrement: kg } },
      });
    }

    // Sample
    if (sampleBy || sampleType) {
      let st = 'onsite';
      if (sampleType?.toLowerCase().includes('lit')) st = 'lit_graded';
      else if (sampleType?.toLowerCase().includes('ship')) st = 'shipped';
      sampleBatch.push({
        ticket_id: ticket.id,
        inspector: sampleBy || 'Cotecna',
        sample_type: st,
      });
    }

    outCount++;
  }
  console.log(`Imported ${outCount} outgoing tickets`);

  // Create all samples
  if (sampleBatch.length > 0) {
    await prisma.terminalSample.createMany({ data: sampleBatch });
    console.log(`Created ${sampleBatch.length} sample records`);
  }

  // Print final bin balances
  const finalBins = await prisma.terminalBin.findMany({ where: { farm_id: farmId }, orderBy: { bin_number: 'asc' } });
  console.log('\nFinal bin balances:');
  for (const b of finalBins) {
    console.log(`  ${b.name} (${b.current_product_label}): ${b.balance_kg.toLocaleString()} kg | C2: ${b.c2_balance_kg.toLocaleString()} | Non-C2: ${b.non_c2_balance_kg.toLocaleString()}`);
  }

  console.log('\nDone! LGX terminal seeded successfully.');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
