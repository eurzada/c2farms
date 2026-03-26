import ExcelJS from 'exceljs';
import prisma from '../config/database.js';
import { getNextCounterpartyCode } from './marketingService.js';

/**
 * Import contracts from the "2026 FY Contracts.xlsx" format.
 *
 * Workbook has one sheet per crop (Durum, Barley, Canary, CWRS, Estons, Canola, SWS, Reds, Yellow Peas).
 * Each sheet columns: Contract Date | Customer | Contract # | Quantity mt | Price /mt |
 *                      Delivery Period | Additional Terms | Completed | Contract (hyperlink)
 */

// Map sheet names to commodity codes/names — flexible matching
const CROP_NAME_MAP = {
  'durum': 'Durum',
  'barley': 'Barley',
  'canary': 'Canary Seed',
  'canaryseed': 'Canary Seed',
  'canary seed': 'Canary Seed',
  'cwrs': 'CWRS',
  'hard red spring': 'CWRS',
  'estons': 'Lentils',
  'lentils': 'Lentils',
  'canola': 'Canola',
  'sws': 'SWS',
  'soft white spring': 'SWS',
  'reds': 'Red Lentils',
  'red lentils': 'Red Lentils',
  'yellow peas': 'Yellow Peas',
  'peas': 'Yellow Peas',
  'chickpeas': 'Chickpeas',
  'flax': 'Flax',
  'oats': 'Oats',
};

/**
 * Attempt to parse a delivery period string into start/end dates.
 * Formats: "Sept 1, 2026 - Oct 31, 2026", "Jan-Mar 2026", "ASAP", etc.
 */
function parseDeliveryPeriod(text) {
  if (!text || typeof text !== 'string') return { start: null, end: null };

  // Try "Month Day, Year - Month Day, Year"
  const rangeMatch = text.match(
    /(\w+)\s+(\d{1,2}),?\s+(\d{4})\s*[-–]\s*(\w+)\s+(\d{1,2}),?\s+(\d{4})/
  );
  if (rangeMatch) {
    const start = new Date(`${rangeMatch[1]} ${rangeMatch[2]}, ${rangeMatch[3]}`);
    const end = new Date(`${rangeMatch[4]} ${rangeMatch[5]}, ${rangeMatch[6]}`);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      return { start, end };
    }
  }

  // Try "Mon-Mon Year" (e.g., "Jan-Mar 2026")
  const shortRange = text.match(/(\w+)\s*[-–]\s*(\w+)\s+(\d{4})/);
  if (shortRange) {
    const start = new Date(`${shortRange[1]} 1, ${shortRange[3]}`);
    const endMonth = new Date(`${shortRange[2]} 1, ${shortRange[3]}`);
    if (!isNaN(start.getTime()) && !isNaN(endMonth.getTime())) {
      // End of that month
      const end = new Date(endMonth.getFullYear(), endMonth.getMonth() + 1, 0);
      return { start, end };
    }
  }

  return { start: null, end: null };
}

/**
 * Find the best matching header column from a row of cells.
 */
