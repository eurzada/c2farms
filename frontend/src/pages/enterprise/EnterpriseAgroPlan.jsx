import { useState, useEffect, useMemo } from 'react';
import {
  Box, Typography, Paper, Alert, Chip, Stack, Tabs, Tab,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import InventoryIcon from '@mui/icons-material/Inventory';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import { useNavigate, useLocation } from 'react-router-dom';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';
import ProductLibrary from '../agronomy/ProductLibrary';
import ProcurementContracts from '../agronomy/ProcurementContracts';
import ProcurementExportButtons from '../../components/agronomy/ProcurementExportButtons';
import PlanVsBooked from '../agronomy/PlanVsBooked';

function fmt(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function fmtDec(n) { return '$' + (n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDol(n) { return '$' + (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function fmtK(n) { return n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : fmtDec(n); }

const TH = { fontWeight: 'bold', bgcolor: 'action.hover', whiteSpace: 'nowrap', fontSize: '0.78rem', py: 0.75, px: 1 };
const TD = { fontSize: '0.8rem', py: 0.5, px: 1 };
const TOTAL_ROW = { fontWeight: 'bold', borderTop: 2, borderColor: 'divider' };

const TIMING_LABELS = { fall_residual: 'Fall Residual', preburn: 'Preburn', incrop: 'In-Crop', fungicide: 'Fungicide', desiccation: 'Desiccation' };
const TIMING_ORDER = ['fall_residual', 'preburn', 'incrop', 'fungicide', 'desiccation'];

function shortName(name) { return (name || '').replace(/^C2\s*/i, ''); }

/* ═══════════════════════════════════════════════════════════════════════════
   Data builders
   ═══════════════════════════════════════════════════════════════════════════ */

function buildCategoryData(farmsWithData, category) {
  const productMap = new Map();
  const farmTotals = new Map();

  for (const { farm, plan, dashboard } of farmsWithData) {
    const acres = dashboard?.farm?.acres || 0;
    farmTotals.set(farm.id, { cost: 0, acres });
    if (!plan?.allocations) continue;

    for (const alloc of plan.allocations) {
      const inputs = (alloc.inputs || []).filter(i =>
        category === 'seed' ? (i.category === 'seed' || i.category === 'seed_treatment') : i.category === category
      );
      for (const inp of inputs) {
        if (!productMap.has(inp.product_name)) {
          productMap.set(inp.product_name, { unit: inp.rate_unit, unitPrice: inp.cost_per_unit, farms: {} });
        }
        const p = productMap.get(inp.product_name);
        if (!p.farms[farm.id]) p.farms[farm.id] = { cost: 0, volume: 0 };
        const acres = (inp.category === 'seed' || inp.category === 'seed_treatment') && inp.acres != null ? inp.acres : alloc.acres;
        const vol = inp.rate * acres;
        const cost = vol * inp.cost_per_unit;
        p.farms[farm.id].cost += cost;
        p.farms[farm.id].volume += vol;
        farmTotals.get(farm.id).cost += cost;
      }
    }
  }

  const products = [...productMap.entries()]
    .map(([name, data]) => {
      const totalCost = Object.values(data.farms).reduce((s, f) => s + f.cost, 0);
      const totalVol = Object.values(data.farms).reduce((s, f) => s + f.volume, 0);
      return { name, unit: data.unit, unitPrice: data.unitPrice, farms: data.farms, totalCost, totalVol };
    })
    .sort((a, b) => b.totalCost - a.totalCost);

  const grandCost = products.reduce((s, p) => s + p.totalCost, 0);
  const grandAcres = [...farmTotals.values()].reduce((s, f) => s + f.acres, 0);

  return { products, farmTotals, grandCost, grandAcres };
}

function buildStageData(farmsWithData) {
  const stageSet = new Set();
  const farmStage = new Map();
  const farmAcres = new Map();

  for (const { farm, plan, dashboard } of farmsWithData) {
    const acres = dashboard?.farm?.acres || 0;
    farmAcres.set(farm.id, acres);
    farmStage.set(farm.id, {});
    if (!plan?.allocations) continue;

    for (const alloc of plan.allocations) {
      for (const inp of (alloc.inputs || []).filter(i => i.category === 'chemical')) {
        const t = inp.timing || 'other';
        stageSet.add(t);
        const sd = farmStage.get(farm.id);
        sd[t] = (sd[t] || 0) + inp.rate * inp.cost_per_unit * alloc.acres;
      }
    }
  }

  const stages = TIMING_ORDER.filter(t => stageSet.has(t));
  if (stageSet.has('other')) stages.push('other');
  return { stages, farmStage, farmAcres };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Product Cost Table
   ═══════════════════════════════════════════════════════════════════════════ */
function ProductCostTable({ title, data, farmsWithData }) {
  const { products, farmTotals, grandCost, grandAcres } = data;
  if (products.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" fontWeight="bold" sx={{ mb: 1 }}>{title}</Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': TH }}>
              <TableCell>Product</TableCell>
              <TableCell>Unit</TableCell>
              <TableCell align="right">$/Unit</TableCell>
              {farmsWithData.map(({ farm }) => (
                <TableCell key={farm.id} align="right">{shortName(farm.name)}</TableCell>
              ))}
              <TableCell align="right" sx={{ borderLeft: 1, borderColor: 'divider' }}>Total</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {products.map(p => (
              <TableRow key={p.name} hover>
                <TableCell sx={{ ...TD, fontWeight: 500, whiteSpace: 'nowrap' }}>{p.name}</TableCell>
                <TableCell sx={{ ...TD, color: 'text.secondary', fontSize: '0.7rem' }}>{p.unit}</TableCell>
                <TableCell align="right" sx={{ ...TD, color: 'text.secondary' }}>{fmtDec(p.unitPrice)}</TableCell>
                {farmsWithData.map(({ farm }) => {
                  const cost = p.farms[farm.id]?.cost || 0;
                  return (
                    <TableCell key={farm.id} align="right"
                      sx={{ ...TD, color: cost > 0 ? 'text.primary' : 'text.disabled' }}>
                      {cost > 0 ? fmtDol(cost) : '—'}
                    </TableCell>
                  );
                })}
                <TableCell align="right" sx={{ ...TD, fontWeight: 'bold', borderLeft: 1, borderColor: 'divider' }}>
                  {fmtDol(p.totalCost)}
                </TableCell>
              </TableRow>
            ))}

            <TableRow sx={{ '& td': { ...TD, ...TOTAL_ROW } }}>
              <TableCell colSpan={3}>Total Cost</TableCell>
              {farmsWithData.map(({ farm }) => (
                <TableCell key={farm.id} align="right">{fmtDol(farmTotals.get(farm.id)?.cost || 0)}</TableCell>
              ))}
              <TableCell align="right" sx={{ borderLeft: 1, borderColor: 'divider' }}>{fmtDol(grandCost)}</TableCell>
            </TableRow>

            <TableRow sx={{ '& td': { ...TD, fontWeight: 'bold', color: 'primary.main' } }}>
              <TableCell colSpan={3}>$/Acre</TableCell>
              {farmsWithData.map(({ farm }) => {
                const ft = farmTotals.get(farm.id);
                return (
                  <TableCell key={farm.id} align="right">
                    {ft?.acres > 0 ? fmtDec(ft.cost / ft.acres) : '—'}
                  </TableCell>
                );
              })}
              <TableCell align="right" sx={{ borderLeft: 1, borderColor: 'divider' }}>
                {grandAcres > 0 ? fmtDec(grandCost / grandAcres) : '—'}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Chemistry Stage Matrix
   ═══════════════════════════════════════════════════════════════════════════ */
function ChemStageTable({ stageData, farmsWithData }) {
  const { stages, farmStage, farmAcres } = stageData;
  if (stages.length === 0) return null;

  const grandAcres = [...farmAcres.values()].reduce((s, v) => s + v, 0);

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" fontWeight="bold" sx={{ mb: 1 }}>Chemistry by Stage ($/Acre)</Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': TH }}>
              <TableCell>Location</TableCell>
              {stages.map(s => (
                <TableCell key={s} align="right">{TIMING_LABELS[s] || s}</TableCell>
              ))}
              <TableCell align="right" sx={{ borderLeft: 1, borderColor: 'divider', fontWeight: 'bold' }}>Total</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {farmsWithData.map(({ farm }) => {
              const sd = farmStage.get(farm.id) || {};
              const acres = farmAcres.get(farm.id) || 0;
              let rowTotal = 0;
              for (const s of stages) rowTotal += sd[s] || 0;

              return (
                <TableRow key={farm.id} hover>
                  <TableCell sx={{ ...TD, fontWeight: 'bold', whiteSpace: 'nowrap' }}>{shortName(farm.name)}</TableCell>
                  {stages.map(s => {
                    const val = sd[s] || 0;
                    const perAcre = acres > 0 ? val / acres : 0;
                    return (
                      <TableCell key={s} align="right"
                        sx={{ ...TD, color: val > 0 ? 'text.primary' : 'text.disabled' }}>
                        {val > 0 ? fmtDec(perAcre) : '—'}
                      </TableCell>
                    );
                  })}
                  <TableCell align="right" sx={{ ...TD, fontWeight: 'bold', borderLeft: 1, borderColor: 'divider' }}>
                    {acres > 0 ? fmtDec(rowTotal / acres) : '—'}
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow sx={{ '& td': { ...TD, ...TOTAL_ROW } }}>
              <TableCell>Avg $/Acre</TableCell>
              {stages.map(s => {
                const total = farmsWithData.reduce((sum, { farm }) => sum + (farmStage.get(farm.id)?.[s] || 0), 0);
                return <TableCell key={s} align="right">{grandAcres > 0 ? fmtDec(total / grandAcres) : '—'}</TableCell>;
              })}
              <TableCell align="right" sx={{ borderLeft: 1, borderColor: 'divider' }}>
                {(() => {
                  const total = farmsWithData.reduce((sum, { farm }) => {
                    const sd = farmStage.get(farm.id) || {};
                    return sum + stages.reduce((ss, s) => ss + (sd[s] || 0), 0);
                  }, 0);
                  return grandAcres > 0 ? fmtDec(total / grandAcres) : '—';
                })()}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Procurement Tab Content
   ═══════════════════════════════════════════════════════════════════════════ */
function ProcurementContent({ year, farmsWithData }) {
  const seedData = useMemo(() => buildCategoryData(farmsWithData, 'seed'), [farmsWithData]);
  const fertData = useMemo(() => buildCategoryData(farmsWithData, 'fertilizer'), [farmsWithData]);
  const chemData = useMemo(() => buildCategoryData(farmsWithData, 'chemical'), [farmsWithData]);
  const stageData = useMemo(() => buildStageData(farmsWithData), [farmsWithData]);

  const grandAcres = seedData.grandAcres;
  const totalInput = seedData.grandCost + fertData.grandCost + chemData.grandCost;

  if (farmsWithData.length === 0) {
    return <Alert severity="warning">No agronomy plans found for crop year {year}.</Alert>;
  }

  return (
    <>
      {/* KPIs */}
      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        {[
          { label: 'Farms', value: farmsWithData.length },
          { label: 'Total Acres', value: fmt(grandAcres) },
          { label: 'Seed', value: fmtDol(seedData.grandCost) },
          { label: 'Fertilizer', value: fmtDol(fertData.grandCost) },
          { label: 'Chemistry', value: fmtDol(chemData.grandCost) },
          { label: 'Total $/Acre', value: grandAcres > 0 ? fmtDec(totalInput / grandAcres) : '—' },
        ].map(kpi => (
          <Paper key={kpi.label} sx={{ p: 2, textAlign: 'center', flex: 1 }}>
            <Typography variant="body2" color="text.secondary">{kpi.label}</Typography>
            <Typography variant="h6" fontWeight="bold">{kpi.value}</Typography>
          </Paper>
        ))}
      </Stack>

      {/* Cost by Location */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" fontWeight="bold" sx={{ mb: 1 }}>Cost by Location ($/Acre)</Typography>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': TH }}>
                <TableCell>Location</TableCell>
                <TableCell align="right">Acres</TableCell>
                <TableCell align="right">Seed</TableCell>
                <TableCell align="right">Fertilizer</TableCell>
                <TableCell align="right">Chemistry</TableCell>
                <TableCell align="right" sx={{ borderLeft: 1, borderColor: 'divider' }}>Total $/Acre</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {farmsWithData.map(({ farm }) => {
                const acres = seedData.farmTotals.get(farm.id)?.acres || 0;
                const s = seedData.farmTotals.get(farm.id)?.cost || 0;
                const f = fertData.farmTotals.get(farm.id)?.cost || 0;
                const c = chemData.farmTotals.get(farm.id)?.cost || 0;
                return (
                  <TableRow key={farm.id} hover>
                    <TableCell sx={{ ...TD, fontWeight: 'bold', whiteSpace: 'nowrap' }}>{shortName(farm.name)}</TableCell>
                    <TableCell align="right" sx={TD}>{fmt(acres)}</TableCell>
                    <TableCell align="right" sx={TD}>{acres > 0 ? fmtDec(s / acres) : '—'}</TableCell>
                    <TableCell align="right" sx={TD}>{acres > 0 ? fmtDec(f / acres) : '—'}</TableCell>
                    <TableCell align="right" sx={TD}>{acres > 0 ? fmtDec(c / acres) : '—'}</TableCell>
                    <TableCell align="right" sx={{ ...TD, fontWeight: 'bold', borderLeft: 1, borderColor: 'divider' }}>
                      {acres > 0 ? fmtDec((s + f + c) / acres) : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow sx={{ '& td': { ...TD, ...TOTAL_ROW } }}>
                <TableCell>TOTAL</TableCell>
                <TableCell align="right">{fmt(grandAcres)}</TableCell>
                <TableCell align="right">{grandAcres > 0 ? fmtDec(seedData.grandCost / grandAcres) : ''}</TableCell>
                <TableCell align="right">{grandAcres > 0 ? fmtDec(fertData.grandCost / grandAcres) : ''}</TableCell>
                <TableCell align="right">{grandAcres > 0 ? fmtDec(chemData.grandCost / grandAcres) : ''}</TableCell>
                <TableCell align="right" sx={{ borderLeft: 1, borderColor: 'divider' }}>
                  {grandAcres > 0 ? fmtDec(totalInput / grandAcres) : ''}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      {/* Product tables */}
      <ProductCostTable title="Seed" data={seedData} farmsWithData={farmsWithData} />
      <ProductCostTable title="Fertilizer" data={fertData} farmsWithData={farmsWithData} />
      <ProductCostTable title="Chemistry" data={chemData} farmsWithData={farmsWithData} />

      {/* Chemistry by stage */}
      <ChemStageTable stageData={stageData} farmsWithData={farmsWithData} />
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main Page — Tabbed: Procurement | Product Library
   ═══════════════════════════════════════════════════════════════════════════ */
export default function EnterpriseAgroPlan() {
  const { farmUnits } = useFarm();
  const navigate = useNavigate();
  const location = useLocation();
  const [year, setYear] = useState(2026);
  const [farmResults, setFarmResults] = useState([]);
  const [loading, setLoading] = useState(true);

  const isLibraryTab = location.pathname.includes('/library');
  const isContractsTab = location.pathname.includes('/contracts');
  const isCoverageTab = location.pathname.includes('/coverage');
  const tabIndex = isCoverageTab ? 3 : isContractsTab ? 2 : isLibraryTab ? 1 : 0;

  useEffect(() => {
    if (!farmUnits?.length) return;
    setLoading(true);
    Promise.all(
      farmUnits.map(farm =>
        Promise.all([
          api.get(`/api/farms/${farm.id}/agronomy/plans?year=${year}`).catch(() => ({ data: null })),
          api.get(`/api/farms/${farm.id}/agronomy/dashboard?year=${year}`).catch(() => ({ data: null })),
        ]).then(([planRes, dashRes]) => ({ farm, plan: planRes.data, dashboard: dashRes.data }))
      )
    ).then(setFarmResults).finally(() => setLoading(false));
  }, [farmUnits, year]);

  const farmsWithData = useMemo(
    () => farmResults.filter(r => r.dashboard?.farm && r.plan?.allocations?.length > 0),
    [farmResults]
  );

  const handleTabChange = (_, idx) => {
    const paths = ['/enterprise/agro-plan', '/enterprise/agro-plan/library', '/enterprise/agro-plan/contracts', '/enterprise/agro-plan/coverage'];
    navigate(paths[idx] || paths[0]);
  };

  if (loading) return <Typography>Loading...</Typography>;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight="bold">Procurement</Typography>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Crop Year</InputLabel>
          <Select value={year} label="Crop Year" onChange={e => setYear(e.target.value)}>
            <MenuItem value={2026}>2026</MenuItem>
            <MenuItem value={2025}>2025</MenuItem>
            <MenuItem value={2027}>2027</MenuItem>
          </Select>
        </FormControl>
        <Chip icon={<VisibilityIcon />} label="Read-Only" size="small" variant="outlined" />
        <Box sx={{ ml: 'auto' }}>
          <ProcurementExportButtons cropYear={year} />
        </Box>
      </Box>

      {/* Tabs */}
      <Tabs
        value={tabIndex}
        onChange={handleTabChange}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        <Tab label="Procurement" icon={<AgricultureIcon />} iconPosition="start" />
        <Tab label="Product Library" icon={<InventoryIcon />} iconPosition="start" />
        <Tab label="Contracts" icon={<ReceiptLongIcon />} iconPosition="start" />
        <Tab label="Plan vs Booked" icon={<CompareArrowsIcon />} iconPosition="start" />
      </Tabs>

      {/* Tab content */}
      {tabIndex === 0 && (
        <ProcurementContent year={year} farmsWithData={farmsWithData} />
      )}
      {tabIndex === 1 && (
        <ProductLibrary year={year} />
      )}
      {tabIndex === 2 && (
        <ProcurementContracts year={year} />
      )}
      {tabIndex === 3 && (
        <PlanVsBooked year={year} />
      )}
    </Box>
  );
}
