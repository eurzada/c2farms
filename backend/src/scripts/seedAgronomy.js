/**
 * Seed agronomy data from the Agronomic Worksheet Feb 26.xlsx
 * Run: cd backend && node src/scripts/seedAgronomy.js
 */
import prisma from '../config/database.js';

const CROP_YEAR = 2026;

// ─── Farm Master (from Excel) ───────────────────────────────────────
// Maps InventoryLocation names to agronomy farm data
const FARMS = [
  { name: 'Lewvan', region: 'South SK', soilZone: 'Dark Brown', rainfall: 350, totalAcres: 24384 },
  { name: 'Hyas', region: 'East SK', soilZone: 'Black', rainfall: 400, totalAcres: 12450 },
  { name: 'Balcarres', region: 'Central SK', soilZone: 'Black', rainfall: 380, totalAcres: 15135 },
  { name: 'Stockholm', region: 'East SK', soilZone: 'Dark Brown', rainfall: 360, totalAcres: 19995 },
  { name: 'Provost', region: 'East AB', soilZone: 'Brown', rainfall: 310, totalAcres: 7000 },
  { name: 'Ridgedale', region: 'North SK', soilZone: 'Black', rainfall: 420, totalAcres: 8924 },
];

// ─── Crop Allocations per farm ──────────────────────────────────────
// { crop, acres, yield, price, nutrients: [n_rate, p_rate, k_rate, s_rate], available_n }
const ALLOCATIONS = {
  Lewvan: [
    { crop: 'Canola', acres: 10607, yield: 55, price: 15.50, nutrients: [2.75, -0.8, -0.45, 0.25], available_n: 18, cu_target: 0.5, b_target: 0.3, zn_target: 0.2 },
    { crop: 'Spring Durum Wheat', acres: 9981, yield: 70, price: 7.75, nutrients: [2.15, -0.6, -0.45, 0.25], available_n: 17 },
    { crop: 'Chickpeas', acres: 3796, yield: 50, price: 18.00, nutrients: [0, 0, 0, 0], available_n: 0 },
  ],
  Hyas: [
    { crop: 'Canola', acres: 5301, yield: 50, price: 15.50, nutrients: [2.75, -0.8, -0.45, 0.25], available_n: 18 },
    { crop: 'Spring Wheat', acres: 4452, yield: 75, price: 7.50, nutrients: [2.0, -0.55, -0.4, 0.2], available_n: 17 },
    { crop: 'Spring Barley', acres: 1364, yield: 100, price: 5.00, nutrients: [1.6, -0.45, -0.35, 0.15], available_n: 15 },
    { crop: 'Small Red Lentils', acres: 317, yield: 40, price: 16.00, nutrients: [0, 0, 0, 0], available_n: 0 },
    { crop: 'Yellow Field Peas', acres: 1016, yield: 60, price: 8.50, nutrients: [0, 0, 0, 0], available_n: 0 },
  ],
  Stockholm: [
    { crop: 'Canola', acres: 9351, yield: 50, price: 15.50, nutrients: [2.75, -0.8, -0.45, 0.25], available_n: 18 },
    { crop: 'Spring Wheat', acres: 6662, yield: 75, price: 7.50, nutrients: [2.0, -0.55, -0.4, 0.2], available_n: 17 },
    { crop: 'Spring Barley', acres: 2057, yield: 100, price: 5.00, nutrients: [1.6, -0.45, -0.35, 0.15], available_n: 15 },
    { crop: 'Small Red Lentils', acres: 1925, yield: 40, price: 16.00, nutrients: [0, 0, 0, 0], available_n: 0 },
  ],
  Balcarres: [
    { crop: 'Canola', acres: 6771, yield: 50, price: 15.50, nutrients: [2.75, -0.8, -0.45, 0.25], available_n: 18 },
    { crop: 'Spring Durum Wheat', acres: 4246, yield: 70, price: 7.75, nutrients: [2.15, -0.6, -0.45, 0.25], available_n: 17 },
    { crop: 'Chickpeas', acres: 557, yield: 50, price: 18.00, nutrients: [0, 0, 0, 0], available_n: 0 },
    { crop: 'Small Red Lentils', acres: 1985, yield: 40, price: 16.00, nutrients: [0, 0, 0, 0], available_n: 0 },
  ],
  Provost: [
    { crop: 'Canola', acres: 3495, yield: 45, price: 15.50, nutrients: [2.75, -0.8, -0.45, 0.25], available_n: 15 },
    { crop: 'Spring Durum Wheat', acres: 2192, yield: 65, price: 7.75, nutrients: [2.15, -0.6, -0.45, 0.25], available_n: 15 },
    { crop: 'Chickpeas', acres: 288, yield: 45, price: 18.00, nutrients: [0, 0, 0, 0], available_n: 0 },
    { crop: 'Small Red Lentils', acres: 1025, yield: 35, price: 16.00, nutrients: [0, 0, 0, 0], available_n: 0 },
  ],
  Ridgedale: [
    { crop: 'Canola', acres: 3400, yield: 50, price: 15.50, nutrients: [2.75, -0.8, -0.45, 0.25], available_n: 20 },
    { crop: 'Spring Wheat', acres: 3416, yield: 75, price: 7.50, nutrients: [2.0, -0.55, -0.4, 0.2], available_n: 18 },
    { crop: 'Small Red Lentils', acres: 1973, yield: 40, price: 16.00, nutrients: [0, 0, 0, 0], available_n: 0 },
  ],
};