function findColumn(headers, ...candidates) {
  for (const candidate of candidates) {
    const idx = headers.findIndex(h =>
      h && h.toString().toLowerCase().includes(candidate.toLowerCase())
    );
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * Preview contract import — parse Excel and return rows with match info.
 */
export async function previewContractImport(farmId, buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const [commodities, counterparties, existingContracts] = await Promise.all([
    prisma.commodity.findMany({ where: { farm_id: farmId } }),
    prisma.counterparty.findMany({ where: { farm_id: farmId } }),
    prisma.marketingContract.findMany({ where: { farm_id: farmId }, select: { contract_number: true } }),
  ]);

  const existingContractSet = new Set(existingContracts.map(c => c.contract_number));

  const contracts = [];
  const errors = [];
  const newCounterparties = new Set();

  for (const sheet of workbook.worksheets) {
    const sheetName = sheet.name.trim();
    const cropKey = sheetName.toLowerCase().replace(/\s+/g, '');

    // Match commodity from sheet name
    let commodityName = null;
    for (const [key, name] of Object.entries(CROP_NAME_MAP)) {
      if (cropKey.includes(key.replace(/\s+/g, ''))) {
        commodityName = name;
        break;
      }
    }
    if (!commodityName) commodityName = sheetName; // fallback to sheet name

    const matchedCommodity = commodities.find(c =>
      c.name.toLowerCase() === commodityName.toLowerCase() ||
      c.code.toLowerCase() === commodityName.toLowerCase() ||
      c.name.toLowerCase().includes(commodityName.toLowerCase()) ||
      commodityName.toLowerCase().includes(c.name.toLowerCase())
    );

    // Parse header row (row 1)
    const headerRow = sheet.getRow(1);
    const headers = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      headers[colNumber - 1] = cell.value?.toString() || '';
    });

    if (headers.length === 0) continue;

    const colDate = findColumn(headers, 'Contract Date', 'Date');
    const colCustomer = findColumn(headers, 'Customer', 'Buyer');
    const colContractNum = findColumn(headers, 'Contract #', 'Contract Number', 'Contract No');
    const colQuantity = findColumn(headers, 'Quantity mt', 'Quantity', 'Qty');
    const colPrice = findColumn(headers, 'Price /mt', 'Price', 'Price/mt');
    const colDelivery = findColumn(headers, 'Delivery Period', 'Delivery');
    const colTerms = findColumn(headers, 'Additional Terms', 'Terms', 'Notes');
    const colCompleted = findColumn(headers, 'Completed', 'Complete', 'Status');

    // Process data rows
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // skip header

      const getValue = (colIdx) => {
        if (colIdx < 0) return null;
        const cell = row.getCell(colIdx + 1);
        return cell.value;
      };

      const contractNumber = getValue(colContractNum)?.toString()?.trim();
      if (!contractNumber) return; // skip rows without contract number

      const customerName = getValue(colCustomer)?.toString()?.trim();
      const quantityMt = parseFloat(getValue(colQuantity)) || 0;
      const priceMt = parseFloat(getValue(colPrice)) || null;
      const deliveryPeriodText = getValue(colDelivery)?.toString()?.trim();
      const additionalTerms = getValue(colTerms)?.toString()?.trim();
      const completed = getValue(colCompleted);

      // Parse contract date
      let contractDate = null;
      const dateVal = getValue(colDate);
      if (dateVal instanceof Date) {
        contractDate = dateVal;
      } else if (dateVal) {
        const d = new Date(dateVal);
        if (!isNaN(d.getTime())) contractDate = d;
      }

      // Parse delivery period
      const { start: deliveryStart, end: deliveryEnd } = parseDeliveryPeriod(deliveryPeriodText);

      // Match counterparty
      const matchedCounterparty = customerName
        ? counterparties.find(cp =>
            cp.name.toLowerCase() === customerName.toLowerCase() ||
            cp.short_code.toLowerCase() === customerName.toLowerCase().replace(/\s+/g, '') ||
            cp.name.toLowerCase().includes(customerName.toLowerCase()) ||
            customerName.toLowerCase().includes(cp.name.toLowerCase())
          )
        : null;

      if (customerName && !matchedCounterparty) {
        newCounterparties.add(customerName);
      }

      // Determine completed status
      let isCompleted = false;
      if (completed === true || completed === 'true' || completed === 'TRUE' || completed === 'Yes') {
        isCompleted = true;
      }

      const isExisting = existingContractSet.has(contractNumber);

      contracts.push({
        sheet_name: sheetName,
        commodity_name: commodityName,
        commodity_id: matchedCommodity?.id || null,
        commodity_match: matchedCommodity?.name || null,
        contract_number: contractNumber,
        contract_date: contractDate?.toISOString()?.split('T')[0] || null,
        customer_name: customerName,
        counterparty_id: matchedCounterparty?.id || null,
        counterparty_match: matchedCounterparty?.name || null,
        quantity_mt: quantityMt,
        price_per_mt: priceMt,
        delivery_period: deliveryPeriodText,
        delivery_start: deliveryStart?.toISOString()?.split('T')[0] || null,
        delivery_end: deliveryEnd?.toISOString()?.split('T')[0] || null,
        additional_terms: additionalTerms,
        completed: isCompleted,
        is_existing: isExisting,
        status: isExisting ? 'update' : 'new',
      });
    });
  }

  return {
    contracts,
    errors,
    new_counterparties: [...newCounterparties],
    summary: {
      total: contracts.length,
      new_count: contracts.filter(c => c.status === 'new').length,
      update_count: contracts.filter(c => c.status === 'update').length,
      sheets_parsed: workbook.worksheets.length,
      unmatched_commodities: contracts.filter(c => !c.commodity_id).length,
      new_counterparties: newCounterparties.size,
    },
  };
}

