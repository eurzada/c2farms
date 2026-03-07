import { useState, useEffect, useMemo } from 'react';
import {
  Box, Typography, Paper, Stack, Chip, Alert, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  useTheme,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip as ChartTooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { useFarm } from '../../contexts/FarmContext';
import { formatCurrency } from '../../utils/formatting';
import api from '../../services/api';

ChartJS.register(CategoryScale, LinearScale, BarElement, ChartTooltip, Legend);

function fmt(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function fmtDec(n) { return (n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const TH_SX = { fontWeight: 'bold', bgcolor: 'action.hover', whiteSpace: 'nowrap' };

function KpiCard({ label, value, sub, color }) {
  return (
    <Paper sx={{ p: 2.5, textAlign: 'center', flex: 1 }}>
      <Typography variant="body2" color="text.secondary" gutterBottom>{label}</Typography>
      <Typography variant="h5" fontWeight="bold" sx={{ color: color || 'text.primary' }}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

export default function EnterpriseLabour() {
  const theme = useTheme();
  const { farmUnits, isAdmin } = useFarm();
  const [farmData, setFarmData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();
  const year = 2026;

  const loadData = () => {
    if (!farmUnits?.length) return;
    setLoading(true);
    Promise.all(
      farmUnits.map(farm =>
        api.get(`/api/farms/${farm.id}/labour/dashboard?year=${year}`)
          .then(res => ({ farm, data: res.data }))
          .catch(() => ({ farm, data: null }))
      )
    ).then(setFarmData).finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, [farmUnits, year]);

  const handleBulkStatus = async (status) => {
    const action = status === 'draft' ? 'unlock' : 'lock';
    const ok = await confirm({
      title: `${action === 'unlock' ? 'Unlock' : 'Lock'} All Labour Plans?`,
      message: `This will ${action} all labour plans for FY${year} across all farms. ${action === 'unlock' ? 'Plans will revert to draft status and become editable.' : 'Plans will be locked and no further edits allowed.'}`,
      confirmText: `${action === 'unlock' ? 'Unlock' : 'Lock'} All`,
      confirmColor: action === 'unlock' ? 'warning' : 'primary',
    });
    if (!ok) return;
    setBulkLoading(true);
    try {
      await api.post('/api/labour/bulk-status', { fiscal_year: year, status });
      loadData();
    } catch (err) {
      console.error('Bulk status update failed:', err);
    } finally {
      setBulkLoading(false);
    }
  };

  const { farmsWithPlans, farmsWithout, totals } = useMemo(() => {
    const withPlans = farmData.filter(r => r.data);
    const without = farmData.filter(r => !r.data);
    const t = { hours: 0, cost: 0, acres: 0 };
    for (const { data } of withPlans) {
      t.hours += data.total_hours || 0;
      t.cost += data.total_cost || 0;
      t.acres += data.total_acres || 0;
    }
    return { farmsWithPlans: withPlans, farmsWithout: without, totals: t };
  }, [farmData]);

  // Bar chart: hours by season across farms
  const isDark = theme.palette.mode === 'dark';
  const textColor = theme.palette.text.primary;

  const chartData = useMemo(() => {
    if (farmsWithPlans.length === 0) return null;
    // Collect all unique season names
    const allSeasons = new Set();
    for (const { data } of farmsWithPlans) {
      for (const s of (data.seasons || [])) allSeasons.add(s.name);
    }
    const seasonNames = [...allSeasons];
    const COLORS = ['#2e7d32', '#1565c0', '#ef6c00', '#6a1b9a', '#c62828', '#00838f', '#4e342e', '#37474f'];

    return {
      labels: seasonNames,
      datasets: farmsWithPlans.map(({ farm, data }, i) => ({
        label: farm.name,
        data: seasonNames.map(sn => {
          const match = (data.seasons || []).find(s => s.name === sn);
          return match ? match.hours : 0;
        }),
        backgroundColor: COLORS[i % COLORS.length],
      })),
    };
  }, [farmsWithPlans]);

  const chartOpts = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { ticks: { color: textColor }, grid: { display: false } },
      y: { ticks: { color: textColor, callback: v => fmt(v) + ' hrs' }, grid: { color: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' } },
    },
    plugins: {
      legend: { labels: { color: textColor } },
      tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)} hrs` } },
    },
  }), [textColor, isDark]);

  if (loading) return <Typography>Loading...</Typography>;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight="bold">Labour Rollup</Typography>
        <Chip icon={<VisibilityIcon />} label="Read-Only" size="small" variant="outlined" />
        <Chip label={`${farmsWithPlans.length} of ${farmData.length} farms`} size="small" color="info" variant="outlined" />
        {isAdmin && farmsWithPlans.length > 0 && (
          <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
            {farmsWithPlans.some(r => ['approved', 'locked'].includes(r.data?.status)) && (
              <Button size="small" variant="outlined" color="warning" startIcon={<LockOpenIcon />}
                disabled={bulkLoading} onClick={() => handleBulkStatus('draft')}>
                Unlock All Plans
              </Button>
            )}
            {farmsWithPlans.some(r => ['draft'].includes(r.data?.status)) && (
              <Button size="small" variant="outlined" startIcon={<LockIcon />}
                disabled={bulkLoading} onClick={() => handleBulkStatus('locked')}>
                Lock All Plans
              </Button>
            )}
          </Box>
        )}
      </Box>

      {farmsWithPlans.length === 0 ? (
        <Alert severity="warning">No labour plans found for FY{year}. Create plans on individual farm units first.</Alert>
      ) : (
        <>
          <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
            <KpiCard label="Total Hours" value={fmt(totals.hours)} sub={`${farmsWithPlans.length} farms`} />
            <KpiCard label="Total Cost" value={formatCurrency(totals.cost)} />
            <KpiCard label="Avg Cost / Acre" value={totals.acres ? formatCurrency(totals.cost / totals.acres) : '—'} sub={totals.acres ? `${fmt(totals.acres)} total acres` : ''} />
            <KpiCard label="Avg Hours / Acre" value={totals.acres ? fmtDec(totals.hours / totals.acres) : '—'} />
          </Stack>

          {/* Chart */}
          {chartData && (
            <Paper sx={{ p: 2, mb: 3 }}>
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>Hours by Season</Typography>
              <Box sx={{ height: 300 }}>
                <Bar data={chartData} options={chartOpts} />
              </Box>
            </Paper>
          )}

          {/* Per-Farm Table */}
          <Typography variant="h6" fontWeight="bold" sx={{ mb: 1 }}>Per Farm Unit</Typography>
          <TableContainer component={Paper} sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': TH_SX }}>
                  <TableCell>Farm Unit</TableCell>
                  <TableCell align="right">Acres</TableCell>
                  <TableCell align="right">Total Hours</TableCell>
                  <TableCell align="right">Hrs/Acre</TableCell>
                  <TableCell align="right">Avg Wage</TableCell>
                  <TableCell align="right">Total Cost</TableCell>
                  <TableCell align="right">$/Acre</TableCell>
                  <TableCell align="center">Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {farmsWithPlans.map(({ farm, data }) => (
                  <TableRow key={farm.id} hover>
                    <TableCell sx={{ fontWeight: 'bold' }}>{farm.name}</TableCell>
                    <TableCell align="right">{fmt(data.total_acres)}</TableCell>
                    <TableCell align="right">{fmt(data.total_hours)}</TableCell>
                    <TableCell align="right">{fmtDec(data.hours_per_acre)}</TableCell>
                    <TableCell align="right">${fmtDec(data.avg_wage)}</TableCell>
                    <TableCell align="right">{formatCurrency(data.total_cost)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>{formatCurrency(data.cost_per_acre)}</TableCell>
                    <TableCell align="center">
                      <Chip
                        label={data.status === 'draft' ? 'Draft' : 'Locked'}
                        size="small"
                        icon={data.status === 'locked' ? <LockIcon /> : <LockOpenIcon />}
                        color={data.status === 'locked' ? 'primary' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow sx={{ '& td': { fontWeight: 'bold', borderTop: 2, borderColor: 'divider' } }}>
                  <TableCell>TOTAL</TableCell>
                  <TableCell align="right">{fmt(totals.acres)}</TableCell>
                  <TableCell align="right">{fmt(totals.hours)}</TableCell>
                  <TableCell align="right">{totals.acres ? fmtDec(totals.hours / totals.acres) : '—'}</TableCell>
                  <TableCell />
                  <TableCell align="right">{formatCurrency(totals.cost)}</TableCell>
                  <TableCell align="right">{totals.acres ? formatCurrency(totals.cost / totals.acres) : '—'}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          {farmsWithout.length > 0 && (
            <Alert severity="warning" variant="outlined">
              {farmsWithout.length} farm unit(s) have no labour plan for FY{year}:{' '}
              {farmsWithout.map(r => r.farm.name).join(', ')}
            </Alert>
          )}
        </>
      )}
      <ConfirmDialog {...confirmDialogProps} />
    </Box>
  );
}
