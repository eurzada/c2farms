import ExcelJS from 'exceljs';
import prisma from '../config/database.js';
import { convertBuToKg } from './inventoryService.js';
import {
  COMMODITIES, LOCATIONS, COMMODITY_NAME_MAP, CONTRACT_COMMODITY_MAP, normalizeBinType,
} from '../utils/inventoryConstants.js';

/**
 * Import inventory data from an Excel buffer (matches `2026 SK Inventory.xlsx` structure).
 * All operations are idempotent upserts — safe to re-import the same file.
 *
 * Expected workbook structure:
 *   - Snapshot sheets: named like "Oct 31" / "Nov 30" / "Dec 31" (inventory counts)
 *     Row 1 = headers, columns: Farm/Location, Bin #, Type, Capacity, Commodity, Bushels, Crop Year, Notes
 *   - "Contracts" sheet: buyer/crop/contracted/hauled
 */
export async function importInventoryFromExcel(farmId, buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const summary = { commodities: 0, locations: 0, bins: 0, binCounts: 0, contracts: 0, periods: 0 };
  const errors = [];

  // 1. Upsert commodities
  const commodityMap = {};
  for (const c of COMMODITIES) {
    const record = await prisma.commodity.upsert({
      where: { farm_id_code: { farm_id: farmId, code: c.code } },
      update: { name: c.name, lbs_per_bu: c.lbs_per_bu },
      create: { farm_id: farmId, name: c.name, code: c.code, lbs_per_bu: c.lbs_per_bu },
    });
    commodityMap[c.code] = record;
    summary.commodities++;
  }

  // 2. Upsert locations
  const locationMap = {};
  for (const loc of LOCATIONS) {
    const record = await prisma.inventoryLocation.upsert({
      where: { farm_id_code: { farm_id: farmId, code: loc.code } },
      update: { name: loc.name, cluster: loc.cluster },
      create: { farm_id: farmId, name: loc.name, code: loc.code, cluster: loc.cluster },
    });
    locationMap[loc.name] = record;
    summary.locations++;
  }

  // 3. Detect snapshot sheets — first by name pattern, then by column headers
  const snapshotPattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})$/i;
  const contractPattern = /contract/i;
  const snapshotSheets = [];

  // Helper: check if a sheet has inventory-like headers (Location + Bin #)
  function hasInventoryHeaders(sheet) {
    if (sheet.rowCount < 2) return false;
    const headerRow = sheet.getRow(1);
    let hasLocation = false, hasBin = false;
    headerRow.eachCell((cell) => {
      const val = (cell.value || '').toString().trim().toLowerCase();
      if (val.includes('farm') || val.includes('location')) hasLocation = true;
      if (val.includes('bin')) hasBin = true;
    });
    return hasLocation && hasBin;
  }

  workbook.eachSheet((sheet) => {
    const name = sheet.name.trim();
    // Match by name pattern first
    if (snapshotPattern.test(name)) {
      snapshotSheets.push(sheet);
    }
    // Fall back: any non-contract sheet with Location + Bin # headers
    else if (!contractPattern.test(name) && hasInventoryHeaders(sheet)) {
      snapshotSheets.push(sheet);
    }
  });

  if (snapshotSheets.length === 0) {
    errors.push('No snapshot sheets found (need sheets with Location and Bin # columns, or named like "Oct 31", "Nov 30")');
  }

  // Build period date from sheet name + infer year, or default to today
  function parsePeriodDate(sheetName) {
    const match = sheetName.trim().match(snapshotPattern);
    if (!match) {
      // Sheet detected by headers, not name — use today as the period date
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    const monthStr = match[1];
    const day = parseInt(match[2]);
    const monthIndex = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      .findIndex(m => m.toLowerCase() === monthStr.toLowerCase());
    // Use current crop year context: Oct-Dec = previous year, Jan-Sep = current year
    const now = new Date();
    let year = now.getFullYear();
    if (monthIndex >= 9) year = now.getFullYear() - 1; // Oct/Nov/Dec → last year
    return new Date(year, monthIndex, day);
  }

  // 4. Process each snapshot sheet
  const binMap = {};
  const periodMap = {};

  for (const sheet of snapshotSheets) {
    const periodDate = parsePeriodDate(sheet.name);
    if (!periodDate) {
      errors.push(`Could not parse date from sheet "${sheet.name}"`);
      continue;
    }

    // Upsert count period
    const isLastSheet = sheet === snapshotSheets[snapshotSheets.length - 1];
    const period = await prisma.countPeriod.upsert({
      where: { farm_id_period_date: { farm_id: farmId, period_date: periodDate } },
      update: { status: isLastSheet ? 'open' : 'closed', crop_year: periodDate.getMonth() >= 9 ? periodDate.getFullYear() : periodDate.getFullYear() - 1 },
      create: { farm_id: farmId, period_date: periodDate, crop_year: periodDate.getMonth() >= 9 ? periodDate.getFullYear() : periodDate.getFullYear() - 1, status: isLastSheet ? 'open' : 'closed' },
    });
    periodMap[sheet.name] = period;
    summary.periods++;

    // Parse header row to find columns
    const headerRow = sheet.getRow(1);
    const headers = {};
    headerRow.eachCell((cell, colNumber) => {
      const val = (cell.value || '').toString().trim().toLowerCase();
      if (val.includes('farm') || val.includes('location')) headers.location = colNumber;
      else if (val.includes('bin') && val.includes('#') || val === 'bin #' || val === 'bin') headers.bin_number = colNumber;
      else if (val.includes('type')) headers.type = colNumber;
      else if (val.includes('capac')) headers.capacity = colNumber;
      else if (val.includes('commod') || val.includes('grain') || val.includes('crop type')) headers.commodity = colNumber;
      else if (val.includes('bushel') || val === 'bu') headers.bushels = colNumber;
      else if (val.includes('crop') && val.includes('year')) headers.crop_year = colNumber;
      else if (val.includes('note')) headers.notes = colNumber;
    });

    if (!headers.location || !headers.bin_number) {
      errors.push(`Sheet "${sheet.name}": Could not find Location/Bin# columns in header row`);
      continue;
    }

    // Process data rows
    let currentLocation = null;
    for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);
      const locationVal = cellStr(row.getCell(headers.location));
      const binNumber = cellStr(row.getCell(headers.bin_number));

      // Track location from column (location cells may only appear on first row of group)
      if (locationVal && locationMap[locationVal]) {
        currentLocation = locationMap[locationVal];
      }

      if (!binNumber || !currentLocation) continue;

      const binType = headers.type ? normalizeBinType(cellStr(row.getCell(headers.type))) : 'hopper';
      const capacityRaw = headers.capacity ? cellNum(row.getCell(headers.capacity)) : null;
      const commodityName = headers.commodity ? cellStr(row.getCell(headers.commodity)) : null;
      const bushels = headers.bushels ? cellNum(row.getCell(headers.bushels)) : 0;
      const cropYear = headers.crop_year ? cellNum(row.getCell(headers.crop_year)) : null;
      const notes = headers.notes ? cellStr(row.getCell(headers.notes)) : null;

      const commodityCode = commodityName ? COMMODITY_NAME_MAP[commodityName] : null;
      const commodityId = commodityCode ? commodityMap[commodityCode]?.id : null;

      // Upsert bin (only once per location+bin_number)
      const binKey = `${currentLocation.id}|${binNumber}`;
      if (!binMap[binKey]) {
        const bin = await prisma.inventoryBin.upsert({
          where: {
            farm_id_location_id_bin_number: {
              farm_id: farmId,
              location_id: currentLocation.id,
              bin_number: binNumber,
            },
          },
          update: {
            bin_type: binType,
            capacity_bu: capacityRaw,
            commodity_id: commodityId,
          },
          create: {
            farm_id: farmId,
            location_id: currentLocation.id,
            bin_number: binNumber,
            bin_type: binType,
            capacity_bu: capacityRaw,
            commodity_id: commodityId,
          },
        });
        binMap[binKey] = bin;
        summary.bins++;
      }

      const bin = binMap[binKey];
      const lbsPerBu = commodityCode ? (commodityMap[commodityCode]?.lbs_per_bu || 60) : 60;
      const kg = convertBuToKg(bushels, lbsPerBu);

      // Upsert bin count
      await prisma.binCount.upsert({
        where: {
          farm_id_count_period_id_bin_id: {
            farm_id: farmId,
            count_period_id: period.id,
            bin_id: bin.id,
          },
        },
        update: {
          commodity_id: commodityId,
          bushels,
          kg,
          crop_year: cropYear ? parseInt(cropYear) : null,
          notes,
        },
        create: {
          farm_id: farmId,
          count_period_id: period.id,
          bin_id: bin.id,
          commodity_id: commodityId,
          bushels,
          kg,
          crop_year: cropYear ? parseInt(cropYear) : null,
          notes,
        },
      });
      summary.binCounts++;
    }

    // Create auto-approved submissions for all locations in this period
    for (const loc of Object.values(locationMap)) {
      await prisma.countSubmission.upsert({
        where: {
          farm_id_count_period_id_location_id: {
            farm_id: farmId,
            count_period_id: period.id,
            location_id: loc.id,
          },
        },
        update: { status: 'approved' },
        create: {
          farm_id: farmId,
          count_period_id: period.id,
          location_id: loc.id,
          status: 'approved',
          notes: 'Excel import',
        },
      });
    }
  }

  // 5. Process Contracts sheet
  const contractSheet = workbook.worksheets.find(
    s => s.name.toLowerCase().includes('contract')
  );

  if (contractSheet) {
    // Parse header
    const cHeaders = {};
    const cHeaderRow = contractSheet.getRow(1);
    cHeaderRow.eachCell((cell, colNumber) => {
      const val = (cell.value || '').toString().trim().toLowerCase();
      if (val.includes('buyer') || val.includes('name') || val.includes('company')) cHeaders.buyer = colNumber;
      else if (val.includes('crop') || val.includes('commodity') || val.includes('grain')) cHeaders.crop = colNumber;
      else if (val.includes('contract') && (val.includes('mt') || val.includes('tonne'))) cHeaders.contracted = colNumber;
      else if (val.includes('haul') || val.includes('deliver')) cHeaders.hauled = colNumber;
      else if (val.includes('contract') && val.includes('#') || val === 'contract #') cHeaders.number = colNumber;
    });

    if (cHeaders.buyer && cHeaders.crop) {
      let contractIdx = 0;
      for (let rowNum = 2; rowNum <= contractSheet.rowCount; rowNum++) {
        const row = contractSheet.getRow(rowNum);
        const buyer = cellStr(row.getCell(cHeaders.buyer));
        const crop = cellStr(row.getCell(cHeaders.crop));

        if (!buyer || !crop) continue;

        const commodityCode = CONTRACT_COMMODITY_MAP[crop];
        if (!commodityCode || !commodityMap[commodityCode]) {
          errors.push(`Contract row ${rowNum}: unknown crop "${crop}"`);
          continue;
        }

        const contractedVal = cHeaders.contracted ? cellNum(row.getCell(cHeaders.contracted)) : 0;
        const hauledVal = cHeaders.hauled ? cellNum(row.getCell(cHeaders.hauled)) : 0;

        // Values from Excel may be in kg — convert to MT
        const contractedMt = contractedVal > 100 ? contractedVal / 1000 : contractedVal;
        const hauledMt = hauledVal > 100 ? hauledVal / 1000 : hauledVal;
        const status = hauledMt >= contractedMt && contractedMt > 0 ? 'fulfilled' : 'open';
        const contractNumber = cHeaders.number ? cellStr(row.getCell(cHeaders.number)) : `C${String(++contractIdx).padStart(3, '0')}`;

        // Find existing contract by buyer + commodity or create new
        let contract = await prisma.contract.findFirst({
          where: {
            farm_id: farmId,
            buyer,
            commodity_id: commodityMap[commodityCode].id,
          },
        });

        if (contract) {
          contract = await prisma.contract.update({
            where: { id: contract.id },
            data: { contracted_mt: contractedMt, status, contract_number: contractNumber },
          });
        } else {
          contract = await prisma.contract.create({
            data: {
              farm_id: farmId,
              contract_number: contractNumber,
              buyer,
              commodity_id: commodityMap[commodityCode].id,
              contracted_mt: contractedMt,
              status,
            },
          });
        }

        // Upsert a single delivery record if there's hauled data
        if (hauledMt > 0) {
          const existingDelivery = await prisma.delivery.findFirst({
            where: { contract_id: contract.id },
          });
          if (existingDelivery) {
            await prisma.delivery.update({
              where: { id: existingDelivery.id },
              data: { mt_delivered: hauledMt },
            });
          } else {
            await prisma.delivery.create({
              data: {
                farm_id: farmId,
                contract_id: contract.id,
                mt_delivered: hauledMt,
                delivery_date: new Date(),
              },
            });
          }
        }

        summary.contracts++;
      }
    } else {
      errors.push('Contracts sheet: Could not find Buyer/Crop columns in header row');
    }
  }

  return { summary, errors };
}

// Helpers
function cellStr(cell) {
  if (!cell || cell.value == null) return '';
  const v = cell.value;
  if (typeof v === 'object' && v.richText) {
    return v.richText.map(r => r.text).join('').trim();
  }
  return v.toString().trim();
}

function cellNum(cell) {
  if (!cell || cell.value == null) return 0;
  const v = typeof cell.value === 'object' && cell.value.result !== undefined ? cell.value.result : cell.value;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}
