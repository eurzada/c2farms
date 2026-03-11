import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Box, Typography, Button, Alert, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, Chip, Paper, Grid, ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { formatCurrency } from '../../utils/formatting';

const PAYMENT_COLORS = { pending: 'warning', paid: 'success', received: 'success' };

export default function TerminalSettlements() {
  const { currentFarm } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [payDialog, setPayDialog] = useState(null);
  const [filter, setFilter] = useState('all');
  const [counterparties, setCounterparties] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [form, setForm] = useState({
    settlement_number: '', direction: 'payable', counterparty_id: '', contract_id: '',
    settlement_date: new Date().toISOString().slice(0, 10), gross_amount: '',
    deductions: '', net_amount: '', settled_mt: '', notes: '',
  });
  const [payForm, setPayForm] = useState({
    payment_date: new Date().toISOString().slice(0, 10), payment_reference: '',
  });

  const farmId = currentFarm?.id;

  const load = useCallback(async () => {
    if (!farmId) return;
    try {
      setLoading(true);
      const params = filter !== 'all' ? { direction: filter } : {};
      const [stlRes, sumRes, cpRes, ctRes] = await Promise.all([
        api.get(`/api/farms/${farmId}/terminal/settlements`, { params: { ...params, limit: 500 } }),
        api.get(`/api/farms/${farmId}/terminal/settlements/summary`),
        api.get(`/api/farms/${farmId}/terminal/counterparties`),
        api.get(`/api/farms/${farmId}/terminal/contracts`, { params: { limit: 500 } }),
      ]);
      setRows(stlRes.data.settlements || []);
      setSummary(sumRes.data);
      setCounterparties(cpRes.data.counterparties || []);
      setContracts(ctRes.data.contracts || []);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load settlements'));
    } finally {
      setLoading(false);
    }
  }, [farmId, filter]);

  useEffect(() => { load(); }, [load]);

  const columnDefs = useMemo(() => [
    { field: 'settlement_number', headerName: 'Settlement #', width: 140 },
    {
      field: 'direction', headerName: 'Type', width: 100,
      cellRenderer: p => (
        <Chip
          label={p.value === 'payable' ? 'Payable' : 'Receivable'}
          size="small"
          color={p.value === 'payable' ? 'error' : 'success'}
          variant="outlined"
        />
      ),
    },
    { field: 'counterparty.name', headerName: 'Counterparty', width: 180 },
    { field: 'contract.contract_number', headerName: 'Contract #', width: 140 },
    { field: 'settlement_date', headerName: 'Date', width: 110, valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString('en-CA') : '' },
    { field: 'gross_amount', headerName: 'Gross', width: 120, type: 'numericColumn', valueFormatter: p => formatCurrency(p.value) },
    {
      headerName: 'Deductions', width: 120, type: 'numericColumn',
      valueGetter: p => {
        const d = p.data.deductions;
        if (!d) return 0;
        if (typeof d === 'number') return d;
        if (typeof d === 'object') return Object.values(d).reduce((s, v) => s + (parseFloat(v) || 0), 0);
        return 0;
      },
      valueFormatter: p => p.value ? formatCurrency(p.value) : '',
    },
    { field: 'net_amount', headerName: 'Net', width: 130, type: 'numericColumn', valueFormatter: p => formatCurrency(p.value), cellStyle: { fontWeight: 700 } },
    {
      field: 'payment_status', headerName: 'Payment', width: 110,
      cellRenderer: p => <Chip label={p.value} size="small" color={PAYMENT_COLORS[p.value] || 'default'} />,
    },
    { field: 'payment_date', headerName: 'Paid Date', width: 110, valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString('en-CA') : '' },
    { field: 'payment_reference', headerName: 'Ref#', width: 120 },
    {
      headerName: '', width: 80,
      cellRenderer: p => {
        if (p.data.payment_status !== 'pending') return null;
        return (
          <Button size="small" color="success" startIcon={<CheckCircleIcon />} onClick={() => setPayDialog(p.data)}>
            Pay
          </Button>
        );
      },
    },
  ], []);

  const defaultColDef = useMemo(() => ({ sortable: true, filter: true, resizable: true }), []);

  const handleDeductionChange = (val) => {
    const gross = parseFloat(form.gross_amount) || 0;
    const ded = parseFloat(val) || 0;
    setForm(f => ({ ...f, deductions: val, net_amount: String(gross - ded) }));
  };

  const handleGrossChange = (val) => {
    const gross = parseFloat(val) || 0;
    const ded = parseFloat(form.deductions) || 0;
    setForm(f => ({ ...f, gross_amount: val, net_amount: String(gross - ded) }));
  };

  const handleSubmit = async () => {
    try {
      const dedAmount = parseFloat(form.deductions) || 0;
      await api.post(`/api/farms/${farmId}/terminal/settlements`, {
        ...form,
        gross_amount: parseFloat(form.gross_amount),
        deductions: dedAmount ? { total: dedAmount } : null,
        net_amount: parseFloat(form.net_amount),
        settled_mt: form.settled_mt ? parseFloat(form.settled_mt) : null,
        contract_id: form.contract_id || null,
      });
      setDialogOpen(false);
      setForm({ settlement_number: '', direction: 'payable', counterparty_id: '', contract_id: '', settlement_date: new Date().toISOString().slice(0, 10), gross_amount: '', deductions: '', net_amount: '', settled_mt: '', notes: '' });
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to create settlement'));
    }
  };

  const handlePay = async () => {
    try {
      await api.post(`/api/farms/${farmId}/terminal/settlements/${payDialog.id}/pay`, payForm);
      setPayDialog(null);
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to mark as paid'));
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={700}>Terminal Settlements</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <ToggleButtonGroup size="small" value={filter} exclusive onChange={(_, v) => v && setFilter(v)}>
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="payable">Payable</ToggleButton>
            <ToggleButton value="receivable">Receivable</ToggleButton>
          </ToggleButtonGroup>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>New Settlement</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {summary && (
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle2" color="error">Payable (to growers)</Typography>
              <Typography variant="h6" fontWeight={700}>{formatCurrency(summary.payable.total)}</Typography>
              <Typography variant="body2">Pending: {formatCurrency(summary.payable.pending)} | Paid: {formatCurrency(summary.payable.paid)} | {summary.payable.count} settlements</Typography>
            </Paper>
          </Grid>
          <Grid item xs={12} sm={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle2" color="success.main">Receivable (from buyers)</Typography>
              <Typography variant="h6" fontWeight={700}>{formatCurrency(summary.receivable.total)}</Typography>
              <Typography variant="body2">Pending: {formatCurrency(summary.receivable.pending)} | Received: {formatCurrency(summary.receivable.received)} | {summary.receivable.count} settlements</Typography>
            </Paper>
          </Grid>
        </Grid>
      )}

      <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 'calc(100vh - 360px)', width: '100%' }}>
        <AgGridReact ref={gridRef} rowData={rows} columnDefs={columnDefs} defaultColDef={defaultColDef} animateRows getRowId={p => p.data.id} loading={loading} />
      </Box>

      {/* New Settlement Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Settlement</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField label="Settlement #" value={form.settlement_number} onChange={e => setForm(f => ({ ...f, settlement_number: e.target.value }))} fullWidth required />
          <TextField select label="Direction" value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))} fullWidth>
            <MenuItem value="payable">Payable (to grower)</MenuItem>
            <MenuItem value="receivable">Receivable (from buyer)</MenuItem>
          </TextField>
          <TextField select label="Counterparty" value={form.counterparty_id} onChange={e => setForm(f => ({ ...f, counterparty_id: e.target.value }))} fullWidth required>
            {counterparties.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
          <TextField select label="Contract (optional)" value={form.contract_id} onChange={e => setForm(f => ({ ...f, contract_id: e.target.value }))} fullWidth>
            <MenuItem value="">None</MenuItem>
            {contracts.map(c => <MenuItem key={c.id} value={c.id}>{c.contract_number} — {c.counterparty?.name} ({c.remaining_mt?.toFixed(0)} MT remaining)</MenuItem>)}
          </TextField>
          <TextField label="Settlement Date" type="date" value={form.settlement_date} onChange={e => setForm(f => ({ ...f, settlement_date: e.target.value }))} InputLabelProps={{ shrink: true }} fullWidth />
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5 }}>
            <TextField label="Gross $" type="number" value={form.gross_amount} onChange={e => handleGrossChange(e.target.value)} required />
            <TextField label="Deductions $" type="number" value={form.deductions} onChange={e => handleDeductionChange(e.target.value)} />
            <TextField label="Net $" type="number" value={form.net_amount} onChange={e => setForm(f => ({ ...f, net_amount: e.target.value }))} InputProps={{ readOnly: true }} />
          </Box>
          <TextField label="Settled MT (updates contract)" type="number" value={form.settled_mt} onChange={e => setForm(f => ({ ...f, settled_mt: e.target.value }))} fullWidth />
          <TextField label="Notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} fullWidth multiline rows={2} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={!form.settlement_number || !form.counterparty_id || !form.gross_amount}>Create</Button>
        </DialogActions>
      </Dialog>

      {/* Mark as Paid Dialog */}
      <Dialog open={!!payDialog} onClose={() => setPayDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Mark Settlement as {payDialog?.direction === 'payable' ? 'Paid' : 'Received'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {payDialog?.settlement_number} — {formatCurrency(payDialog?.net_amount)}
          </Typography>
          <TextField label="Payment Date" type="date" value={payForm.payment_date} onChange={e => setPayForm(f => ({ ...f, payment_date: e.target.value }))} InputLabelProps={{ shrink: true }} fullWidth />
          <TextField label="Payment Reference / Cheque #" value={payForm.payment_reference} onChange={e => setPayForm(f => ({ ...f, payment_reference: e.target.value }))} fullWidth />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPayDialog(null)}>Cancel</Button>
          <Button variant="contained" color="success" onClick={handlePay}>Confirm Payment</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
