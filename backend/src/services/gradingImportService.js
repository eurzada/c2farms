import XLSX from 'xlsx';
import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';

const log = createLogger('grading-import');

// Column layout for EFU grading sheets
// 0=date, 1=bin/field, 2=bin_move, 3=status, 4=bushels, 5=variety, 6=comments, 7=grade,
// 8=reason, 9=dkg%, 10=prot%, 11=mst%, 12=twt
// Note: durum/canola sheets have slightly different column mappings for some quality fields

const COMMODITY_SHEET_MAP = {
  'WHEAT': { commodity: 'Spring Wheat', code: 'CWRS' },
  'DURUM': { commodity: 'Durum', code: 'CWAD' },
  'CANOLA': { commodity: 'Canola', code: 'CAN' },
  'GR LEN': { commodity: 'Lentils SG', code: 'LNSG' },
  'RED LEN': { commodity: 'Lentils SR', code: 'LNSR' },
  'YEL PEA': { commodity: 'Yellow Peas', code: 'PEAS' },
  'CHICKPEA': { commodity: 'Chickpeas', code: 'CHKP' },
  'BARLEY': { commodity: 'Barley', code: 'BARLY' },
  'OATS': { commodity: 'Oats', code: 'OATS' },
  'FLAXSEED': { commodity: 'Flaxseed', code: 'FLAX' },
  'RYE': { commodity: 'Rye', code: 'RYE' },
  'FABABEAN': { commodity: 'Fababean', code: 'FABA' },
};

// Location keywords → inventory location names
const LOCATION_PATTERNS = [
  { keywords: ['hyas'], location: 'Hyas' },
  { keywords: ['waldron'], location: 'Waldron' },
  { keywords: ['ridgedale', 'c2 ridgedale'], location: 'Ridgedale' },
  { keywords: ['balcarres'], location: 'Balcarres' },
  { keywords: ['ogema'], location: 'Ogema' },
  { keywords: ['lewvan'], location: 'Lewvan' },
  { keywords: ['stockholm'], location: 'Stockholm' },
  { keywords: ['lgx'], location: 'LGX' },
];

// Bin number ranges for bins that don't have location keywords
const BIN_NUMBER_RANGES = [
  { range: [100, 199], location: 'Lewvan' },   // Lewvan hopper bins
  { range: [200, 399], location: 'Lewvan' },   // Lewvan fields
  { range: [500, 599], location: 'Lewvan' },   // Lewvan fields
  { range: [600, 699], location: 'Ogema' },    // Ogema bins & fields
  { range: [700, 799], location: 'Ogema' },    // Ogema bins
  { range: [800, 899], location: 'Waldron' },  // Waldron fields
  { range: [900, 999], location: 'Ridgedale' }, // Ridgedale bins
];

function inferLocation(binField) {
  const lower = binField.toLowerCase();
  for (const { keywords, location } of LOCATION_PATTERNS) {
    if (keywords.some(kw => lower.includes(kw))) return location;
  }
  // Try numeric range inference
  const nums = binField.match(/\d+/);
  if (nums) {
    const n = parseInt(nums[0], 10);
    for (const { range, location } of BIN_NUMBER_RANGES) {
      if (n >= range[0] && n <= range[1]) return location;
    }
  }
  return null;
}

/**
 * Attempt to match an EFU bin/field reference to an InventoryBin.
 * Tries exact match first, then fuzzy matching on bin number extraction.
 */
