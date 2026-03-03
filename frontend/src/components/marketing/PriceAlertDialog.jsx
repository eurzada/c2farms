import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, MenuItem, Grid, InputAdornment,
} from '@mui/material';
import api from '../../services/api';

const ALERT_TYPES = [
  { value: 'target_price', label: 'Target Price' },
  { value: 'basis_trigger', label: 'Basis Trigger' },
  { value: 'percent_change', label: 'Percent Change' },
];

const DIRECTIONS = [
  { value: 'above', label: 'Above' },
  { value: 'below', label: 'Below' },
];

export default function PriceAlertDialog({ open, onClose, farmId, commodities, onSaved }) {
  const [form, setForm] = useState({
    commodity_id: '', alert_type: 'target_price', direction: 'above', threshold_value: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({ commodity_id: '', alert_type: 'target_price', direction: 'above', threshold_value: '', notes: '' });
  }, [open]);

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await api.post(`/api/farms/${farmId}/marketing/price-alerts`, {
        ...form,
        threshold_value: parseFloat(form.threshold_value),
      });
      onSaved?.();
    } catch (err) {
      console.error('Alert save error:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create Price Alert</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={12}>
            <TextField select fullWidth label="Commodity" value={form.commodity_id} onChange={set('commodity_id')} required>
              {(commodities || []).map(c => <MenuItem key={c.commodity_id} value={c.commodity_id}>{c.commodity_name}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={6}>
            <TextField select fullWidth label="Alert Type" value={form.alert_type} onChange={set('alert_type')}>
              {ALERT_TYPES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={6}>
            <TextField select fullWidth label="Direction" value={form.direction} onChange={set('direction')}>
              {DIRECTIONS.map(d => <MenuItem key={d.value} value={d.value}>{d.label}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12}>
            <TextField fullWidth label="Threshold Value" value={form.threshold_value} onChange={set('threshold_value')} type="number" required
              InputProps={{ startAdornment: <InputAdornment position="start">$/bu</InputAdornment> }} />
          </Grid>
          <Grid item xs={12}>
            <TextField fullWidth label="Notes" value={form.notes} onChange={set('notes')} multiline rows={2} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving || !form.commodity_id || !form.threshold_value}>
          {saving ? 'Creating...' : 'Create Alert'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
