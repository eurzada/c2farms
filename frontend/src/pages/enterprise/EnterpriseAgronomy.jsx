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

const STATUS_COLORS = { draft: 'default', submitted: 'warning', approved: 'success', locked: 'info', rejected: 'error' };

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

  // Collect all unique crops across all farms (for Farm Registry columns)
  const allCrops = new Set();
  for (const { data } of farmsWithPlans) {
    for (const c of (data.crops || [])) allCrops.add(c.crop);
  }
  const cropColumns = [...allCrops].sort();

  // Aggregate by crop for the Assumptions & Yield Targets table
  const cropAgg = {};
  for (const { data } of farmsWithPlans) {
    for (const c of (data.crops || [])) {
      if (!cropAgg[c.crop]) {
        cropAgg[c.crop] = {
          crop: c.crop,
          acres: 0, production: 0, revenue: 0, total_cost: 0,
          // For weighted-average yield & price
          _yield_x_acres: 0, _price_x_acres: 0,
        };
      }
      const a = cropAgg[c.crop];
      a.acres += c.acres || 0;
      a.production += (c.acres || 0) * (c.target_yield_bu || 0);
      a.revenue += c.revenue || 0;
      a.total_cost += c.total_cost || 0;
      a._yield_x_acres += (c.target_yield_bu || 0) * (c.acres || 0);
      a._price_x_acres += (c.commodity_price || 0) * (c.acres || 0);
    }
  }
  const cropList = Object.values(cropAgg).sort((a, b) => b.acres - a.acres);

  // Grand totals
  const grandTotals = {
    acres: 0, production: 0, revenue: 0, total_cost: 0,
  };
  for (const c of cropList) {
    grandTotals.acres += c.acres;
    grandTotals.production += c.production;
    grandTotals.revenue += c.revenue;
    grandTotals.total_cost += c.total_cost;
  }
  grandTotals.margin = grandTotals.revenue - grandTotals.total_cost;

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

      {/* KPI Cards */}
      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <Paper sx={{ p: 2, textAlign: 'center', flex: 1 }}>
          <Typography variant="body2" color="text.secondary">Farm Units</Typography>
          <Typography variant="h4" fontWeight="bold">{farmsWithPlans.length}</Typography>
        </Paper>
        <Paper sx={{ p: 2, textAlign: 'center', flex: 1 }}>
          <Typography variant="body2" color="text.secondary">Total Acres</Typography>
          <Typography variant="h4" fontWeight="bold">{fmt(grandTotals.acres)}</Typography>
        </Paper>
        <Paper sx={{ p: 2, textAlign: 'center', flex: 1 }}>
          <Typography variant="body2" color="text.secondary">Budgeted Input Cost</Typography>
          <Typography variant="h4" fontWeight="bold">${fmt(grandTotals.total_cost)}</Typography>
        </Paper>
        <Paper sx={{ p: 2, textAlign: 'center', flex: 1 }}>
          <Typography variant="body2" color="text.secondary">Gross Revenue</Typography>
          <Typography variant="h4" fontWeight="bold">${fmt(grandTotals.revenue)}</Typography>
        </Paper>
        <Paper sx={{ p: 2, textAlign: 'center', flex: 1 }}>
          <Typography variant="body2" color="text.secondary">Gross Margin</Typography>
          <Typography variant="h4" fontWeight="bold" sx={{ color: grandTotals.margin >= 0 ? 'success.main' : 'error.main' }}>
            ${fmt(grandTotals.margin)}
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
          <Typography variant="h6" sx={{ mb: 1 }}>Farm Registry</Typography>
          <TableContainer component={Paper} sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 'bold', bgcolor: 'action.hover' } }}>
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
                        <TableCell key={crop} align="right">
                          {cropMap[crop] ? fmt(cropMap[crop]) : <Typography variant="body2" color="text.disabled">0</Typography>}
                        </TableCell>
                      ))}
                      <TableCell align="center">
                        <Chip
                          label={(data.plan_status || 'draft').toUpperCase()}
                          size="small"
                          color={STATUS_COLORS[data.plan_status] || 'default'}
                          variant="outlined"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {farmsWithoutPlans.map(({ farm }) => (
                  <TableRow key={farm.id} sx={{ opacity: 0.5 }}>
                    <TableCell>{farm.name}</TableCell>
                    <TableCell align="right" colSpan={cropColumns.length + 1}>
                      <Typography variant="body2" color="text.secondary">No plan</Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Chip label="NO PLAN" size="small" variant="outlined" />
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow sx={{ '& td': { fontWeight: 'bold', borderTop: 2, borderColor: 'divider' } }}>
                  <TableCell>TOTAL</TableCell>
                  <TableCell align="right">{fmt(grandTotals.acres)}</TableCell>
                  {cropColumns.map(crop => {
                    const total = cropAgg[crop]?.acres || 0;
                    return <TableCell key={crop} align="right">{fmt(total)}</TableCell>;
                  })}
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          {/* ─── Assumptions & Yield Targets ───────────────────────── */}
          <Typography variant="h6" sx={{ mb: 1 }}>Assumptions & Yield Targets</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Yield and price are weighted averages across all farm locations.
          </Typography>
          <TableContainer component={Paper} sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 'bold', bgcolor: 'action.hover' } }}>
                  <TableCell>Crop</TableCell>
                  <TableCell align="right">Target Yield (bu/ac)</TableCell>
                  <TableCell align="right">Price ($/bu)</TableCell>
                  <TableCell align="right">Total Acres</TableCell>
                  <TableCell align="right">Target Production (bu)</TableCell>
                  <TableCell align="right">Gross Revenue ($)</TableCell>
                  <TableCell align="right">Budgeted Input Cost ($)</TableCell>
                  <TableCell align="right">Input Cost / Bushel</TableCell>
                  <TableCell align="right">Gross Margin ($)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {cropList.map(c => {
                  const avgYield = c.acres ? c._yield_x_acres / c.acres : 0;
                  const avgPrice = c.acres ? c._price_x_acres / c.acres : 0;
                  const costPerBu = c.production ? c.total_cost / c.production : 0;
                  const margin = c.revenue - c.total_cost;
                  return (
                    <TableRow key={c.crop} hover>
                      <TableCell sx={{ fontWeight: 'bold' }}>{c.crop}</TableCell>
                      <TableCell align="right">{fmtDec(avgYield)}</TableCell>
                      <TableCell align="right">${fmtDec(avgPrice)}</TableCell>
                      <TableCell align="right">{fmt(c.acres)}</TableCell>
                      <TableCell align="right">{fmt(c.production)}</TableCell>
                      <TableCell align="right">${fmt(c.revenue)}</TableCell>
                      <TableCell align="right">${fmt(c.total_cost)}</TableCell>
                      <TableCell align="right">${fmtDec(costPerBu)}</TableCell>
                      <TableCell align="right" sx={{ color: margin >= 0 ? 'success.main' : 'error.main' }}>
                        ${fmt(margin)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow sx={{ '& td': { fontWeight: 'bold', borderTop: 2, borderColor: 'divider' } }}>
                  <TableCell>TOTAL</TableCell>
                  <TableCell align="right" />
                  <TableCell align="right" />
                  <TableCell align="right">{fmt(grandTotals.acres)}</TableCell>
                  <TableCell align="right">{fmt(grandTotals.production)}</TableCell>
                  <TableCell align="right">${fmt(grandTotals.revenue)}</TableCell>
                  <TableCell align="right">${fmt(grandTotals.total_cost)}</TableCell>
                  <TableCell align="right">
                    {grandTotals.production ? `$${fmtDec(grandTotals.total_cost / grandTotals.production)}` : ''}
                  </TableCell>
                  <TableCell align="right" sx={{ color: grandTotals.margin >= 0 ? 'success.main' : 'error.main' }}>
                    ${fmt(grandTotals.margin)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          {/* ─── Per-Farm Cost Breakdown ───────────────────────────── */}
          <Typography variant="h6" sx={{ mb: 1 }}>Per-Farm Cost Breakdown</Typography>
          <TableContainer component={Paper} sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 'bold', bgcolor: 'action.hover' } }}>
                  <TableCell>Farm</TableCell>
                  <TableCell align="right">Acres</TableCell>
                  <TableCell align="right">Seed ($)</TableCell>
                  <TableCell align="right">Fert ($)</TableCell>
                  <TableCell align="right">Chem ($)</TableCell>
                  <TableCell align="right">Total Input ($)</TableCell>
                  <TableCell align="right">$/Acre</TableCell>
                  <TableCell align="right">Revenue ($)</TableCell>
                  <TableCell align="right">Margin ($)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {farmsWithPlans.map(({ farm, data }) => (
                  <TableRow key={farm.id} hover>
                    <TableCell sx={{ fontWeight: 'bold' }}>{farm.name}</TableCell>
                    <TableCell align="right">{fmt(data.farm.acres)}</TableCell>
                    <TableCell align="right">${fmt(data.farm.seed_total)}</TableCell>
                    <TableCell align="right">${fmt(data.farm.fert_total)}</TableCell>
                    <TableCell align="right">${fmt(data.farm.chem_total)}</TableCell>
                    <TableCell align="right">${fmt(data.farm.total_cost)}</TableCell>
                    <TableCell align="right">${fmtDec(data.farm.cost_per_acre)}</TableCell>
                    <TableCell align="right">${fmt(data.farm.revenue)}</TableCell>
                    <TableCell align="right" sx={{ color: data.farm.margin >= 0 ? 'success.main' : 'error.main' }}>
                      ${fmt(data.farm.margin)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow sx={{ '& td': { fontWeight: 'bold', borderTop: 2, borderColor: 'divider' } }}>
                  <TableCell>TOTAL</TableCell>
                  <TableCell align="right">{fmt(grandTotals.acres)}</TableCell>
                  <TableCell align="right">${fmt(farmsWithPlans.reduce((s, r) => s + (r.data.farm.seed_total || 0), 0))}</TableCell>
                  <TableCell align="right">${fmt(farmsWithPlans.reduce((s, r) => s + (r.data.farm.fert_total || 0), 0))}</TableCell>
                  <TableCell align="right">${fmt(farmsWithPlans.reduce((s, r) => s + (r.data.farm.chem_total || 0), 0))}</TableCell>
                  <TableCell align="right">${fmt(grandTotals.total_cost)}</TableCell>
                  <TableCell align="right">${grandTotals.acres ? `$${fmtDec(grandTotals.total_cost / grandTotals.acres)}` : ''}</TableCell>
                  <TableCell align="right">${fmt(grandTotals.revenue)}</TableCell>
                  <TableCell align="right" sx={{ color: grandTotals.margin >= 0 ? 'success.main' : 'error.main' }}>
                    ${fmt(grandTotals.margin)}
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
