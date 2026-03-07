/**
 * Seed agronomy data — realistic Saskatchewan agronomic plans
 * 40% Canola, 30% Durum, 30% specialty crop per region
 * Run: cd backend && node src/scripts/seedAgronomy.js
 */
import prisma from '../config/database.js';

const CROP_YEAR = 2026;

// ─── Farm Configuration ─────────────────────────────────────────────
// Each farm: 40% Canola, 30% Durum, 30% specialty (region-appropriate)
// Yields/prices reflect soil zone, rainfall, and regional averages
const FARM_PLANS = {
  Lewvan: {
    totalAcres: 24384,
    region: 'South SK', soilZone: 'Dark Brown', rainfall: 350,
    // Dark Brown soil — lower moisture, good for pulses
    // NH3 available at this farm (rig on-site)
    crops: [
      {
        crop: 'Canola', pct: 0.40, yield: 52, price: 14.75,
        nutrients: [2.75, -0.80, -0.45, 0.25], available_n: 22,
        cu_target: 0.5, b_target: 0.3, zn_target: 0.2,
      },
      {
        crop: 'Spring Durum Wheat', pct: 0.30, yield: 48, price: 9.25,
        nutrients: [2.15, -0.60, -0.45, 0.25], available_n: 20,
      },
      {
        crop: 'Large Green Lentils', pct: 0.30, yield: 30, price: 0.38,
        // price is $/lb for lentils (30 bu × ~60 lbs = 1800 lbs × $0.38 = $684/ac revenue)
        nutrients: [0, 0, 0, 0], available_n: 0,
      },
    ],
  },

  Hyas: {
    totalAcres: 12450,
    region: 'East SK', soilZone: 'Black', rainfall: 400,
    // Black soil — higher moisture, excellent cereal country
    // Good for canary seed — traditional East SK crop
    crops: [
      {
        crop: 'Canola', pct: 0.40, yield: 48, price: 14.75,
        nutrients: [2.75, -0.80, -0.45, 0.25], available_n: 25,
      },
      {
        crop: 'Spring Durum Wheat', pct: 0.30, yield: 52, price: 9.25,
        nutrients: [2.15, -0.60, -0.45, 0.25], available_n: 22,
      },
      {
        crop: 'Canary Seed', pct: 0.30, yield: 28, price: 0.32,
        // price $/lb — 28 bu × ~50 lbs = 1400 lbs × $0.32 = $448/ac
        nutrients: [1.50, -0.40, -0.30, 0.15], available_n: 18,
      },
    ],
  },

  Balcarres: {
    totalAcres: 15135,
    region: 'Central SK', soilZone: 'Black', rainfall: 380,
    // Qu'Appelle Valley area — good mixed farming, lentil country
    crops: [
      {
        crop: 'Canola', pct: 0.40, yield: 50, price: 14.75,
        nutrients: [2.75, -0.80, -0.45, 0.25], available_n: 24,
      },
      {
        crop: 'Spring Durum Wheat', pct: 0.30, yield: 50, price: 9.25,
        nutrients: [2.15, -0.60, -0.45, 0.25], available_n: 21,
      },
      {
        crop: 'Small Red Lentils', pct: 0.30, yield: 32, price: 0.28,
        // 32 bu × ~60 lbs = 1920 lbs × $0.28 = $538/ac
        nutrients: [0, 0, 0, 0], available_n: 0,
      },
    ],
  },

  Stockholm: {
    totalAcres: 19995,
    region: 'East SK', soilZone: 'Dark Brown', rainfall: 360,
    // Transitional zone — good for flax as specialty
    crops: [
      {
        crop: 'Canola', pct: 0.40, yield: 48, price: 14.75,
        nutrients: [2.75, -0.80, -0.45, 0.25], available_n: 20,
      },
      {
        crop: 'Spring Durum Wheat', pct: 0.30, yield: 48, price: 9.25,
        nutrients: [2.15, -0.60, -0.45, 0.25], available_n: 19,
      },
      {
        crop: 'Flax', pct: 0.30, yield: 28, price: 13.50,
        // $/bu — 28 bu × $13.50 = $378/ac
        nutrients: [1.60, -0.50, -0.30, 0.20], available_n: 15,
      },
    ],
  },

  Provost: {
    totalAcres: 2800,
    region: 'East AB', soilZone: 'Brown', rainfall: 310,
    // Dryland Brown soil — smaller farm, lower yields, chickpeas do well
    crops: [
      {
        crop: 'Canola', pct: 0.40, yield: 42, price: 14.75,
        nutrients: [2.75, -0.80, -0.45, 0.25], available_n: 15,
      },
      {
        crop: 'Spring Durum Wheat', pct: 0.30, yield: 42, price: 9.25,
        nutrients: [2.15, -0.60, -0.45, 0.25], available_n: 14,
      },
      {
        crop: 'Chickpeas', pct: 0.30, yield: 38, price: 0.42,
        // $/lb — Kabuli desi: 38 bu × ~60 lbs = 2280 lbs × $0.42 = $958/ac
        nutrients: [0, 0, 0, 0], available_n: 0,
      },
    ],
  },

  Ridgedale: {
    totalAcres: 8924,
    region: 'North SK', soilZone: 'Black', rainfall: 420,
    // Northern Black soil — high moisture, excellent for peas
    crops: [
      {
        crop: 'Canola', pct: 0.40, yield: 50, price: 14.75,
        nutrients: [2.75, -0.80, -0.45, 0.25], available_n: 28,
      },
      {
        crop: 'Spring Durum Wheat', pct: 0.30, yield: 55, price: 9.25,
        nutrients: [2.15, -0.60, -0.45, 0.25], available_n: 24,
      },
      {
        crop: 'Yellow Field Peas', pct: 0.30, yield: 55, price: 8.50,
        // $/bu — 55 bu × $8.50 = $468/ac
        nutrients: [0, 0, 0, 0], available_n: 0,
      },
    ],
  },

  Ogema: {
    totalAcres: 10120,
    region: 'South SK', soilZone: 'Dark Brown', rainfall: 340,
    // Southern SK — dry, warm summers, classic mustard/lentil country
    crops: [
      {
        crop: 'Canola', pct: 0.40, yield: 46, price: 14.75,
        nutrients: [2.75, -0.80, -0.45, 0.25], available_n: 18,
      },
      {
        crop: 'Spring Durum Wheat', pct: 0.30, yield: 45, price: 9.25,
        nutrients: [2.15, -0.60, -0.45, 0.25], available_n: 17,
      },
      {
        crop: 'Yellow Mustard', pct: 0.30, yield: 22, price: 0.35,
        // $/lb — 22 bu × ~50 lbs = 1100 lbs × $0.35 = $385/ac
        nutrients: [1.80, -0.50, -0.30, 0.15], available_n: 12,
      },
    ],
  },
};

