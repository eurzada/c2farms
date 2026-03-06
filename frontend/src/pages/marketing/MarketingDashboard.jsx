import { useState, useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Paper, Stack, Chip,
} from '@mui/material';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip as ChartTooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';

ChartJS.register(CategoryScale, LinearScale, BarElement, ChartTooltip, Legend);

import { fmt, fmtDollarK as fmtDollar } from '../../utils/formatting';

const PRIORITY_COLORS = { high: 'error', medium: 'warning', low: 'default' };

export default function MarketingDashboard() {
  const { currentFarm } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();

  const [data, setData] = useState(null);

  useEffect(() => {
    if (!currentFarm) return;
    api.get(`/api/farms/${currentFarm.id}/marketing/dashboard`)
      .then(res => setData(res.data));
  }, [currentFarm]);

  const kpis = data?.kpis || {};
  const positionGrid = data?.positionGrid || [];
  const chartData = data?.chartData || [];

  const columnDefs = useMemo(() => [
    { field: 'commodity_name', headerName: 'Commodity', width: 140, pinned: 'left' },
    { field: 'inventory_mt', headerName: 'On Hand (MT)', width: 120, valueFormatter: p => fmt(p.value) },
    { field: 'committed_mt', headerName: 'Committed', width: 110, valueFormatter: p => fmt(p.value) },
    { field: 'available_mt', headerName: 'Available', width: 110, valueFormatter: p => fmt(p.value) },
    { field: 'pct_committed', headerName: '% Sold', width: 90, valueFormatter: p => `${(p.value || 0).toFixed(0)}%` },
    { field: 'bid_per_bu', headerName: 'Bid $/bu', width: 100, valueFormatter: p => p.value ? `$${p.value.toFixed(2)}` : '—' },
    { field: 'cop_per_bu', headerName: 'COP $/bu', width: 100, valueFormatter: p => p.value ? `$${p.value.toFixed(2)}` : '—' },
    { field: 'target_price_bu', headerName: 'Target $/bu', width: 110, valueFormatter: p => p.value ? `$${p.value.toFixed(2)}` : '—' },
    {
      field: 'outlook', headerName: 'Outlook', width: 100,
      cellRenderer: p => {
        const colors = { bullish: 'success', bearish: 'error', sideways: 'default' };
        return p.value ? <Chip label={p.value} size="small" color={colors[p.value] || 'default'} variant="outlined" /> : '—';
      },
    },
    {
      field: 'priority', headerName: 'Sell Priority', width: 120,
      cellRenderer: p => <Chip label={p.data.action} size="small" color={PRIORITY_COLORS[p.value] || 'default'} />,
    },
    { field: 'rationale', headerName: 'Rationale', flex: 1, minWidth: 200 },
    { field: 'inventory_value', headerName: 'Value', width: 110, valueFormatter: p => fmtDollar(p.value) },
  ], []);

  const defaultColDef = useMemo(() => ({ sortable: true, resizable: true }), []);

  // Chart
  const barChartData = useMemo(() => ({
    labels: chartData.map(r => r.commodity),
    datasets: [
      { label: 'Committed (MT)', data: chartData.map(r => r.committed), backgroundColor: '#1976d2' },
      { label: 'Available (MT)', data: chartData.map(r => r.available), backgroundColor: '#66bb6a' },
    ],
  }), [chartData]);

  const barChartOptions = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' } },
    scales: {
      x: { stacked: true, title: { display: true, text: 'Metric Tonnes' } },
      y: { stacked: true },
    },
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 2 }}>Marketing Dashboard</Typography>

      {/* KPI Cards */}
      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        {[
          { label: 'Total On Hand', value: `${fmt(kpis.total_mt)} MT` },
          { label: 'YTD Hauled', value: `${fmt(kpis.ytd_hauled)} MT` },
          { label: 'Committed', value: `${fmt(kpis.committed_mt)} MT` },
          { label: 'Available', value: `${fmt(kpis.available_mt)} MT` },
          { label: 'Total Value', value: fmtDollar(kpis.total_value) },
          { label: '% Sold', value: `${(kpis.pct_sold || 0).toFixed(0)}%` },
        ].map(k => (
          <Paper key={k.label} sx={{ px: 2, py: 1.5, flex: 1, textAlign: 'center' }} variant="outlined">
            <Typography variant="caption" color="text.secondary">{k.label}</Typography>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>{k.value}</Typography>
          </Paper>
        ))}
      </Stack>

      {/* Position Grid */}
      <Typography variant="h6" sx={{ mb: 1 }}>Position by Commodity</Typography>
      <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 350, width: '100%', mb: 3 }}>
        <AgGridReact
          ref={gridRef}
          rowData={positionGrid}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          getRowId={p => p.data?.commodity_id}
        />
      </Box>

      {/* Chart */}
      <Typography variant="h6" sx={{ mb: 1 }}>Committed vs Available</Typography>
      <Paper variant="outlined" sx={{ p: 2, height: 300 }}>
        <Bar data={barChartData} options={barChartOptions} />
      </Paper>
    </Box>
  );
}
