// Shared inventory constants — used by seed script and import service

export const COMMODITIES = [
  { name: 'Spring Wheat', code: 'CWRS', lbs_per_bu: 60 },
  { name: 'Durum', code: 'CWAD', lbs_per_bu: 60 },
  { name: 'Chickpeas', code: 'CHKP', lbs_per_bu: 60 },
  { name: 'Lentils SG', code: 'LNSG', lbs_per_bu: 60 },
  { name: 'Lentils SR', code: 'LNSR', lbs_per_bu: 60 },
  { name: 'Yellow Peas', code: 'YPEA', lbs_per_bu: 60 },
  { name: 'Fertilizer', code: 'FERT', lbs_per_bu: 60 },
  { name: 'Canola', code: 'CNLA', lbs_per_bu: 50 },
  { name: 'Canola - L358', code: 'L358', lbs_per_bu: 50 },
  { name: 'Canola - Nexera', code: 'NXRA', lbs_per_bu: 50 },
  { name: 'Canary Seed', code: 'CNRY', lbs_per_bu: 56 },
  { name: 'Barley', code: 'BRLY', lbs_per_bu: 48 },
];

export const LOCATIONS = [
  { name: 'Lewvan', code: 'LEW', cluster: 'central' },
  { name: 'Hyas', code: 'HYA', cluster: 'individual' },
  { name: 'Waldron', code: 'WAL', cluster: 'central' },
  { name: 'Balcarres', code: 'BAL', cluster: 'individual' },
  { name: 'Ridgedale', code: 'RDG', cluster: 'individual' },
  { name: 'Ogema', code: 'OGM', cluster: 'individual' },
  { name: 'Stockholm', code: 'STK', cluster: 'individual' },
  { name: 'LGX', code: 'LGX', cluster: 'transit' },
];

// Map commodity names (from Excel) to codes
export const COMMODITY_NAME_MAP = {
  'Spring Wheat': 'CWRS',
  'Durum': 'CWAD',
  'Chickpeas': 'CHKP',
  'Lentils SG': 'LNSG',
  'Lentils SR': 'LNSR',
  'Yellow Peas': 'YPEA',
  'Fertilizer': 'FERT',
  'Canola': 'CNLA',
  'Canola - L358': 'L358',
  'Canola - Nexera': 'NXRA',
  'Canary': 'CNRY',
  'Canary Seed': 'CNRY',
  'Barley': 'BRLY',
};

// Map contract crop names to commodity codes
export const CONTRACT_COMMODITY_MAP = {
  'CWRS': 'CWRS',
  'CWAD': 'CWAD',
  'Canola ': 'CNLA',
  'Canola': 'CNLA',
  'L358': 'L358',
  'Nexera': 'NXRA',
  'SG Lentils': 'LNSG',
  'Chickpeas': 'CHKP',
  'Barley': 'BRLY',
};

export function normalizeBinType(raw) {
  if (!raw) return 'hopper';
  const t = raw.toString().trim().toLowerCase();
  if (t.includes('flat')) return 'flat';
  if (t.includes('bag')) return 'bag';
  if (t.includes('hopper') || t.includes('jhopper')) return 'hopper';
  if (t.includes('fert')) return 'hopper';
  if (t.includes('dryer')) return 'dryer';
  return 'other';
}
