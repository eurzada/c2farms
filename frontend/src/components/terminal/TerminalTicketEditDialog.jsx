import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, MenuItem, Alert, Box, Typography,
  Checkbox, FormControlLabel,
} from '@mui/material';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';

const PRODUCTS = ['CWRS', 'CWAD', 'Canary', 'Flax', 'Barley', 'Lentils', 'Chickpeas', 'Peas'];

export default function TerminalTicketEditDialog({ open, onClose, farmId, ticket, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open && ticket) {
      setForm({
        ticket_number: ticket.ticket_number ?? '',
        ticket_date: ticket.ticket_date ? new Date(ticket.ticket_date).toISOString().slice(0, 10) : '',
        grower_name: ticket.grower_name || '',
        product: ticket.product || '',
        weight_kg: ticket.weight_kg ?? '',
        fmo_number: ticket.fmo_number || '',
        buyer: ticket.buyer || '',
        dockage_pct: ticket.dockage_pct ?? '',
        moisture_pct: ticket.moisture_pct ?? '',
        test_weight: ticket.test_weight ?? '',
        protein_pct: ticket.protein_pct ?? '',
        hvk_pct: ticket.hvk_pct ?? '',
        notes: ticket.notes || '',
      });
      setError(null);
    }
  }, [open, ticket]);

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ticket_number: form.ticket_number !== '' ? parseInt(form.ticket_number) : ticket.ticket_number,
        ticket_date: form.ticket_date || undefined,
        grower_name: form.grower_name,
        product: form.product,
        weight_kg: form.weight_kg !== '' ? parseFloat(form.weight_kg) : ticket.weight_kg,
        fmo_number: form.fmo_number || null,
        buyer: form.buyer || null,
        dockage_pct: form.dockage_pct !== '' ? parseFloat(form.dockage_pct) : null,
        moisture_pct: form.moisture_pct !== '' ? parseFloat(form.moisture_pct) : null,
        test_weight: form.test_weight !== '' ? parseFloat(form.test_weight) : null,
        protein_pct: form.protein_pct !== '' ? parseFloat(form.protein_pct) : null,
        hvk_pct: form.hvk_pct !== '' ? parseFloat(form.hvk_pct) : null,
        notes: form.notes || null,
      };

      await api.put(`/api/farms/${farmId}/terminal/tickets/${ticket.id}`, payload);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to save ticket'));
    } finally {
      setSaving(false);
    }
  };

  if (!ticket) return null;

  const isVoided = ticket.status === 'voided';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit Terminal Ticket #{ticket.ticket_number}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {isVoided && <Alert severity="warning">This ticket is voided and should not be edited.</Alert>}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <TextField
            label="Ticket #"
            type="number"
            value={form.ticket_number ?? ''}
            onChange={e => set('ticket_number', e.target.value)}
            disabled={isVoided}
          />
          <TextField
            label="Date"
            type="date"
            value={form.ticket_date || ''}
            onChange={e => set('ticket_date', e.target.value)}
            InputLabelProps={{ shrink: true }}
            disabled={isVoided}
          />
        </Box>
        <TextField
          label="Grower"
          value={form.grower_name || ''}
          onChange={e => set('grower_name', e.target.value)}
          disabled={isVoided}
          fullWidth
        />
        <TextField
          select
          label="Product"
          value={form.product || ''}
          onChange={e => set('product', e.target.value)}
          disabled={isVoided}
          fullWidth
        >
          {PRODUCTS.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
        </TextField>
        <TextField
          label="Weight (KG)"
          type="number"
          value={form.weight_kg ?? ''}
          onChange={e => set('weight_kg', e.target.value)}
          disabled={isVoided}
          fullWidth
          helperText={form.weight_kg ? `${(parseFloat(form.weight_kg) / 1000).toFixed(3)} MT` : ''}
        />
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <TextField
            label="FMO #"
            value={form.fmo_number || ''}
            onChange={e => set('fmo_number', e.target.value)}
            disabled={isVoided}
          />
          <TextField
            label="Buyer"
            value={form.buyer || ''}
            onChange={e => set('buyer', e.target.value)}
            disabled={isVoided}
          />
        </Box>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1 }}>Quality / Grading</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5 }}>
          <TextField label="Dockage %" type="number" size="small" value={form.dockage_pct ?? ''} onChange={e => set('dockage_pct', e.target.value)} disabled={isVoided} />
          <TextField label="Moisture %" type="number" size="small" value={form.moisture_pct ?? ''} onChange={e => set('moisture_pct', e.target.value)} disabled={isVoided} />
          <TextField label="Test Weight" type="number" size="small" value={form.test_weight ?? ''} onChange={e => set('test_weight', e.target.value)} disabled={isVoided} />
          <TextField label="Protein %" type="number" size="small" value={form.protein_pct ?? ''} onChange={e => set('protein_pct', e.target.value)} disabled={isVoided} />
          <TextField label="HVK %" type="number" size="small" value={form.hvk_pct ?? ''} onChange={e => set('hvk_pct', e.target.value)} disabled={isVoided} />
        </Box>
        <TextField
          label="Notes"
          value={form.notes || ''}
          onChange={e => set('notes', e.target.value)}
          disabled={isVoided}
          fullWidth
          multiline
          rows={2}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || isVoided}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
