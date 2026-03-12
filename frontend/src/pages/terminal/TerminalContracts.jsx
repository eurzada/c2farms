import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Box, Typography, Button, Alert, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, Chip, Paper, Grid, ToggleButton, ToggleButtonGroup,
  IconButton, InputAdornment,
} from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import AddIcon from '@mui/icons-material/Add';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import { useFarm } from '../../contexts/FarmContext';
import TerminalContractImportDialog from '../../components/terminal/TerminalContractImportDialog';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { formatCurrency } from '../../utils/formatting';

const STATUS_COLORS = {
  executed: 'info',
  in_delivery: 'warning',
  fulfilled: 'success',
  settled: 'default',
  cancelled: 'error',
};

export default function TerminalContracts() {
  const { currentFarm } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [counterparties, setCounterparties] = useState([]);
  const [commodities, setCommodities] = useState([]);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [form, setForm] = useState({
    contract_number: '', direction: 'purchase', counterparty_id: '', commodity_id: '',
    contracted_mt: '', price_per_mt: '', ship_mode: 'truck', delivery_point: '',
    start_date: '', end_date: '', notes: '',
  });

  // Edit contract state
  const [editContract, setEditContract] = useState(null);
  const [editForm, setEditForm] = useState({
    contract_number: '', direction: 'purchase', counterparty_id: '', commodity_id: '',
    contracted_mt: '', price_per_mt: '', ship_mode: 'truck', delivery_point: '',
    start_date: '', end_date: '', notes: '',
    grade_prices_json: [],
    blend_requirement_json: [],
  });

  const farmId = currentFarm?.id;

  const load = useCallback(async () => {
    if (!farmId) return;
    try {
      setLoading(true);
      const params = filter !== 'all' ? { direction: filter } : {};
      const [contractRes, summaryRes, cpRes, comRes] = await Promise.all([
        api.get(`/api/farms/${farmId}/terminal/contracts`, { params: { ...params, limit: 500 } }),
        api.get(`/api/farms/${farmId}/terminal/contracts/summary`),
        api.get(`/api/farms/${farmId}/terminal/counterparties`),
        api.get(`/api/farms/${farmId}/terminal/commodities`),
      ]);
      setRows(contractRes.data.contracts || []);
      setSummary(summaryRes.data);
      setCounterparties(cpRes.data.counterparties || []);
      setCommodities(comRes.data.commodities || []);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load contracts'));
    } finally {
      setLoading(false);
    }
  }, [farmId, filter]);

  useEffect(() => { load(); }, [load]);

  const columnDefs = useMemo(() => [
    { field: 'contract_number', headerName: 'Contract #', width: 140 },
    {
      field: 'direction', headerName: 'Type', width: 100,
      cellRenderer: p => (
        <Chip
          label={p.value === 'purchase' ? 'Purchase' : 'Sale'}
          size="small"
          color={p.value === 'purchase' ? 'primary' : 'secondary'}
          variant="outlined"
        />
      ),
    },
    { field: 'counterparty.name', headerName: 'Counterparty', width: 180 },
    { field: 'commodity.name', headerName: 'Commodity', width: 120 },
    { field: 'contracted_mt', headerName: 'Contracted MT', width: 130, type: 'numericColumn', valueFormatter: p => p.value?.toLocaleString('en-CA', { maximumFractionDigits: 1 }) },
    { field: 'delivered_mt', headerName: 'Delivered MT', width: 120, type: 'numericColumn', valueFormatter: p => p.value?.toLocaleString('en-CA', { maximumFractionDigits: 1 }) },
    { field: 'remaining_mt', headerName: 'Remaining MT', width: 130, type: 'numericColumn', valueFormatter: p => p.value?.toLocaleString('en-CA', { maximumFractionDigits: 1 }) },
    { field: 'price_per_mt', headerName: '$/MT', width: 100, type: 'numericColumn', valueFormatter: p => p.value ? formatCurrency(p.value) : '' },
    { field: 'ship_mode', headerName: 'Mode', width: 80 },
    { field: 'delivery_point', headerName: 'Delivery Point', width: 140 },
    {
      field: 'status', headerName: 'Status', width: 120,
      cellRenderer: p => <Chip label={p.value} size="small" color={STATUS_COLORS[p.value] || 'default'} />,
    },
    {
      headerName: 'Blend', width: 100,
      valueGetter: p => {
        const gp = p.data.grade_prices_json;
        if (!gp) return null;
        try {
          const arr = typeof gp === 'string' ? JSON.parse(gp) : gp;
          return Array.isArray(arr) && arr.length > 0 ? 'set' : null;
        } catch { return null; }
      },
      cellRenderer: p => p.value === 'set'
        ? <Chip label="Blend Set" size="small" color="success" variant="outlined" sx={{ fontSize: 11 }} />
        : null,
    },
    { field: '_count.settlements', headerName: 'Stl#', width: 60, type: 'numericColumn' },
  ], []);

  const defaultColDef = useMemo(() => ({ sortable: true, filter: true, resizable: true }), []);

  const handleSubmit = async () => {
    try {
      await api.post(`/api/farms/${farmId}/terminal/contracts`, {
        ...form,
        contracted_mt: parseFloat(form.contracted_mt),
        price_per_mt: form.price_per_mt ? parseFloat(form.price_per_mt) : null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      });
      setDialogOpen(false);
      setForm({ contract_number: '', direction: 'purchase', counterparty_id: '', commodity_id: '', contracted_mt: '', price_per_mt: '', ship_mode: 'truck', delivery_point: '', start_date: '', end_date: '', notes: '' });
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to create contract'));
    }
  };

  const openEditDialog = (contract) => {
    const parseJsonArray = (val) => {
      if (!val) return [];
      try {
        const arr = typeof val === 'string' ? JSON.parse(val) : val;
        return Array.isArray(arr) ? arr : [];
      } catch { return []; }
    };
    setEditContract(contract);
    setEditForm({
      contract_number: contract.contract_number || '',
      direction: contract.direction || 'purchase',
      counterparty_id: contract.counterparty_id || '',
      commodity_id: contract.commodity_id || '',
      contracted_mt: contract.contracted_mt != null ? String(contract.contracted_mt) : '',
      price_per_mt: contract.price_per_mt != null ? String(contract.price_per_mt) : '',
      ship_mode: contract.ship_mode || 'truck',
      delivery_point: contract.delivery_point || '',
      start_date: contract.start_date ? contract.start_date.slice(0, 10) : '',
      end_date: contract.end_date ? contract.end_date.slice(0, 10) : '',
      notes: contract.notes || '',
      grade_prices_json: parseJsonArray(contract.grade_prices_json),
      blend_requirement_json: parseJsonArray(contract.blend_requirement_json),
    });
  };

  const handleEditSubmit = async () => {
    if (!editContract) return;
    try {
      const gradeP = editForm.grade_prices_json
        .filter(r => r.grade?.trim() && r.price_per_mt != null && r.price_per_mt !== '')
        .map(r => ({ grade: r.grade.trim(), price_per_mt: parseFloat(r.price_per_mt) }));
      const blendR = editForm.blend_requirement_json
        .filter(r => r.grade?.trim() && r.mt != null && r.mt !== '')
        .map(r => ({ grade: r.grade.trim(), mt: parseFloat(r.mt) }));

      await api.put(`/api/farms/${farmId}/terminal/contracts/${editContract.id}`, {
        contract_number: editForm.contract_number,
        direction: editForm.direction,
        counterparty_id: editForm.counterparty_id,
        commodity_id: editForm.commodity_id,
        contracted_mt: parseFloat(editForm.contracted_mt),
        price_per_mt: editForm.price_per_mt ? parseFloat(editForm.price_per_mt) : null,
        ship_mode: editForm.ship_mode,
        delivery_point: editForm.delivery_point,
        start_date: editForm.start_date || null,
        end_date: editForm.end_date || null,
        notes: editForm.notes,
        grade_prices_json: gradeP.length ? gradeP : null,
        blend_requirement_json: blendR.length ? blendR : null,
      });
      setEditContract(null);
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to update contract'));
    }
  };

  const fmtMt = v => v != null ? `${v.toLocaleString('en-CA', { maximumFractionDigits: 1 })} MT` : '—';

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={700}>Terminal Contracts</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <ToggleButtonGroup size="small" value={filter} exclusive onChange={(_, v) => v && setFilter(v)}>
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="purchase">Purchase</ToggleButton>
            <ToggleButton value="sale">Sale</ToggleButton>
          </ToggleButtonGroup>
          <Button variant="outlined" startIcon={<CloudUploadIcon />} onClick={() => setImportDialogOpen(true)}>Import Contract</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>New Contract</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {summary && (
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle2" color="primary">Purchase Contracts</Typography>
              <Typography variant="h6" fontWeight={700}>{summary.purchase.count} contracts</Typography>
              <Typography variant="body2">Contracted: {fmtMt(summary.purchase.total_contracted_mt)} | Delivered: {fmtMt(summary.purchase.total_delivered_mt)} | Remaining: {fmtMt(summary.purchase.total_remaining_mt)}</Typography>
            </Paper>
          </Grid>
          <Grid item xs={12} sm={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle2" color="secondary">Sale Contracts</Typography>
              <Typography variant="h6" fontWeight={700}>{summary.sale.count} contracts</Typography>
              <Typography variant="body2">Contracted: {fmtMt(summary.sale.total_contracted_mt)} | Delivered: {fmtMt(summary.sale.total_delivered_mt)} | Remaining: {fmtMt(summary.sale.total_remaining_mt)}</Typography>
            </Paper>
          </Grid>
        </Grid>
      )}

      <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 'calc(100vh - 360px)', width: '100%' }}>
        <AgGridReact
          ref={gridRef}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          getRowId={p => p.data.id}
          loading={loading}
          onRowDoubleClicked={p => openEditDialog(p.data)}
        />
      </Box>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Contract</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField label="Contract #" value={form.contract_number} onChange={e => setForm(f => ({ ...f, contract_number: e.target.value }))} fullWidth required />
          <TextField select label="Direction" value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))} fullWidth>
            <MenuItem value="purchase">Purchase (from grower)</MenuItem>
            <MenuItem value="sale">Sale (to buyer)</MenuItem>
          </TextField>
          <TextField select label="Counterparty" value={form.counterparty_id} onChange={e => setForm(f => ({ ...f, counterparty_id: e.target.value }))} fullWidth required>
            {counterparties.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
          <TextField select label="Commodity" value={form.commodity_id} onChange={e => setForm(f => ({ ...f, commodity_id: e.target.value }))} fullWidth required>
            {commodities.map(c => <MenuItem key={c.id} value={c.id}>{c.name} ({c.code})</MenuItem>)}
          </TextField>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <TextField label="Contracted MT" type="number" value={form.contracted_mt} onChange={e => setForm(f => ({ ...f, contracted_mt: e.target.value }))} required />
            <TextField label="Price $/MT" type="number" value={form.price_per_mt} onChange={e => setForm(f => ({ ...f, price_per_mt: e.target.value }))} />
          </Box>
          <TextField select label="Ship Mode" value={form.ship_mode} onChange={e => setForm(f => ({ ...f, ship_mode: e.target.value }))} fullWidth>
            <MenuItem value="truck">Truck</MenuItem>
            <MenuItem value="rail">Rail</MenuItem>
          </TextField>
          <TextField label="Delivery Point" value={form.delivery_point} onChange={e => setForm(f => ({ ...f, delivery_point: e.target.value }))} fullWidth />
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <TextField label="Start Date" type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} InputLabelProps={{ shrink: true }} />
            <TextField label="End Date" type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} InputLabelProps={{ shrink: true }} />
          </Box>
          <TextField label="Notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} fullWidth multiline rows={2} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={!form.contract_number || !form.counterparty_id || !form.commodity_id || !form.contracted_mt}>Create</Button>
        </DialogActions>
      </Dialog>

      {/* Edit Contract Dialog */}
      <Dialog open={!!editContract} onClose={() => setEditContract(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Contract</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField label="Contract #" value={editForm.contract_number} onChange={e => setEditForm(f => ({ ...f, contract_number: e.target.value }))} fullWidth required />
          <TextField select label="Direction" value={editForm.direction} onChange={e => setEditForm(f => ({ ...f, direction: e.target.value }))} fullWidth>
            <MenuItem value="purchase">Purchase (from grower)</MenuItem>
            <MenuItem value="sale">Sale (to buyer)</MenuItem>
          </TextField>
          <TextField select label="Counterparty" value={editForm.counterparty_id} onChange={e => setEditForm(f => ({ ...f, counterparty_id: e.target.value }))} fullWidth required>
            {counterparties.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
          <TextField select label="Commodity" value={editForm.commodity_id} onChange={e => setEditForm(f => ({ ...f, commodity_id: e.target.value }))} fullWidth required>
            {commodities.map(c => <MenuItem key={c.id} value={c.id}>{c.name} ({c.code})</MenuItem>)}
          </TextField>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <TextField label="Contracted MT" type="number" value={editForm.contracted_mt} onChange={e => setEditForm(f => ({ ...f, contracted_mt: e.target.value }))} required />
            <TextField label="Price $/MT" type="number" value={editForm.price_per_mt} onChange={e => setEditForm(f => ({ ...f, price_per_mt: e.target.value }))} />
          </Box>
          <TextField select label="Ship Mode" value={editForm.ship_mode} onChange={e => setEditForm(f => ({ ...f, ship_mode: e.target.value }))} fullWidth>
            <MenuItem value="truck">Truck</MenuItem>
            <MenuItem value="rail">Rail</MenuItem>
          </TextField>
          <TextField label="Delivery Point" value={editForm.delivery_point} onChange={e => setEditForm(f => ({ ...f, delivery_point: e.target.value }))} fullWidth />
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <TextField label="Start Date" type="date" value={editForm.start_date} onChange={e => setEditForm(f => ({ ...f, start_date: e.target.value }))} InputLabelProps={{ shrink: true }} />
            <TextField label="End Date" type="date" value={editForm.end_date} onChange={e => setEditForm(f => ({ ...f, end_date: e.target.value }))} InputLabelProps={{ shrink: true }} />
          </Box>
          <TextField label="Notes" value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} fullWidth multiline rows={2} />

          {/* Grade Prices */}
          <Typography variant="subtitle2" sx={{ mt: 1 }}>Grade Prices</Typography>
          {editForm.grade_prices_json.map((row, idx) => (
            <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField size="small" label="Grade" value={row.grade || ''}
                onChange={e => setEditForm(f => ({ ...f, grade_prices_json: f.grade_prices_json.map((r, i) => i === idx ? { ...r, grade: e.target.value } : r) }))}
                sx={{ width: 140 }} />
              <TextField size="small" label="$/MT" type="number" value={row.price_per_mt ?? ''}
                onChange={e => setEditForm(f => ({ ...f, grade_prices_json: f.grade_prices_json.map((r, i) => i === idx ? { ...r, price_per_mt: e.target.value } : r) }))}
                sx={{ width: 100 }}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }} />
              <IconButton size="small" onClick={() => setEditForm(f => ({ ...f, grade_prices_json: f.grade_prices_json.filter((_, i) => i !== idx) }))}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
          <Button size="small" startIcon={<AddIcon />} onClick={() => setEditForm(f => ({ ...f, grade_prices_json: [...f.grade_prices_json, { grade: '', price_per_mt: '' }] }))}>
            Add grade price
          </Button>

          {/* Blend Requirement */}
          <Typography variant="subtitle2" sx={{ mt: 1 }}>Blend Requirement</Typography>
          {editForm.blend_requirement_json.map((row, idx) => (
            <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField size="small" label="Grade" value={row.grade || ''}
                onChange={e => setEditForm(f => ({ ...f, blend_requirement_json: f.blend_requirement_json.map((r, i) => i === idx ? { ...r, grade: e.target.value } : r) }))}
                sx={{ width: 140 }} />
              <TextField size="small" label="MT" type="number" value={row.mt ?? ''}
                onChange={e => setEditForm(f => ({ ...f, blend_requirement_json: f.blend_requirement_json.map((r, i) => i === idx ? { ...r, mt: e.target.value } : r) }))}
                sx={{ width: 100 }} />
              <IconButton size="small" onClick={() => setEditForm(f => ({ ...f, blend_requirement_json: f.blend_requirement_json.filter((_, i) => i !== idx) }))}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setEditForm(f => ({ ...f, blend_requirement_json: [...f.blend_requirement_json, { grade: '', mt: '' }] }))}>
            Add blend line
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditContract(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleEditSubmit} disabled={!editForm.contract_number || !editForm.counterparty_id || !editForm.commodity_id || !editForm.contracted_mt}>Save</Button>
        </DialogActions>
      </Dialog>

      <TerminalContractImportDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        farmId={farmId}
        onImported={load}
      />
    </Box>
  );
}
