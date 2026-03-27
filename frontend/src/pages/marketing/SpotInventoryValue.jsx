import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Paper, Stack, Chip, Tooltip, Snackbar, Alert,
} from '@mui/material';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import { fmt, fmtDollarK } from '../../utils/formatting';
import useGridState from '../../hooks/useGridState.js';

const SOURCE_COLORS = {
  market_bid: 'success',
  market_bid_stale: 'warning',
  contract_avg: 'info',
  no_price: 'default',
};
const SOURCE_LABELS = {
  market_bid: 'Bid',
  market_bid_stale: 'Bid (stale)',
  contract_avg: 'Contract Avg',
  no_price: 'No Price',
};

export default function SpotInventoryValue() {
  const { currentFarm, canEdit } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const { onGridReady: restoreGridState, onStateChanged } = useGridState('c2_marketing_spot_value_grid');

  const handleGridReady = useCallback((params) => {
    params.api.sizeColumnsToFit();
    restoreGridState(params);
  }, [restoreGridState]);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'info' });

  const agTheme = mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

  const fetchData = useCallback(() => {
    if (!currentFarm) return;
    setLoading(true);
    api.get(`/api/farms/${currentFarm.id}/marketing/spot-value`)
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [currentFarm]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Build commodity lookup for price editing
  const commodityMap = useMemo(() => {
    if (!data?.commodities) return {};
    const m = {};
    for (const c of data.commodities) m[c.code] = c;
    return m;
  }, [data]);

  // Handle inline price edit
  const handlePriceEdit = useCallback(async (event) => {
    const { data: rowData, newValue } = event;
    const commodity = commodityMap[rowData._commodityCode];
    if (!commodity || !currentFarm || !canEdit) return;

    const parsed = parseFloat(newValue);
    if (isNaN(parsed) || parsed <= 0) {
      setSnack({ open: true, message: 'Enter a valid positive price', severity: 'warning' });
      fetchData();
      return;
    }

    try {
      await api.put(`/api/farms/${currentFarm.id}/marketing/prices/${commodity.id}`, {
        bid_per_bu: parsed,
      });
      setSnack({ open: true, message: `Updated ${commodity.name} to $${parsed.toFixed(2)}/bu`, severity: 'success' });
      fetchData();
    } catch {
      setSnack({ open: true, message: 'Failed to update price', severity: 'error' });
    }
  }, [currentFarm, canEdit, commodityMap, fetchData]);

  // Build ag-Grid row data: one row per commodity
  const rowData = useMemo(() => {
    if (!data?.commodities) return [];
    return data.commodities.map(c => {
      const row = {
        _commodityCode: c.code,
        commodity_name: c.name,
        price_per_bu: c.price_per_bu,
        price_per_mt: c.price_per_mt,
        source: c.source,
        source_detail: c.source_detail,
        stale: c.stale,
        days_old: c.days_old,
      };
      // Add value per location
      for (const r of data.rows) {
        const cell = r.values[c.code];
        row[`loc_${r.location}`] = cell?.value || 0;
        row[`mt_${r.location}`] = cell?.mt || 0;
      }
      // Row total
      const totCol = data.totals[c.code];
      row.total_value = totCol?.value || 0;
      row.total_mt = totCol?.mt || 0;
      return row;
    });
  }, [data]);

  // Pinned bottom: location totals
  const pinnedBottom = useMemo(() => {
    if (!data?.rows) return [];
    const row = { commodity_name: 'TOTAL', price_per_bu: null, price_per_mt: null, source: null };
    for (const r of data.rows) {
      row[`loc_${r.location}`] = r.total_value;
      row[`mt_${r.location}`] = r.total_mt;
    }
    row.total_value = data.grand_total_value;
    row.total_mt = data.grand_total_mt;
    return [row];
  }, [data]);

  // Column definitions
  const columnDefs = useMemo(() => {
    if (!data?.locations) return [];

    const cols = [
      {
        field: 'commodity_name', headerName: 'Crop', width: 130, pinned: 'left',
        cellStyle: p => p.data?.commodity_name === 'TOTAL' ? { fontWeight: 700 } : { fontWeight: 600 },
      },
      {
        field: 'price_per_bu', headerName: 'Spot $/bu', width: 105, pinned: 'left',
        editable: p => canEdit && p.data?.commodity_name !== 'TOTAL',
        valueFormatter: p => p.value ? `$${p.value.toFixed(2)}` : '—',
        cellStyle: p => {
          if (!p.data?.source || p.data.commodity_name === 'TOTAL') return null;
          if (p.data.source === 'no_price') return { color: '#9e9e9e', fontStyle: 'italic' };
          if (p.data.stale) return { color: '#ed6c02' };
          return null;
        },
      },
      {
        field: 'price_per_mt', headerName: 'Spot $/MT', width: 105, pinned: 'left',
        valueFormatter: p => p.value ? `$${p.value.toFixed(0)}` : '—',
      },
      {
        field: 'source', headerName: 'Source', width: 120, pinned: 'left',
        cellRenderer: p => {
          if (!p.value || p.data?.commodity_name === 'TOTAL') return '';
          const color = SOURCE_COLORS[p.value] || 'default';
          const label = SOURCE_LABELS[p.value] || p.value;
          return (
            <Tooltip title={p.data?.source_detail || ''} arrow>
              <Chip label={label} size="small" color={color} variant="outlined" />
            </Tooltip>
          );
        },
      },
    ];

    // Dynamic location columns
    for (const loc of data.locations) {
      cols.push({
        headerName: loc,
        field: `loc_${loc}`,
        width: 120,
        type: 'rightAligned',
        valueFormatter: p => {
          const v = p.value;
          if (!v) return '—';
          return fmtDollarK(v);
        },
        headerTooltip: loc,
        cellStyle: p => {
          if (p.data?.commodity_name === 'TOTAL') return { fontWeight: 700 };
          return p.value ? null : { color: '#9e9e9e' };
        },
      });
    }

    // Total column
    cols.push({
      field: 'total_value', headerName: 'Total', width: 120, pinned: 'right',
      type: 'rightAligned',
      valueFormatter: p => p.value ? fmtDollarK(p.value) : '—',
      cellStyle: () => ({ fontWeight: 700 }),
    });

    return cols;
  }, [data, canEdit]);

  const defaultColDef = useMemo(() => ({ sortable: true, resizable: true }), []);

  const gridHeight = data?.commodities?.length
    ? Math.min(500, 56 + (data.commodities.length + 1) * 42 + 42)
    : 200;

  const periodLabel = data?.period_date
    ? new Date(data.period_date).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
    : '';

  const staleCount = data?.commodities?.filter(c => c.stale || c.source === 'no_price').length || 0;

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 0.5 }}>Spot Inventory Value</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Market-purpose bins valued at spot prices, reduced 2% for dockage
        {periodLabel ? ` | Inventory: ${periodLabel}` : ''}
      </Typography>

      {/* KPI Cards */}
      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <Tooltip title="Total spot value of all market-purpose grain, net of 2% dockage" arrow>
          <Paper sx={{ px: 2, py: 1.5, flex: 1, textAlign: 'center' }} variant="outlined">
            <Typography variant="caption" color="text.secondary">Spot Inventory Value</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {data ? fmtDollarK(data.grand_total_value) : '—'}
            </Typography>
          </Paper>
        </Tooltip>
        <Tooltip title="Total market-purpose grain on hand" arrow>
          <Paper sx={{ px: 2, py: 1.5, flex: 1, textAlign: 'center' }} variant="outlined">
            <Typography variant="caption" color="text.secondary">Total On Hand</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {data ? `${fmt(data.grand_total_mt, 0)} MT` : '—'}
            </Typography>
          </Paper>
        </Tooltip>
        {staleCount > 0 && (
          <Paper sx={{ px: 2, py: 1.5, flex: 1, textAlign: 'center', borderColor: 'warning.main' }} variant="outlined">
            <Typography variant="caption" color="text.secondary">Price Attention</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700, color: 'warning.main' }}>
              {staleCount} crop{staleCount > 1 ? 's' : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary">stale or missing price</Typography>
          </Paper>
        )}
      </Stack>

      {/* Matrix Grid */}
      {data?.commodities?.length ? (
        <Box className={agTheme} sx={{ height: gridHeight, width: '100%', minWidth: 0 }}>
          <AgGridReact
            ref={gridRef}
            rowData={rowData}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            pinnedBottomRowData={pinnedBottom}
            animateRows
            getRowId={p => p.data?._commodityCode || 'total'}
            onCellValueChanged={handlePriceEdit}
            singleClickEdit
            stopEditingWhenCellsLoseFocus
            onGridReady={handleGridReady}
            onFirstDataRendered={({ api }) => api.sizeColumnsToFit()}
            onColumnResized={onStateChanged}
            onColumnMoved={onStateChanged}
            onSortChanged={onStateChanged}
            onColumnVisible={onStateChanged}
          />
        </Box>
      ) : !loading ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            No market inventory data available. Ensure bins have a count period with market-purpose grain.
          </Typography>
        </Paper>
      ) : null}

      <Snackbar open={snack.open} autoHideDuration={3000} onClose={() => setSnack(s => ({ ...s, open: false }))}>
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
