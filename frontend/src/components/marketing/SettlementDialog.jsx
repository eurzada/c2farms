import { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, Grid, Typography,
} from '@mui/material';
import api from '../../services/api';

export default function SettlementDialog({ open, onClose, farmId, contract, onSaved }) {
  const [form, setForm] = useState({
    settlement_date: new Date().toISOString().slice(0, 10),
    settlement_amount: '',
  });
  const [saving, setSaving] = useState(false);

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await api.post(`/api/farms/${farmId}/marketing/contracts/${contract.id}/settle`, {
        settlement_date: form.settlement_date,
        settlement_amount: parseFloat(form.settlement_amount),
      });
      onSaved?.();
    } catch (err) {
      console.error('Settlement error:', err);
    } finally {
      setSaving(false);
    }
  };

  if (!contract) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Settle Contract</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {contract.contract_number} — {contract.counterparty?.name} — {contract.commodity?.name}
          <br />Contracted: {contract.contracted_mt?.toFixed(1)} MT | Delivered: {contract.delivered_mt?.toFixed(1)} MT
        </Typography>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={6}>
            <TextField fullWidth label="Settlement Date" value={form.settlement_date} onChange={set('settlement_date')} type="date" InputLabelProps={{ shrink: true }} required />
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth label="Settlement Amount ($)" value={form.settlement_amount} onChange={set('settlement_amount')} type="number" required autoFocus />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="success" onClick={handleSubmit} disabled={saving || !form.settlement_amount}>
          {saving ? 'Settling...' : 'Settle Contract'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