// ─── Input Programs ─────────────────────────────────────────────────
// Canola program (used across most farms — rates vary)
const CANOLA_INPUTS_LEWVAN = [
  // Seed
  { category: 'seed', product_name: 'InVigor L233P', rate: 5, rate_unit: 'lbs/acre', cost_per_unit: 12.50, sort_order: 0 },
  { category: 'seed_treatment', product_name: 'Seed Treatment', rate: 1, rate_unit: 'per acre', cost_per_unit: 8.50, sort_order: 1 },
  // Fertilizer
  { category: 'fertilizer', product_name: 'NH3', product_analysis: '82-0-0', form: 'nh3', rate: 100, rate_unit: 'lbs/acre', cost_per_unit: 0.6497, sort_order: 10 },
  { category: 'fertilizer', product_name: 'Treated Urea', product_analysis: '46-0-0', form: 'dry', rate: 100, rate_unit: 'lbs/acre', cost_per_unit: 0.34, sort_order: 11 },
  { category: 'fertilizer', product_name: 'MAP', product_analysis: '11-52-0', form: 'dry', rate: 100, rate_unit: 'lbs/acre', cost_per_unit: 0.5299, sort_order: 12 },
  { category: 'fertilizer', product_name: 'Potash', product_analysis: '0-0-60', form: 'dry', rate: 100, rate_unit: 'lbs/acre', cost_per_unit: 0.294, sort_order: 13 },
  { category: 'fertilizer', product_name: 'Urea', product_analysis: '46-0-0', form: 'dry', rate: 100, rate_unit: 'lbs/acre', cost_per_unit: 0.3448, sort_order: 14 },
  { category: 'fertilizer', product_name: 'Cropplex', product_analysis: '12-40-0-10-1', form: 'dry', rate: 100, rate_unit: 'lbs/acre', cost_per_unit: 0.5309, sort_order: 15 },
  // Chemical
  { category: 'chemical', product_name: 'Avadex', timing: 'fall_residual', rate: 2.5, rate_unit: 'L/acre', cost_per_unit: 8.50, sort_order: 20 },
  { category: 'chemical', product_name: 'Bromo', timing: 'preburn', rate: 0.5, rate_unit: 'L/acre', cost_per_unit: 42.00, sort_order: 21 },
  { category: 'chemical', product_name: 'Liberty', timing: 'incrop', rate: 0.5, rate_unit: 'L/acre', cost_per_unit: 85.00, sort_order: 22 },
  { category: 'chemical', product_name: 'Glyphosate 1/2', timing: 'desiccation', rate: 0.15, rate_unit: 'L/acre', cost_per_unit: 125.00, sort_order: 23 },
];

