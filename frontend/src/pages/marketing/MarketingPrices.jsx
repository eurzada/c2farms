import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Paper, Stack, TextField, Accordion, AccordionSummary, AccordionDetails,
  Chip, Snackbar, Alert,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import useGridState from '../../hooks/useGridState.js';

export default function MarketingPrices() {
  const { currentFarm, canEdit } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const { onGridReady, onStateChanged } = useGridState('c2_marketing_prices_grid');

  const [prices, setPrices] = useState([]);
  const [settings, setSettings] = useState(null);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'info' });

  // Hold-vs-sell inputs
  const [holdInputs, setHoldInputs] = useState({ quantity: 100, currentPrice: 14, futurePrice: 15, holdMonths: 3 });

  const fetchData = useCallback(() => {
    if (!currentFarm) return;
    Promise.all([
      api.get(`/api/farms/${currentFarm.id}/marketing/prices`),
      api.get(`/api/farms/${currentFarm.id}/marketing/settings`),
    ]).then(([pRes, sRes]) => {
      setPrices(pRes.data.prices || []);
      setSettings(sRes.data.settings || {});
    });
  }, [currentFarm]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCellEdit = useCallback(async (event) => {
    const { data, colDef, newValue } = event;
    if (!currentFarm || !canEdit) return;

    try {
      await api.put(`/api/farms/${currentFarm.id}/marketing/prices/${data.commodity_id}`, {
        [colDef.field]: newValue === '' ? null : parseFloat(newValue) || newValue,
      });
      setSnack({ open: true, message: `Updated ${data.commodity_name} ${colDef.headerName}`, severity: 'success' });
      fetchData();
    } catch (err) {
      console.error('Price update error:', err);
      setSnack({ open: true, message: 'Failed to update price', severity: 'error' });
    }
  }, [currentFarm, canEdit, fetchData]);

  const columnDefs = useMemo(() => [
    { field: 'commodity_name', headerName: 'Commodity', width: 140, pinned: 'left' },
    { field: 'commodity_code', headerName: 'Code', width: 80 },
    { field: 'bid_per_bu', headerName: 'Bid $/bu', width: 100, editable: canEdit, valueFormatter: p => p.value ? `$${p.value.toFixed(2)}` : '—' },
    { field: 'basis_per_bu', headerName: 'Basis $/bu', width: 110, editable: canEdit, valueFormatter: p => p.value != null ? `$${p.value.toFixed(2)}` : '—' },
    { field: 'futures_reference', headerName: 'Futures Ref', width: 130, editable: canEdit },
    { field: 'futures_close', headerName: 'Futures $', width: 100, editable: canEdit, valueFormatter: p => p.value ? `$${p.value.toFixed(2)}` : '—' },
    { field: 'cop_per_bu', headerName: 'COP $/bu', width: 100, editable: canEdit, valueFormatter: p => p.value ? `$${p.value.toFixed(2)}` : '—' },
    { field: 'target_price_bu', headerName: 'Target $/bu', width: 110, editable: canEdit, valueFormatter: p => p.value ? `$${p.value.toFixed(2)}` : '—' },
    {
      headerName: 'Margin $/bu', width: 110,
      valueGetter: p => {
        const bid = p.data.bid_per_bu;
        const cop = p.data.cop_per_bu;
        return bid && cop ? bid - cop : null;
      },
      valueFormatter: p => p.value != null ? `$${p.value.toFixed(2)}` : '—',
      cellStyle: p => p.value != null ? { color: p.value >= 0 ? '#2e7d32' : '#d32f2f', fontWeight: 600 } : {},
    },
    {
      field: 'outlook', headerName: 'Outlook', width: 110, editable: canEdit,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: ['bullish', 'sideways', 'bearish'] },
      cellRenderer: p => {
        const colors = { bullish: 'success', bearish: 'error', sideways: 'default' };
        return p.value ? <Chip label={p.value} size="small" color={colors[p.value] || 'default'} variant="outlined" /> : '—';
      },
    },
    { field: 'buyer_name', headerName: 'Source', width: 100, editable: canEdit },
    {
      headerName: 'Updated', width: 110,
      valueGetter: p => p.data.price_date ? new Date(p.data.price_date).toLocaleDateString('en-CA') : '—',
    },
  ], [canEdit]);

  const defaultColDef = useMemo(() => ({ sortable: true, resizable: true, filter: true }), []);

  // Carry cost calculations
  const locRate = settings?.loc_interest_rate || 0.0725;
  const storageCost = settings?.storage_cost_per_mt_month || 3.5;
  const avgGrainValue = 400;
  const monthlyLocCost = (avgGrainValue * locRate) / 12;
  const monthlyCarry = monthlyLocCost + storageCost;

  // Hold vs Sell
  const holdCost = monthlyCarry * holdInputs.holdMonths * holdInputs.quantity;
  const potentialGain = (holdInputs.futurePrice - holdInputs.currentPrice) * holdInputs.quantity * 36.7437; // rough $/bu to $/MT for canola
  const netBenefit = potentialGain - holdCost;

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 2 }}>Market Prices</Typography>

      {/* Price Grid */}
      <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 420, width: '100%', mb: 3 }}>
        <AgGridReact
          ref={gridRef}
          rowData={prices}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          getRowId={p => p.data?.commodity_id}
          onCellValueChanged={handleCellEdit}
          singleClickEdit
          stopEditingWhenCellsLoseFocus
          onGridReady={onGridReady}
          onColumnResized={onStateChanged}
          onColumnMoved={onStateChanged}
          onSortChanged={onStateChanged}
          onColumnVisible={onStateChanged}
        />
      </Box>

      {/* Cost of Carry Calculator */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">Cost of Carry Calculator</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack direction="row" spacing={3}>
            <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle2" gutterBottom>LOC Interest</Typography>
              <Typography variant="body2">Rate: {(locRate * 100).toFixed(2)}%</Typography>
              <Typography variant="body2">Avg grain value: ${avgGrainValue}/MT</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>Monthly LOC cost: ${monthlyLocCost.toFixed(2)}/MT</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle2" gutterBottom>Storage</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>${storageCost.toFixed(2)}/MT/month</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle2" gutterBottom>Total Carry</Typography>
              <Typography variant="h5" sx={{ fontWeight: 600 }}>${monthlyCarry.toFixed(2)}/MT/month</Typography>
            </Paper>
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* Hold vs Sell */}
      <Accordion sx={{ mt: 1 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">Hold vs Sell Framework</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <TextField label="Quantity (MT)" type="number" value={holdInputs.quantity} size="small"
              onChange={e => setHoldInputs(h => ({ ...h, quantity: parseFloat(e.target.value) || 0 }))} />
            <TextField label="Current $/bu" type="number" value={holdInputs.currentPrice} size="small"
              onChange={e => setHoldInputs(h => ({ ...h, currentPrice: parseFloat(e.target.value) || 0 }))} />
            <TextField label="Expected Future $/bu" type="number" value={holdInputs.futurePrice} size="small"
              onChange={e => setHoldInputs(h => ({ ...h, futurePrice: parseFloat(e.target.value) || 0 }))} />
            <TextField label="Hold Months" type="number" value={holdInputs.holdMonths} size="small"
              onChange={e => setHoldInputs(h => ({ ...h, holdMonths: parseInt(e.target.value) || 0 }))} />
          </Stack>
          <Stack direction="row" spacing={3}>
            <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle2">Hold Cost</Typography>
              <Typography variant="h6" color="error.main">${holdCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle2">Potential Gain</Typography>
              <Typography variant="h6" color="success.main">${potentialGain.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle2">Net Benefit</Typography>
              <Typography variant="h6" sx={{ color: netBenefit >= 0 ? 'success.main' : 'error.main', fontWeight: 600 }}>
                ${netBenefit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </Typography>
              <Chip label={netBenefit >= 0 ? 'HOLD' : 'SELL'} size="small" color={netBenefit >= 0 ? 'success' : 'error'} />
            </Paper>
          </Stack>
        </AccordionDetails>
      </Accordion>

      <Snackbar open={snack.open} autoHideDuration={3000} onClose={() => setSnack(s => ({ ...s, open: false }))}>
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