// ─── Input Programs ─────────────────────────────────────────────────
// Realistic 2025-2026 western Canada input costs

// Canola — Lewvan gets NH3 (own rig), everyone else dry blend
function getCanolaInputs(farmName, soilZone, availableN, targetYield) {
  const nRequired = Math.round(targetYield * 2.75);
  const nToApply = nRequired - (availableN || 0);

  const seed = [
    { category: 'seed', product_name: 'InVigor L233P', rate: 5, rate_unit: 'lbs/acre', cost_per_unit: 12.50, sort_order: 0 },
    { category: 'seed_treatment', product_name: 'Prosper EverGol', rate: 1, rate_unit: 'per acre', cost_per_unit: 9.25, sort_order: 1 },
  ];

  let fert;
  if (farmName === 'Lewvan') {
    // NH3 rig — split N between NH3 (fall) and side-banded urea (spring)
    const nh3Lbs = Math.round(nToApply * 0.55 / 0.82); // 55% of N via NH3
    const ureaLbs = Math.round(nToApply * 0.45 / 0.46); // 45% via treated urea
    fert = [
      { category: 'fertilizer', product_name: 'NH3', product_analysis: '82-0-0', form: 'nh3', rate: nh3Lbs, rate_unit: 'lbs/acre', cost_per_unit: 0.52, sort_order: 10 },
      { category: 'fertilizer', product_name: 'Treated Urea', product_analysis: '46-0-0', form: 'dry', rate: ureaLbs, rate_unit: 'lbs/acre', cost_per_unit: 0.3834, sort_order: 11 },
      { category: 'fertilizer', product_name: 'MAP', product_analysis: '11-52-0', form: 'dry', rate: 90, rate_unit: 'lbs/acre', cost_per_unit: 0.5299, sort_order: 12 },
      { category: 'fertilizer', product_name: 'Potash', product_analysis: '0-0-60', form: 'dry', rate: 50, rate_unit: 'lbs/acre', cost_per_unit: 0.294, sort_order: 13 },
      { category: 'fertilizer', product_name: 'AMS', product_analysis: '21-0-0-24', form: 'dry', rate: 30, rate_unit: 'lbs/acre', cost_per_unit: 0.30, sort_order: 14 },
    ];
  } else {
    // Dry blend — all N via treated urea + MAP
    const mapLbs = soilZone === 'Black' ? 80 : 70;
    const potashLbs = soilZone === 'Black' ? 40 : 55;
    const nFromMap = Math.round(mapLbs * 0.11);
    const ureaLbs = Math.round((nToApply - nFromMap) / 0.46);
    fert = [
      { category: 'fertilizer', product_name: 'Treated Urea', product_analysis: '46-0-0', form: 'dry', rate: Math.max(ureaLbs, 0), rate_unit: 'lbs/acre', cost_per_unit: 0.3834, sort_order: 10 },
      { category: 'fertilizer', product_name: 'MAP', product_analysis: '11-52-0', form: 'dry', rate: mapLbs, rate_unit: 'lbs/acre', cost_per_unit: 0.5299, sort_order: 11 },
      { category: 'fertilizer', product_name: 'Potash', product_analysis: '0-0-60', form: 'dry', rate: potashLbs, rate_unit: 'lbs/acre', cost_per_unit: 0.294, sort_order: 12 },
      { category: 'fertilizer', product_name: 'AMS', product_analysis: '21-0-0-24', form: 'dry', rate: 25, rate_unit: 'lbs/acre', cost_per_unit: 0.30, sort_order: 13 },
    ];
  }

  const chem = [
    { category: 'chemical', product_name: 'Glyphosate', timing: 'preburn', rate: 0.67, rate_unit: 'L/acre', cost_per_unit: 5.50, sort_order: 20 },
    { category: 'chemical', product_name: 'Heat LQ', timing: 'preburn', rate: 0.02, rate_unit: 'L/acre', cost_per_unit: 210.00, sort_order: 21 },
    { category: 'chemical', product_name: 'Liberty 200SN', timing: 'incrop', rate: 1.25, rate_unit: 'L/acre', cost_per_unit: 11.75, sort_order: 22 },
    { category: 'chemical', product_name: 'Centurion', timing: 'incrop', rate: 0.10, rate_unit: 'L/acre', cost_per_unit: 68.00, sort_order: 23 },
    { category: 'chemical', product_name: 'Cotegra', timing: 'fungicide', rate: 0.20, rate_unit: 'L/acre', cost_per_unit: 82.00, sort_order: 24 },
    { category: 'chemical', product_name: 'Glyphosate 540', timing: 'desiccation', rate: 0.50, rate_unit: 'L/acre', cost_per_unit: 5.50, sort_order: 25 },
  ];

  return [...seed, ...fert, ...chem];
}