// Standard canola program for non-Lewvan farms (no NH3, uses Treated Urea + Cropplex)
const CANOLA_INPUTS_STANDARD = [
  { category: 'seed', product_name: 'InVigor L233P', rate: 5, rate_unit: 'lbs/acre', cost_per_unit: 12.50, sort_order: 0 },
  { category: 'seed_treatment', product_name: 'Seed Treatment', rate: 1, rate_unit: 'per acre', cost_per_unit: 8.50, sort_order: 1 },
  { category: 'fertilizer', product_name: 'Treated Urea', product_analysis: '46-0-0', form: 'dry', rate: 130, rate_unit: 'lbs/acre', cost_per_unit: 0.3834, sort_order: 10 },
  { category: 'fertilizer', product_name: 'MAP', product_analysis: '11-52-0', form: 'dry', rate: 20, rate_unit: 'lbs/acre', cost_per_unit: 0.5299, sort_order: 11 },
  { category: 'fertilizer', product_name: 'Potash', product_analysis: '0-0-60', form: 'dry', rate: 40, rate_unit: 'lbs/acre', cost_per_unit: 0.294, sort_order: 12 },
  { category: 'fertilizer', product_name: 'Urea', product_analysis: '46-0-0', form: 'dry', rate: 90, rate_unit: 'lbs/acre', cost_per_unit: 0.3448, sort_order: 13 },
  { category: 'fertilizer', product_name: 'Cropplex', product_analysis: '12-40-0-10-1', form: 'dry', rate: 85, rate_unit: 'lbs/acre', cost_per_unit: 0.5309, sort_order: 14 },
  { category: 'chemical', product_name: 'Avadex', timing: 'fall_residual', rate: 2.5, rate_unit: 'L/acre', cost_per_unit: 8.50, sort_order: 20 },
  { category: 'chemical', product_name: 'Bromo', timing: 'preburn', rate: 0.5, rate_unit: 'L/acre', cost_per_unit: 42.00, sort_order: 21 },
  { category: 'chemical', product_name: 'Liberty', timing: 'incrop', rate: 0.5, rate_unit: 'L/acre', cost_per_unit: 85.00, sort_order: 22 },
  { category: 'chemical', product_name: 'Glyphosate 1/2', timing: 'desiccation', rate: 0.15, rate_unit: 'L/acre', cost_per_unit: 125.00, sort_order: 23 },
];

const DURUM_INPUTS = [
  { category: 'seed', product_name: 'CDC Fortitude', rate: 90, rate_unit: 'lbs/acre', cost_per_unit: 1.45, sort_order: 0 },
  { category: 'seed_treatment', product_name: 'Seed Treatment', rate: 1, rate_unit: 'per acre', cost_per_unit: 6.50, sort_order: 1 },
  { category: 'fertilizer', product_name: 'Treated Urea', product_analysis: '46-0-0', form: 'dry', rate: 130, rate_unit: 'lbs/acre', cost_per_unit: 0.3834, sort_order: 10 },
  { category: 'fertilizer', product_name: 'MAP', product_analysis: '11-52-0', form: 'dry', rate: 30, rate_unit: 'lbs/acre', cost_per_unit: 0.5299, sort_order: 11 },
  { category: 'fertilizer', product_name: 'Potash', product_analysis: '0-0-60', form: 'dry', rate: 40, rate_unit: 'lbs/acre', cost_per_unit: 0.294, sort_order: 12 },
  { category: 'chemical', product_name: 'Avadex', timing: 'fall_residual', rate: 2.5, rate_unit: 'L/acre', cost_per_unit: 8.50, sort_order: 20 },
  { category: 'chemical', product_name: 'Korrex', timing: 'preburn', rate: 0.5, rate_unit: 'L/acre', cost_per_unit: 42.00, sort_order: 21 },
  { category: 'chemical', product_name: 'Miravis Era', timing: 'fungicide', rate: 0.4, rate_unit: 'L/acre', cost_per_unit: 55.00, sort_order: 22 },
  { category: 'chemical', product_name: 'Glyphosate 1/2', timing: 'desiccation', rate: 0.15, rate_unit: 'L/acre', cost_per_unit: 125.00, sort_order: 23 },
];

