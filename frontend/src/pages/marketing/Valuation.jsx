import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Paper, Stack, Chip, Tooltip, Snackbar, Alert,
  Accordion, AccordionSummary, AccordionDetails,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import { fmt, fmtDollarK } from '../../utils/formatting';
import useGridState from '../../hooks/useGridState.js';

const fmtBu = (v) => v != null ? `$${v.toFixed(2)}` : '—';
const fmtMt = (v) => v != null ? `$${v.toFixed(0)}` : '—';
const fmtVal = (v) => fmtDollarK(v);

const TIER_COLORS = {
  tier1: '#1976d2',  // blue
  tier2: '#2e7d32',  // green
  tier3: '#ed6c02',  // amber
};

const SOURCE_CHIP = {
  market_bid: { label: 'Bid', color: 'success' },
  market_bid_stale: { label: 'Bid (stale)', color: 'warning' },
  contract_avg: { label: 'Contract Avg', color: 'info' },
  no_price: { label: 'No Price', color: 'default' },
};

export default function Valuation() {
  const { currentFarm, canEdit } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const { onGridReady: restoreGridState, onStateChanged } = useGridState('c2_marketing_valuation_grid');

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
    api.get(`/api/farms/${currentFarm.id}/marketing/valuation`)
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [currentFarm]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Inline price edit handler for Tier 3
  const handlePriceEdit = useCallback(async (event) => {
    const { data: rowData, newValue } = event;
    if (!currentFarm || !canEdit) return;

    const parsed = parseFloat(newValue);
    if (isNaN(parsed) || parsed <= 0) {
      setSnack({ open: true, message: 'Enter a valid positive price', severity: 'warning' });
      fetchData();
      return;
    }

    try {
      await api.put(`/api/farms/${currentFarm.id}/marketing/prices/${rowData.commodity_id}`, {
        bid_per_bu: parsed,
      });
      setSnack({ open: true, message: `Updated ${rowData.commodity_name} to $${parsed.toFixed(2)}/bu`, severity: 'success' });
      fetchData();
    } catch {
      setSnack({ open: true, message: 'Failed to update price', severity: 'error' });
    }
  }, [currentFarm, canEdit, fetchData]);

  // Tier 3 ag-Grid columns
  const tier3ColDefs = useMemo(() => [
    { field: 'commodity_name', headerName: 'Commodity', width: 140, pinned: 'left', cellStyle: () => ({ fontWeight: 600 }) },
    { field: 'inventory_mt', headerName: 'Inventory (MT)', width: 120, type: 'rightAligned', valueFormatter: p => fmt(p.value, 0) },
    { field: 'contracted_mt', headerName: 'Contracted (MT)', width: 130, type: 'rightAligned', valueFormatter: p => fmt(p.value, 0) },
    { field: 'uncontracted_mt', headerName: 'Uncontracted (MT)', width: 140, type: 'rightAligned', valueFormatter: p => fmt(p.value, 0),
      cellStyle: p => ({ fontWeight: 600, color: p.value > 0 ? undefined : '#9e9e9e' }),
    },
    {
      field: 'spot_price_per_bu', headerName: 'Spot $/bu', width: 110, type: 'rightAligned',
      editable: p => canEdit && p.data?.commodity_name !== 'TOTAL',
      valueFormatter: p => fmtBu(p.value),
      cellStyle: p => {
        if (!p.data?.spot_source) return null;
        if (p.data.spot_source === 'no_price') return { color: '#9e9e9e', fontStyle: 'italic' };
        if (p.data.stale) return { color: '#ed6c02' };
        return null;
      },
    },
    { field: 'spot_price_per_mt', headerName: 'Spot $/MT', width: 110, type: 'rightAligned', valueFormatter: p => fmtMt(p.value) },
    {
      field: 'spot_source', headerName: 'Source', width: 120,
      cellRenderer: p => {
        if (!p.value || p.data?.commodity_name === 'TOTAL') return '';
        const cfg = SOURCE_CHIP[p.value] || { label: p.value, color: 'default' };
        return (
          <Tooltip title={p.data?.spot_source_detail || ''} arrow>
            <Chip label={cfg.label} size="small" color={cfg.color} variant="outlined" />
          </Tooltip>
        );
      },
    },
    {
      field: 'total_value', headerName: 'Value', width: 120, type: 'rightAligned', pinned: 'right',
      valueFormatter: p => fmtVal(p.value),
      cellStyle: () => ({ fontWeight: 700 }),
    },
  ], [canEdit]);

  const tier3Pinned = useMemo(() => {
    if (!data?.tier3?.rows?.length) return [];
    return [{
      commodity_name: 'TOTAL',
      inventory_mt: data.tier3.rows.reduce((s, r) => s + r.inventory_mt, 0),
      contracted_mt: data.tier3.rows.reduce((s, r) => s + r.contracted_mt, 0),
      uncontracted_mt: data.tier3.rows.reduce((s, r) => s + r.uncontracted_mt, 0),
      spot_price_per_bu: null,
      spot_price_per_mt: null,
      spot_source: null,
      total_value: data.tier3.total_value,
    }];
  }, [data]);

  const tier3Height = data?.tier3?.rows?.length
    ? Math.min(500, 56 + (data.tier3.rows.length + 1) * 42 + 42)
    : 200;

  const s = data?.summary || {};
  const periodLabel = data?.period_date
    ? new Date(data.period_date).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
    : '';

  const cellSx = { py: 0.75, px: 1.5, fontSize: '0.84rem' };
  const headSx = { ...cellSx, fontWeight: 700 };
  const totalSx = { ...cellSx, fontWeight: 700, borderTop: 2, borderColor: 'divider' };

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 0.5 }}>Inventory Valuation</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Three-tier valuation of enterprise grain inventory
        {periodLabel ? ` | Inventory: ${periodLabel}` : ''}
        {' | Excludes LGX, 2026 crop year, transfer contracts'}
      </Typography>

      {/* ─── Summary Cards ─── */}
      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <Tooltip title="Tier 1 + Tier 2 + Tier 3" arrow>
          <Paper sx={{ px: 2, py: 1.5, flex: 1.5, textAlign: 'center', borderLeft: 4, borderColor: 'primary.main' }} variant="outlined">
            <Typography variant="caption" color="text.secondary">Total Inventory Value</Typography>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>{fmtVal(s.grand_total_value)}</Typography>
            <Typography variant="caption" color="text.secondary">{fmt(s.total_inventory_mt, 0)} MT on hand</Typography>
          </Paper>
        </Tooltip>
        <Tooltip title="Basis and HTA contracts valued at current futures ± basis" arrow>
          <Paper sx={{ px: 2, py: 1.5, flex: 1, textAlign: 'center', borderLeft: 4, borderColor: TIER_COLORS.tier1 }} variant="outlined">
            <Typography variant="caption" color="text.secondary">Basis / HTA</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>{fmtVal(s.tier1_value)}</Typography>
            <Typography variant="caption" color="text.secondary">{fmt(s.tier1_mt, 0)} MT</Typography>
          </Paper>
        </Tooltip>
        <Tooltip title="Contracts with locked prices" arrow>
          <Paper sx={{ px: 2, py: 1.5, flex: 1, textAlign: 'center', borderLeft: 4, borderColor: TIER_COLORS.tier2 }} variant="outlined">
            <Typography variant="caption" color="text.secondary">Fixed Price</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>{fmtVal(s.tier2_value)}</Typography>
            <Typography variant="caption" color="text.secondary">{fmt(s.tier2_mt, 0)} MT</Typography>
          </Paper>
        </Tooltip>
        <Tooltip title="Uncontracted grain at spot price, net of 2% dockage" arrow>
          <Paper sx={{ px: 2, py: 1.5, flex: 1, textAlign: 'center', borderLeft: 4, borderColor: TIER_COLORS.tier3 }} variant="outlined">
            <Typography variant="caption" color="text.secondary">Spot (Uncontracted)</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>{fmtVal(s.tier3_value)}</Typography>
            <Typography variant="caption" color="text.secondary">{fmt(s.tier3_mt, 0)} MT</Typography>
          </Paper>
        </Tooltip>
      </Stack>

      {/* ─── Tier 1: Basis / HTA ─── */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Stack direction="row" alignItems="center" spacing={2} sx={{ width: '100%', pr: 2 }}>
            <Box sx={{ width: 4, height: 24, bgcolor: TIER_COLORS.tier1, borderRadius: 1 }} />
            <Typography variant="h6" sx={{ flex: 1 }}>Basis / HTA Contracts</Typography>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {fmt(data?.tier1?.total_mt, 0)} MT &nbsp;|&nbsp; {fmtVal(data?.tier1?.total_value)}
            </Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 0 }}>
          {data?.tier1?.rows?.length ? (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={headSx}>Commodity</TableCell>
                    <TableCell sx={headSx}>Contract #</TableCell>
                    <TableCell sx={headSx}>Buyer</TableCell>
                    <TableCell sx={headSx} align="right">Remaining (MT)</TableCell>
                    <TableCell sx={headSx} align="right">Basis $/MT</TableCell>
                    <TableCell sx={headSx}>Futures Ref</TableCell>
                    <TableCell sx={headSx} align="right">Futures $/bu</TableCell>
                    <TableCell sx={headSx} align="right">Calc $/bu</TableCell>
                    <TableCell sx={headSx} align="right">Calc $/MT</TableCell>
                    <TableCell sx={headSx} align="right">Value</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.tier1.rows.map(r => (
                    <TableRow key={r.contract_number} hover>
                      <TableCell sx={cellSx}>{r.commodity_name}</TableCell>
                      <TableCell sx={cellSx}>{r.contract_number}</TableCell>
                      <TableCell sx={cellSx}>{r.buyer}</TableCell>
                      <TableCell sx={cellSx} align="right">{fmt(r.remaining_mt, 0)}</TableCell>
                      <TableCell sx={cellSx} align="right">{r.basis_level >= 0 ? '+' : ''}{r.basis_level?.toFixed(2)}</TableCell>
                      <TableCell sx={cellSx}>{r.futures_reference || '—'}</TableCell>
                      <TableCell sx={cellSx} align="right">
                        {r.needs_price
                          ? <Chip label="Needs Price" size="small" color="warning" variant="outlined" />
                          : fmtBu(r.futures_close)}
                      </TableCell>
                      <TableCell sx={cellSx} align="right">{fmtBu(r.calc_price_per_bu)}</TableCell>
                      <TableCell sx={cellSx} align="right">{fmtMt(r.calc_price_per_mt)}</TableCell>
                      <TableCell sx={{ ...cellSx, fontWeight: 600 }} align="right">{fmtVal(r.total_value)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell sx={totalSx} colSpan={3}>Total</TableCell>
                    <TableCell sx={totalSx} align="right">{fmt(data.tier1.total_mt, 0)}</TableCell>
                    <TableCell sx={totalSx} colSpan={5} />
                    <TableCell sx={totalSx} align="right">{fmtVal(data.tier1.total_value)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Typography color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>No basis or HTA contracts</Typography>
          )}
        </AccordionDetails>
      </Accordion>

      {/* ─── Tier 2: Fixed Price ─── */}
      <Accordion defaultExpanded sx={{ mt: 1 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Stack direction="row" alignItems="center" spacing={2} sx={{ width: '100%', pr: 2 }}>
            <Box sx={{ width: 4, height: 24, bgcolor: TIER_COLORS.tier2, borderRadius: 1 }} />
            <Typography variant="h6" sx={{ flex: 1 }}>Fixed-Price Contracts</Typography>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {fmt(data?.tier2?.total_mt, 0)} MT &nbsp;|&nbsp; {fmtVal(data?.tier2?.total_value)}
            </Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 0 }}>
          {data?.tier2?.rows?.length ? (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={headSx}>Commodity</TableCell>
                    <TableCell sx={headSx}>Contract #</TableCell>
                    <TableCell sx={headSx}>Buyer</TableCell>
                    <TableCell sx={headSx} align="right">Remaining (MT)</TableCell>
                    <TableCell sx={headSx} align="right">Price $/bu</TableCell>
                    <TableCell sx={headSx} align="right">Price $/MT</TableCell>
                    <TableCell sx={headSx} align="right">Value</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.tier2.rows.map(r => (
                    <TableRow key={r.contract_number} hover>
                      <TableCell sx={cellSx}>{r.commodity_name}</TableCell>
                      <TableCell sx={cellSx}>{r.contract_number}</TableCell>
                      <TableCell sx={cellSx}>{r.buyer}</TableCell>
                      <TableCell sx={cellSx} align="right">{fmt(r.remaining_mt, 0)}</TableCell>
                      <TableCell sx={cellSx} align="right">{fmtBu(r.price_per_bu)}</TableCell>
                      <TableCell sx={cellSx} align="right">{fmtMt(r.price_per_mt)}</TableCell>
                      <TableCell sx={{ ...cellSx, fontWeight: 600 }} align="right">{fmtVal(r.total_value)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell sx={totalSx} colSpan={3}>Total</TableCell>
                    <TableCell sx={totalSx} align="right">{fmt(data.tier2.total_mt, 0)}</TableCell>
                    <TableCell sx={totalSx} colSpan={2} />
                    <TableCell sx={totalSx} align="right">{fmtVal(data.tier2.total_value)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Typography color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>No fixed-price contracts</Typography>
          )}
        </AccordionDetails>
      </Accordion>

      {/* ─── Tier 3: Uncontracted Grain (Spot) ─── */}
      <Accordion defaultExpanded sx={{ mt: 1 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Stack direction="row" alignItems="center" spacing={2} sx={{ width: '100%', pr: 2 }}>
            <Box sx={{ width: 4, height: 24, bgcolor: TIER_COLORS.tier3, borderRadius: 1 }} />
            <Typography variant="h6" sx={{ flex: 1 }}>Uncontracted Grain (Spot)</Typography>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {fmt(data?.tier3?.total_mt, 0)} MT &nbsp;|&nbsp; {fmtVal(data?.tier3?.total_value)}
            </Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
            Spot prices net of 2% dockage. Click a Spot $/bu cell to update the price.
          </Typography>
          {data?.tier3?.rows?.length ? (
            <Box className={agTheme} sx={{ height: tier3Height, width: '100%', minWidth: 0 }}>
              <AgGridReact
                ref={gridRef}
                rowData={data.tier3.rows}
                columnDefs={tier3ColDefs}
                defaultColDef={{ sortable: true, resizable: true }}
                pinnedBottomRowData={tier3Pinned}
                animateRows
                getRowId={p => p.data?.commodity_code || 'total'}
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
            <Typography color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
              No uncontracted inventory data available.
            </Typography>
          ) : null}
        </AccordionDetails>
      </Accordion>

      <Snackbar open={snack.open} autoHideDuration={3000} onClose={() => setSnack(s => ({ ...s, open: false }))}>
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
