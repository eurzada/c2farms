import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box, Typography, Paper, Stack, Slider, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow,
} from '@mui/material';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip as ChartTooltip, Legend } from 'chart.js';
import { Chart } from 'react-chartjs-2';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ChartTooltip, Legend);

const fmt = (v) => `$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtSigned = (v) => {
  const s = v >= 0 ? '+' : '-';
  return `${s}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

export default function MarketingCashFlow() {
  const { currentFarm } = useFarm();
  const [data, setData] = useState(null);
  const [stressPct, setStressPct] = useState(10);

  const fetchData = useCallback(() => {
    if (!currentFarm) return;
    api.get(`/api/farms/${currentFarm.id}/marketing/cash-flow?months=6`)
      .then(res => setData(res.data));
  }, [currentFarm]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const summary = data?.summary || {};
  const monthly = data?.monthly || [];

  // Stress test with adjustable slider
  const stressedReceipts = useMemo(() => {
    if (!monthly.length) return [];
    return monthly.map(m => ({
      ...m,
      stressed_receipts: m.receipts * (1 - stressPct / 100),
      stressed_net: (m.receipts * (1 - stressPct / 100)) - m.requirements,
    }));
  }, [monthly, stressPct]);

  // Chart data
  const chartData = useMemo(() => ({
    labels: monthly.map(m => m.month),
    datasets: [
      {
        type: 'bar', label: 'Requirements', data: monthly.map(m => -m.requirements),
        backgroundColor: '#ef5350', order: 2,
      },
      {
        type: 'bar', label: 'Receipts', data: monthly.map(m => m.receipts),
        backgroundColor: '#66bb6a', order: 2,
      },
      {
        type: 'line', label: 'Cumulative Net', data: monthly.map(m => m.cumulative),
        borderColor: '#1976d2', backgroundColor: '#1976d2', tension: 0.3, order: 1,
        yAxisID: 'y',
      },
    ],
  }), [monthly]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' } },
    scales: {
      y: {
        ticks: { callback: v => `$${(v / 1000).toFixed(0)}K` },
      },
    },
  };

  // KPIs
  const cashGap3Mo = summary.cash_gap_3mo || 0;
  const locAvailable = summary.loc_available || 0;
  const netGap = cashGap3Mo + locAvailable;

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 2 }}>Cash Flow Projection</Typography>

      {/* KPI Cards */}
      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <Paper sx={{ px: 2.5, py: 1.5, flex: 1, textAlign: 'center' }} variant="outlined">
          <Typography variant="caption" color="text.secondary">3-Month Cash Gap</Typography>
          <Typography variant="h6" sx={{ fontWeight: 600, color: cashGap3Mo >= 0 ? 'success.main' : 'error.main' }}>
            {fmtSigned(cashGap3Mo)}
          </Typography>
        </Paper>
        <Paper sx={{ px: 2.5, py: 1.5, flex: 1, textAlign: 'center' }} variant="outlined">
          <Typography variant="caption" color="text.secondary">LOC Available</Typography>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>{fmt(locAvailable)}</Typography>
        </Paper>
        <Paper sx={{ px: 2.5, py: 1.5, flex: 1, textAlign: 'center' }} variant="outlined">
          <Typography variant="caption" color="text.secondary">Net Gap After LOC</Typography>
          <Typography variant="h6" sx={{ fontWeight: 600, color: netGap >= 0 ? 'success.main' : 'error.main' }}>
            {fmtSigned(netGap)}
          </Typography>
        </Paper>
      </Stack>

      {/* Monthly Table */}
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Month</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Requirements</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Receipts</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Net</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Cumulative</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {monthly.map(m => (
              <TableRow key={m.month}>
                <TableCell>{m.month}</TableCell>
                <TableCell align="right" sx={{ color: 'error.main' }}>{fmt(m.requirements)}</TableCell>
                <TableCell align="right" sx={{ color: 'success.main' }}>{fmt(m.receipts)}</TableCell>
                <TableCell align="right" sx={{ color: m.net >= 0 ? 'success.main' : 'error.main', fontWeight: 600 }}>{fmtSigned(m.net)}</TableCell>
                <TableCell align="right" sx={{ color: m.cumulative >= 0 ? 'success.main' : 'error.main' }}>{fmtSigned(m.cumulative)}</TableCell>
              </TableRow>
            ))}
            <TableRow sx={{ '& td': { fontWeight: 700, borderTop: 2, borderColor: 'divider' } }}>
              <TableCell>Total</TableCell>
              <TableCell align="right" sx={{ color: 'error.main' }}>{fmt(summary.total_requirements || 0)}</TableCell>
              <TableCell align="right" sx={{ color: 'success.main' }}>{fmt(summary.total_receipts || 0)}</TableCell>
              <TableCell align="right" sx={{ color: (summary.total_net || 0) >= 0 ? 'success.main' : 'error.main' }}>{fmtSigned(summary.total_net || 0)}</TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>

      {/* Chart */}
      <Typography variant="h6" sx={{ mb: 1 }}>Cash Flow Chart</Typography>
      <Paper variant="outlined" sx={{ p: 2, height: 350, mb: 3 }}>
        <Chart type="bar" data={chartData} options={chartOptions} />
      </Paper>

      {/* Stress Test */}
      <Typography variant="h6" sx={{ mb: 1 }}>Stress Test</Typography>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="body2" gutterBottom>
          What if grain prices drop? Slide to simulate receipt reduction:
        </Typography>
        <Stack direction="row" spacing={3} alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ minWidth: 100 }}>Price Drop:</Typography>
          <Slider value={stressPct} onChange={(_, v) => setStressPct(v)} min={0} max={30} step={5}
            marks={[{ value: 0, label: '0%' }, { value: 10, label: '10%' }, { value: 20, label: '20%' }, { value: 30, label: '30%' }]}
            sx={{ maxWidth: 400 }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>{stressPct}%</Typography>
        </Stack>
        <Stack direction="row" spacing={3}>
          <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
            <Typography variant="subtitle2">Stressed Receipts</Typography>
            <Typography variant="h6">{fmt((summary.total_receipts || 0) * (1 - stressPct / 100))}</Typography>
          </Paper>
          <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
            <Typography variant="subtitle2">Stressed Net</Typography>
            <Typography variant="h6" sx={{ color: ((summary.total_net || 0) + (summary.total_receipts || 0) * (-stressPct / 100)) >= 0 ? 'success.main' : 'error.main' }}>
              {fmtSigned((summary.total_net || 0) + (summary.total_receipts || 0) * (-stressPct / 100))}
            </Typography>
          </Paper>
        </Stack>
      </Paper>
    </Box>
  );
}