const SPRING_WHEAT_INPUTS = [
  { category: 'seed', product_name: 'AAC Brandon', rate: 90, rate_unit: 'lbs/acre', cost_per_unit: 0.65, sort_order: 0 },
  { category: 'seed_treatment', product_name: 'Seed Treatment', rate: 1, rate_unit: 'per acre', cost_per_unit: 6.50, sort_order: 1 },
  { category: 'fertilizer', product_name: 'Treated Urea', product_analysis: '46-0-0', form: 'dry', rate: 110, rate_unit: 'lbs/acre', cost_per_unit: 0.3834, sort_order: 10 },
  { category: 'fertilizer', product_name: 'MAP', product_analysis: '11-52-0', form: 'dry', rate: 25, rate_unit: 'lbs/acre', cost_per_unit: 0.5299, sort_order: 11 },
  { category: 'fertilizer', product_name: 'Potash', product_analysis: '0-0-60', form: 'dry', rate: 35, rate_unit: 'lbs/acre', cost_per_unit: 0.294, sort_order: 12 },
  { category: 'chemical', product_name: 'Avadex', timing: 'fall_residual', rate: 2.5, rate_unit: 'L/acre', cost_per_unit: 8.50, sort_order: 20 },
  { category: 'chemical', product_name: 'Simplicity GoDri', timing: 'preburn', rate: 0.5, rate_unit: 'L/acre', cost_per_unit: 42.00, sort_order: 21 },
  { category: 'chemical', product_name: 'Axial Extreme', timing: 'incrop', rate: 0.4, rate_unit: 'L/acre', cost_per_unit: 38.00, sort_order: 22 },
  { category: 'chemical', product_name: 'Miravis Era', timing: 'fungicide', rate: 0.4, rate_unit: 'L/acre', cost_per_unit: 55.00, sort_order: 23 },
  { category: 'chemical', product_name: 'Glyphosate 1/2', timing: 'desiccation', rate: 0.15, rate_unit: 'L/acre', cost_per_unit: 125.00, sort_order: 24 },
];

const BARLEY_INPUTS = [
  { category: 'seed', product_name: 'CDC Copeland', rate: 70, rate_unit: 'lbs/acre', cost_per_unit: 0.70, sort_order: 0 },
  { category: 'seed_treatment', product_name: 'Seed Treatment', rate: 1, rate_unit: 'per acre', cost_per_unit: 6.50, sort_order: 1 },
  { category: 'fertilizer', product_name: 'Treated Urea', product_analysis: '46-0-0', form: 'dry', rate: 100, rate_unit: 'lbs/acre', cost_per_unit: 0.3834, sort_order: 10 },
  { category: 'fertilizer', product_name: 'MAP', product_analysis: '11-52-0', form: 'dry', rate: 20, rate_unit: 'lbs/acre', cost_per_unit: 0.5299, sort_order: 11 },
  { category: 'fertilizer', product_name: 'Potash', product_analysis: '0-0-60', form: 'dry', rate: 30, rate_unit: 'lbs/acre', cost_per_unit: 0.294, sort_order: 12 },
  { category: 'chemical', product_name: 'Avadex', timing: 'fall_residual', rate: 2.5, rate_unit: 'L/acre', cost_per_unit: 8.50, sort_order: 20 },
  { category: 'chemical', product_name: 'Simplicity GoDri', timing: 'preburn', rate: 0.5, rate_unit: 'L/acre', cost_per_unit: 42.00, sort_order: 21 },
  { category: 'chemical', product_name: 'Glyphosate 1/2', timing: 'desiccation', rate: 0.15, rate_unit: 'L/acre', cost_per_unit: 125.00, sort_order: 22 },
];

