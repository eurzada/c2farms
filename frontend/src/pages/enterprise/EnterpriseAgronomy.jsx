import { useState, useEffect, useMemo } from 'react';
import {
  Box, Typography, Paper, Alert, Chip, Stack, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  FormControl, InputLabel, Select, MenuItem, useTheme,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import LockIcon from '@mui/icons-material/Lock';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import { Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, Tooltip as ChartTooltip, Legend } from 'chart.js';
import { Doughnut, Bar } from 'react-chartjs-2';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, ChartTooltip, Legend);

function fmt(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function fmtDec(n) { return (n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtPct(n) { return (n * 100).toFixed(1) + '%'; }

const CROP_COLORS = [
  '#2e7d32', '#1565c0', '#ef6c00', '#6a1b9a', '#c62828', '#00838f', '#4e342e', '#37474f',
];

const TH_SX = { fontWeight: 'bold', bgcolor: 'action.hover', whiteSpace: 'nowrap' };
const TOTAL_SX = { fontWeight: 'bold', borderTop: 2, borderColor: 'divider' };

function KpiCard({ label, value, sub, color }) {
  return (
    <Paper sx={{ p: 2.5, textAlign: 'center', flex: 1 }}>
      <Typography variant="body2" color="text.secondary" gutterBottom>{label}</Typography>
      <Typography variant="h5" fontWeight="bold" sx={{ color: color || 'text.primary' }}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

export default function EnterpriseAgronomy() {
  const theme = useTheme();
  const { farmUnits, isAdmin } = useFarm();
  const [year, setYear] = useState(2026);
  const [farmData, setFarmData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  const loadData = () => {
    if (!farmUnits?.length) return;
    setLoading(true);
    Promise.all(
      farmUnits.map(farm =>
        api.get(`/api/farms/${farm.id}/agronomy/dashboard?year=${year}`)
          .then(res => ({ farm, data: res.data }))
          .catch(() => ({ farm, data: null }))
      )
    ).then(setFarmData).finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, [farmUnits, year]);

  const handleBulkStatus = async (status) => {
    const action = status === 'draft' ? 'unlock' : 'lock';
    const ok = await confirm({
      title: `${action === 'unlock' ? 'Unlock' : 'Lock'} All Plans?`,
      message: `This will ${action} all agronomy plans for crop year ${year} across all farms. ${action === 'unlock' ? 'Plans will revert to draft status and become editable.' : 'Plans will be locked and no further edits allowed.'}`,
      confirmText: `${action === 'unlock' ? 'Unlock' : 'Lock'} All`,
      confirmColor: action === 'unlock' ? 'warning' : 'primary',
    });
    if (!ok) return;
    setBulkLoading(true);
    try {
      await api.post('/api/agronomy/bulk-status', { crop_year: year, status });
      loadData();
    } catch (err) {
      console.error('Bulk status update failed:', err);
    } finally {
      setBulkLoading(false);
    }
  };

  const { farmsWithPlans, cropList, gt } = useMemo(() => {
    const withPlans = farmData.filter(r => r.data?.farm);
    const cropAgg = {};
    for (const { data } of withPlans) {
      for (const c of (data.crops || [])) {
        if (!cropAgg[c.crop]) {
          cropAgg[c.crop] = {
            crop: c.crop, acres: 0, production: 0, revenue: 0,
            seed_total: 0, fert_total: 0, chem_total: 0, total_cost: 0,
            _yield_x_acres: 0, _price_x_acres: 0,
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
        a._price_x_acres += (c.commodity_price || 0) * (c.acres || 0);
      }
    }
    const list = Object.values(cropAgg).sort((a, b) => b.acres - a.acres);
    const totals = { acres: 0, production: 0, revenue: 0, seed_total: 0, fert_total: 0, chem_total: 0, total_cost: 0 };
    for (const c of list) {
      totals.acres += c.acres; totals.production += c.production; totals.revenue += c.revenue;
      totals.seed_total += c.seed_total; totals.fert_total += c.fert_total;
      totals.chem_total += c.chem_total; totals.total_cost += c.total_cost;
    }
    totals.margin = totals.revenue - totals.total_cost;
    return { farmsWithPlans: withPlans, cropList: list, gt: totals };
  }, [farmData]);

  const farmsWithoutPlans = farmData.filter(r => !r.data?.farm);
  const hasLockedPlans = farmsWithPlans.some(r => ['approved', 'locked'].includes(r.data?.plan_status));
  const hasDraftPlans = farmsWithPlans.some(r => ['draft', 'submitted'].includes(r.data?.plan_status));
  const isDark = theme.palette.mode === 'dark';
  const textColor = theme.palette.text.primary;

  // ─── Chart configs ─────────────────────────────────────────────────
  const acresPieData = useMemo(() => ({
    labels: cropList.map(c => c.crop),
    datasets: [{
      data: cropList.map(c => c.acres),
      backgroundColor: CROP_COLORS.slice(0, cropList.length),
      borderWidth: isDark ? 0 : 1,
      borderColor: theme.palette.background.paper,
    }],
  }), [cropList, isDark, theme]);

  const inputPieData = useMemo(() => ({
    labels: ['Seed', 'Fertilizer', 'Chemical'],
    datasets: [{
      data: [gt.seed_total, gt.fert_total, gt.chem_total],
      backgroundColor: ['#2e7d32', '#1565c0', '#ef6c00'],
      borderWidth: isDark ? 0 : 1,
      borderColor: theme.palette.background.paper,
    }],
  }), [gt, isDark, theme]);

  const marginBarData = useMemo(() => ({
    labels: cropList.map(c => c.crop),
    datasets: [
      {
        label: 'Revenue/Acre',
        data: cropList.map(c => c.acres ? c.revenue / c.acres : 0),
        backgroundColor: '#2e7d32',
      },
      {
        label: 'Cost/Acre',
        data: cropList.map(c => c.acres ? c.total_cost / c.acres : 0),
        backgroundColor: '#c62828',
      },
    ],
  }), [cropList]);

  const pieOpts = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { color: textColor, padding: 12, font: { size: 11 } } },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const total = ctx.dataset.data.reduce((s, v) => s + v, 0);
            const pct = total ? ((ctx.raw / total) * 100).toFixed(1) : 0;
            return ` ${ctx.label}: ${fmt(ctx.raw)} (${pct}%)`;
          },
        },
      },
    },
  }), [textColor]);

  const barOpts = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { ticks: { color: textColor }, grid: { display: false } },
      y: { ticks: { color: textColor, callback: v => `$${v}` }, grid: { color: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' } },
    },
    plugins: {
      legend: { labels: { color: textColor } },
      tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: $${fmtDec(ctx.raw)}` } },
    },
  }), [textColor, isDark]);

  if (loading) return <Typography>Loading...</Typography>;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight="bold">Agronomy Rollup</Typography>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Crop Year</InputLabel>
          <Select value={year} label="Crop Year" onChange={e => setYear(e.target.value)}>
            <MenuItem value={2026}>2026</MenuItem>
            <MenuItem value={2025}>2025</MenuItem>
            <MenuItem value={2027}>2027</MenuItem>
          </Select>
        </FormControl>
        <Chip icon={<VisibilityIcon />} label="Read-Only" size="small" variant="outlined" />
        <Chip label={`${farmsWithPlans.length} of ${farmData.length} farms`} size="small" color="info" variant="outlined" />
        {isAdmin && farmsWithPlans.length > 0 && (
          <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
            {hasLockedPlans && (
              <Button
                size="small" variant="outlined" color="warning"
                startIcon={<LockOpenIcon />}
                disabled={bulkLoading}
                onClick={() => handleBulkStatus('draft')}
              >
                Unlock All Plans
              </Button>
            )}
            {hasDraftPlans && (
              <Button
                size="small" variant="outlined"
                startIcon={<LockIcon />}
                disabled={bulkLoading}
                onClick={() => handleBulkStatus('locked')}
              >
                Lock All Plans
              </Button>
            )}
          </Box>
        )}
      </Box>

      {farmsWithPlans.length === 0 ? (
        <Alert severity="warning">
          No agronomy plans found for crop year {year}. Create plans on individual farm units first.
        </Alert>
      ) : (
        <>
          {/* ─── KPI Cards ─────────────────────────────────────────── */}
          <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
            <KpiCard label="Total Acres" value={fmt(gt.acres)} sub={`${cropList.length} crops`} />
            <KpiCard label="Gross Revenue" value={`$${fmt(gt.revenue)}`} sub={gt.acres ? `$${fmtDec(gt.revenue / gt.acres)}/ac` : ''} />
            <KpiCard label="Total Input Cost" value={`$${fmt(gt.total_cost)}`} sub={gt.acres ? `$${fmtDec(gt.total_cost / gt.acres)}/ac` : ''} />
            <KpiCard label="Gross Margin" value={`$${fmt(gt.margin)}`}
              sub={gt.revenue ? `${fmtPct(gt.margin / gt.revenue)} margin` : ''}
              color={gt.margin >= 0 ? 'success.main' : 'error.main'} />
            <KpiCard label="Cost / Bushel" value={gt.production ? `$${fmtDec(gt.total_cost / gt.production)}` : '—'}
              sub={gt.production ? `${fmt(gt.production)} bu total` : ''} />
          </Stack>

          {/* ─── Charts Row ────────────────────────────────────────── */}
          <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
            <Paper sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>Acres by Crop</Typography>
              <Box sx={{ height: 260 }}>
                <Doughnut data={acresPieData} options={pieOpts} />
              </Box>
            </Paper>
            <Paper sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>Input Budget Breakdown</Typography>
              <Box sx={{ height: 260 }}>
                <Doughnut data={inputPieData} options={pieOpts} />
              </Box>
            </Paper>
            <Paper sx={{ p: 2, flex: 2 }}>
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>Revenue vs Cost per Acre</Typography>
              <Box sx={{ height: 260 }}>
                <Bar data={marginBarData} options={barOpts} />
              </Box>
            </Paper>
          </Stack>

          {/* ─── Crop P&L Table ─────────────────────────────────────── */}
          <Typography variant="h6" fontWeight="bold" sx={{ mb: 1 }}>Crop Economics</Typography>
          <TableContainer component={Paper} sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': TH_SX }}>
                  <TableCell>Crop</TableCell>
                  <TableCell align="right">Acres</TableCell>
                  <TableCell align="right">Yield (bu/ac)</TableCell>
                  <TableCell align="right">Price ($/bu)</TableCell>
                  <TableCell align="right">Revenue/Acre</TableCell>
                  <TableCell align="right">Seed/Acre</TableCell>
                  <TableCell align="right">Fert/Acre</TableCell>
                  <TableCell align="right">Chem/Acre</TableCell>
                  <TableCell align="right">Total Cost/Acre</TableCell>
                  <TableCell align="right">Cost/Bushel</TableCell>
                  <TableCell align="right">Margin/Acre</TableCell>
                  <TableCell align="right">Margin %</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {cropList.map(c => {
                  const avgYield = c.acres ? c._yield_x_acres / c.acres : 0;
                  const avgPrice = c.acres ? c._price_x_acres / c.acres : 0;
                  const revPerAcre = c.acres ? c.revenue / c.acres : 0;
                  const seedPerAcre = c.acres ? c.seed_total / c.acres : 0;
                  const fertPerAcre = c.acres ? c.fert_total / c.acres : 0;
                  const chemPerAcre = c.acres ? c.chem_total / c.acres : 0;
                  const costPerAcre = c.acres ? c.total_cost / c.acres : 0;
                  const costPerBu = c.production ? c.total_cost / c.production : 0;
                  const marginPerAcre = revPerAcre - costPerAcre;
                  const marginPct = c.revenue ? (c.revenue - c.total_cost) / c.revenue : 0;
                  return (
                    <TableRow key={c.crop} hover>
                      <TableCell sx={{ fontWeight: 'bold' }}>{c.crop}</TableCell>
                      <TableCell align="right">{fmt(c.acres)}</TableCell>
                      <TableCell align="right">{fmtDec(avgYield)}</TableCell>
                      <TableCell align="right">${fmtDec(avgPrice)}</TableCell>
                      <TableCell align="right">${fmtDec(revPerAcre)}</TableCell>
                      <TableCell align="right">${fmtDec(seedPerAcre)}</TableCell>
                      <TableCell align="right">${fmtDec(fertPerAcre)}</TableCell>
                      <TableCell align="right">${fmtDec(chemPerAcre)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>${fmtDec(costPerAcre)}</TableCell>
                      <TableCell align="right">${fmtDec(costPerBu)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold', color: marginPerAcre >= 0 ? 'success.main' : 'error.main' }}>
                        ${fmtDec(marginPerAcre)}
                      </TableCell>
                      <TableCell align="right" sx={{ color: marginPct >= 0 ? 'success.main' : 'error.main' }}>
                        {fmtPct(marginPct)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow sx={{ '& td': TOTAL_SX }}>
                  <TableCell>TOTAL</TableCell>
                  <TableCell align="right">{fmt(gt.acres)}</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell align="right">${gt.acres ? fmtDec(gt.revenue / gt.acres) : ''}</TableCell>
                  <TableCell align="right">${gt.acres ? fmtDec(gt.seed_total / gt.acres) : ''}</TableCell>
                  <TableCell align="right">${gt.acres ? fmtDec(gt.fert_total / gt.acres) : ''}</TableCell>
                  <TableCell align="right">${gt.acres ? fmtDec(gt.chem_total / gt.acres) : ''}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>${gt.acres ? fmtDec(gt.total_cost / gt.acres) : ''}</TableCell>
                  <TableCell align="right">${gt.production ? fmtDec(gt.total_cost / gt.production) : ''}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold', color: gt.margin >= 0 ? 'success.main' : 'error.main' }}>
                    ${gt.acres ? fmtDec(gt.margin / gt.acres) : ''}
                  </TableCell>
                  <TableCell align="right" sx={{ color: gt.margin >= 0 ? 'success.main' : 'error.main' }}>
                    {gt.revenue ? fmtPct(gt.margin / gt.revenue) : ''}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          {/* ─── Budget Guardrails ──────────────────────────────────── */}
          <Typography variant="h6" fontWeight="bold" sx={{ mb: 1 }}>Budget Guardrails</Typography>
          <TableContainer component={Paper} sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': TH_SX }}>
                  <TableCell>Farm</TableCell>
                  <TableCell align="right">Budgeted</TableCell>
                  <TableCell align="right">Actual Spend</TableCell>
                  <TableCell align="right">Variance</TableCell>
                  <TableCell align="center">Status</TableCell>
                  <TableCell align="right">Cost/Acre</TableCell>
                  <TableCell align="right">Margin %</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {farmsWithPlans.map(({ farm, data }) => {
                  const d = data.farm;
                  const actualSpend = 0; // TODO: pull from GL actuals
                  const variance = actualSpend - (d.total_cost || 0);
                  const marginPct = d.revenue ? d.margin / d.revenue : 0;
                  const isPreSeason = actualSpend === 0;
                  return (
                    <TableRow key={farm.id} hover>
                      <TableCell sx={{ fontWeight: 'bold' }}>{farm.name}</TableCell>
                      <TableCell align="right">${fmt(d.total_cost)}</TableCell>
                      <TableCell align="right">${fmt(actualSpend)}</TableCell>
                      <TableCell align="right" sx={{ color: variance < 0 ? 'error.main' : 'text.secondary' }}>
                        {variance < 0 ? `($${fmt(Math.abs(variance))})` : `$${fmt(variance)}`}
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          label={isPreSeason ? 'Pre-Season' : 'On Track'}
                          size="small"
                          color={isPreSeason ? 'default' : 'success'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell align="right">${fmtDec(d.cost_per_acre)}</TableCell>
                      <TableCell align="right" sx={{ color: marginPct >= 0 ? 'success.main' : 'error.main' }}>
                        {fmtPct(marginPct)}
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
      <ConfirmDialog {...confirmDialogProps} />
    </Box>
  );
}