// Durum — high protein cereal, needs good N, fungicide critical for FHB
function getDurumInputs(soilZone, availableN, targetYield) {
  const nRequired = Math.round(targetYield * 2.15);
  const nToApply = nRequired - (availableN || 0);
  const mapLbs = soilZone === 'Black' ? 40 : 35;
  const nFromMap = Math.round(mapLbs * 0.11);
  const ureaLbs = Math.round((nToApply - nFromMap) / 0.46);
  const potashLbs = soilZone === 'Black' ? 30 : 25;

  return [
    { category: 'seed', product_name: 'CDC Fortitude', rate: 100, rate_unit: 'lbs/acre', cost_per_unit: 0.38, sort_order: 0 },
    { category: 'seed_treatment', product_name: 'Raxil PRO', rate: 1, rate_unit: 'per acre', cost_per_unit: 5.80, sort_order: 1 },
    // Fert
    { category: 'fertilizer', product_name: 'Treated Urea', product_analysis: '46-0-0', form: 'dry', rate: Math.max(ureaLbs, 0), rate_unit: 'lbs/acre', cost_per_unit: 0.3834, sort_order: 10 },
    { category: 'fertilizer', product_name: 'MAP', product_analysis: '11-52-0', form: 'dry', rate: mapLbs, rate_unit: 'lbs/acre', cost_per_unit: 0.5299, sort_order: 11 },
    { category: 'fertilizer', product_name: 'Potash', product_analysis: '0-0-60', form: 'dry', rate: potashLbs, rate_unit: 'lbs/acre', cost_per_unit: 0.294, sort_order: 12 },
    // Chem
    { category: 'chemical', product_name: 'Glyphosate', timing: 'preburn', rate: 0.67, rate_unit: 'L/acre', cost_per_unit: 5.50, sort_order: 20 },
    { category: 'chemical', product_name: 'Pixxaro', timing: 'incrop', rate: 0.20, rate_unit: 'L/acre', cost_per_unit: 44.00, sort_order: 21 },
    { category: 'chemical', product_name: 'Axial BIA', timing: 'incrop', rate: 0.24, rate_unit: 'L/acre', cost_per_unit: 46.00, sort_order: 22 },
    { category: 'chemical', product_name: 'Prosaro XTR', timing: 'fungicide', rate: 0.32, rate_unit: 'L/acre', cost_per_unit: 58.00, sort_order: 23 },
    { category: 'chemical', product_name: 'Glyphosate 540', timing: 'desiccation', rate: 0.67, rate_unit: 'L/acre', cost_per_unit: 5.50, sort_order: 24 },
  ];
}

// Large Green Lentils — Lewvan specialty
function getLargeGreenLentilInputs() {
  return [
    { category: 'seed', product_name: 'CDC Greenstar', rate: 75, rate_unit: 'lbs/acre', cost_per_unit: 0.55, sort_order: 0 },
    { category: 'seed_treatment', product_name: 'Vibrance Maxx + Nodulator XL', rate: 1, rate_unit: 'per acre', cost_per_unit: 14.50, sort_order: 1 },
    // No fertilizer — biological N fixation, P/K from previous crop residue
    { category: 'fertilizer', product_name: 'MAP', product_analysis: '11-52-0', form: 'dry', rate: 20, rate_unit: 'lbs/acre', cost_per_unit: 0.5299, sort_order: 10 },
    // Chem — pulse-specific
    { category: 'chemical', product_name: 'Authority Supreme', timing: 'fall_residual', rate: 0.14, rate_unit: 'L/acre', cost_per_unit: 67.00, sort_order: 20 },
    { category: 'chemical', product_name: 'Glyphosate', timing: 'preburn', rate: 0.67, rate_unit: 'L/acre', cost_per_unit: 5.50, sort_order: 21 },
    { category: 'chemical', product_name: 'Odyssey DLX', timing: 'incrop', rate: 0.02, rate_unit: 'L/acre', cost_per_unit: 392.00, sort_order: 22 },
    { category: 'chemical', product_name: 'Headline', timing: 'fungicide', rate: 0.16, rate_unit: 'L/acre', cost_per_unit: 62.00, sort_order: 23 },
    { category: 'chemical', product_name: 'Reglone', timing: 'desiccation', rate: 0.40, rate_unit: 'L/acre', cost_per_unit: 18.50, sort_order: 24 },
  ];
}