const CHICKPEA_INPUTS = [
  { category: 'seed', product_name: 'CDC Orion CP', rate: 200, rate_unit: 'lbs/acre', cost_per_unit: 1.85, sort_order: 0 },
  { category: 'seed_treatment', product_name: 'Seed Treatment + Inoculant', rate: 1, rate_unit: 'per acre', cost_per_unit: 12.00, sort_order: 1 },
  { category: 'chemical', product_name: 'Authority Supreme', timing: 'fall_residual', rate: 0.3, rate_unit: 'L/acre', cost_per_unit: 45.00, sort_order: 20 },
  { category: 'chemical', product_name: 'Voraxor', timing: 'preburn', rate: 0.25, rate_unit: 'L/acre', cost_per_unit: 48.00, sort_order: 21 },
  { category: 'chemical', product_name: 'Solo ADV', timing: 'incrop', rate: 0.5, rate_unit: 'L/acre', cost_per_unit: 35.00, sort_order: 22 },
  { category: 'chemical', product_name: 'Dyax', timing: 'fungicide', rate: 0.3, rate_unit: 'L/acre', cost_per_unit: 60.00, sort_order: 23 },
  { category: 'chemical', product_name: 'Reglone Ion', timing: 'desiccation', rate: 0.5, rate_unit: 'L/acre', cost_per_unit: 28.00, sort_order: 24 },
];

const LENTIL_INPUTS = [
  { category: 'seed', product_name: 'CDC Maxim CL', rate: 55, rate_unit: 'lbs/acre', cost_per_unit: 1.85, sort_order: 0 },
  { category: 'seed_treatment', product_name: 'Seed Treatment + Inoculant', rate: 1, rate_unit: 'per acre', cost_per_unit: 12.00, sort_order: 1 },
  { category: 'chemical', product_name: 'Authority Supreme', timing: 'fall_residual', rate: 0.3, rate_unit: 'L/acre', cost_per_unit: 45.00, sort_order: 20 },
  { category: 'chemical', product_name: 'Voraxor', timing: 'preburn', rate: 0.25, rate_unit: 'L/acre', cost_per_unit: 48.00, sort_order: 21 },
  { category: 'chemical', product_name: 'Solo ADV', timing: 'incrop', rate: 0.5, rate_unit: 'L/acre', cost_per_unit: 35.00, sort_order: 22 },
  { category: 'chemical', product_name: 'Elatus', timing: 'fungicide', rate: 0.3, rate_unit: 'L/acre', cost_per_unit: 55.00, sort_order: 23 },
  { category: 'chemical', product_name: 'Reglone Ion', timing: 'desiccation', rate: 0.5, rate_unit: 'L/acre', cost_per_unit: 28.00, sort_order: 24 },
];

const PEAS_INPUTS = [
  { category: 'seed', product_name: 'CDC Meadow', rate: 175, rate_unit: 'lbs/acre', cost_per_unit: 0.65, sort_order: 0 },
  { category: 'seed_treatment', product_name: 'Seed Treatment + Inoculant', rate: 1, rate_unit: 'per acre', cost_per_unit: 10.00, sort_order: 1 },
  { category: 'chemical', product_name: 'Authority Supreme', timing: 'fall_residual', rate: 0.3, rate_unit: 'L/acre', cost_per_unit: 45.00, sort_order: 20 },
  { category: 'chemical', product_name: 'Solo ADV', timing: 'incrop', rate: 0.5, rate_unit: 'L/acre', cost_per_unit: 35.00, sort_order: 21 },
  { category: 'chemical', product_name: 'Reglone Ion', timing: 'desiccation', rate: 0.5, rate_unit: 'L/acre', cost_per_unit: 28.00, sort_order: 22 },
];

