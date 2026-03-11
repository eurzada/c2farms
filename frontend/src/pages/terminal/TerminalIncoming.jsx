import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Typography, Button, Alert, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem, Checkbox, FormControlLabel } from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import AddIcon from '@mui/icons-material/Add';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';

const PRODUCTS = ['CWRS', 'CWAD', 'Canary', 'Flax', 'Barley', 'Lentils', 'Chickpeas', 'Peas'];

export default function TerminalIncoming() {
  const { currentFarm } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bins, setBins] = useState([]);
  const [form, setForm] = useState({
    ticket_date: new Date().toISOString().slice(0, 10),
    grower_name: '',
    product: '',
    weight_kg: '',
    fmo_number: '',
    buyer: '',
    bin_id: '',
    is_c2_farms: false,
    dockage_pct: '', moisture_pct: '', test_weight: '', protein_pct: '', hvk_pct: '',
  });

  const farmId = currentFarm?.id;

  const load = useCallback(async () => {
    if (!farmId) return;
    try {
      setLoading(true);
      const [ticketRes, binRes] = await Promise.all([
        api.get(`/api/farms/${farmId}/terminal/tickets`, { params: { direction: 'inbound', limit: 1000 } }),
        api.get(`/api/farms/${farmId}/terminal/bins`),
      ]);
      setRows(ticketRes.data.tickets || []);
      setBins(binRes.data || []);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load incoming tickets'));
    } finally {
      setLoading(false);
    }
  }, [farmId]);

  useEffect(() => { load(); }, [load]);

  const columnDefs = useMemo(() => [
    { field: 'ticket_date', headerName: 'Date', width: 110, valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString('en-CA') : '' },
    { field: 'grower_name', headerName: 'Grower', width: 200 },
    { field: 'product', headerName: 'Product', width: 100 },
    { field: 'weight_kg', headerName: 'KG', width: 100, type: 'numericColumn', valueFormatter: p => p.value?.toLocaleString('en-CA') },
    { field: 'ticket_number', headerName: 'Ticket#', width: 90, type: 'numericColumn' },
    { field: 'fmo_number', headerName: 'FMO#', width: 110 },
    { field: 'buyer', headerName: 'Buyer', width: 100 },
    { field: 'dockage_pct', headerName: 'Dock%', width: 80, type: 'numericColumn' },
    { field: 'moisture_pct', headerName: 'Moist%', width: 80, type: 'numericColumn' },
    { field: 'test_weight', headerName: 'TW', width: 70, type: 'numericColumn' },
    { field: 'protein_pct', headerName: 'Prot%', width: 80, type: 'numericColumn' },
    { field: 'hvk_pct', headerName: 'HVK%', width: 80, type: 'numericColumn' },
    { field: 'balance_after_kg', headerName: 'Balance', width: 110, type: 'numericColumn', valueFormatter: p => p.value?.toLocaleString('en-CA') },
    {
      field: 'status', headerName: 'Status', width: 90,
      cellRenderer: p => p.value === 'voided'
        ? <span style={{ color: 'red' }}>VOIDED</span>
        : <span style={{ color: 'green' }}>OK</span>,
    },
  ], []);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    filter: true,
    resizable: true,
  }), []);

  const handleSubmit = async () => {
    try {
      const payload = {
        direction: 'inbound',
        ticket_date: form.ticket_date,
        grower_name: form.grower_name,
        product: form.product,
        weight_kg: parseFloat(form.weight_kg),
        fmo_number: form.fmo_number || null,
        buyer: form.buyer || null,
        bin_id: form.bin_id || null,
        is_c2_farms: form.is_c2_farms,
        dockage_pct: form.dockage_pct ? parseFloat(form.dockage_pct) : null,
        moisture_pct: form.moisture_pct ? parseFloat(form.moisture_pct) : null,
        test_weight: form.test_weight ? parseFloat(form.test_weight) : null,
        protein_pct: form.protein_pct ? parseFloat(form.protein_pct) : null,
        hvk_pct: form.hvk_pct ? parseFloat(form.hvk_pct) : null,
      };
      await api.post(`/api/farms/${farmId}/terminal/tickets`, payload);
      setDialogOpen(false);
      setForm({ ticket_date: new Date().toISOString().slice(0, 10), grower_name: '', product: '', weight_kg: '', fmo_number: '', buyer: '', bin_id: '', is_c2_farms: false, dockage_pct: '', moisture_pct: '', test_weight: '', protein_pct: '', hvk_pct: '' });
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to create ticket'));
    }
  };

  const handleGrowerChange = (val) => {
    const isC2 = /c2\s*farms|2\s*century/i.test(val);
    setForm(f => ({ ...f, grower_name: val, is_c2_farms: isC2 }));
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={700}>Incoming Loads</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>New Ticket</Button>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 'calc(100vh - 260px)', width: '100%' }}>
        <AgGridReact
          ref={gridRef}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          getRowId={p => p.data.id}
          loading={loading}
        />
      </Box>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Incoming Ticket</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField label="Date" type="date" value={form.ticket_date} onChange={e => setForm(f => ({ ...f, ticket_date: e.target.value }))} InputLabelProps={{ shrink: true }} fullWidth />
          <TextField label="Grower" value={form.grower_name} onChange={e => handleGrowerChange(e.target.value)} fullWidth required />
          <FormControlLabel control={<Checkbox checked={form.is_c2_farms} onChange={e => setForm(f => ({ ...f, is_c2_farms: e.target.checked }))} />} label="C2 Farms load" />
          <TextField select label="Product" value={form.product} onChange={e => setForm(f => ({ ...f, product: e.target.value }))} fullWidth required>
            {PRODUCTS.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
          </TextField>
          <TextField label="Weight (KG)" type="number" value={form.weight_kg} onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))} fullWidth required />
          <TextField select label="Destination Bin" value={form.bin_id} onChange={e => setForm(f => ({ ...f, bin_id: e.target.value }))} fullWidth>
            <MenuItem value="">None</MenuItem>
            {bins.map(b => <MenuItem key={b.id} value={b.id}>{b.name} — {b.current_product_label || 'Empty'}</MenuItem>)}
          </TextField>
          <TextField label="FMO#" value={form.fmo_number} onChange={e => setForm(f => ({ ...f, fmo_number: e.target.value }))} fullWidth />
          <TextField label="Buyer" value={form.buyer} onChange={e => setForm(f => ({ ...f, buyer: e.target.value }))} fullWidth />
          <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1 }}>Quality / Grading</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5 }}>
            <TextField label="Dockage %" type="number" size="small" value={form.dockage_pct} onChange={e => setForm(f => ({ ...f, dockage_pct: e.target.value }))} />
            <TextField label="Moisture %" type="number" size="small" value={form.moisture_pct} onChange={e => setForm(f => ({ ...f, moisture_pct: e.target.value }))} />
            <TextField label="Test Weight" type="number" size="small" value={form.test_weight} onChange={e => setForm(f => ({ ...f, test_weight: e.target.value }))} />
            <TextField label="Protein %" type="number" size="small" value={form.protein_pct} onChange={e => setForm(f => ({ ...f, protein_pct: e.target.value }))} />
            <TextField label="HVK %" type="number" size="small" value={form.hvk_pct} onChange={e => setForm(f => ({ ...f, hvk_pct: e.target.value }))} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={!form.grower_name || !form.product || !form.weight_kg}>Create Ticket</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