// Small Red Lentils — Balcarres
function getSmallRedLentilInputs() {
  return [
    { category: 'seed', product_name: 'CDC Maxim CL', rate: 55, rate_unit: 'lbs/acre', cost_per_unit: 0.48, sort_order: 0 },
    { category: 'seed_treatment', product_name: 'Vibrance Maxx + Nodulator XL', rate: 1, rate_unit: 'per acre', cost_per_unit: 14.50, sort_order: 1 },
    { category: 'fertilizer', product_name: 'MAP', product_analysis: '11-52-0', form: 'dry', rate: 20, rate_unit: 'lbs/acre', cost_per_unit: 0.5299, sort_order: 10 },
    { category: 'chemical', product_name: 'Authority Supreme', timing: 'fall_residual', rate: 0.14, rate_unit: 'L/acre', cost_per_unit: 67.00, sort_order: 20 },
    { category: 'chemical', product_name: 'Glyphosate', timing: 'preburn', rate: 0.67, rate_unit: 'L/acre', cost_per_unit: 5.50, sort_order: 21 },
    { category: 'chemical', product_name: 'Odyssey DLX', timing: 'incrop', rate: 0.02, rate_unit: 'L/acre', cost_per_unit: 392.00, sort_order: 22 },
    { category: 'chemical', product_name: 'Elatus', timing: 'fungicide', rate: 0.14, rate_unit: 'L/acre', cost_per_unit: 75.00, sort_order: 23 },
    { category: 'chemical', product_name: 'Reglone', timing: 'desiccation', rate: 0.40, rate_unit: 'L/acre', cost_per_unit: 18.50, sort_order: 24 },
  ];
}

// Canary Seed — East SK specialty (Hyas)
function getCanarySeedInputs(soilZone, availableN, targetYield) {
  const nRequired = Math.round(targetYield * 1.50);
  const nToApply = nRequired - (availableN || 0);
  const ureaLbs = Math.round(nToApply / 0.46);

  return [
    { category: 'seed', product_name: 'CDC Calvi', rate: 12, rate_unit: 'lbs/acre', cost_per_unit: 1.65, sort_order: 0 },
    { category: 'seed_treatment', product_name: 'Raxil PRO', rate: 1, rate_unit: 'per acre', cost_per_unit: 4.20, sort_order: 1 },
    { category: 'fertilizer', product_name: 'Treated Urea', product_analysis: '46-0-0', form: 'dry', rate: Math.max(ureaLbs, 0), rate_unit: 'lbs/acre', cost_per_unit: 0.3834, sort_order: 10 },
    { category: 'fertilizer', product_name: 'MAP', product_analysis: '11-52-0', form: 'dry', rate: 30, rate_unit: 'lbs/acre', cost_per_unit: 0.5299, sort_order: 11 },
    { category: 'fertilizer', product_name: 'Potash', product_analysis: '0-0-60', form: 'dry', rate: 20, rate_unit: 'lbs/acre', cost_per_unit: 0.294, sort_order: 12 },
    { category: 'chemical', product_name: 'Glyphosate', timing: 'preburn', rate: 0.67, rate_unit: 'L/acre', cost_per_unit: 5.50, sort_order: 20 },
    { category: 'chemical', product_name: 'Bromoxynil', timing: 'incrop', rate: 0.40, rate_unit: 'L/acre', cost_per_unit: 14.00, sort_order: 21 },
    { category: 'chemical', product_name: 'Traxos', timing: 'incrop', rate: 0.30, rate_unit: 'L/acre', cost_per_unit: 42.00, sort_order: 22 },
    { category: 'chemical', product_name: 'Glyphosate 540', timing: 'desiccation', rate: 0.50, rate_unit: 'L/acre', cost_per_unit: 5.50, sort_order: 23 },
  ];
}