function getInputProgram(crop, farmName) {
  if (crop === 'Canola' && farmName === 'Lewvan') return CANOLA_INPUTS_LEWVAN;
  if (crop === 'Canola') return CANOLA_INPUTS_STANDARD;
  if (crop === 'Spring Durum Wheat') return DURUM_INPUTS;
  if (crop === 'Spring Wheat') return SPRING_WHEAT_INPUTS;
  if (crop === 'Spring Barley') return BARLEY_INPUTS;
  if (crop === 'Chickpeas') return CHICKPEA_INPUTS;
  if (crop === 'Small Red Lentils') return LENTIL_INPUTS;
  if (crop === 'Yellow Field Peas') return PEAS_INPUTS;
  return [];
}

// ─── Season Profiles ────────────────────────────────────────────────
const SEASON_PROFILES = {
  'Canola':              { apr_pct: 0.15, may_pct: 0.45, jun_pct: 0.15, jul_pct: 0.10, aug_pct: 0.10, sep_pct: 0.05, oct_pct: 0 },
  'Spring Wheat':        { apr_pct: 0.10, may_pct: 0.45, jun_pct: 0.15, jul_pct: 0.10, aug_pct: 0.15, sep_pct: 0.05, oct_pct: 0 },
  'Spring Durum Wheat':  { apr_pct: 0.10, may_pct: 0.45, jun_pct: 0.15, jul_pct: 0.10, aug_pct: 0.15, sep_pct: 0.05, oct_pct: 0 },
  'Spring Barley':       { apr_pct: 0.10, may_pct: 0.45, jun_pct: 0.15, jul_pct: 0.15, aug_pct: 0.10, sep_pct: 0.05, oct_pct: 0 },
  'Chickpeas':           { apr_pct: 0.15, may_pct: 0.40, jun_pct: 0.15, jul_pct: 0.10, aug_pct: 0.10, sep_pct: 0.10, oct_pct: 0 },
  'Small Red Lentils':   { apr_pct: 0.15, may_pct: 0.40, jun_pct: 0.15, jul_pct: 0.10, aug_pct: 0.10, sep_pct: 0.10, oct_pct: 0 },
  'Yellow Field Peas':   { apr_pct: 0.15, may_pct: 0.40, jun_pct: 0.15, jul_pct: 0.10, aug_pct: 0.10, sep_pct: 0.10, oct_pct: 0 },
};

