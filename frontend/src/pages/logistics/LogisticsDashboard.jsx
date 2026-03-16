import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Paper, Grid, Stack, Chip, Alert, Button,
  TextField, MenuItem, CircularProgress, IconButton, Tooltip,
} from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip as ChartTooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import { fmt, fmtDollar } from '../../utils/formatting';

ChartJS.register(CategoryScale, LinearScale, BarElement, ChartTooltip, Legend);

const FY_OPTIONS = [2024, 2025, 2026, 2027];

/** Export ag-Grid data as CSV via its built-in API */
function exportGridCsv(gridRef, fileName) {
  gridRef.current?.api?.exportDataAsCsv({ fileName });
}

/** Export arbitrary rows as CSV (for chart data / KPIs) */
function exportRowsCsv(rows, columns, fileName) {
  const header = columns.map(c => c.label).join(',');
  const lines = rows.map(r => columns.map(c => {
    const v = r[c.key];
    return typeof v === 'string' && v.includes(',') ? `"${v}"` : v ?? '';
  }).join(','));
  const blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function TileHeader({ title, onExport, children }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{title}</Typography>
      <Stack direction="row" spacing={0.5} alignItems="center">
        {children}
        {onExport && (
          <Tooltip title="Export CSV">
            <IconButton size="small" onClick={onExport}><FileDownloadIcon fontSize="small" /></IconButton>
          </Tooltip>
        )}
      </Stack>
    </Stack>
  );
}