// Flax — Stockholm
function getFlaxInputs(soilZone, availableN, targetYield) {
  const nRequired = Math.round(targetYield * 1.60);
  const nToApply = nRequired - (availableN || 0);
  const ureaLbs = Math.round(nToApply / 0.46);

  return [
    { category: 'seed', product_name: 'CDC Glas', rate: 45, rate_unit: 'lbs/acre', cost_per_unit: 0.85, sort_order: 0 },
    { category: 'seed_treatment', product_name: 'Vitaflo 280', rate: 1, rate_unit: 'per acre', cost_per_unit: 3.50, sort_order: 1 },
    { category: 'fertilizer', product_name: 'Treated Urea', product_analysis: '46-0-0', form: 'dry', rate: Math.max(ureaLbs, 0), rate_unit: 'lbs/acre', cost_per_unit: 0.3834, sort_order: 10 },
    { category: 'fertilizer', product_name: 'MAP', product_analysis: '11-52-0', form: 'dry', rate: 35, rate_unit: 'lbs/acre', cost_per_unit: 0.5299, sort_order: 11 },
    { category: 'fertilizer', product_name: 'Potash', product_analysis: '0-0-60', form: 'dry', rate: 25, rate_unit: 'lbs/acre', cost_per_unit: 0.294, sort_order: 12 },
    { category: 'chemical', product_name: 'Glyphosate', timing: 'preburn', rate: 0.67, rate_unit: 'L/acre', cost_per_unit: 5.50, sort_order: 20 },
    { category: 'chemical', product_name: 'Poast Ultra', timing: 'incrop', rate: 0.16, rate_unit: 'L/acre', cost_per_unit: 52.00, sort_order: 21 },
    { category: 'chemical', product_name: 'Buctril M', timing: 'incrop', rate: 0.40, rate_unit: 'L/acre', cost_per_unit: 14.50, sort_order: 22 },
    { category: 'chemical', product_name: 'Glyphosate 540', timing: 'desiccation', rate: 0.67, rate_unit: 'L/acre', cost_per_unit: 5.50, sort_order: 23 },
  ];
}

// Chickpeas — Provost (Kabuli type, Brown soil)
function getChickpeaInputs() {
  return [
    { category: 'seed', product_name: 'CDC Leader', rate: 200, rate_unit: 'lbs/acre', cost_per_unit: 0.62, sort_order: 0 },
    { category: 'seed_treatment', product_name: 'Vibrance Maxx + Nodulator XL', rate: 1, rate_unit: 'per acre', cost_per_unit: 16.00, sort_order: 1 },
    { category: 'fertilizer', product_name: 'MAP', product_analysis: '11-52-0', form: 'dry', rate: 25, rate_unit: 'lbs/acre', cost_per_unit: 0.5299, sort_order: 10 },
    { category: 'chemical', product_name: 'Authority Supreme', timing: 'fall_residual', rate: 0.14, rate_unit: 'L/acre', cost_per_unit: 67.00, sort_order: 20 },
    { category: 'chemical', product_name: 'Glyphosate', timing: 'preburn', rate: 0.67, rate_unit: 'L/acre', cost_per_unit: 5.50, sort_order: 21 },
    { category: 'chemical', product_name: 'Odyssey DLX', timing: 'incrop', rate: 0.02, rate_unit: 'L/acre', cost_per_unit: 392.00, sort_order: 22 },
    { category: 'chemical', product_name: 'Dyax', timing: 'fungicide', rate: 0.10, rate_unit: 'L/acre', cost_per_unit: 98.00, sort_order: 23 },
    { category: 'chemical', product_name: 'Headline', timing: 'fungicide', rate: 0.16, rate_unit: 'L/acre', cost_per_unit: 62.00, sort_order: 24 },
    { category: 'chemical', product_name: 'Reglone', timing: 'desiccation', rate: 0.40, rate_unit: 'L/acre', cost_per_unit: 18.50, sort_order: 25 },
  ];
}

// Yellow Field Peas — Ridgedale
function getYellowPeaInputs() {
  return [
    { category: 'seed', product_name: 'CDC Meadow', rate: 175, rate_unit: 'lbs/acre', cost_per_unit: 0.28, sort_order: 0 },
    { category: 'seed_treatment', product_name: 'Vibrance Maxx + Nodulator XL', rate: 1, rate_unit: 'per acre', cost_per_unit: 13.00, sort_order: 1 },
    { category: 'fertilizer', product_name: 'MAP', product_analysis: '11-52-0', form: 'dry', rate: 20, rate_unit: 'lbs/acre', cost_per_unit: 0.5299, sort_order: 10 },
    { category: 'chemical', product_name: 'Authority Supreme', timing: 'fall_residual', rate: 0.14, rate_unit: 'L/acre', cost_per_unit: 67.00, sort_order: 20 },
    { category: 'chemical', product_name: 'Glyphosate', timing: 'preburn', rate: 0.67, rate_unit: 'L/acre', cost_per_unit: 5.50, sort_order: 21 },
    { category: 'chemical', product_name: 'Odyssey DLX', timing: 'incrop', rate: 0.02, rate_unit: 'L/acre', cost_per_unit: 392.00, sort_order: 22 },
    { category: 'chemical', product_name: 'Priaxor', timing: 'fungicide', rate: 0.12, rate_unit: 'L/acre', cost_per_unit: 85.00, sort_order: 23 },
    { category: 'chemical', product_name: 'Reglone', timing: 'desiccation', rate: 0.40, rate_unit: 'L/acre', cost_per_unit: 18.50, sort_order: 24 },
  ];
}