// ─── Product Reference Data (Input Index) ───────────────────────────
const PRODUCTS = [
  // Seeds
  { name: 'InVigor L233P', type: 'seed', crop_filter: 'Canola', default_unit: 'lbs/acre', default_rate: 5, default_cost: 12.50 },
  { name: 'L340PC', type: 'seed', crop_filter: 'Canola', default_unit: 'lbs/acre', default_rate: 5, default_cost: 12.50 },
  { name: 'L356P', type: 'seed', crop_filter: 'Canola', default_unit: 'lbs/acre', default_rate: 5, default_cost: 12.50 },
  { name: 'AAC Brandon', type: 'seed', crop_filter: 'Spring Wheat', default_unit: 'lbs/acre', default_rate: 90, default_cost: 0.65 },
  { name: 'Starbuck', type: 'seed', crop_filter: 'Spring Wheat', default_unit: 'lbs/acre', default_rate: 90, default_cost: 0.55 },
  { name: 'CDC Fortitude', type: 'seed', crop_filter: 'Spring Durum Wheat', default_unit: 'lbs/acre', default_rate: 90, default_cost: 1.45 },
  { name: 'Certified Weyburn', type: 'seed', crop_filter: 'Spring Durum Wheat', default_unit: 'lbs/acre', default_rate: 90, default_cost: 1.45 },
  { name: 'CDC Copeland', type: 'seed', crop_filter: 'Spring Barley', default_unit: 'lbs/acre', default_rate: 70, default_cost: 0.70 },
  { name: 'CDC Orion CP', type: 'seed', crop_filter: 'Chickpeas', default_unit: 'lbs/acre', default_rate: 200, default_cost: 1.85 },
  { name: 'CDC Maxim CL', type: 'seed', crop_filter: 'Small Red Lentils', default_unit: 'lbs/acre', default_rate: 55, default_cost: 1.85 },
  { name: 'CDC Meadow', type: 'seed', crop_filter: 'Yellow Field Peas', default_unit: 'lbs/acre', default_rate: 175, default_cost: 0.65 },
  // Fertilizers
  { name: 'NH3', type: 'fertilizer', analysis_code: '82-0-0', form: 'nh3', default_unit: 'lbs/acre', default_cost: 0.6497 },
  { name: 'Treated Urea', type: 'fertilizer', analysis_code: '46-0-0', form: 'dry', default_unit: 'lbs/acre', default_cost: 0.3834 },
  { name: 'Urea', type: 'fertilizer', analysis_code: '46-0-0', form: 'dry', default_unit: 'lbs/acre', default_cost: 0.3448 },
  { name: 'MAP', type: 'fertilizer', analysis_code: '11-52-0', form: 'dry', default_unit: 'lbs/acre', default_cost: 0.5299 },
  { name: 'Potash', type: 'fertilizer', analysis_code: '0-0-60', form: 'dry', default_unit: 'lbs/acre', default_cost: 0.294 },
  { name: 'Cropplex', type: 'fertilizer', analysis_code: '12-40-0-10-1', form: 'dry', default_unit: 'lbs/acre', default_cost: 0.5309 },
  { name: 'AMS', type: 'fertilizer', analysis_code: '21-0-0-24', form: 'dry', default_unit: 'lbs/acre', default_cost: 0.30 },
  { name: 'UAN', type: 'fertilizer', analysis_code: '28-0-0', form: 'liquid', default_unit: 'US Gal/Acre', default_cost: 0.40 },
  { name: '10-34-0', type: 'fertilizer', analysis_code: '10-34-0', form: 'liquid', default_unit: 'US Gal/Acre', default_cost: 0.45 },
  { name: 'ATS', type: 'fertilizer', analysis_code: '12-0-0-26', form: 'liquid', default_unit: 'US Gal/Acre', default_cost: 0.35 },
  { name: 'Nexus Cu', type: 'fertilizer', analysis_code: '0-0-0-0-9', form: 'micro_nutrient', default_unit: 'lbs/acre', default_cost: 2.50 },
  { name: 'Micro B', type: 'fertilizer', analysis_code: '0-0-0-0-0-15', form: 'micro_nutrient', default_unit: 'lbs/acre', default_cost: 3.00 },
  { name: 'Micro Zn', type: 'fertilizer', analysis_code: '0-0-0-0-0-0-36', form: 'micro_nutrient', default_unit: 'lbs/acre', default_cost: 2.75 },
  // Chemicals - Herbicides
  { name: 'Avadex', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 8.50 },
  { name: 'Bromo', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 42.00 },
  { name: 'Simplicity GoDri', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 42.00 },
  { name: 'Korrex', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 42.00 },
  { name: 'Liberty', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 85.00 },
  { name: 'Glyphosate', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 125.00 },
  { name: 'Axial Extreme', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 38.00 },
  { name: 'Solo ADV', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 35.00 },
  { name: 'Authority Supreme', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 45.00 },
  { name: 'Voraxor', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 48.00 },
  // Chemicals - Fungicides
  { name: 'Miravis Era', type: 'chemical', sub_type: 'fungicide', default_unit: 'L/acre', default_cost: 55.00 },
  { name: 'Cotegra', type: 'chemical', sub_type: 'fungicide', default_unit: 'L/acre', default_cost: 50.00 },
  { name: 'Elatus', type: 'chemical', sub_type: 'fungicide', default_unit: 'L/acre', default_cost: 55.00 },
  { name: 'Dyax', type: 'chemical', sub_type: 'fungicide', default_unit: 'L/acre', default_cost: 60.00 },
  // Chemicals - Desiccant
  { name: 'Reglone Ion', type: 'chemical', sub_type: 'herbicide', default_unit: 'L/acre', default_cost: 28.00 },
];