function KPICard({ label, value, color }) {
  return (
    <Paper elevation={2} sx={{ p: 2, textAlign: 'center', flex: 1, minWidth: 130 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h5" sx={{ fontWeight: 600, color: color || 'text.primary' }}>
        {value}
      </Typography>
    </Paper>
  );
}

export default function LogisticsDashboard() {
  const { currentFarm } = useFarm();
  const { mode } = useThemeMode();
  const navigate = useNavigate();
  const unsettledGridRef = useRef();
  const pendingGridRef = useRef();
  const missingGridRef = useRef();
  const confirmedGridRef = useRef();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fiscalYear, setFiscalYear] = useState('2026');

  const agTheme = mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

  useEffect(() => {
    if (!currentFarm) return;
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (fiscalYear) params.append('fiscal_year', fiscalYear);
    api.get(`/api/farms/${currentFarm.id}/logistics/dashboard?${params}`)
      .then(res => setData(res.data))
      .catch(() => setError('Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, [currentFarm, fiscalYear]);

  // --- KPIs ---
  const kpis = data?.kpis;

  // --- Chart data ---
  const chartData = useMemo(() => {
    if (!data?.shipped_vs_settled?.length) return null;
    const rows = data.shipped_vs_settled;
    return {
      labels: rows.map(r => r.commodity),
      datasets: [
        { label: 'Shipped MT', data: rows.map(r => r.shipped_mt), backgroundColor: '#1976d2' },
        { label: 'Settled MT', data: rows.map(r => r.settled_mt), backgroundColor: '#2e7d32' },
      ],
    };
  }, [data]);

  const chartOptions = useMemo(() => ({
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      tooltip: {
        callbacks: {
          label: ctx => `${ctx.dataset.label}: ${fmt(ctx.raw)} MT`,
        },
      },
    },
    scales: {
      x: { title: { display: true, text: 'Metric Tonnes' }, ticks: { callback: v => fmt(v) } },
    },
  }), []);

  // --- Unsettled by contract columns ---
  const unsettledCols = useMemo(() => [
    { field: 'buyer', headerName: 'Buyer', flex: 1.2, minWidth: 120 },
    { field: 'contract_number', headerName: 'Contract #', flex: 1, minWidth: 110 },
    { field: 'commodity', headerName: 'Commodity', flex: 0.9, minWidth: 90 },
    { field: 'shipped_count', headerName: 'Shipped', width: 80, type: 'numericColumn' },
    { field: 'shipped_mt', headerName: 'Shipped MT', width: 100, type: 'numericColumn', valueFormatter: p => fmt(p.value) },
    { field: 'settled_count', headerName: 'Settled', width: 80, type: 'numericColumn' },
    { field: 'settled_mt', headerName: 'Settled MT', width: 100, type: 'numericColumn', valueFormatter: p => fmt(p.value) },
    {
      field: 'gap_mt', headerName: 'Gap MT', width: 100, type: 'numericColumn',
      valueFormatter: p => fmt(p.value),
      cellStyle: p => (p.value > 0 ? { color: '#d32f2f', fontWeight: 600 } : null),
    },
  ], []);

  const unsettledFooter = useMemo(() => {
    if (!data?.unsettled_by_contract?.length) return [];
    const rows = data.unsettled_by_contract;
    return [{
      buyer: 'TOTAL',
      contract_number: '',
      commodity: '',
      shipped_count: rows.reduce((s, r) => s + r.shipped_count, 0),
      shipped_mt: rows.reduce((s, r) => s + r.shipped_mt, 0),
      settled_count: rows.reduce((s, r) => s + r.settled_count, 0),
      settled_mt: rows.reduce((s, r) => s + r.settled_mt, 0),
      gap_mt: rows.reduce((s, r) => s + r.gap_mt, 0),
    }];
  }, [data]);

  // --- Pending settlements columns ---
  const pendingCols = useMemo(() => [
    { field: 'settlement_number', headerName: 'Settlement #', flex: 1, minWidth: 110 },
    {
      field: 'settlement_date', headerName: 'Date', width: 95,
      valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString('en-CA') : '',
    },
    { field: 'buyer', headerName: 'Buyer', flex: 1, minWidth: 100 },
    {
      field: 'total_amount', headerName: 'Amount', width: 110, type: 'numericColumn',
      valueFormatter: p => p.value != null ? fmtDollar(p.value) : '',
    },
    {
      field: 'status', headerName: 'Status', width: 90,
      cellRenderer: p => {
        const colors = { pending: 'warning', disputed: 'error', reconciled: 'info', approved: 'success' };
        return <Chip label={p.value} size="small" color={colors[p.value] || 'default'} variant="outlined" />;
      },
    },
    { field: 'line_count', headerName: 'Lines', width: 60, type: 'numericColumn' },
  ], []);

  // --- Missing loads columns ---
  const missingCols = useMemo(() => [
    { field: 'buyer', headerName: 'Buyer', flex: 1, minWidth: 120 },
    { field: 'contract_number', headerName: 'Contract #', flex: 0.9, minWidth: 110 },
    { field: 'commodity', headerName: 'Commodity', flex: 0.8, minWidth: 90 },
    { field: 'total_shipped', headerName: 'Total Shipped', width: 100, type: 'numericColumn' },
    { field: 'on_settlements', headerName: 'On Settlements', width: 110, type: 'numericColumn' },
    {
      field: 'missing_count', headerName: 'Missing', width: 80, type: 'numericColumn',
      cellStyle: { color: '#d32f2f', fontWeight: 600 },
    },
    {
      field: 'missing_mt', headerName: 'Missing MT', width: 100, type: 'numericColumn',
      valueFormatter: p => fmt(p.value),
      cellStyle: { color: '#d32f2f', fontWeight: 600 },
    },
    {
      field: 'missing_tickets', headerName: 'Ticket #s', flex: 1.5, minWidth: 150,
      valueFormatter: p => (p.value || []).join(', '),
    },
  ], []);

  // --- Shipped vs Confirmed Sold columns ---
  const confirmedCols = useMemo(() => [
    { field: 'commodity', headerName: 'Commodity', flex: 1, minWidth: 120 },
    { field: 'shipped_mt', headerName: 'Shipped (Tickets) MT', flex: 0.8, type: 'numericColumn', valueFormatter: p => fmt(p.value) },
    { field: 'confirmed_mt', headerName: 'Confirmed Sold MT', flex: 0.8, type: 'numericColumn', valueFormatter: p => fmt(p.value) },
    {
      field: 'gap_mt', headerName: 'Pending Confirmation MT', flex: 0.8, type: 'numericColumn',
      valueFormatter: p => fmt(p.value),
      cellStyle: p => (p.value > 0 ? { color: '#ed6c02', fontWeight: 600 } : null),
    },
  ], []);

  const confirmedFooter = useMemo(() => {
    const t = data?.shipped_vs_confirmed?.totals;
    if (!t) return [];
    return [{ commodity: 'TOTAL', shipped_mt: t.shipped_mt, confirmed_mt: t.confirmed_mt, gap_mt: t.gap_mt }];
  }, [data]);

  const defaultColDef = useMemo(() => ({ sortable: true, resizable: true }), []);

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>;
  }
  if (error) {
    return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;
  }
  if (!data) return null;

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>Logistics Dashboard</Typography>
        <TextField
          select size="small" label="Fiscal Year"
          value={fiscalYear}
          onChange={(e) => setFiscalYear(e.target.value)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">All Years</MenuItem>
          {FY_OPTIONS.map(fy => (
            <MenuItem key={fy} value={String(fy)}>
              FY{fy} (Nov {String(fy - 1).slice(-2)} – Oct {String(fy).slice(-2)})
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {/* Row 1: KPI Cards */}
      <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <KPICard label="Total Shipments" value={fmt(kpis.total_shipments)} />
        <KPICard label="Total MT Shipped" value={fmt(kpis.total_mt_shipped)} />
        <KPICard label="Total Settled" value={fmtDollar(kpis.total_settled_amount)} />
        <KPICard
          label="Pending Settlements"
          value={kpis.pending_settlements}
          color={kpis.pending_settlements > 0 ? 'warning.main' : undefined}
        />
        <KPICard
          label="Exception Lines"
          value={kpis.exception_lines}
          color={kpis.exception_lines > 0 ? 'error.main' : undefined}
        />
      </Stack>

      {/* Row 2: Shipped (Tickets) vs Confirmed Sold (Marketing) */}
      {data.shipped_vs_confirmed?.rows?.length > 0 && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <TileHeader
            title="Grain Shipped (Truck Tickets) vs Confirmed Sold (Marketing Contracts)"
            onExport={() => exportGridCsv(confirmedGridRef, 'shipped-vs-confirmed.csv')}
          >
            <Button size="small" variant="text" onClick={() => navigate('/marketing/dashboard')}>
              View Marketing
            </Button>
          </TileHeader>
          <Box className={agTheme} sx={{ height: Math.max(200, data.shipped_vs_confirmed.rows.length * 42 + 60), width: '100%' }}>
            <AgGridReact
              ref={confirmedGridRef}
              rowData={data.shipped_vs_confirmed.rows}
              columnDefs={confirmedCols}
              defaultColDef={defaultColDef}
              pinnedBottomRowData={confirmedFooter}
              animateRows
              onGridReady={({ api }) => api.sizeColumnsToFit()}
            />
          </Box>
        </Paper>
      )}

      {/* Row 3: Shipped vs Settled chart */}
      {chartData && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <TileHeader
            title="Shipped vs Settled by Commodity"
            onExport={() => exportRowsCsv(
              data.shipped_vs_settled,
              [{ key: 'commodity', label: 'Commodity' }, { key: 'shipped_mt', label: 'Shipped MT' }, { key: 'settled_mt', label: 'Settled MT' }],
              'shipped-vs-settled.csv',
            )}
          />
          <Box sx={{ height: Math.max(200, data.shipped_vs_settled.length * 50 + 60) }}>
            <Bar data={chartData} options={chartOptions} />
          </Box>
        </Paper>
      )}

      {/* Row 3: Two side-by-side panels */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        {/* Unsettled Loads by Buyer+Contract */}
        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 2 }}>
            <TileHeader
              title="Unsettled Loads by Buyer + Contract"
              onExport={data.unsettled_by_contract?.length > 0 ? () => exportGridCsv(unsettledGridRef, 'unsettled-loads.csv') : undefined}
            />
            {data.unsettled_by_contract?.length > 0 ? (
              <Box className={agTheme} sx={{ height: 350, width: '100%' }}>
                <AgGridReact
                  ref={unsettledGridRef}
                  rowData={data.unsettled_by_contract}
                  columnDefs={unsettledCols}
                  defaultColDef={defaultColDef}
                  pinnedBottomRowData={unsettledFooter}
                  animateRows
                  onGridReady={({ api }) => api.sizeColumnsToFit()}
                  onRowClicked={({ data: row }) => {
                    if (row?.contract_number) {
                      navigate(`/logistics/tickets?contract=${encodeURIComponent(row.contract_number)}`);
                    }
                  }}
                  rowStyle={{ cursor: 'pointer' }}
                />
              </Box>
            ) : (
              <Alert severity="success" variant="outlined">All shipped loads have matching settlements</Alert>
            )}
          </Paper>
        </Grid>

        {/* Pending Settlements */}
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 2 }}>
            <TileHeader
              title="Pending Settlements"
              onExport={data.pending_settlements?.length > 0 ? () => exportGridCsv(pendingGridRef, 'pending-settlements.csv') : undefined}
            />
            {data.pending_settlements?.length > 0 ? (
              <Box className={agTheme} sx={{ height: 350, width: '100%' }}>
                <AgGridReact
                  ref={pendingGridRef}
                  rowData={data.pending_settlements}
                  columnDefs={pendingCols}
                  defaultColDef={defaultColDef}
                  animateRows
                  onGridReady={({ api }) => api.sizeColumnsToFit()}
                  onRowClicked={({ data: row }) => {
                    if (row?.id) {
                      navigate(`/logistics/settlements?open=${row.id}`);
                    }
                  }}
                  rowStyle={{ cursor: 'pointer' }}
                />
              </Box>
            ) : (
              <Alert severity="success" variant="outlined">No pending settlements</Alert>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Row 4: Missing Loads */}
      <Paper sx={{ p: 2 }}>
        <TileHeader
          title="Missing Loads — Shipped but Not on Any Settlement"
          onExport={data.missing_loads?.length > 0 ? () => exportGridCsv(missingGridRef, 'missing-loads.csv') : undefined}
        />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Contracts where some loads have been settled but other loads shipped on the same contract are missing from all settlements.
        </Typography>
        {data.missing_loads?.length > 0 ? (
          <Box className={agTheme} sx={{ height: 300, width: '100%' }}>
            <AgGridReact
              ref={missingGridRef}
              rowData={data.missing_loads}
              columnDefs={missingCols}
              defaultColDef={defaultColDef}
              animateRows
              onGridReady={({ api }) => api.sizeColumnsToFit()}
            />
          </Box>
        ) : (
          <Alert severity="success" variant="outlined">All shipped loads accounted for on settlements</Alert>
        )}
      </Paper>
    </Box>
  );
}