function matchBin(binField, locationBins) {
  if (!locationBins.length) return null;

  const lower = binField.toLowerCase().trim();

  // Strategy 1: Extract bin number and try direct match
  const binPatterns = [
    /bin\s+(\S+)/i,          // "Bin 100", "Bin WA1"
    /(\bwa\d+\b)/i,          // "WA1", "WA41"
    /(\bs\d+\b)/i,           // "S1", "S13"
    /(?:balcarres|hyas|waldron|ridgedale|ogema|lewvan|stockholm)\s+(\d+)/i,
    /^(\d+)\s/,              // starts with number "712 "
    /^(\d+)$/,               // just a number "712"
    /^f(\d+)\s/i,            // "F622 BAG" → "622"
  ];

  for (const pat of binPatterns) {
    const m = lower.match(pat);
    if (m) {
      const extracted = m[1].trim();
      const match = locationBins.find(b => b.bin_number.toLowerCase() === extracted);
      if (match) return match;
    }
  }

  // Strategy 2: bag references — "208 bag 1", "Field 208 Bag 1+2", "F622 BAG"
  const bagMatch = lower.match(/(?:field\s+|f)?(\d+)\s*(?:bag|bags?)\s*(\d+)?/i);
  if (bagMatch) {
    const fieldNum = bagMatch[1];
    const bagNum = bagMatch[2];

    if (bagNum) {
      // Try exact "208 bag 1"
      const target = `${fieldNum} bag ${bagNum}`;
      const match = locationBins.find(b => b.bin_number.toLowerCase() === target);
      if (match) return match;
      // Case-sensitive variant
      const altMatch = locationBins.find(b => b.bin_number === `${fieldNum} Bag ${bagNum}`);
      if (altMatch) return altMatch;
    }

    // Try just the field number bins (e.g., "622 Bag 1" from "F622 BAG")
    const fieldMatch = locationBins.find(b => {
      const bn = b.bin_number.toLowerCase();
      return bn.startsWith(fieldNum + ' bag') || bn.startsWith(fieldNum + ' ');
    });
    if (fieldMatch) return fieldMatch;

    // Try bin number as just the field number
    const numMatch = locationBins.find(b => b.bin_number === fieldNum);
    if (numMatch) return numMatch;
  }

  // Strategy 3: "Bag R2", "R4 Grain Bag", "R1 Bag" → bins named with R/bag prefix
  const rBagMatch = lower.match(/\b(?:bag\s+)?r(\d+)\b/i);
  if (rBagMatch) {
    const rNum = rBagMatch[1];
    // Try "9106 Bag", "9107 Bag" etc. for Ridgedale
    const match = locationBins.find(b => {
      const bn = b.bin_number.toLowerCase();
      return bn.includes('bag') && bn.includes(rNum);
    });
    if (match) return match;
  }

  // Strategy 4: "Bag 1 (600/601 Ogema)" → bins starting with "600"
  const parenMatch = lower.match(/\((\d+)/);
  if (parenMatch) {
    const num = parenMatch[1];
    const match = locationBins.find(b => {
      const bn = b.bin_number.toLowerCase();
      return bn.startsWith(num + ' bag') || bn === num;
    });
    if (match) return match;
  }

  // Strategy 5: "Waldron 40" → "WA40", "Waldron 25, 31" → "WA25"
  const waldronNum = lower.match(/waldron\s+(\d+)/i);
  if (waldronNum) {
    const waNum = `wa${waldronNum[1]}`;
    const match = locationBins.find(b => b.bin_number.toLowerCase() === waNum);
    if (match) return match;
  }

  // Strategy 6: "Stockholm Bin 4" → "S4"
  const stkNum = lower.match(/stockholm.*?(\d+)/i);
  if (stkNum) {
    const sNum = `s${stkNum[1]}`;
    const match = locationBins.find(b => b.bin_number.toLowerCase() === sNum);
    if (match) return match;
  }

  // Strategy 7: "bag 652 field" → "652 bag 1"
  const looseBag = lower.match(/bag\s+(\d+)/i);
  if (looseBag) {
    const num = looseBag[1];
    const match = locationBins.find(b => b.bin_number.toLowerCase().startsWith(num));
    if (match) return match;
  }

  // Strategy 8: "Lewvan Field 642 Bag" → "Field 243 Bag" — just field number
  const fieldOnly = lower.match(/field\s+(\d+)/i);
  if (fieldOnly) {
    const fieldNum = fieldOnly[1];
    const match = locationBins.find(b => b.bin_number.toLowerCase().startsWith(fieldNum));
    if (match) return match;
  }

  // Strategy 9: Check if any bin number appears in the EFU reference
  for (const bin of locationBins) {
    const binLower = bin.bin_number.toLowerCase();
    if (binLower.length > 1 && lower.includes(binLower)) return bin;
  }

  return null;
}

/**
 * Parse the EFU .xlsb file and return preview data
 */
export async function importGradesFromEfu(farmId, buffer, filename) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  // Load locations and bins for matching
  const locations = await prisma.inventoryLocation.findMany({
    where: { farm_id: farmId },
  });
  const locationMap = {};
  for (const loc of locations) {
    locationMap[loc.name] = loc;
  }

  const allBins = await prisma.inventoryBin.findMany({
    where: { farm_id: farmId, is_active: true },
    include: { location: true, commodity: true },
  });
  const binsByLocation = {};
  for (const bin of allBins) {
    const locName = bin.location.name;
    if (!binsByLocation[locName]) binsByLocation[locName] = [];
    binsByLocation[locName].push(bin);
  }

  // Detect crop year from grade dates in the file
  let detectedCropYear = null;

  const entries = [];
  const unmatchedEntries = [];

  for (const sheetName of workbook.SheetNames) {
    const sheetConfig = COMMODITY_SHEET_MAP[sheetName];
    if (!sheetConfig) continue;

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

    // Find header row
    let headerIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i]?.[0] === 'GRADE DATE') { headerIdx = i; break; }
    }
    if (headerIdx < 0) continue;

    // Build column index from header
    const header = rows[headerIdx];
    const colIndex = {};
    for (let c = 0; c < header.length; c++) {
      const h = header[c];
      if (!h) continue;
      const hUpper = String(h).toUpperCase().trim();
      if (hUpper.includes('DKG')) colIndex.dkg = c;
      else if (hUpper.includes('PROT')) colIndex.prot = c;
      else if (hUpper.includes('MST') || hUpper === 'MOISTURE') colIndex.mst = c;
      else if (hUpper.includes('TWT') || hUpper.includes('TEST WEIGHT')) colIndex.twt = c;
      else if (hUpper.includes('HVK')) colIndex.hvk = c;
      else if (hUpper === 'FROST  (T-M-B)' || hUpper.includes('FROST')) colIndex.frost = c;
    }

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r[1] || !String(r[1]).trim()) continue;
      const binField = String(r[1]).trim();
      if (binField === 'BIN MOVE (IF COMPLETED)') continue;

      // Parse grade date
      let gradeDate = null;
      if (r[0]) {
        if (typeof r[0] === 'number') {
          const d = XLSX.SSF.parse_date_code(r[0]);
          if (d) {
            gradeDate = new Date(d.y, d.m - 1, d.d);
            if (!detectedCropYear) detectedCropYear = d.y >= 8 ? d.y : d.y;
          }
        }
      }

      const status = r[3] ? String(r[3]).trim() : '';
      const variety = r[5] ? String(r[5]).trim() : '';
      const grade = r[7] ? String(r[7]).trim() : '';
      const gradeReason = r[8] ? String(r[8]).trim() : '';

      // Quality metrics — use header-derived column indices
      const dkg = colIndex.dkg != null && r[colIndex.dkg] != null ? parseFloat(r[colIndex.dkg]) : null;
      const prot = colIndex.prot != null && r[colIndex.prot] != null ? parseFloat(r[colIndex.prot]) : null;
      const mst = colIndex.mst != null && r[colIndex.mst] != null ? parseFloat(r[colIndex.mst]) : null;
      const twt = colIndex.twt != null && r[colIndex.twt] != null ? parseFloat(r[colIndex.twt]) : null;
      const hvk = colIndex.hvk != null && r[colIndex.hvk] != null ? parseFloat(r[colIndex.hvk]) : null;

      // Infer location
      const locationName = inferLocation(binField);
      const location = locationName ? locationMap[locationName] : null;
      const locationBins = locationName ? (binsByLocation[locationName] || []) : [];

      // Match to inventory bin
      const matchedBin = location ? matchBin(binField, locationBins) : null;

      // Build a short grade for display
      let gradeShort = grade;
      // "Wheat, No.1 CWRS" → "1 CWRS"
      const gradeNum = grade.match(/No\.?\s*(\d+)\s*(.*)/);
      if (gradeNum) gradeShort = `${gradeNum[1]} ${gradeNum[2]}`.trim();
      // If grade is a reason code (durum), use it directly
      if (!gradeNum && grade) gradeShort = grade;

      const entry = {
        efu_bin_field: binField,
        sheet: sheetName,
        commodity: sheetConfig.commodity,
        location_name: locationName,
        location_id: location?.id || null,
        bin_id: matchedBin?.id || null,
        bin_number: matchedBin?.bin_number || null,
        matched: !!matchedBin,
        grade,
        grade_short: gradeShort,
        variety,
        grade_reason: gradeReason || (grade && !gradeNum ? grade : ''),
        protein_pct: !isNaN(prot) ? prot : null,
        moisture_pct: !isNaN(mst) ? mst : null,
        dockage_pct: !isNaN(dkg) ? dkg : null,
        test_weight: !isNaN(twt) ? twt : null,
        hvk_pct: !isNaN(hvk) ? hvk : null,
        grade_date: gradeDate,
        source: 'efu',
        status: status?.toLowerCase() === 'available' ? 'available' : status?.toLowerCase() || 'available',
      };

      if (matchedBin) {
        entries.push(entry);
      } else {
        unmatchedEntries.push(entry);
      }
    }
  }

  // Default crop year from dates, or current harvest year
  const now = new Date();
  const cropYear = detectedCropYear || (now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1);

  log.info(`EFU import preview: ${entries.length} matched, ${unmatchedEntries.length} unmatched from ${filename}`);

  return {
    matched: entries,
    unmatched: unmatchedEntries,
    crop_year: cropYear,
    total: entries.length + unmatchedEntries.length,
    match_rate: entries.length + unmatchedEntries.length > 0
      ? Math.round((entries.length / (entries.length + unmatchedEntries.length)) * 100)
      : 0,
  };
}

