import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Box, Typography, Button, Alert, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, Paper, Chip,
} from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import AddIcon from '@mui/icons-material/Add';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';
import useGridState from '../../hooks/useGridState.js';

export default function TerminalBlending() {
  const { currentFarm } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bins, setBins] = useState([]);
  const [form, setForm] = useState({
    blend_date: new Date().toISOString().slice(0, 10),
    description: '', outbound_buyer: 'JGL',
    source_bin_id: '', source_bin_pct: '20',
    blend_bin_id: '', blend_bin_pct: '80',
    total_output_kg: '', rail_car_numbers_str: '', car_count: '', target_protein: '',
  });

  const { onGridReady, onStateChanged } = useGridState('c2_terminal_blending_grid');
  const farmId = currentFarm?.id;

  const load = useCallback(async () => {
    if (!farmId) return;
    try {
      setLoading(true);
      const [blendRes, binRes] = await Promise.all([
        api.get(`/api/farms/${farmId}/terminal/blends`, { params: { limit: 100 } }),
        api.get(`/api/farms/${farmId}/terminal/bins`),
      ]);
      setRows(blendRes.data.blendEvents || []);
      setBins(binRes.data || []);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load blend events'));
    } finally {
      setLoading(false);
    }
  }, [farmId]);

  useEffect(() => { load(); }, [load]);

  const columnDefs = useMemo(() => [
    { field: 'blend_date', headerName: 'Date', width: 110, valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString('en-CA') : '' },
    { field: 'description', headerName: 'Description', width: 280 },
    { field: 'outbound_buyer', headerName: 'Buyer', width: 80 },
    { field: 'car_count', headerName: 'Cars', width: 70, type: 'numericColumn' },
    { field: 'total_output_kg', headerName: 'Total KG', width: 110, type: 'numericColumn', valueFormatter: p => p.value?.toLocaleString('en-CA') },
    { field: 'source_bin_pct', headerName: 'Source %', width: 90, type: 'numericColumn', valueFormatter: p => `${p.value}%` },
    { field: 'source_bin_kg', headerName: 'Source KG', width: 100, type: 'numericColumn', valueFormatter: p => p.value?.toLocaleString('en-CA') },
    { field: 'blend_bin_pct', headerName: 'Blend %', width: 90, type: 'numericColumn', valueFormatter: p => `${p.value}%` },
    { field: 'blend_bin_kg', headerName: 'Blend KG', width: 100, type: 'numericColumn', valueFormatter: p => p.value?.toLocaleString('en-CA') },
    { field: 'target_protein', headerName: 'Target Prot%', width: 110, type: 'numericColumn' },
    {
      field: 'rail_car_numbers', headerName: 'Rail Cars', flex: 1, minWidth: 200,
      valueFormatter: p => Array.isArray(p.value) ? p.value.join(', ') : '',
    },
  ], []);

  const defaultColDef = useMemo(() => ({ sortable: true, filter: true, resizable: true }), []);

  const handlePctChange = (field, value) => {
    const pct = parseFloat(value) || 0;
    const otherField = field === 'source_bin_pct' ? 'blend_bin_pct' : 'source_bin_pct';
    setForm(f => ({ ...f, [field]: value, [otherField]: String(100 - pct) }));
  };

  const handleSubmit = async () => {
    try {
      const railCars = form.rail_car_numbers_str.split(/[,;\s]+/).filter(Boolean);
      const payload = {
        blend_date: form.blend_date,
        description: form.description,
        outbound_buyer: form.outbound_buyer,
        source_bin_id: form.source_bin_id,
        source_bin_pct: parseFloat(form.source_bin_pct),
        blend_bin_id: form.blend_bin_id,
        blend_bin_pct: parseFloat(form.blend_bin_pct),
        total_output_kg: parseFloat(form.total_output_kg),
        rail_car_numbers: railCars,
        car_count: parseInt(form.car_count) || railCars.length,
        target_protein: form.target_protein ? parseFloat(form.target_protein) : null,
      };
      await api.post(`/api/farms/${farmId}/terminal/blends`, payload);
      setDialogOpen(false);
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to create blend event'));
    }
  };

  const previewKg = () => {
    const total = parseFloat(form.total_output_kg) || 0;
    const sPct = parseFloat(form.source_bin_pct) || 0;
    const bPct = parseFloat(form.blend_bin_pct) || 0;
    return { source: Math.round(total * sPct / 100), blend: Math.round(total * bPct / 100) };
  };

  const preview = previewKg();

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={700}>Blending Events</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>New Blend</Button>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 'calc(100vh - 260px)', width: '100%' }}>
        <AgGridReact ref={gridRef} rowData={rows} columnDefs={columnDefs} defaultColDef={defaultColDef} animateRows getRowId={p => p.data.id} loading={loading} onGridReady={onGridReady} onColumnResized={onStateChanged} onColumnMoved={onStateChanged} onSortChanged={onStateChanged} onColumnVisible={onStateChanged} />
      </Box>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Blend Event</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField label="Date" type="date" value={form.blend_date} onChange={e => setForm(f => ({ ...f, blend_date: e.target.value }))} InputLabelProps={{ shrink: true }} fullWidth />
          <TextField label="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} fullWidth placeholder='e.g. "JGL - 4 Cars - Blend w/3 80%"' />
          <TextField label="Buyer" value={form.outbound_buyer} onChange={e => setForm(f => ({ ...f, outbound_buyer: e.target.value }))} fullWidth />
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <TextField select label="Source Bin (Hi Pro)" value={form.source_bin_id} onChange={e => setForm(f => ({ ...f, source_bin_id: e.target.value }))} fullWidth>
              {bins.map(b => <MenuItem key={b.id} value={b.id}>{b.name} — {b.current_product_label || 'Empty'}</MenuItem>)}
            </TextField>
            <TextField label="Source %" type="number" value={form.source_bin_pct} onChange={e => handlePctChange('source_bin_pct', e.target.value)} fullWidth />
            <TextField select label="Blend Bin (Lo Pro)" value={form.blend_bin_id} onChange={e => setForm(f => ({ ...f, blend_bin_id: e.target.value }))} fullWidth>
              {bins.map(b => <MenuItem key={b.id} value={b.id}>{b.name} — {b.current_product_label || 'Empty'}</MenuItem>)}
            </TextField>
            <TextField label="Blend %" type="number" value={form.blend_bin_pct} onChange={e => handlePctChange('blend_bin_pct', e.target.value)} fullWidth />
          </Box>
          <TextField label="Total Output KG" type="number" value={form.total_output_kg} onChange={e => setForm(f => ({ ...f, total_output_kg: e.target.value }))} fullWidth required />
          {form.total_output_kg && (
            <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', gap: 2 }}>
              <Chip label={`Source: ${preview.source.toLocaleString()} kg (${form.source_bin_pct}%)`} color="primary" size="small" />
              <Chip label={`Blend: ${preview.blend.toLocaleString()} kg (${form.blend_bin_pct}%)`} color="secondary" size="small" />
            </Paper>
          )}
          <TextField label="Rail Car #s (comma/space separated)" value={form.rail_car_numbers_str} onChange={e => setForm(f => ({ ...f, rail_car_numbers_str: e.target.value }))} fullWidth multiline rows={2} placeholder="CP651086, SOO122455, CP654324, DME51057" />
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <TextField label="Car Count" type="number" value={form.car_count} onChange={e => setForm(f => ({ ...f, car_count: e.target.value }))} />
            <TextField label="Target Protein %" type="number" value={form.target_protein} onChange={e => setForm(f => ({ ...f, target_protein: e.target.value }))} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={!form.source_bin_id || !form.blend_bin_id || !form.total_output_kg}>Create Blend</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
