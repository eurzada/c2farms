import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, MenuItem, Grid, InputAdornment,
} from '@mui/material';
import api from '../../services/api';

const PRICING_TYPES = [
  { value: 'flat', label: 'Flat Price' },
  { value: 'basis', label: 'Basis' },
  { value: 'hta', label: 'HTA (Hedge to Arrive)' },
  { value: 'min_price', label: 'Minimum Price' },
  { value: 'deferred', label: 'Deferred Delivery' },
];

const CROP_YEARS = ['2025/26', '2026/27'];

const EMPTY = {
  commodity_id: '', counterparty_id: '', crop_year: '2025/26', grade: '',
  contracted_mt: '', pricing_type: 'flat', price_per_bu: '', basis_level: '',
  futures_reference: '', futures_price: '', elevator_site: '', farm_origin: '',
  delivery_start: '', delivery_end: '', tolerance_pct: '', broker: '', notes: '',
};

export default function ContractFormDialog({ open, onClose, farmId, onSaved, initial }) {
  const [form, setForm] = useState(EMPTY);
  const [commodities, setCommodities] = useState([]);
  const [counterparties, setCounterparties] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !farmId) return;
    Promise.all([
      api.get(`/api/farms/${farmId}/marketing/prices`),
      api.get(`/api/farms/${farmId}/marketing/counterparties`),
    ]).then(([pRes, cpRes]) => {
      setCommodities(pRes.data.prices || []);
      setCounterparties(cpRes.data.counterparties || []);
    });
  }, [open, farmId]);

  useEffect(() => {
    if (initial) {
      setForm({ ...EMPTY, ...initial });
    } else {
      setForm(EMPTY);
    }
  }, [initial, open]);

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        contracted_mt: parseFloat(form.contracted_mt),
        price_per_bu: form.price_per_bu ? parseFloat(form.price_per_bu) : null,
        basis_level: form.basis_level ? parseFloat(form.basis_level) : null,
        futures_price: form.futures_price ? parseFloat(form.futures_price) : null,
        tolerance_pct: form.tolerance_pct ? parseFloat(form.tolerance_pct) : null,
      };

      if (initial?.id) {
        await api.put(`/api/farms/${farmId}/marketing/contracts/${initial.id}`, payload);
        onSaved?.();
      } else {
        const res = await api.post(`/api/farms/${farmId}/marketing/contracts`, payload);
        onSaved?.(res.data.warning);
      }
    } catch (err) {
      console.error('Save contract error:', err);
    } finally {
      setSaving(false);
    }
  };

  const showBasis = ['basis', 'hta', 'min_price'].includes(form.pricing_type);
  const showFutures = ['basis', 'hta'].includes(form.pricing_type);
  const showFlat = ['flat', 'deferred', 'min_price'].includes(form.pricing_type);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{initial?.id ? 'Edit Contract' : 'New Marketing Contract'}</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={6}>
            <TextField select fullWidth label="Counterparty" value={form.counterparty_id} onChange={set('counterparty_id')} required>
              {counterparties.map(cp => <MenuItem key={cp.id} value={cp.id}>{cp.name} ({cp.short_code})</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={6}>
            <TextField select fullWidth label="Commodity" value={form.commodity_id} onChange={set('commodity_id')} required>
              {commodities.map(c => <MenuItem key={c.commodity_id} value={c.commodity_id}>{c.commodity_name}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={4}>
            <TextField select fullWidth label="Crop Year" value={form.crop_year} onChange={set('crop_year')}>
              {CROP_YEARS.map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Grade" value={form.grade} onChange={set('grade')} />
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Quantity (MT)" value={form.contracted_mt} onChange={set('contracted_mt')} type="number" required />
          </Grid>
          <Grid item xs={4}>
            <TextField select fullWidth label="Pricing Type" value={form.pricing_type} onChange={set('pricing_type')}>
              {PRICING_TYPES.map(pt => <MenuItem key={pt.value} value={pt.value}>{pt.label}</MenuItem>)}
            </TextField>
          </Grid>
          {showFlat && (
            <Grid item xs={4}>
              <TextField fullWidth label="Price" value={form.price_per_bu} onChange={set('price_per_bu')} type="number"
                InputProps={{ startAdornment: <InputAdornment position="start">$/bu</InputAdornment> }} />
            </Grid>
          )}
          {showBasis && (
            <Grid item xs={4}>
              <TextField fullWidth label="Basis Level" value={form.basis_level} onChange={set('basis_level')} type="number"
                InputProps={{ startAdornment: <InputAdornment position="start">$/bu</InputAdornment> }} />
            </Grid>
          )}
          {showFutures && (
            <>
              <Grid item xs={4}>
                <TextField fullWidth label="Futures Reference" value={form.futures_reference} onChange={set('futures_reference')} placeholder="e.g. ICE RS May26" />
              </Grid>
              <Grid item xs={4}>
                <TextField fullWidth label="Futures Price" value={form.futures_price} onChange={set('futures_price')} type="number"
                  InputProps={{ startAdornment: <InputAdornment position="start">$/bu</InputAdornment> }} />
              </Grid>
            </>
          )}
          <Grid item xs={4}>
            <TextField fullWidth label="Elevator / Delivery Site" value={form.elevator_site} onChange={set('elevator_site')} />
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Delivery Start" value={form.delivery_start} onChange={set('delivery_start')} type="date" InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Delivery End" value={form.delivery_end} onChange={set('delivery_end')} type="date" InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Broker" value={form.broker} onChange={set('broker')} />
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Tolerance %" value={form.tolerance_pct} onChange={set('tolerance_pct')} type="number" />
          </Grid>
          <Grid item xs={12}>
            <TextField fullWidth label="Notes" value={form.notes} onChange={set('notes')} multiline rows={2} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving || !form.commodity_id || !form.counterparty_id || !form.contracted_mt}>
          {saving ? 'Saving...' : (initial?.id ? 'Update' : 'Create Contract')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
