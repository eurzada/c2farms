import { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, Grid, Typography,
} from '@mui/material';
import api from '../../services/api';

export default function DeliveryFormDialog({ open, onClose, farmId, contract, onSaved }) {
  const [form, setForm] = useState({
    mt_delivered: '', delivery_date: new Date().toISOString().slice(0, 10),
    ticket_number: '', gross_weight_mt: '', dockage_pct: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await api.post(`/api/farms/${farmId}/marketing/contracts/${contract.id}/deliveries`, {
        mt_delivered: parseFloat(form.mt_delivered),
        delivery_date: form.delivery_date,
        ticket_number: form.ticket_number || null,
        gross_weight_mt: form.gross_weight_mt ? parseFloat(form.gross_weight_mt) : null,
        dockage_pct: form.dockage_pct ? parseFloat(form.dockage_pct) : null,
        notes: form.notes || null,
      });
      setForm({ mt_delivered: '', delivery_date: new Date().toISOString().slice(0, 10), ticket_number: '', gross_weight_mt: '', dockage_pct: '', notes: '' });
      onSaved?.();
    } catch (err) {
      console.error('Delivery error:', err);
    } finally {
      setSaving(false);
    }
  };

  if (!contract) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Record Delivery</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {contract.contract_number} — {contract.counterparty?.name} — {contract.commodity?.name}
          <br />Remaining: {contract.remaining_mt?.toFixed(1)} MT of {contract.contracted_mt?.toFixed(1)} MT
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <TextField fullWidth label="Net Weight (MT)" value={form.mt_delivered} onChange={set('mt_delivered')} type="number" required autoFocus />
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth label="Delivery Date" value={form.delivery_date} onChange={set('delivery_date')} type="date" InputLabelProps={{ shrink: true }} required />
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Ticket #" value={form.ticket_number} onChange={set('ticket_number')} />
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Gross Weight (MT)" value={form.gross_weight_mt} onChange={set('gross_weight_mt')} type="number" />
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Dockage %" value={form.dockage_pct} onChange={set('dockage_pct')} type="number" />
          </Grid>
          <Grid item xs={12}>
            <TextField fullWidth label="Notes" value={form.notes} onChange={set('notes')} multiline rows={2} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving || !form.mt_delivered}>
          {saving ? 'Recording...' : 'Record Delivery'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
