import { useState, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, FormControlLabel, Checkbox, Typography, Alert, CircularProgress,
} from '@mui/material';
import api from '../../services/api';

function inferCropYear(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const month = d.getMonth(); // 0-indexed
  return month >= 7 ? d.getFullYear() : d.getFullYear() - 1; // Aug-Dec = that year, Jan-Jul = prev
}

function lastDayOfMonth() {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return last.toISOString().slice(0, 10);
}

export default function NewPeriodDialog({ open, onClose, farmId, previousPeriod, onCreated }) {
  const [periodDate, setPeriodDate] = useState(lastDayOfMonth);
  const [copyFrom, setCopyFrom] = useState(!!previousPeriod);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const cropYear = useMemo(() => inferCropYear(periodDate), [periodDate]);

  const handleCreate = async () => {
    if (!periodDate) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.post(`/api/farms/${farmId}/inventory/count-periods`, {
        period_date: periodDate,
      });
      const newPeriod = res.data.period;

      if (copyFrom && previousPeriod) {
        await api.post(`/api/farms/${farmId}/inventory/count-periods/${newPeriod.id}/copy-from/${previousPeriod.id}`);
      }

      onCreated(newPeriod);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create period');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>New Count Period</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <TextField
          label="Period Date"
          type="date"
          value={periodDate}
          onChange={e => setPeriodDate(e.target.value)}
          fullWidth
          sx={{ mt: 1 }}
          InputLabelProps={{ shrink: true }}
        />

        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Crop Year: {cropYear || '—'}
        </Typography>

        {previousPeriod && (
          <FormControlLabel
            control={<Checkbox checked={copyFrom} onChange={e => setCopyFrom(e.target.checked)} />}
            label={`Copy counts from ${new Date(previousPeriod.period_date).toLocaleDateString('en-CA')}`}
            sx={{ mt: 1 }}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleCreate} disabled={saving || !periodDate}>
          {saving ? <CircularProgress size={20} /> : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