// Yellow Mustard — Ogema
function getYellowMustardInputs(soilZone, availableN, targetYield) {
  const nRequired = Math.round(targetYield * 1.80);
  const nToApply = nRequired - (availableN || 0);
  const ureaLbs = Math.round(nToApply / 0.46);

  return [
    { category: 'seed', product_name: 'Andante', rate: 7, rate_unit: 'lbs/acre', cost_per_unit: 1.10, sort_order: 0 },
    { category: 'seed_treatment', product_name: 'Helix Vibrance', rate: 1, rate_unit: 'per acre', cost_per_unit: 5.50, sort_order: 1 },
    { category: 'fertilizer', product_name: 'Treated Urea', product_analysis: '46-0-0', form: 'dry', rate: Math.max(ureaLbs, 0), rate_unit: 'lbs/acre', cost_per_unit: 0.3834, sort_order: 10 },
    { category: 'fertilizer', product_name: 'MAP', product_analysis: '11-52-0', form: 'dry', rate: 30, rate_unit: 'lbs/acre', cost_per_unit: 0.5299, sort_order: 11 },
    { category: 'fertilizer', product_name: 'Potash', product_analysis: '0-0-60', form: 'dry', rate: 20, rate_unit: 'lbs/acre', cost_per_unit: 0.294, sort_order: 12 },
    { category: 'chemical', product_name: 'Glyphosate', timing: 'preburn', rate: 0.67, rate_unit: 'L/acre', cost_per_unit: 5.50, sort_order: 20 },
    { category: 'chemical', product_name: 'Poast Ultra', timing: 'incrop', rate: 0.16, rate_unit: 'L/acre', cost_per_unit: 52.00, sort_order: 21 },
    { category: 'chemical', product_name: 'Muster', timing: 'incrop', rate: 0.004, rate_unit: 'L/acre', cost_per_unit: 1550.00, sort_order: 22 },
    { category: 'chemical', product_name: 'Glyphosate 540', timing: 'desiccation', rate: 0.50, rate_unit: 'L/acre', cost_per_unit: 5.50, sort_order: 23 },
  ];
}

function getInputProgram(crop, farmName, soilZone, availableN, targetYield) {
  switch (crop) {
    case 'Canola': return getCanolaInputs(farmName, soilZone, availableN, targetYield);
    case 'Spring Durum Wheat': return getDurumInputs(soilZone, availableN, targetYield);
    case 'Large Green Lentils': return getLargeGreenLentilInputs();
    case 'Small Red Lentils': return getSmallRedLentilInputs();
    case 'Canary Seed': return getCanarySeedInputs(soilZone, availableN, targetYield);
    case 'Flax': return getFlaxInputs(soilZone, availableN, targetYield);
    case 'Chickpeas': return getChickpeaInputs();
    case 'Yellow Field Peas': return getYellowPeaInputs();
    case 'Yellow Mustard': return getYellowMustardInputs(soilZone, availableN, targetYield);
    default: return [];
  }
}

// ─── Revenue calculation helper ─────────────────────────────────────
// Pulses/mustard priced in $/lb, cereals/oilseeds in $/bu
const LB_PRICED_CROPS = ['Large Green Lentils', 'Small Red Lentils', 'Chickpeas', 'Yellow Mustard', 'Canary Seed'];
const LBS_PER_BU = {
  'Large Green Lentils': 60,
  'Small Red Lentils': 60,
  'Chickpeas': 60,
  'Yellow Mustard': 50,
  'Canary Seed': 50,
};

function getCommodityPrice(crop, rawPrice) {
  // For $/lb crops, convert to $/bu for the database field (commodity_price is always $/bu)
  if (LB_PRICED_CROPS.includes(crop)) {
    return rawPrice * (LBS_PER_BU[crop] || 60);
  }
  return rawPrice;
}

// ─── Season Profiles ────────────────────────────────────────────────
const SEASON_PROFILES = {
  'Canola':              { apr_pct: 0.15, may_pct: 0.45, jun_pct: 0.15, jul_pct: 0.10, aug_pct: 0.10, sep_pct: 0.05, oct_pct: 0 },
  'Spring Durum Wheat':  { apr_pct: 0.10, may_pct: 0.45, jun_pct: 0.15, jul_pct: 0.10, aug_pct: 0.15, sep_pct: 0.05, oct_pct: 0 },
  'Large Green Lentils': { apr_pct: 0.15, may_pct: 0.40, jun_pct: 0.15, jul_pct: 0.10, aug_pct: 0.10, sep_pct: 0.10, oct_pct: 0 },
  'Small Red Lentils':   { apr_pct: 0.15, may_pct: 0.40, jun_pct: 0.15, jul_pct: 0.10, aug_pct: 0.10, sep_pct: 0.10, oct_pct: 0 },
  'Canary Seed':         { apr_pct: 0.10, may_pct: 0.45, jun_pct: 0.15, jul_pct: 0.10, aug_pct: 0.15, sep_pct: 0.05, oct_pct: 0 },
  'Flax':                { apr_pct: 0.10, may_pct: 0.40, jun_pct: 0.15, jul_pct: 0.15, aug_pct: 0.15, sep_pct: 0.05, oct_pct: 0 },
  'Chickpeas':           { apr_pct: 0.15, may_pct: 0.40, jun_pct: 0.15, jul_pct: 0.10, aug_pct: 0.10, sep_pct: 0.10, oct_pct: 0 },
  'Yellow Field Peas':   { apr_pct: 0.15, may_pct: 0.40, jun_pct: 0.15, jul_pct: 0.10, aug_pct: 0.10, sep_pct: 0.10, oct_pct: 0 },
  'Yellow Mustard':      { apr_pct: 0.10, may_pct: 0.40, jun_pct: 0.15, jul_pct: 0.15, aug_pct: 0.15, sep_pct: 0.05, oct_pct: 0 },
};

