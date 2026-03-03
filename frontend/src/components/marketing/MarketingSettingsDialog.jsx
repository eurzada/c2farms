import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, Grid, InputAdornment,
} from '@mui/material';
import api from '../../services/api';

export default function MarketingSettingsDialog({ open, onClose, farmId }) {
  const [form, setForm] = useState({
    loc_interest_rate: 7.25,
    storage_cost_per_mt_month: 3.5,
    loc_available: '',
    contract_prefix: 'MKT',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !farmId) return;
    api.get(`/api/farms/${farmId}/marketing/settings`).then(res => {
      const s = res.data.settings;
      if (s) {
        setForm({
          loc_interest_rate: (s.loc_interest_rate || 0.0725) * 100,
          storage_cost_per_mt_month: s.storage_cost_per_mt_month || 3.5,
          loc_available: s.loc_available || '',
          contract_prefix: s.contract_prefix || 'MKT',
        });
      }
    });
  }, [open, farmId]);

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/api/farms/${farmId}/marketing/settings`, {
        loc_interest_rate: parseFloat(form.loc_interest_rate) / 100,
        storage_cost_per_mt_month: parseFloat(form.storage_cost_per_mt_month),
        loc_available: form.loc_available ? parseFloat(form.loc_available) : null,
        contract_prefix: form.contract_prefix,
      });
      onClose();
    } catch (err) {
      console.error('Settings save error:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Marketing Settings</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={6}>
            <TextField fullWidth label="LOC Interest Rate" value={form.loc_interest_rate} onChange={set('loc_interest_rate')} type="number"
              InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
              helperText="Annual line of credit rate" />
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth label="Storage Cost" value={form.storage_cost_per_mt_month} onChange={set('storage_cost_per_mt_month')} type="number"
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment>, endAdornment: <InputAdornment position="end">/MT/mo</InputAdornment> }} />
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth label="LOC Available" value={form.loc_available} onChange={set('loc_available')} type="number"
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }} />
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth label="Contract Prefix" value={form.contract_prefix} onChange={set('contract_prefix')}
              helperText="e.g. MKT" />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
