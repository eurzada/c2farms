import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
  const matrixGridRef = useRef();
  const matrixApiRef = useRef();
  const matrixContainerRef = useRef();
  const unsettledGridRef = useRef();

  const [data, setData] = useState(null);
  const [matrixData, setMatrixData] = useState(null);
  const [unsettledData, setUnsettledData] = useState(null);

  const agTheme = mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

  useEffect(() => {
    if (!currentFarm) return;
    api.get(`/api/farms/${currentFarm.id}/marketing/dashboard`)
      .then(res => setData(res.data));
  }, [currentFarm]);

  // Fetch commitment matrix & delivered-unsettled (all years)
  const fetchMatrixData = useCallback(() => {
    if (!currentFarm) return;
    api.get(`/api/farms/${currentFarm.id}/marketing/commitment-matrix`)
      .then(res => setMatrixData(res.data))
      .catch(() => setMatrixData(null));
    api.get(`/api/farms/${currentFarm.id}/marketing/delivered-unsettled`)
      .then(res => setUnsettledData(res.data))
      .catch(() => setUnsettledData({ contracts: [], total_mt: 0, total_value: 0 }));
  }, [currentFarm]);

  useEffect(() => { fetchMatrixData(); }, [fetchMatrixData]);

  const kpis = data?.kpis || {};
  const positionGrid = data?.positionGrid || [];
  const chartData = data?.chartData || [];
  const dashboardMatrix = data?.commitmentMatrix;

  // Use matrix from dashboard when present, else from separate API
  const effectiveMatrixData = useMemo(() => {
    if (dashboardMatrix?.rows?.length) return dashboardMatrix;
    if (matrixData?.rows?.length) return matrixData;
    return null;
  }, [dashboardMatrix, matrixData]);

  const columnDefs = useMemo(() => [
    { field: 'commodity_name', headerName: 'Commodity', flex: 1, minWidth: 100, pinned: 'left' },
    { field: 'inventory_mt', headerName: 'On Hand (MT)', width: 100, valueFormatter: p => fmt(p.value) },
    { field: 'committed_mt', headerName: 'Committed', width: 90, valueFormatter: p => fmt(p.value) },
    { field: 'available_mt', headerName: 'Available', width: 90, valueFormatter: p => fmt(p.value) },
    { field: 'pct_committed', headerName: '% Sold', width: 72, valueFormatter: p => `${(p.value || 0).toFixed(0)}%` },
    { field: 'bid_per_bu', headerName: 'Bid $/bu', width: 88, valueFormatter: p => p.value ? `$${p.value.toFixed(2)}` : '—' },
    { field: 'cop_per_bu', headerName: 'COP $/bu', width: 88, valueFormatter: p => p.value ? `$${p.value.toFixed(2)}` : '—' },
    { field: 'target_price_bu', headerName: 'Target $/bu', width: 95, valueFormatter: p => p.value ? `$${p.value.toFixed(2)}` : '—' },
    {
      field: 'outlook', headerName: 'Outlook', width: 88,
      cellRenderer: p => {
        const colors = { bullish: 'success', bearish: 'error', sideways: 'default' };
        return p.value ? <Chip label={p.value} size="small" color={colors[p.value] || 'default'} variant="outlined" /> : '—';
      },
    },
    {
      field: 'priority', headerName: 'Sell Priority', width: 100,
      cellRenderer: p => <Chip label={p.data.action} size="small" color={PRIORITY_COLORS[p.value] || 'default'} />,
    },
    { field: 'rationale', headerName: 'Rationale', flex: 1, minWidth: 140 },
    { field: 'inventory_value', headerName: 'Value', width: 90, valueFormatter: p => fmtDollar(p.value) },
  ], []);

  const defaultColDef = useMemo(() => ({ sortable: true, resizable: true }), []);

  // ─── Commitment Matrix: crops as columns, buyers as rows ───
  const matrixColDefs = useMemo(() => {
    const mat = effectiveMatrixData || matrixData;
    if (!mat?.crops?.length) return [];
    const cropCols = mat.crops.map(c => ({
      headerName: c.name,
      headerTooltip: `${c.name} (${c.code})`,
      field: `crops.${c.code}`,
      flex: 1,
      minWidth: 100,
      type: 'rightAligned',
      valueGetter: p => p.data?.crops?.[c.code] ?? 0,
      valueFormatter: p => {
        const v = p.value;
        if (p.data?._rowType === 'pct') return v != null ? `${Number(v).toFixed(0)}%` : '–';
        return v ? fmt(v) : '–';
      },
      cellStyle: p => {
        if (p.data?._rowType === 'pct' && p.value != null) {
          const v = Number(p.value);
          if (v < 25) return { color: '#d32f2f', fontWeight: 600 };
          if (v > 75) return { color: '#2e7d32', fontWeight: 600 };
          return { color: '#e65100' };
        }
        return p.value ? null : { color: '#9e9e9e' };
      },
    }));

    return [
      {
        field: 'buyer_name',
        headerName: 'Buyer',
        flex: 1,
        minWidth: 140,
        pinned: 'left',
        cellStyle: p => (p.data?._rowType ? { fontWeight: 700 } : { fontWeight: 600 }),
      },
      ...cropCols,
      {
        field: 'total_mt',
        headerName: 'Total (MT)',
        minWidth: 110,
        flex: 1,
        type: 'rightAligned',
        valueFormatter: p => {
          if (p.data?._rowType === 'pct') return p.value != null ? `${Number(p.value).toFixed(0)}%` : '–';
          return p.value != null ? fmt(p.value) : '–';
        },
        cellStyle: p => p.data?._rowType ? { fontWeight: 600 } : p.value ? { fontWeight: 600 } : null,
      },
    ];
  }, [effectiveMatrixData, matrixData]);

  // Pinned bottom rows: Totals, Available, % Avail
  const matrixPinnedBottom = useMemo(() => {
    const mat = effectiveMatrixData || matrixData;
    if (!mat?.totals_row) return [];
    const footerRows = [
      {
        buyer_name: 'Total',
        crops: mat.totals_row.crops || {},
        total_mt: mat.totals_row.total_mt,
        _rowType: 'totals',
      },
      {
        buyer_name: 'Available',
        crops: mat.available_row?.crops || {},
        total_mt: mat.available_row?.total_mt,
        _rowType: 'available',
      },
      {
        buyer_name: '% Avail',
        crops: mat.pct_row?.crops || {},
        total_mt: mat.pct_row?.total_mt,
        _rowType: 'pct',
      },
    ];
    return footerRows;
  }, [effectiveMatrixData, matrixData]);

  // ─── Delivered Unsettled columns ───
  const unsettledColDefs = useMemo(() => [
    { field: 'contract_number', headerName: 'Contract #', width: 110 },
    { field: 'buyer', headerName: 'Buyer', flex: 1, minWidth: 100 },
    { field: 'commodity', headerName: 'Crop', width: 100 },
    { field: 'crop_year', headerName: 'Crop Year', width: 88 },
    { field: 'delivered_mt', headerName: 'Delivered (MT)', width: 100, type: 'rightAligned', valueFormatter: p => fmt(p.value) },
    { field: 'price_per_bu', headerName: '$/bu', width: 76, type: 'rightAligned', valueFormatter: p => p.value ? `$${p.value.toFixed(2)}` : '—' },
    { field: 'contract_value', headerName: 'Value', width: 95, type: 'rightAligned', valueFormatter: p => p.value ? fmtDollar(p.value) : '—' },
    { field: 'delivery_end', headerName: 'Delivery End', width: 105, valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString('en-CA') : '—' },
  ], []);

  const unsettledPinnedBottom = useMemo(() => {
    if (!unsettledData?.contracts?.length) return [];
    return [{
      contract_number: `${unsettledData.contracts.length} contracts`,
      buyer: '', commodity: '', crop_year: '',
      delivered_mt: unsettledData.total_mt,
      price_per_bu: null,
      contract_value: unsettledData.total_value,
      delivery_end: null,
    }];
  }, [unsettledData]);

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

  const mat = effectiveMatrixData || matrixData;

  // Resize commitment matrix columns when container or window changes
  useEffect(() => {
    const el = matrixContainerRef.current;
    if (!el || !mat?.rows?.length) return;
    const ro = new ResizeObserver(() => {
      matrixApiRef.current?.sizeColumnsToFit?.();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      matrixApiRef.current = null;
    };
  }, [mat?.rows?.length]);

  const matrixHeight = mat?.rows?.length
    ? Math.min(450, 56 + (mat.rows.length + 3) * 42)
    : 200;

  const unsettledHeight = unsettledData?.contracts?.length
    ? Math.min(350, 56 + unsettledData.contracts.length * 42 + 42)
    : 120;

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
      <Box className={agTheme} sx={{ height: 350, width: '100%', minWidth: 0, mb: 3 }}>
        <AgGridReact
          ref={gridRef}
          rowData={positionGrid}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          getRowId={p => p.data?.commodity_id}
          onGridReady={({ api }) => api.sizeColumnsToFit()}
          onFirstDataRendered={({ api }) => api.sizeColumnsToFit()}
        />
      </Box>

      {/* Chart */}
      <Typography variant="h6" sx={{ mb: 1 }}>Committed vs Available</Typography>
      <Paper variant="outlined" sx={{ p: 2, height: 300, mb: 3 }}>
        <Bar data={barChartData} options={barChartOptions} />
      </Paper>

      {/* ─── Commitment Matrix ─── */}
      <Typography variant="h6" sx={{ mb: 1 }}>Commitments by Buyer</Typography>

      {mat?.rows?.length ? (
        <Box ref={matrixContainerRef} className={agTheme} sx={{ height: matrixHeight, width: '100%', minWidth: 0, mb: 3 }}>
          <AgGridReact
            ref={matrixGridRef}
            rowData={mat.rows}
            columnDefs={matrixColDefs}
            defaultColDef={defaultColDef}
            pinnedBottomRowData={matrixPinnedBottom}
            animateRows
            getRowId={p => p.data?.buyer_name ? `buyer-${p.data.buyer_name}` : `footer-${p.data?._rowType}`}
            onGridReady={({ api }) => {
              matrixApiRef.current = api;
              api.sizeColumnsToFit();
            }}
            onFirstDataRendered={({ api }) => api.sizeColumnsToFit()}
          />
        </Box>
      ) : (
        <Paper variant="outlined" sx={{ p: 3, mb: 3, textAlign: 'center' }}>
          <Typography color="text.secondary">No active commitments</Typography>
        </Paper>
      )}

      {/* ─── Delivered Unsettled ─── */}
      {unsettledData?.contracts?.length > 0 && (
        <>
          <Typography variant="h6" sx={{ mb: 1 }}>Delivered — Awaiting Settlement</Typography>
          <Box className={agTheme} sx={{ height: unsettledHeight, width: '100%', minWidth: 0 }}>
            <AgGridReact
              ref={unsettledGridRef}
              rowData={unsettledData.contracts}
              columnDefs={unsettledColDefs}
              defaultColDef={defaultColDef}
              pinnedBottomRowData={unsettledPinnedBottom}
              animateRows
              getRowId={p => p.data?.id}
              onGridReady={({ api }) => api.sizeColumnsToFit()}
              onFirstDataRendered={({ api }) => api.sizeColumnsToFit()}
            />
          </Box>
        </>
      )}
    </Box>
  );
}
