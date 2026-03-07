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
function fmtDec(n) { return (n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtPct(n) { return (n * 100).toFixed(1) + '%'; }

const STATUS_COLORS = { draft: 'default', submitted: 'warning', approved: 'success', locked: 'info', rejected: 'error' };

function statusChip(status) {
  return (
    <Chip
      label={(status || 'draft').toUpperCase()}
      size="small"
      color={STATUS_COLORS[status] || 'default'}
      variant="outlined"
    />
  );
}

function SectionHeader({ children }) {
  return (
    <Typography variant="h6" sx={{ mb: 1, mt: 3, fontWeight: 'bold' }}>
      {children}
    </Typography>
  );
}

const TH_SX = { fontWeight: 'bold', bgcolor: 'action.hover', whiteSpace: 'nowrap' };
const TOTAL_SX = { fontWeight: 'bold', borderTop: 2, borderColor: 'divider' };

export default function EnterpriseAgronomy() {
  const { farmUnits } = useFarm();
  const [year, setYear] = useState(2026);
  const [farmData, setFarmData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!farmUnits?.length) return;
    setLoading(true);

    Promise.all(
      farmUnits.map(farm =>
        api.get(`/api/farms/${farm.id}/agronomy/dashboard?year=${year}`)
          .then(res => ({ farm, data: res.data }))
          .catch(() => ({ farm, data: null }))
      )
    ).then(results => {
      setFarmData(results);
    }).finally(() => setLoading(false));
  }, [farmUnits, year]);

  if (loading) return <Typography>Loading...</Typography>;

  const farmsWithPlans = farmData.filter(r => r.data?.farm);
  const farmsWithoutPlans = farmData.filter(r => !r.data?.farm);

  // ─── Farm Registry: collect all unique crops for column headers ─────
  const allCrops = new Set();
  for (const { data } of farmsWithPlans) {
    for (const c of (data.crops || [])) allCrops.add(c.crop);
  }
  const cropColumns = [...allCrops].sort();

  // ─── Aggregate by crop ─────────────────────────────────────────────
  const cropAgg = {};
  for (const { data } of farmsWithPlans) {
    for (const c of (data.crops || [])) {
      if (!cropAgg[c.crop]) {
        cropAgg[c.crop] = {
          crop: c.crop, acres: 0, production: 0, revenue: 0,
          seed_total: 0, fert_total: 0, chem_total: 0, total_cost: 0,
          _yield_x_acres: 0,
        };
      }
      const a = cropAgg[c.crop];
      a.acres += c.acres || 0;
      a.production += (c.acres || 0) * (c.target_yield_bu || 0);
      a.revenue += c.revenue || 0;
      a.seed_total += c.seed_total || 0;
      a.fert_total += c.fert_total || 0;
      a.chem_total += c.chem_total || 0;
      a.total_cost += c.total_cost || 0;
      a._yield_x_acres += (c.target_yield_bu || 0) * (c.acres || 0);
    }
  }
  const cropList = Object.values(cropAgg).sort((a, b) => b.acres - a.acres);

  // ─── Grand totals ──────────────────────────────────────────────────
  const gt = { acres: 0, production: 0, revenue: 0, seed_total: 0, fert_total: 0, chem_total: 0, total_cost: 0 };
  for (const c of cropList) {
    gt.acres += c.acres;
    gt.production += c.production;
    gt.revenue += c.revenue;
    gt.seed_total += c.seed_total;
    gt.fert_total += c.fert_total;
    gt.chem_total += c.chem_total;
    gt.total_cost += c.total_cost;
  }
  gt.margin = gt.revenue - gt.total_cost;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight="bold">Enterprise Agronomy</Typography>
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

      {/* ─── KPI Banner ─────────────────────────────────────────────── */}
      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <Paper sx={{ p: 2, textAlign: 'center', flex: 1 }}>
          <Typography variant="body2" color="text.secondary">Total Acres</Typography>
          <Typography variant="h5" fontWeight="bold">{fmt(gt.acres)}</Typography>
        </Paper>
        <Paper sx={{ p: 2, textAlign: 'center', flex: 1 }}>
          <Typography variant="body2" color="text.secondary">Total Input Budget</Typography>
          <Typography variant="h5" fontWeight="bold">${fmt(gt.total_cost)}</Typography>
        </Paper>
        <Paper sx={{ p: 2, textAlign: 'center', flex: 1 }}>
          <Typography variant="body2" color="text.secondary">Projected Gross Revenue</Typography>
          <Typography variant="h5" fontWeight="bold">${fmt(gt.revenue)}</Typography>
        </Paper>
        <Paper sx={{ p: 2, textAlign: 'center', flex: 1 }}>
          <Typography variant="body2" color="text.secondary">Projected Gross Margin</Typography>
          <Typography variant="h5" fontWeight="bold" sx={{ color: gt.margin >= 0 ? 'success.main' : 'error.main' }}>
            ${fmt(gt.margin)}
          </Typography>
        </Paper>
      </Stack>

      {farmsWithPlans.length === 0 ? (
        <Alert severity="warning">
          No agronomy plans found for crop year {year}. Create plans on individual farm units first.
        </Alert>
      ) : (
        <>
          {/* ─── Farm Registry ──────────────────────────────────────── */}
          <SectionHeader>Farm Registry</SectionHeader>
          <TableContainer component={Paper} sx={{ mb: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': TH_SX }}>
                  <TableCell>Farm</TableCell>
                  <TableCell align="right">Total Acres</TableCell>
                  {cropColumns.map(crop => (
                    <TableCell key={crop} align="right">{crop} (ac)</TableCell>
                  ))}
                  <TableCell align="center">Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {farmsWithPlans.map(({ farm, data }) => {
                  const cropMap = {};
                  for (const c of (data.crops || [])) cropMap[c.crop] = c.acres || 0;
                  return (
                    <TableRow key={farm.id} hover>
                      <TableCell sx={{ fontWeight: 'bold' }}>{farm.name}</TableCell>
                      <TableCell align="right">{fmt(data.farm.acres)}</TableCell>
                      {cropColumns.map(crop => (
                        <TableCell key={crop} align="right" sx={!cropMap[crop] ? { color: 'text.disabled' } : undefined}>
                          {fmt(cropMap[crop] || 0)}
                        </TableCell>
                      ))}
                      <TableCell align="center">{statusChip(data.plan_status)}</TableCell>
                    </TableRow>
                  );
                })}
                {farmsWithoutPlans.map(({ farm }) => (
                  <TableRow key={farm.id} sx={{ opacity: 0.5 }}>
                    <TableCell>{farm.name}</TableCell>
                    <TableCell colSpan={cropColumns.length + 1} />
                    <TableCell align="center">{statusChip(null)}</TableCell>
                  </TableRow>
                ))}
                <TableRow sx={{ '& td': TOTAL_SX }}>
                  <TableCell>TOTAL</TableCell>
                  <TableCell align="right">{fmt(gt.acres)}</TableCell>
                  {cropColumns.map(crop => (
                    <TableCell key={crop} align="right">{fmt(cropAgg[crop]?.acres || 0)}</TableCell>
                  ))}
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          {/* ─── Cost Summary by Farm ──────────────────────────────── */}
          <SectionHeader>Cost Summary by Farm</SectionHeader>
          <TableContainer component={Paper} sx={{ mb: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': TH_SX }}>
                  <TableCell>Farm</TableCell>
                  <TableCell align="right">Total Acres</TableCell>
                  <TableCell align="right">Seed ($)</TableCell>
                  <TableCell align="right">Fertilizer ($)</TableCell>
                  <TableCell align="right">Chemical ($)</TableCell>
                  <TableCell align="right">Total Input ($)</TableCell>
                  <TableCell align="right">Cost/Acre ($)</TableCell>
                  <TableCell align="right">Proj. Revenue ($)</TableCell>
                  <TableCell align="right">Gross Margin ($)</TableCell>
                  <TableCell align="right">Margin/Acre ($)</TableCell>
                  <TableCell align="right">Margin %</TableCell>
                  <TableCell align="center">Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {farmsWithPlans.map(({ farm, data }) => {
                  const d = data.farm;
                  const marginPct = d.revenue ? (d.margin / d.revenue) : 0;
                  return (
                    <TableRow key={farm.id} hover>
                      <TableCell sx={{ fontWeight: 'bold' }}>{farm.name}</TableCell>
                      <TableCell align="right">{fmt(d.acres)}</TableCell>
                      <TableCell align="right">${fmt(d.seed_total)}</TableCell>
                      <TableCell align="right">${fmt(d.fert_total)}</TableCell>
                      <TableCell align="right">${fmt(d.chem_total)}</TableCell>
                      <TableCell align="right">${fmt(d.total_cost)}</TableCell>
                      <TableCell align="right">${fmtDec(d.cost_per_acre)}</TableCell>
                      <TableCell align="right">${fmt(d.revenue)}</TableCell>
                      <TableCell align="right" sx={{ color: d.margin >= 0 ? 'success.main' : 'error.main' }}>
                        ${fmt(d.margin)}
                      </TableCell>
                      <TableCell align="right">${fmtDec(d.margin_per_acre)}</TableCell>
                      <TableCell align="right">{fmtPct(marginPct)}</TableCell>
                      <TableCell align="center">
                        <Chip label="On Track" size="small" color="success" variant="outlined" />
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow sx={{ '& td': TOTAL_SX }}>
                  <TableCell>TOTAL</TableCell>
                  <TableCell align="right">{fmt(gt.acres)}</TableCell>
                  <TableCell align="right">${fmt(gt.seed_total)}</TableCell>
                  <TableCell align="right">${fmt(gt.fert_total)}</TableCell>
                  <TableCell align="right">${fmt(gt.chem_total)}</TableCell>
                  <TableCell align="right">${fmt(gt.total_cost)}</TableCell>
                  <TableCell align="right">${gt.acres ? `$${fmtDec(gt.total_cost / gt.acres)}` : ''}</TableCell>
                  <TableCell align="right">${fmt(gt.revenue)}</TableCell>
                  <TableCell align="right" sx={{ color: gt.margin >= 0 ? 'success.main' : 'error.main' }}>
                    ${fmt(gt.margin)}
                  </TableCell>
                  <TableCell align="right">${gt.acres ? fmtDec(gt.margin / gt.acres) : ''}</TableCell>
                  <TableCell align="right">{gt.revenue ? fmtPct(gt.margin / gt.revenue) : ''}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          {/* ─── Cost Summary by Crop ─────────────────────────────── */}
          <SectionHeader>Cost Summary by Crop</SectionHeader>
          <TableContainer component={Paper} sx={{ mb: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': TH_SX }}>
                  <TableCell>Crop</TableCell>
                  <TableCell align="right">Total Acres</TableCell>
                  <TableCell align="right">Seed ($)</TableCell>
                  <TableCell align="right">Fertilizer ($)</TableCell>
                  <TableCell align="right">Chemical ($)</TableCell>
                  <TableCell align="right">Total Input ($)</TableCell>
                  <TableCell align="right">Cost/Acre ($)</TableCell>
                  <TableCell align="right">Target Yield</TableCell>
                  <TableCell align="right">Cost/Bushel ($)</TableCell>
                  <TableCell align="right">Revenue/Acre ($)</TableCell>
                  <TableCell align="right">Margin/Acre ($)</TableCell>
                  <TableCell align="right">% of Budget</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {cropList.map(c => {
                  const costPerAcre = c.acres ? c.total_cost / c.acres : 0;
                  const avgYield = c.acres ? c._yield_x_acres / c.acres : 0;
                  const costPerBu = c.production ? c.total_cost / c.production : 0;
                  const revPerAcre = c.acres ? c.revenue / c.acres : 0;
                  const marginPerAcre = c.acres ? (c.revenue - c.total_cost) / c.acres : 0;
                  const pctBudget = gt.total_cost ? c.total_cost / gt.total_cost : 0;
                  return (
                    <TableRow key={c.crop} hover>
                      <TableCell sx={{ fontWeight: 'bold' }}>{c.crop}</TableCell>
                      <TableCell align="right">{fmt(c.acres)}</TableCell>
                      <TableCell align="right">${fmt(c.seed_total)}</TableCell>
                      <TableCell align="right">${fmt(c.fert_total)}</TableCell>
                      <TableCell align="right">${fmt(c.chem_total)}</TableCell>
                      <TableCell align="right">${fmt(c.total_cost)}</TableCell>
                      <TableCell align="right">${fmtDec(costPerAcre)}</TableCell>
                      <TableCell align="right">{fmtDec(avgYield)}</TableCell>
                      <TableCell align="right">${fmtDec(costPerBu)}</TableCell>
                      <TableCell align="right">${fmtDec(revPerAcre)}</TableCell>
                      <TableCell align="right" sx={{ color: marginPerAcre >= 0 ? 'success.main' : 'error.main' }}>
                        ${fmtDec(marginPerAcre)}
                      </TableCell>
                      <TableCell align="right">{fmtPct(pctBudget)}</TableCell>
                    </TableRow>
                  );
                })}
                <TableRow sx={{ '& td': TOTAL_SX }}>
                  <TableCell>TOTAL</TableCell>
                  <TableCell align="right">{fmt(gt.acres)}</TableCell>
                  <TableCell align="right">${fmt(gt.seed_total)}</TableCell>
                  <TableCell align="right">${fmt(gt.fert_total)}</TableCell>
                  <TableCell align="right">${fmt(gt.chem_total)}</TableCell>
                  <TableCell align="right">${fmt(gt.total_cost)}</TableCell>
                  <TableCell align="right">${gt.acres ? `$${fmtDec(gt.total_cost / gt.acres)}` : ''}</TableCell>
                  <TableCell align="right" />
                  <TableCell align="right" />
                  <TableCell align="right" />
                  <TableCell align="right" />
                  <TableCell align="right">100.0%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          {/* ─── Budget Guardrails — Variance Monitoring ──────────── */}
          <SectionHeader>Budget Guardrails — Variance Monitoring</SectionHeader>
          <TableContainer component={Paper} sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': TH_SX }}>
                  <TableCell>Farm</TableCell>
                  <TableCell align="right">Budgeted ($)</TableCell>
                  <TableCell align="right">Actual Spend ($)</TableCell>
                  <TableCell align="right">Variance ($)</TableCell>
                  <TableCell align="right">Variance %</TableCell>
                  <TableCell align="center">Budget Status</TableCell>
                  <TableCell align="right">Target Yield</TableCell>
                  <TableCell align="right">Actual Yield</TableCell>
                  <TableCell align="right">Yield Var %</TableCell>
                  <TableCell align="center">Yield Status</TableCell>
                  <TableCell align="center">Overall</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {farmsWithPlans.map(({ farm, data }) => {
                  const d = data.farm;
                  const budgeted = d.total_cost || 0;
                  // Actual spend would come from GL actuals once connected
                  const actualSpend = 0; // TODO: pull from GL actuals
                  const variance = actualSpend - budgeted;
                  const variancePct = budgeted ? variance / budgeted : 0;
                  const targetYieldPerAcre = d.acres ? (d.revenue / (d.acres * (d.margin_pct !== undefined ? 1 : 1))) : 0;
                  // cost_per_acre as proxy for weighted target yield $/acre
                  const costPerAcre = d.cost_per_acre || 0;
                  const actualYield = 0; // TODO: pull from actual harvest data
                  const yieldVar = costPerAcre ? -1 : 0; // Pre-season placeholder

                  const isBudgetPreSeason = actualSpend === 0;
                  const isYieldPreSeason = actualYield === 0;

                  return (
                    <TableRow key={farm.id} hover>
                      <TableCell sx={{ fontWeight: 'bold' }}>{farm.name}</TableCell>
                      <TableCell align="right">${fmt(budgeted)}</TableCell>
                      <TableCell align="right">${fmt(actualSpend)}</TableCell>
                      <TableCell align="right" sx={{ color: variance < 0 ? 'error.main' : 'success.main' }}>
                        {variance < 0 ? `($${fmt(Math.abs(variance))})` : `$${fmt(variance)}`}
                      </TableCell>
                      <TableCell align="right" sx={{ color: variancePct < 0 ? 'error.main' : 'success.main' }}>
                        {fmtPct(variancePct)}
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          label={isBudgetPreSeason ? 'Pre-Season' : (Math.abs(variancePct) <= 0.1 ? 'On Track' : 'Over Budget')}
                          size="small"
                          color={isBudgetPreSeason ? 'default' : (Math.abs(variancePct) <= 0.1 ? 'success' : 'error')}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell align="right">${fmtDec(costPerAcre)}</TableCell>
                      <TableCell align="right">${fmtDec(actualYield)}</TableCell>
                      <TableCell align="right" sx={{ color: 'error.main' }}>
                        {isYieldPreSeason ? fmtPct(-1) : fmtPct(yieldVar)}
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          label={isYieldPreSeason ? 'Pre-Season' : 'On Track'}
                          size="small"
                          color={isYieldPreSeason ? 'default' : 'success'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          label={isBudgetPreSeason ? 'Pre-Season' : 'On Track'}
                          size="small"
                          color={isBudgetPreSeason ? 'default' : 'success'}
                          variant="outlined"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {farmsWithoutPlans.length > 0 && (
            <Alert severity="warning" variant="outlined">
              {farmsWithoutPlans.length} farm unit(s) have no agronomy plan for {year}:{' '}
              {farmsWithoutPlans.map(r => r.farm.name).join(', ')}
            </Alert>
          )}
        </>
      )}
    </Box>
  );
}
