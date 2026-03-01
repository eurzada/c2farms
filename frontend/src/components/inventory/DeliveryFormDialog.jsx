import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, Stack, Typography,
} from '@mui/material';
import api from '../../services/api';

export default function DeliveryFormDialog({ open, contract, onClose, farmId, onSaved }) {
  const [form, setForm] = useState({ mt_delivered: '', delivery_date: '', ticket_number: '', notes: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        mt_delivered: '',
        delivery_date: new Date().toISOString().slice(0, 10),
        ticket_number: '',
        notes: '',
      });
    }
  }, [open]);

  const handleSave = async () => {
    if (!contract || !farmId) return;
    setSaving(true);
    try {
      await api.post(`/api/farms/${farmId}/contracts/${contract.id}/deliveries`, form);
      onSaved();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to record delivery');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Record Delivery</DialogTitle>
      <DialogContent>
        {contract && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {contract.buyer} — {contract.commodity?.name} ({contract.contracted_mt?.toLocaleString()} MT contracted)
          </Typography>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="MT Delivered" type="number" value={form.mt_delivered} onChange={e => setForm(f => ({ ...f, mt_delivered: e.target.value }))} fullWidth required />
          <TextField label="Delivery Date" type="date" value={form.delivery_date} onChange={e => setForm(f => ({ ...f, delivery_date: e.target.value }))} fullWidth InputLabelProps={{ shrink: true }} required />
          <TextField label="Ticket Number" value={form.ticket_number} onChange={e => setForm(f => ({ ...f, ticket_number: e.target.value }))} fullWidth />
          <TextField label="Notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} fullWidth multiline rows={2} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={saving || !form.mt_delivered || !form.delivery_date}>
          Record
        </Button>
      </DialogActions>
    </Dialog>
  );
}