/**
 * Commit parsed contracts to the database.
 * Creates missing counterparties, then upserts MarketingContracts.
 */
export async function commitContractImport(farmId, contracts, options = {}) {
  const { cropYear = '2025', createCounterparties = true } = options;
  const results = { created: 0, updated: 0, counterparties_created: 0, errors: [] };

  // Create missing counterparties first
  if (createCounterparties) {
    const newCpNames = new Set(
      contracts
        .filter(c => c.customer_name && !c.counterparty_id)
        .map(c => c.customer_name)
    );

    for (const name of newCpNames) {
      try {
        let cp = await prisma.counterparty.findFirst({
          where: { farm_id: farmId, name },
        });
        if (!cp) {
          const shortCode = await getNextCounterpartyCode(farmId);
          cp = await prisma.counterparty.create({
            data: { farm_id: farmId, name, short_code: shortCode, type: 'buyer' },
          });
          results.counterparties_created++;
        }

        // Update contract references
        for (const c of contracts) {
          if (c.customer_name === name && !c.counterparty_id) {
            c.counterparty_id = cp.id;
          }
        }
      } catch (err) {
        results.errors.push(`Counterparty "${name}": ${err.message}`);
      }
    }
  }

  // Upsert contracts
  for (const c of contracts) {
    if (!c.counterparty_id || !c.commodity_id) {
      results.errors.push(
        `Contract ${c.contract_number}: Missing ${!c.counterparty_id ? 'counterparty' : 'commodity'}`
      );
      continue;
    }

    try {
      const status = c.completed ? 'delivered' : 'executed';

      const data = {
        farm_id: farmId,
        contract_number: c.contract_number,
        crop_year: cropYear,
        commodity_id: c.commodity_id,
        counterparty_id: c.counterparty_id,
        contracted_mt: c.quantity_mt,
        remaining_mt: c.completed ? 0 : c.quantity_mt,
        price_per_mt: c.price_per_mt,
        delivery_start: c.delivery_start ? new Date(c.delivery_start) : null,
        delivery_end: c.delivery_end ? new Date(c.delivery_end) : null,
        notes: c.additional_terms || null,
        status,
      };

      await prisma.marketingContract.upsert({
        where: {
          farm_id_contract_number: { farm_id: farmId, contract_number: c.contract_number },
        },
        update: {
          contracted_mt: data.contracted_mt,
          remaining_mt: data.remaining_mt,
          price_per_mt: data.price_per_mt,
          delivery_start: data.delivery_start,
          delivery_end: data.delivery_end,
          notes: data.notes,
          status: data.status,
        },
        create: data,
      });

      if (c.is_existing) {
        results.updated++;
      } else {
        results.created++;
      }
    } catch (err) {
      results.errors.push(`Contract ${c.contract_number}: ${err.message}`);
    }
  }

  return results;
}