// ─── Product Reference Data ─────────────────────────────────────────
const PRODUCTS = [
  // Seeds
  { name: 'InVigor L233P', type: 'seed', crop_filter: 'Canola', default_unit: 'lbs/acre', default_rate: 5, default_cost: 12.50 },
  { name: 'L340PC', type: 'seed', crop_filter: 'Canola', default_unit: 'lbs/acre', default_rate: 5, default_cost: 12.50 },
  { name: 'CDC Fortitude', type: 'seed', crop_filter: 'Spring Durum Wheat', default_unit: 'lbs/acre', default_rate: 100, default_cost: 0.38 },
  { name: 'CDC Greenstar', type: 'seed', crop_filter: 'Large Green Lentils', default_unit: 'lbs/acre', default_rate: 75, default_cost: 0.55 },
  { name: 'CDC Maxim CL', type: 'seed', crop_filter: 'Small Red Lentils', default_unit: 'lbs/acre', default_rate: 55, default_cost: 0.48 },
  { name: 'CDC Calvi', type: 'seed', crop_filter: 'Canary Seed', default_unit: 'lbs/acre', default_rate: 12, default_cost: 1.65 },
  { name: 'CDC Glas', type: 'seed', crop_filter: 'Flax', default_unit: 'lbs/acre', default_rate: 45, default_cost: 0.85 },
  { name: 'CDC Leader', type: 'seed', crop_filter: 'Chickpeas', default_unit: 'lbs/acre', default_rate: 200, default_cost: 0.62 },
  { name: 'CDC Meadow', type: 'seed', crop_filter: 'Yellow Field Peas', default_unit: 'lbs/acre', default_rate: 175, default_cost: 0.28 },
  { name: 'Andante', type: 'seed', crop_filter: 'Yellow Mustard', default_unit: 'lbs/acre', default_rate: 7, default_cost: 1.10 },
  // Fertilizers
  { name: 'NH3', type: 'fertilizer', analysis_code: '82-0-0', form: 'nh3', default_unit: 'lbs/acre', default_cost: 0.52 },
  { name: 'Treated Urea', type: 'fertilizer', analysis_code: '46-0-0', form: 'dry', default_unit: 'lbs/acre', default_cost: 0.3834 },
  { name: 'MAP', type: 'fertilizer', analysis_code: '11-52-0', form: 'dry', default_unit: 'lbs/acre', default_cost: 0.5299 },
  { name: 'Potash', type: 'fertilizer', analysis_code: '0-0-60', form: 'dry', default_unit: 'lbs/acre', default_cost: 0.294 },
  { name: 'AMS', type: 'fertilizer', analysis_code: '21-0-0-24', form: 'dry', default_unit: 'lbs/acre', default_cost: 0.30 },
  // Chemicals
  { name: 'Glyphosate', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 5.50 },
  { name: 'Glyphosate 540', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 5.50 },
  { name: 'Heat LQ', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 210.00 },
  { name: 'Liberty 200SN', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 11.75 },
  { name: 'Centurion', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 68.00 },
  { name: 'Pixxaro', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 44.00 },
  { name: 'Axial BIA', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 46.00 },
  { name: 'Odyssey DLX', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 392.00 },
  { name: 'Authority Supreme', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 67.00 },
  { name: 'Bromoxynil', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 14.00 },
  { name: 'Traxos', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 42.00 },
  { name: 'Poast Ultra', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 52.00 },
  { name: 'Buctril M', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 14.50 },
  { name: 'Muster', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 1550.00 },
  // Fungicides
  { name: 'Cotegra', type: 'chemical', sub_type: 'fungicide', default_unit: 'L/acre', default_cost: 82.00 },
  { name: 'Prosaro XTR', type: 'chemical', sub_type: 'fungicide', default_unit: 'L/acre', default_cost: 58.00 },
  { name: 'Headline', type: 'chemical', sub_type: 'fungicide', default_unit: 'L/acre', default_cost: 62.00 },
  { name: 'Elatus', type: 'chemical', sub_type: 'fungicide', default_unit: 'L/acre', default_cost: 75.00 },
  { name: 'Dyax', type: 'chemical', sub_type: 'fungicide', default_unit: 'L/acre', default_cost: 98.00 },
  { name: 'Priaxor', type: 'chemical', sub_type: 'fungicide', default_unit: 'L/acre', default_cost: 85.00 },
  // Desiccant
  { name: 'Reglone', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 18.50 },
  // Seed treatments (reference)
  { name: 'Prosper EverGol', type: 'chemical', sub_type: 'seed_treatment', default_unit: 'per acre', default_cost: 9.25 },
  { name: 'Raxil PRO', type: 'chemical', sub_type: 'seed_treatment', default_unit: 'per acre', default_cost: 5.80 },
  { name: 'Vibrance Maxx + Nodulator XL', type: 'chemical', sub_type: 'seed_treatment', default_unit: 'per acre', default_cost: 14.50 },
  { name: 'Vitaflo 280', type: 'chemical', sub_type: 'seed_treatment', default_unit: 'per acre', default_cost: 3.50 },
  { name: 'Helix Vibrance', type: 'chemical', sub_type: 'seed_treatment', default_unit: 'per acre', default_cost: 5.50 },
];

