import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Typography, Button, Alert, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem } from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import AddIcon from '@mui/icons-material/Add';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';

const PRODUCTS = ['CWRS', 'CWAD', 'Canary', 'Flax', 'Barley', 'Lentils'];
const SAMPLE_TYPES = ['Onsite', 'Shipped', 'LIT Graded'];

export default function TerminalOutgoing() {
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
    product: '', rail_car_number: '', vehicle_id: '', fmo_number: '',
    outbound_kg: '', sold_to: 'JGL', seal_numbers: '', bin_id: '',
    sample_type: '', sample_inspector: 'Cotecna',
  });

  const farmId = currentFarm?.id;

  const load = useCallback(async () => {
    if (!farmId) return;
    try {
      setLoading(true);
      const [ticketRes, binRes] = await Promise.all([
        api.get(`/api/farms/${farmId}/terminal/tickets`, { params: { direction: 'outbound', limit: 1000 } }),
        api.get(`/api/farms/${farmId}/terminal/bins`),
      ]);
      setRows(ticketRes.data.tickets || []);
      setBins(binRes.data || []);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load outgoing tickets'));
    } finally {
      setLoading(false);
    }
  }, [farmId]);

  useEffect(() => { load(); }, [load]);

  const columnDefs = useMemo(() => [
    { field: 'ticket_date', headerName: 'Date', width: 110, valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString('en-CA') : '' },
    { field: 'product', headerName: 'Crop', width: 100 },
    { field: 'rail_car_number', headerName: 'Rail Car #', width: 130 },
    { field: 'ticket_number', headerName: 'Ticket#', width: 90, type: 'numericColumn' },
    { field: 'fmo_number', headerName: 'FMO#', width: 110 },
    { field: 'outbound_kg', headerName: 'KG', width: 100, type: 'numericColumn', valueFormatter: p => p.value?.toLocaleString('en-CA') },
    { field: 'sold_to', headerName: 'Sold to', width: 100 },
    { field: 'seal_numbers', headerName: 'Seal #s', width: 250 },
    {
      headerName: 'Sample', width: 100,
      valueGetter: p => p.data.samples?.[0]?.sample_type || '',
    },
    {
      headerName: 'Sample By', width: 100,
      valueGetter: p => p.data.samples?.[0]?.inspector || '',
    },
    { field: 'balance_after_kg', headerName: 'Balance', width: 110, type: 'numericColumn', valueFormatter: p => p.value?.toLocaleString('en-CA') },
    {
      field: 'status', headerName: 'Status', width: 90,
      cellRenderer: p => p.value === 'voided'
        ? <span style={{ color: 'red' }}>VOIDED</span>
        : <span style={{ color: 'green' }}>OK</span>,
    },
  ], []);

  const defaultColDef = useMemo(() => ({
    sortable: true, filter: true, resizable: true,
  }), []);

  const handleSubmit = async () => {
    try {
      const payload = {
        direction: 'outbound',
        ticket_date: form.ticket_date,
        product: form.product,
        rail_car_number: form.rail_car_number || null,
        vehicle_id: form.vehicle_id || null,
        fmo_number: form.fmo_number || null,
        outbound_kg: parseFloat(form.outbound_kg),
        weight_kg: parseFloat(form.outbound_kg),
        sold_to: form.sold_to || null,
        seal_numbers: form.seal_numbers || null,
        bin_id: form.bin_id || null,
        is_c2_farms: false,
      };
      const res = await api.post(`/api/farms/${farmId}/terminal/tickets`, payload);
      if (form.sample_type && res.data?.id) {
        await api.post(`/api/farms/${farmId}/terminal/tickets/${res.data.id}/samples`, {
          inspector: form.sample_inspector,
          sample_type: form.sample_type.toLowerCase().replace(' ', '_'),
        });
      }
      setDialogOpen(false);
      setForm({ ticket_date: new Date().toISOString().slice(0, 10), product: '', rail_car_number: '', vehicle_id: '', fmo_number: '', outbound_kg: '', sold_to: 'JGL', seal_numbers: '', bin_id: '', sample_type: '', sample_inspector: 'Cotecna' });
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to create outbound ticket'));
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={700}>Outgoing Loads & Cars</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>New Outbound</Button>
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
        <DialogTitle>New Outbound Shipment</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField label="Date" type="date" value={form.ticket_date} onChange={e => setForm(f => ({ ...f, ticket_date: e.target.value }))} InputLabelProps={{ shrink: true }} fullWidth />
          <TextField select label="Crop" value={form.product} onChange={e => setForm(f => ({ ...f, product: e.target.value }))} fullWidth required>
            {PRODUCTS.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
          </TextField>
          <TextField label="Rail Car #" value={form.rail_car_number} onChange={e => setForm(f => ({ ...f, rail_car_number: e.target.value }))} fullWidth placeholder="e.g. SOO115778" />
          <TextField label="Truck/Loader Ticket #" value={form.vehicle_id} onChange={e => setForm(f => ({ ...f, vehicle_id: e.target.value }))} fullWidth />
          <TextField label="FMO#" value={form.fmo_number} onChange={e => setForm(f => ({ ...f, fmo_number: e.target.value }))} fullWidth />
          <TextField label="KG" type="number" value={form.outbound_kg} onChange={e => setForm(f => ({ ...f, outbound_kg: e.target.value }))} fullWidth required />
          <TextField select label="Source Bin" value={form.bin_id} onChange={e => setForm(f => ({ ...f, bin_id: e.target.value }))} fullWidth>
            <MenuItem value="">None</MenuItem>
            {bins.map(b => <MenuItem key={b.id} value={b.id}>{b.name} — {b.current_product_label || 'Empty'} ({b.balance_kg?.toLocaleString()} kg)</MenuItem>)}
          </TextField>
          <TextField label="Sold to" value={form.sold_to} onChange={e => setForm(f => ({ ...f, sold_to: e.target.value }))} fullWidth />
          <TextField label="Seal #s" value={form.seal_numbers} onChange={e => setForm(f => ({ ...f, seal_numbers: e.target.value }))} fullWidth placeholder="e.g. 1803097;98;99;00" />
          <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1 }}>Sample Info</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <TextField select label="Sample Type" size="small" value={form.sample_type} onChange={e => setForm(f => ({ ...f, sample_type: e.target.value }))}>
              <MenuItem value="">None</MenuItem>
              {SAMPLE_TYPES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
            <TextField label="Inspector" size="small" value={form.sample_inspector} onChange={e => setForm(f => ({ ...f, sample_inspector: e.target.value }))} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={!form.product || !form.outbound_kg}>Create</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
