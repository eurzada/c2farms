import { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, Alert, Chip, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';

function fmt(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function fmtDec(n) { return (n || 0).toLocaleString('en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
function fmtDollar(n) { return '$' + (n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const TH_SX = { fontWeight: 'bold', bgcolor: 'action.hover', whiteSpace: 'nowrap', fontSize: '0.8rem' };
const TOTAL_SX = { fontWeight: 'bold', borderTop: 2, borderColor: 'divider' };
const FERT_TONNES_PER_LB = 1 / 2204.62;
const TONNES_PER_TRUCK = 44; // ~44 tonnes per B-train

function SectionHeader({ children, color }) {
  return (
    <Typography variant="h6" sx={{ mb: 1, mt: 3, fontWeight: 'bold', color: color || 'text.primary' }}>
      {children}
    </Typography>
  );
}

export default function EnterpriseAgroPlan() {
  const { farmUnits } = useFarm();
  const [year, setYear] = useState(2026);
  const [farmResults, setFarmResults] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!farmUnits?.length) return;
    setLoading(true);

    Promise.all(
      farmUnits.map(farm =>
        Promise.all([
          api.get(`/api/farms/${farm.id}/agronomy/procurement?year=${year}`).catch(() => ({ data: [] })),
          api.get(`/api/farms/${farm.id}/agronomy/dashboard?year=${year}`).catch(() => ({ data: null })),
        ]).then(([procRes, dashRes]) => ({
          farm,
          procurement: procRes.data || [],
          dashboard: dashRes.data,
        }))
      )
    ).then(results => {
      setFarmResults(results);
    }).finally(() => setLoading(false));
  }, [farmUnits, year]);

  if (loading) return <Typography>Loading...</Typography>;

  const farmsWithData = farmResults.filter(r => r.dashboard?.farm);

  // ─── Build product matrices per category ──────────────────────────
  function buildMatrix(category) {
    const productSet = new Set();
    const farmMap = {}; // farmId → { productName → totalQty }

    for (const { farm, procurement } of farmsWithData) {
      farmMap[farm.id] = { totalQty: 0, totalCost: 0, acres: 0 };
      const items = procurement.filter(p =>
        category === 'seed' ? (p.category === 'seed' || p.category === 'seed_treatment')
        : p.category === category
      );
      for (const item of items) {
        productSet.add(item.product_name);
        farmMap[farm.id][item.product_name] = (farmMap[farm.id][item.product_name] || 0) + item.total_qty;
        farmMap[farm.id].totalQty += item.total_qty;
        farmMap[farm.id].totalCost += item.total_cost;
      }
    }

    // Get acres from dashboard
    for (const { farm, dashboard } of farmsWithData) {
      if (farmMap[farm.id]) {
        farmMap[farm.id].acres = dashboard?.farm?.acres || 0;
      }
    }

    const products = [...productSet].sort();

    // Column totals
    const colTotals = {};
    for (const p of products) {
      colTotals[p] = 0;
      for (const { farm } of farmsWithData) {
        colTotals[p] += farmMap[farm.id]?.[p] || 0;
      }
    }
    const grandTotalQty = farmsWithData.reduce((s, { farm }) => s + (farmMap[farm.id]?.totalQty || 0), 0);
    const grandTotalCost = farmsWithData.reduce((s, { farm }) => s + (farmMap[farm.id]?.totalCost || 0), 0);
    const grandTotalAcres = farmsWithData.reduce((s, { farm }) => s + (farmMap[farm.id]?.acres || 0), 0);

    return { products, farmMap, colTotals, grandTotalQty, grandTotalCost, grandTotalAcres };
  }

  // Also build seed matrix with crop acre columns
  function buildSeedWithCrops() {
    const cropAcreMap = {}; // farmId → { crop → acres }
    const allCrops = new Set();
    for (const { farm, dashboard } of farmsWithData) {
      cropAcreMap[farm.id] = {};
      for (const c of (dashboard?.crops || [])) {
        cropAcreMap[farm.id][c.crop] = c.acres;
        allCrops.add(c.crop);
      }
    }
    const crops = [...allCrops].sort();

    // Crop acre totals
    const cropTotals = {};
    for (const crop of crops) {
      cropTotals[crop] = 0;
      for (const { farm } of farmsWithData) {
        cropTotals[crop] += cropAcreMap[farm.id]?.[crop] || 0;
      }
    }

    return { cropAcreMap, crops, cropTotals };
  }

  const seedMatrix = buildMatrix('seed');
  const fertMatrix = buildMatrix('fertilizer');
  const chemMatrix = buildMatrix('chemical');
  const { cropAcreMap, crops, cropTotals } = buildSeedWithCrops();

  // Total input per farm (for the last column in chemicals)
  const farmTotalInput = {};
  for (const { farm } of farmsWithData) {
    const s = seedMatrix.farmMap[farm.id]?.totalCost || 0;
    const f = fertMatrix.farmMap[farm.id]?.totalCost || 0;
    const c = chemMatrix.farmMap[farm.id]?.totalCost || 0;
    const acres = seedMatrix.farmMap[farm.id]?.acres || 0;
    farmTotalInput[farm.id] = acres ? (s + f + c) / acres : 0;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight="bold">Agronomic Costs $</Typography>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Crop Year</InputLabel>
          <Select value={year} label="Crop Year" onChange={e => setYear(e.target.value)}>
            <MenuItem value={2026}>2026</MenuItem>
            <MenuItem value={2025}>2025</MenuItem>
            <MenuItem value={2027}>2027</MenuItem>
          </Select>
        </FormControl>
        <Chip icon={<VisibilityIcon />} label="Read-Only" size="small" variant="outlined" />
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Farm-level product requirements — all quantities derived from crop allocations x per-acre rates.
      </Typography>

      {farmsWithData.length === 0 ? (
        <Alert severity="warning">
          No agronomy plans found for crop year {year}.
        </Alert>
      ) : (
        <>
          {/* ─── Seed Requirements by Farm ─────────────────────────── */}
          <SectionHeader>Seed Requirements by Farm</SectionHeader>
          <TableContainer component={Paper} sx={{ mb: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': TH_SX }}>
                  <TableCell>Farm</TableCell>
                  {crops.map(crop => (
                    <TableCell key={crop} align="right">{crop} (ac)</TableCell>
                  ))}
                  {seedMatrix.products.map(p => (
                    <TableCell key={p} align="right">{p} (lbs)</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {farmsWithData.map(({ farm }) => (
                  <TableRow key={farm.id} hover>
                    <TableCell sx={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>{farm.name}</TableCell>
                    {crops.map(crop => (
                      <TableCell key={crop} align="right" sx={!cropAcreMap[farm.id]?.[crop] ? { color: 'text.disabled' } : undefined}>
                        {fmt(cropAcreMap[farm.id]?.[crop] || 0)}
                      </TableCell>
                    ))}
                    {seedMatrix.products.map(p => (
                      <TableCell key={p} align="right" sx={!seedMatrix.farmMap[farm.id]?.[p] ? { color: 'text.disabled' } : undefined}>
                        {fmt(seedMatrix.farmMap[farm.id]?.[p] || 0)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                <TableRow sx={{ '& td': TOTAL_SX }}>
                  <TableCell>TOTAL</TableCell>
                  {crops.map(crop => (
                    <TableCell key={crop} align="right">{fmt(cropTotals[crop] || 0)}</TableCell>
                  ))}
                  {seedMatrix.products.map(p => (
                    <TableCell key={p} align="right">{fmt(seedMatrix.colTotals[p] || 0)}</TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          {/* ─── Fertilizer Requirements by Farm (lbs) ─────────────── */}
          <SectionHeader>Fertilizer Requirements by Farm (lbs)</SectionHeader>
          <TableContainer component={Paper} sx={{ mb: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': TH_SX }}>
                  <TableCell>Farm</TableCell>
                  {fertMatrix.products.map(p => (
                    <TableCell key={p} align="right">{p} (lbs)</TableCell>
                  ))}
                  <TableCell align="right">Total Fert (lbs)</TableCell>
                  <TableCell align="right">Total Fert Cost ($)</TableCell>
                  <TableCell align="right">Fert $/Acre</TableCell>
                  <TableCell align="right">Tonnes Required</TableCell>
                  <TableCell align="right">Truck Loads (est)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {farmsWithData.map(({ farm }) => {
                  const fm = fertMatrix.farmMap[farm.id] || {};
                  const tonnes = (fm.totalQty || 0) * FERT_TONNES_PER_LB;
                  const loads = Math.ceil(tonnes / TONNES_PER_TRUCK);
                  const perAcre = fm.acres ? (fm.totalCost || 0) / fm.acres : 0;
                  return (
                    <TableRow key={farm.id} hover>
                      <TableCell sx={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>{farm.name}</TableCell>
                      {fertMatrix.products.map(p => (
                        <TableCell key={p} align="right">{fmt(fm[p] || 0)}</TableCell>
                      ))}
                      <TableCell align="right">{fmt(fm.totalQty)}</TableCell>
                      <TableCell align="right">{fmtDollar(fm.totalCost)}</TableCell>
                      <TableCell align="right">{fmtDollar(perAcre)}</TableCell>
                      <TableCell align="right">{fmtDec(tonnes)}</TableCell>
                      <TableCell align="right">{loads}</TableCell>
                    </TableRow>
                  );
                })}
                <TableRow sx={{ '& td': TOTAL_SX }}>
                  <TableCell>TOTAL</TableCell>
                  {fertMatrix.products.map(p => (
                    <TableCell key={p} align="right">{fmt(fertMatrix.colTotals[p] || 0)}</TableCell>
                  ))}
                  <TableCell align="right">{fmt(fertMatrix.grandTotalQty)}</TableCell>
                  <TableCell align="right">{fmtDollar(fertMatrix.grandTotalCost)}</TableCell>
                  <TableCell align="right">
                    {fertMatrix.grandTotalAcres ? fmtDollar(fertMatrix.grandTotalCost / fertMatrix.grandTotalAcres) : ''}
                  </TableCell>
                  <TableCell align="right">{fmtDec(fertMatrix.grandTotalQty * FERT_TONNES_PER_LB)}</TableCell>
                  <TableCell align="right">{Math.ceil(fertMatrix.grandTotalQty * FERT_TONNES_PER_LB / TONNES_PER_TRUCK)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          {/* ─── Chemical Requirements by Farm (Litres) ─────────────── */}
          <SectionHeader>Chemical Requirements by Farm (Litres)</SectionHeader>
          <TableContainer component={Paper} sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': TH_SX }}>
                  <TableCell>Farm</TableCell>
                  {chemMatrix.products.map(p => (
                    <TableCell key={p} align="right">{p} (L)</TableCell>
                  ))}
                  <TableCell align="right">Total Chem Cost ($)</TableCell>
                  <TableCell align="right">Chem $/Acre</TableCell>
                  <TableCell align="right">Spray Loads (est)</TableCell>
                  <TableCell align="right">Total Input $/Acre</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {farmsWithData.map(({ farm }) => {
                  const cm = chemMatrix.farmMap[farm.id] || {};
                  const perAcre = cm.acres ? (cm.totalCost || 0) / cm.acres : 0;
                  // Rough spray load estimate: ~15,000 L per spray run for a big sprayer
                  const sprayLoads = Math.ceil((cm.totalQty || 0) / 15000);
                  return (
                    <TableRow key={farm.id} hover>
                      <TableCell sx={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>{farm.name}</TableCell>
                      {chemMatrix.products.map(p => (
                        <TableCell key={p} align="right">{fmtDec(cm[p] || 0)}</TableCell>
                      ))}
                      <TableCell align="right">{fmtDollar(cm.totalCost)}</TableCell>
                      <TableCell align="right">{fmtDollar(perAcre)}</TableCell>
                      <TableCell align="right">{sprayLoads}</TableCell>
                      <TableCell align="right">{fmtDollar(farmTotalInput[farm.id] || 0)}</TableCell>
                    </TableRow>
                  );
                })}
                <TableRow sx={{ '& td': TOTAL_SX }}>
                  <TableCell>TOTAL</TableCell>
                  {chemMatrix.products.map(p => (
                    <TableCell key={p} align="right">{fmtDec(chemMatrix.colTotals[p] || 0)}</TableCell>
                  ))}
                  <TableCell align="right">{fmtDollar(chemMatrix.grandTotalCost)}</TableCell>
                  <TableCell align="right">
                    {chemMatrix.grandTotalAcres ? fmtDollar(chemMatrix.grandTotalCost / chemMatrix.grandTotalAcres) : ''}
                  </TableCell>
                  <TableCell align="right">
                    {Math.ceil(Object.values(chemMatrix.colTotals).reduce((s, v) => s + v, 0) / 15000)}
                  </TableCell>
                  <TableCell align="right">
                    {fertMatrix.grandTotalAcres
                      ? fmtDollar((seedMatrix.grandTotalCost + fertMatrix.grandTotalCost + chemMatrix.grandTotalCost) / fertMatrix.grandTotalAcres)
                      : ''}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  );
}