// ─── Main seed function ─────────────────────────────────────────────
async function seed() {
  const farms = await prisma.farm.findMany();
  if (!farms.length) {
    console.error('No farms found. Run the main seed first.');
    process.exit(1);
  }

  const farmMap = Object.fromEntries(farms.map(f => [f.name, f.id]));
  console.log(`Found ${farms.length} farms: ${farms.map(f => f.name).join(', ')}`);

  // Clean existing agronomy data
  console.log('Cleaning existing agronomy data...');
  await prisma.cropInput.deleteMany({});
  await prisma.cropAllocation.deleteMany({});
  await prisma.agroPlan.deleteMany({});
  await prisma.agroProduct.deleteMany({});
  await prisma.seasonProfile.deleteMany({});

  // Use the first farm's ID for products (they're shared reference data)
  const refFarmId = farms[0].id;

  // Seed products
  console.log('\nSeeding product reference data...');
  for (const p of PRODUCTS) {
    await prisma.agroProduct.create({ data: { farm_id: refFarmId, ...p } });
  }
  console.log(`  ${PRODUCTS.length} products created`);

  // Seed season profiles for each farm
  console.log('Seeding season profiles...');
  let profileCount = 0;
  for (const farm of farms) {
    for (const [crop, pcts] of Object.entries(SEASON_PROFILES)) {
      await prisma.seasonProfile.create({
        data: { farm_id: farm.id, crop, crop_year: CROP_YEAR, ...pcts },
      });
      profileCount++;
    }
  }
  console.log(`  ${profileCount} profiles created`);

  // Create plans per farm
  console.log('\nCreating agronomy plans...');
  let totalAllocs = 0;
  let totalInputs = 0;

  for (const [farmName, cfg] of Object.entries(FARM_PLANS)) {
    const farmId = farmMap[farmName];
    if (!farmId) {
      console.warn(`  SKIP: Farm "${farmName}" not found in database`);
      continue;
    }

    console.log(`\n  ${farmName} (${cfg.totalAcres} ac, ${cfg.soilZone} soil, ${cfg.rainfall}mm rain)`);

    const plan = await prisma.agroPlan.create({
      data: {
        farm_id: farmId,
        crop_year: CROP_YEAR,
        status: 'approved',
        prepared_by: 'Tyson Hunter',
        approved_by: 'Michael C.',
        approved_at: new Date(),
      },
    });

    let sortOrder = 0;
    for (const cropCfg of cfg.crops) {
      const acres = Math.round(cfg.totalAcres * cropCfg.pct);
      const commodityPrice = getCommodityPrice(cropCfg.crop, cropCfg.price);

      console.log(`    ${cropCfg.crop}: ${acres} ac, ${cropCfg.yield} bu/ac, $${commodityPrice.toFixed(2)}/bu`);

      const allocation = await prisma.cropAllocation.create({
        data: {
          plan_id: plan.id,
          crop: cropCfg.crop,
          acres,
          target_yield_bu: cropCfg.yield,
          commodity_price: commodityPrice,
          sort_order: sortOrder++,
          n_rate_per_bu: cropCfg.nutrients[0] || null,
          p_rate_per_bu: cropCfg.nutrients[1] || null,
          k_rate_per_bu: cropCfg.nutrients[2] || null,
          s_rate_per_bu: cropCfg.nutrients[3] || null,
          available_n: cropCfg.available_n || null,
          cu_target: cropCfg.cu_target || null,
          b_target: cropCfg.b_target || null,
          zn_target: cropCfg.zn_target || null,
        },
      });

      const inputs = getInputProgram(
        cropCfg.crop, farmName, cfg.soilZone,
        cropCfg.available_n, cropCfg.yield
      );

      for (const inp of inputs) {
        await prisma.cropInput.create({
          data: { allocation_id: allocation.id, ...inp },
        });
      }

      // Summarize cost
      let seedCost = 0, fertCost = 0, chemCost = 0;
      for (const inp of inputs) {
        const lineCost = inp.rate * inp.cost_per_unit;
        if (inp.category === 'seed' || inp.category === 'seed_treatment') seedCost += lineCost;
        else if (inp.category === 'fertilizer') fertCost += lineCost;
        else if (inp.category === 'chemical') chemCost += lineCost;
      }
      console.log(`      Seed: $${seedCost.toFixed(2)}/ac | Fert: $${fertCost.toFixed(2)}/ac | Chem: $${chemCost.toFixed(2)}/ac | Total: $${(seedCost + fertCost + chemCost).toFixed(2)}/ac`);

      totalAllocs++;
      totalInputs += inputs.length;
    }
  }

  console.log('\n========================================');
  console.log('Agronomy seed complete!');
  console.log(`  Farms: ${Object.keys(FARM_PLANS).length}`);
  console.log(`  Allocations: ${totalAllocs}`);
  console.log(`  Inputs: ${totalInputs}`);
  console.log('========================================');
}

seed()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
