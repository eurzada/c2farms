import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, MenuItem, Alert, Box, Typography,
} from '@mui/material';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';

export default function TicketEditDialog({ open, onClose, farmId, ticket, onSaved }) {
  const [form, setForm] = useState({});
  const [commodities, setCommodities] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open && ticket) {
      setForm({
        ticket_number: ticket.ticket_number || '',
        delivery_date: ticket.delivery_date ? new Date(ticket.delivery_date).toISOString().slice(0, 10) : '',
        commodity_id: ticket.commodity?.id || ticket.commodity_id || '',
        grade: ticket.grade || '',
        net_weight_kg: ticket.net_weight_kg ?? '',
        buyer_name: ticket.buyer_name || '',
        contract_number: ticket.contract_number || '',
        destination: ticket.destination || '',
        notes: ticket.notes || '',
      });
      setError(null);
    }
  }, [open, ticket]);

  useEffect(() => {
    if (open && farmId) {
      api.get(`/api/farms/${farmId}/inventory/commodities`).then(res => {
        setCommodities(res.data.commodities || res.data || []);
      }).catch(() => {});
    }
  }, [open, farmId]);

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const patch = {};
      if (form.ticket_number !== (ticket.ticket_number || '')) patch.ticket_number = form.ticket_number;
      if (form.delivery_date !== (ticket.delivery_date ? new Date(ticket.delivery_date).toISOString().slice(0, 10) : ''))
        patch.delivery_date = form.delivery_date;
      if (form.commodity_id && form.commodity_id !== (ticket.commodity?.id || ticket.commodity_id || ''))
        patch.commodity_id = form.commodity_id;
      if (form.grade !== (ticket.grade || '')) patch.grade = form.grade;
      if (String(form.net_weight_kg) !== String(ticket.net_weight_kg ?? ''))
        patch.net_weight_kg = form.net_weight_kg;
      if (form.buyer_name !== (ticket.buyer_name || '')) patch.buyer_name = form.buyer_name;
      if (form.contract_number !== (ticket.contract_number || '')) patch.contract_number = form.contract_number;
      if (form.destination !== (ticket.destination || '')) patch.destination = form.destination;
      if (form.notes !== (ticket.notes || '')) patch.notes = form.notes;

      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }

      await api.patch(`/api/farms/${farmId}/tickets/${ticket.id}`, patch);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to save ticket'));
    } finally {
      setSaving(false);
    }
  };

  if (!ticket) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit Ticket #{ticket.ticket_number}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {ticket.settled && (
          <Alert severity="warning">This ticket is marked as settled and cannot be edited.</Alert>
        )}
        <TextField
          label="Ticket #"
          value={form.ticket_number || ''}
          onChange={e => set('ticket_number', e.target.value)}
          disabled={ticket.settled}
          fullWidth
        />
        <TextField
          label="Delivery Date"
          type="date"
          value={form.delivery_date || ''}
          onChange={e => set('delivery_date', e.target.value)}
          InputLabelProps={{ shrink: true }}
          disabled={ticket.settled}
          fullWidth
        />
        <TextField
          select
          label="Commodity"
          value={form.commodity_id || ''}
          onChange={e => set('commodity_id', e.target.value)}
          disabled={ticket.settled}
          fullWidth
        >
          <MenuItem value="">—</MenuItem>
          {commodities.map(c => (
            <MenuItem key={c.id} value={c.id}>{c.name} ({c.code})</MenuItem>
          ))}
        </TextField>
        <TextField
          label="Grade"
          value={form.grade || ''}
          onChange={e => set('grade', e.target.value)}
          disabled={ticket.settled}
          fullWidth
        />
        <TextField
          label="Net Weight (KG)"
          type="number"
          value={form.net_weight_kg ?? ''}
          onChange={e => set('net_weight_kg', e.target.value)}
          disabled={ticket.settled}
          fullWidth
          helperText={form.net_weight_kg ? `${(parseFloat(form.net_weight_kg) / 1000).toFixed(3)} MT` : ''}
        />
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <TextField
            label="Buyer"
            value={form.buyer_name || ''}
            onChange={e => set('buyer_name', e.target.value)}
            disabled={ticket.settled}
          />
          <TextField
            label="Contract #"
            value={form.contract_number || ''}
            onChange={e => set('contract_number', e.target.value)}
            disabled={ticket.settled}
          />
        </Box>
        <TextField
          label="Destination"
          value={form.destination || ''}
          onChange={e => set('destination', e.target.value)}
          disabled={ticket.settled}
          fullWidth
        />
        <TextField
          label="Notes"
          value={form.notes || ''}
          onChange={e => set('notes', e.target.value)}
          disabled={ticket.settled}
          fullWidth
          multiline
          rows={2}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || ticket.settled}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