async function seed() {
  const farm = await prisma.farm.findFirst();
  if (!farm) {
    console.error('No farm found. Run the main seed first.');
    process.exit(1);
  }
  const farmId = farm.id;

  console.log(`Seeding agronomy data for farm: ${farm.name} (${farmId})`);

  // Clean existing agronomy data
  await prisma.cropInput.deleteMany({});
  await prisma.cropAllocation.deleteMany({});
  await prisma.agroPlan.deleteMany({});
  await prisma.agroProduct.deleteMany({});
  await prisma.seasonProfile.deleteMany({});

  // Seed products
  console.log('Seeding product reference data...');
  for (const p of PRODUCTS) {
    await prisma.agroProduct.create({
      data: { farm_id: farmId, ...p },
    });
  }
  console.log(`  ${PRODUCTS.length} products created`);

  // Seed season profiles
  console.log('Seeding season profiles...');
  for (const [crop, pcts] of Object.entries(SEASON_PROFILES)) {
    await prisma.seasonProfile.create({
      data: { farm_id: farmId, crop, crop_year: CROP_YEAR, ...pcts },
    });
  }
  console.log(`  ${Object.keys(SEASON_PROFILES).length} profiles created`);

  // Create one plan per farm location
  // Since we have a single "farm" in the system but multiple locations,
  // we create one plan for the farm with all crops from all locations combined.
  // In future multi-farm setup, each location would be its own farm.
  // For now, we combine the largest allocation per crop across all locations.

  // Actually, looking at the architecture, we have one Farm but multiple InventoryLocations.
  // The agronomy plan is per-farm. Let's create one plan with combined allocations.
  // But the Excel has per-location data. For the single-farm demo, let's use Lewvan as the primary.
  // Later when we add multi-farm, each location becomes a farm.

  // For demo: create plan with Lewvan's data (the largest farm)
  console.log('Creating agro plan for crop year', CROP_YEAR);
  const plan = await prisma.agroPlan.create({
    data: {
      farm_id: farmId,
      crop_year: CROP_YEAR,
      status: 'draft',
      prepared_by: 'Tyson Hunter',
    },
  });

  // Use Lewvan allocations for the single-farm demo
  const farmAllocs = ALLOCATIONS.Lewvan;
  let sortOrder = 0;
  for (const alloc of farmAllocs) {
    console.log(`  Creating allocation: ${alloc.crop} — ${alloc.acres} ac`);
    const allocation = await prisma.cropAllocation.create({
      data: {
        plan_id: plan.id,
        crop: alloc.crop,
        acres: alloc.acres,
        target_yield_bu: alloc.yield,
        commodity_price: alloc.price,
        sort_order: sortOrder++,
        n_rate_per_bu: alloc.nutrients[0] || null,
        p_rate_per_bu: alloc.nutrients[1] || null,
        k_rate_per_bu: alloc.nutrients[2] || null,
        s_rate_per_bu: alloc.nutrients[3] || null,
        available_n: alloc.available_n || null,
        cu_target: alloc.cu_target || null,
        b_target: alloc.b_target || null,
        zn_target: alloc.zn_target || null,
      },
    });

    const inputs = getInputProgram(alloc.crop, 'Lewvan');
    for (const inp of inputs) {
      await prisma.cropInput.create({
        data: {
          allocation_id: allocation.id,
          ...inp,
        },
      });
    }
    console.log(`    ${inputs.length} inputs created`);
  }

  console.log('\nAgronomy seed complete!');
  console.log(`  Plan: ${plan.id} (${plan.status})`);
  console.log(`  Allocations: ${farmAllocs.length}`);
}

seed()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
