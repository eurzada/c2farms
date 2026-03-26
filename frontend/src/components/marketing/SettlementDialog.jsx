import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, Grid, Typography, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, CircularProgress, Box,
} from '@mui/material';
import api from '../../services/api';
import { fmtDollar, fmt } from '../../utils/formatting';

export default function SettlementDialog({ open, onClose, farmId, contract, onSaved }) {
  const [form, setForm] = useState({
    settlement_date: new Date().toISOString().slice(0, 10),
    settlement_amount: '',
  });
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // Fetch settlement summary when dialog opens
  useEffect(() => {
    if (!open || !contract || !farmId) return;
    setLoadingSummary(true);
    api.get(`/api/farms/${farmId}/marketing/contracts/${contract.id}/settlement-summary`)
      .then(res => {
        setSummary(res.data);
        // Auto-populate amount and date from linked settlements
        if (res.data.total_amount > 0) {
          setForm(f => ({
            settlement_date: res.data.latest_date || f.settlement_date,
            settlement_amount: String(res.data.total_amount),
          }));
        }
      })
      .catch(() => setSummary(null))
      .finally(() => setLoadingSummary(false));
  }, [open, contract, farmId]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setForm({ settlement_date: new Date().toISOString().slice(0, 10), settlement_amount: '' });
      setSummary(null);
    }
  }, [open]);

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await api.post(`/api/farms/${farmId}/marketing/contracts/${contract.id}/fulfill`, {
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
      <DialogTitle>Fulfill Contract</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {contract.contract_number} — {contract.counterparty?.name} — {contract.commodity?.name}
          <br />Contracted: {fmt(contract.contracted_mt)} MT | Delivered: {fmt(contract.delivered_mt)} MT
        </Typography>

        {loadingSummary && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={24} />
          </Box>
        )}

        {summary && summary.settlement_count > 0 && (
          <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Settlement</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell>Date</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {summary.settlements.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell>{s.settlement_number || `Settlement ${i + 1}`}</TableCell>
                    <TableCell align="right">{fmtDollar(s.amount)}</TableCell>
                    <TableCell>{s.date ? new Date(s.date).toLocaleDateString('en-CA') : '—'}</TableCell>
                  </TableRow>
                ))}
                {summary.settlement_count > 1 && (
                  <TableRow sx={{ '& td': { fontWeight: 700, borderTop: '2px solid', borderColor: 'divider' } }}>
                    <TableCell>Total ({summary.settlement_count} settlements)</TableCell>
                    <TableCell align="right">{fmtDollar(summary.total_amount)}</TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {summary && summary.settlement_count === 0 && (
          <Typography variant="body2" color="warning.main" sx={{ mb: 2 }}>
            No approved settlements linked to this contract. Enter the settlement amount manually.
          </Typography>
        )}

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
          {saving ? 'Fulfilling...' : 'Fulfill Contract'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
