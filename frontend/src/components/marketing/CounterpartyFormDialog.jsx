import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, MenuItem, Grid,
} from '@mui/material';
import api from '../../services/api';

const TYPES = [
  { value: 'buyer', label: 'Buyer' },
  { value: 'broker', label: 'Broker' },
  { value: 'elevator', label: 'Elevator' },
  { value: 'terminal', label: 'Terminal' },
];

const EMPTY = {
  name: '', short_code: '', type: 'buyer',
  contact_name: '', contact_email: '', contact_phone: '',
  default_elevator_site: '', notes: '',
};

export default function CounterpartyFormDialog({ open, onClose, farmId, initial, onSaved }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(initial ? { ...EMPTY, ...initial } : EMPTY);
  }, [initial, open]);

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async () => {
    setSaving(true);
    try {
      if (initial?.id) {
        await api.put(`/api/farms/${farmId}/marketing/counterparties/${initial.id}`, form);
      } else {
        await api.post(`/api/farms/${farmId}/marketing/counterparties`, form);
      }
      onSaved?.();
    } catch (err) {
      console.error('Save counterparty error:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{initial?.id ? 'Edit Buyer' : 'Add Buyer'}</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={8}>
            <TextField fullWidth label="Name" value={form.name} onChange={set('name')} required />
          </Grid>
          <Grid item xs={4}>
            <TextField
              fullWidth
              label="Short Code"
              value={form.short_code}
              onChange={set('short_code')}
              placeholder={initial?.id ? undefined : 'Auto (001, 002…)'}
              inputProps={{ maxLength: 3 }}
              helperText={!initial?.id ? 'Leave blank for auto-assigned 3-digit code' : undefined}
            />
          </Grid>
          <Grid item xs={6}>
            <TextField select fullWidth label="Type" value={form.type} onChange={set('type')}>
              {TYPES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth label="Default Elevator" value={form.default_elevator_site} onChange={set('default_elevator_site')} />
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Contact Name" value={form.contact_name} onChange={set('contact_name')} />
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Email" value={form.contact_email} onChange={set('contact_email')} />
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Phone" value={form.contact_phone} onChange={set('contact_phone')} />
          </Grid>
          <Grid item xs={12}>
            <TextField fullWidth label="Notes" value={form.notes} onChange={set('notes')} multiline rows={2} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving || !form.name}>
          {saving ? 'Saving...' : (initial?.id ? 'Update' : 'Add Buyer')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
