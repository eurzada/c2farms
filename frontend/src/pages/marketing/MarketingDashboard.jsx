import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Paper, Stack, Chip, Tooltip,
} from '@mui/material';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip as ChartTooltip, Legend } from 'chart.js';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';

ChartJS.register(CategoryScale, LinearScale, BarElement, ChartTooltip, Legend);

import { fmt, fmtDollarK as fmtDollar } from '../../utils/formatting';
import useGridState from '../../hooks/useGridState.js';

const PRIORITY_COLORS = { high: 'error', medium: 'warning', low: 'default' };

export default function MarketingDashboard() {
  const { currentFarm } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const fulfillmentGridRef = useRef();
  const matrixGridRef = useRef();
  const matrixApiRef = useRef();
  const matrixContainerRef = useRef();
  const unsettledGridRef = useRef();

  const [data, setData] = useState(null);
  const [fulfillment, setFulfillment] = useState([]);
  const [matrixData, setMatrixData] = useState(null);
  const [unsettledData, setUnsettledData] = useState(null);

  const agTheme = mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

  const { onGridReady: restoreFulfillment, onStateChanged: onFulfillmentChanged } = useGridState('c2_marketing_dash_fulfillment_grid');
  const { onGridReady: restoreMatrix, onStateChanged: onMatrixChanged } = useGridState('c2_marketing_dash_matrix_grid');
  const { onGridReady: restoreUnsettled, onStateChanged: onUnsettledChanged } = useGridState('c2_marketing_dash_unsettled_grid');
  const { onGridReady: restorePosition, onStateChanged: onPositionChanged } = useGridState('c2_marketing_dash_position_grid');

  const handleFulfillmentReady = useCallback((params) => {
    params.api.sizeColumnsToFit();
    restoreFulfillment(params);
  }, [restoreFulfillment]);

  const handleMatrixReady = useCallback((params) => {
    matrixApiRef.current = params.api;
    params.api.sizeColumnsToFit();
    restoreMatrix(params);
  }, [restoreMatrix]);

  const handleUnsettledReady = useCallback((params) => {
    params.api.sizeColumnsToFit();
    restoreUnsettled(params);
  }, [restoreUnsettled]);

  const handlePositionReady = useCallback((params) => {
    params.api.sizeColumnsToFit();
    restorePosition(params);
  }, [restorePosition]);

  useEffect(() => {
    if (!currentFarm) return;
    api.get(`/api/farms/${currentFarm.id}/marketing/dashboard`)
      .then(res => setData(res.data));
    api.get(`/api/farms/${currentFarm.id}/marketing/contract-fulfillment`)
      .then(res => setFulfillment(res.data.contracts || []))
      .catch(() => setFulfillment([]));
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

  // ─── Contract Fulfillment columns ───
  const fulfillmentColDefs = useMemo(() => [
    { field: 'contract_number', headerName: 'Contract #', width: 140, pinned: 'left' },
    { field: 'buyer', headerName: 'Buyer', width: 150, minWidth: 120 },
    { field: 'commodity', headerName: 'Crop', width: 110 },
    { field: 'grade', headerName: 'Grade', width: 100 },
    { field: 'contracted_mt', headerName: 'Contracted', width: 110, type: 'rightAligned', valueFormatter: p => fmt(p.value),
      headerTooltip: 'Contracted MT',
    },
    { field: 'hauled_mt', headerName: 'Unload', width: 100, type: 'rightAligned', valueFormatter: p => fmt(p.value),
      headerTooltip: 'Unload weight from truck tickets — dirty grain before dockage',
    },
    { field: 'settled_net_mt', headerName: 'Net (Settled)', width: 110, type: 'rightAligned',
      valueFormatter: p => p.value ? fmt(p.value) : '—',
      headerTooltip: 'Net (clean) weight from buyer settlements — what fulfills contract obligations',
      cellStyle: p => !p.value ? { color: '#9e9e9e', fontStyle: 'italic' } : null,
    },
    { field: 'remaining_mt', headerName: 'Remaining', width: 100, type: 'rightAligned', valueFormatter: p => fmt(p.value),
      headerTooltip: 'Remaining MT to deliver',
      cellStyle: p => p.value > 0 ? { color: '#e65100', fontWeight: 600 } : { color: '#2e7d32' },
    },
    {
      field: 'pct_complete', headerName: 'Progress', width: 160,
      headerTooltip: 'Contract fulfillment based on Net (clean) weight from settlements. Falls back to Unload weight when no settlement data.',
      cellRenderer: p => {
        const hasNet = p.data?.settled_net_mt > 0;
        const pct = Math.min(100, p.value || 0);
        // Settled = solid green/blue; Unsettled = amber/orange to signal "unconfirmed"
        const color = hasNet
          ? (pct >= 100 ? '#2e7d32' : pct >= 50 ? '#1976d2' : '#e65100')
          : '#ed6c02'; // amber for all unsettled — even at 100%
        const tooltip = hasNet
          ? 'Based on Net (settlement) weight'
          : 'Based on Unload (ticket) weight — awaiting settlement confirmation';
        const label = hasNet ? `${pct.toFixed(0)}%` : `${pct.toFixed(0)}% (unload)`;
        return (
          <Tooltip title={tooltip} arrow>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
              <Box sx={{ flex: 1, bgcolor: 'action.hover', borderRadius: 1, height: 8 }}>
                <Box sx={{
                  width: `${pct}%`, bgcolor: color, borderRadius: 1, height: 8,
                  ...(hasNet ? {} : { backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.4) 2px, rgba(255,255,255,0.4) 4px)' }),
                }} />
              </Box>
              <Typography variant="caption" sx={{ minWidth: hasNet ? 35 : 70, color: hasNet ? 'text.primary' : '#ed6c02', fontWeight: hasNet ? 400 : 600 }}>
                {label}
              </Typography>
            </Box>
          </Tooltip>
        );
      },
    },
    { field: 'delivery_end', headerName: 'Delivery End', width: 115, valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString('en-CA') : '\u2014' },
    { field: 'elevator_site', headerName: 'Delivery Point', width: 140, minWidth: 100 },
    { field: 'price_per_bu', headerName: '$/bu', width: 80, type: 'rightAligned', valueFormatter: p => p.value ? `$${p.value.toFixed(2)}` : '\u2014' },
  ], []);

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
      {
        field: 'earliest_delivery_end',
        headerName: 'Next Delivery',
        width: 110,
        valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString('en-CA') : '',
        sort: 'asc',
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

      {/* KPI Cards — Row 1: Inventory */}
      <Stack direction="row" spacing={2} sx={{ mb: 1.5 }}>
        {[
          { label: 'Total On Hand', value: `${fmt(kpis.total_mt)} MT`, tip: 'Total grain in bins from the latest inventory count' },
          { label: 'Available to Sell', value: `${fmt(kpis.available_mt)} MT`, tip: 'On hand minus what is already committed to contracts' },
          { label: 'Inventory Value', value: fmtDollar(kpis.total_value), tip: 'On-hand inventory valued at current bid prices' },
        ].map(k => (
          <Tooltip key={k.label} title={k.tip} arrow placement="top">
            <Paper sx={{ px: 2, py: 1.5, flex: 1, textAlign: 'center', cursor: 'default' }} variant="outlined">
              <Typography variant="caption" color="text.secondary">{k.label}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>{k.value}</Typography>
            </Paper>
          </Tooltip>
        ))}
      </Stack>

      {/* KPI Cards — Row 2: Contract Fulfilment Pipeline */}
      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        {[
          { label: 'Gross Commitment', value: `${fmt(kpis.gross_commitment)} MT`, color: 'text.primary', tip: 'Total MT across all signed contracts (executed + in delivery)' },
          { label: 'Hauled (Unload)', value: `${fmt(kpis.hauled_mt)} MT`, color: 'info.main', tip: 'Unload weight from truck tickets — dirty grain before dockage' },
          { label: 'Still to Haul', value: `${fmt(kpis.remaining_less_hauled)} MT`, color: 'error.main', tip: 'Gross commitment minus hauled (Unload weight) — grain still to be physically moved' },
          { label: 'Confirmed (Paid)', value: `${fmt(kpis.settled_mt)} MT`, color: 'success.main', tip: 'MT from approved settlement documents — buyer has paid' },
          { label: 'Awaiting Payment', value: `${fmt(kpis.remaining_less_settled)} MT`, color: 'warning.main', tip: 'Gross commitment minus confirmed paid — still awaiting settlement' },
        ].map(k => (
          <Tooltip key={k.label} title={k.tip} arrow placement="top">
            <Paper sx={{ px: 2, py: 1.5, flex: 1, textAlign: 'center', cursor: 'default' }} variant="outlined">
              <Typography variant="caption" color="text.secondary">{k.label}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 600, color: k.color }}>{k.value}</Typography>
            </Paper>
          </Tooltip>
        ))}
      </Stack>

      {/* Contract Fulfillment */}
      {fulfillment.length > 0 && (
        <>
          <Typography variant="h6" sx={{ mb: 1 }}>Contract Fulfillment</Typography>
          <Box className={agTheme} sx={{ height: Math.min(400, 56 + fulfillment.length * 42), width: '100%', minWidth: 0, mb: 3, '& .ag-header-cell-label': { whiteSpace: 'normal', lineHeight: '1.2' } }}>
            <AgGridReact
              ref={fulfillmentGridRef}
              rowData={fulfillment}
              columnDefs={fulfillmentColDefs}
              defaultColDef={{ ...defaultColDef, autoHeaderHeight: true, wrapHeaderText: true }}
              animateRows
              getRowId={p => p.data?.id}
              onGridReady={handleFulfillmentReady}
              onColumnResized={onFulfillmentChanged}
              onColumnMoved={onFulfillmentChanged}
              onSortChanged={onFulfillmentChanged}
              onColumnVisible={onFulfillmentChanged}
            />
          </Box>
        </>
      )}

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
            onGridReady={handleMatrixReady}
            onFirstDataRendered={({ api }) => api.sizeColumnsToFit()}
            onColumnResized={onMatrixChanged}
            onColumnMoved={onMatrixChanged}
            onSortChanged={onMatrixChanged}
            onColumnVisible={onMatrixChanged}
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
          <Box className={agTheme} sx={{ height: unsettledHeight, width: '100%', minWidth: 0, mb: 3 }}>
            <AgGridReact
              ref={unsettledGridRef}
              rowData={unsettledData.contracts}
              columnDefs={unsettledColDefs}
              defaultColDef={defaultColDef}
              pinnedBottomRowData={unsettledPinnedBottom}
              animateRows
              getRowId={p => p.data?.id}
              onGridReady={handleUnsettledReady}
              onFirstDataRendered={({ api }) => api.sizeColumnsToFit()}
              onColumnResized={onUnsettledChanged}
              onColumnMoved={onUnsettledChanged}
              onSortChanged={onUnsettledChanged}
              onColumnVisible={onUnsettledChanged}
            />
          </Box>
        </>
      )}

      {/* Position Grid */}
      <Typography variant="h6" sx={{ mb: 1 }}>Position by Commodity</Typography>
      <Box className={agTheme} sx={{ height: 350, width: '100%', minWidth: 0 }}>
        <AgGridReact
          ref={gridRef}
          rowData={positionGrid}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          getRowId={p => p.data?.commodity_id}
          onGridReady={handlePositionReady}
          onFirstDataRendered={({ api }) => api.sizeColumnsToFit()}
          onColumnResized={onPositionChanged}
          onColumnMoved={onPositionChanged}
          onSortChanged={onPositionChanged}
          onColumnVisible={onPositionChanged}
        />
      </Box>
    </Box>
  );
}