/**
 * Confirm and save matched grades to the database
 */
export async function confirmGradesImport(farmId, grades, cropYear) {
  let created = 0;
  let updated = 0;

  for (const g of grades) {
    if (!g.bin_id) continue;

    const data = {
      farm_id: farmId,
      bin_id: g.bin_id,
      crop_year: cropYear,
      grade: g.grade || '',
      grade_short: g.grade_short || null,
      variety: g.variety || null,
      grade_reason: g.grade_reason || null,
      protein_pct: g.protein_pct,
      moisture_pct: g.moisture_pct,
      dockage_pct: g.dockage_pct,
      test_weight: g.test_weight,
      hvk_pct: g.hvk_pct,
      inspector_notes: g.inspector_notes || null,
      source: g.source || 'efu',
      grade_date: g.grade_date ? new Date(g.grade_date) : null,
      status: g.status || 'available',
    };

    const existing = await prisma.binGrade.findUnique({
      where: { farm_id_bin_id_crop_year: { farm_id: farmId, bin_id: g.bin_id, crop_year: cropYear } },
    });

    if (existing) {
      await prisma.binGrade.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.binGrade.create({ data });
      created++;
    }
  }

  log.info(`EFU import confirmed: ${created} created, ${updated} updated for crop year ${cropYear}`);

  return { created, updated, total: created + updated, crop_year: cropYear };
}
