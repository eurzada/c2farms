import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, FormControl, InputLabel, Select, MenuItem, Stack,
} from '@mui/material';
import api from '../../services/api';

export default function ContractFormDialog({ open, onClose, farmId, onSaved }) {
  const [commodities, setCommodities] = useState([]);
  const [form, setForm] = useState({
    buyer: '', commodity_id: '', contracted_mt: '', price_per_mt: '', contract_number: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!farmId || !open) return;
    api.get(`/api/farms/${farmId}/inventory/commodities`)
      .then(res => setCommodities(res.data.commodities || []));
  }, [farmId, open]);

  useEffect(() => {
    if (open) setForm({ buyer: '', commodity_id: '', contracted_mt: '', price_per_mt: '', contract_number: '', notes: '' });
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.post(`/api/farms/${farmId}/contracts`, form);
      onSaved(res.data.warning);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create contract');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Contract</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Buyer" value={form.buyer} onChange={e => setForm(f => ({ ...f, buyer: e.target.value }))} fullWidth required />
          <FormControl fullWidth required>
            <InputLabel>Commodity</InputLabel>
            <Select value={form.commodity_id} label="Commodity" onChange={e => setForm(f => ({ ...f, commodity_id: e.target.value }))}>
              {commodities.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label="Contracted MT" type="number" value={form.contracted_mt} onChange={e => setForm(f => ({ ...f, contracted_mt: e.target.value }))} fullWidth required />
          <TextField label="Price per MT" type="number" value={form.price_per_mt} onChange={e => setForm(f => ({ ...f, price_per_mt: e.target.value }))} fullWidth />
          <TextField label="Contract Number" value={form.contract_number} onChange={e => setForm(f => ({ ...f, contract_number: e.target.value }))} fullWidth />
          <TextField label="Notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} fullWidth multiline rows={2} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={saving || !form.buyer || !form.commodity_id || !form.contracted_mt}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
