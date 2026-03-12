import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  TextField, MenuItem, Alert, Stack, InputAdornment, IconButton,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import api from '../../services/api';
import { fmt } from '../../utils/formatting';
import { extractErrorMessage } from '../../utils/errorHelpers';

const currentYear = new Date().getFullYear();
const CROP_YEARS = Array.from({ length: 5 }, (_, i) => `${currentYear - i}/${String(currentYear - i + 1).slice(-2)}`);

export default function TransferAgreementFromTerminalDialog({ open, onClose, farmId, onCreated }) {
  const [terminalContracts, setTerminalContracts] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [gradePrices, setGradePrices] = useState([{ grade: '', price_per_mt: '' }]);
  const [blendRequirement, setBlendRequirement] = useState([]);
  const [cropYear, setCropYear] = useState(CROP_YEARS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !farmId) return;
    api.get(`/api/farms/${farmId}/marketing/terminal-contracts-for-transfer`)
      .then(res => setTerminalContracts(res.data.contracts || []))
      .catch(() => setTerminalContracts([]));
    setSelectedId('');
    setGradePrices([{ grade: '', price_per_mt: '' }]);
    setBlendRequirement([]);
    setError(null);
  }, [open, farmId]);

  const selected = terminalContracts.find(c => c.id === selectedId);
  const contractNumber = selected
    ? `LGX-${selected.counterparty?.short_code || 'BUY'}-${selected.contract_number}`
    : '';

  const handleCreate = async () => {
    if (!selectedId) {
      setError('Select a terminal contract');
      return;
    }
    const validGrades = gradePrices.filter(r => r.grade?.trim() && r.price_per_mt != null && r.price_per_mt !== '');
    if (validGrades.length === 0) {
      setError('Add at least one grade price (grade and $/MT)');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const grade_prices_json = validGrades.map(r => ({
        grade: r.grade.trim(),
        price_per_mt: parseFloat(r.price_per_mt),
      }));
      const blend_requirement_json = blendRequirement
        .filter(r => r.grade?.trim() && r.mt != null && r.mt !== '')
        .map(r => ({ grade: r.grade.trim(), mt: parseFloat(r.mt) }));
      await api.post(`/api/farms/${farmId}/marketing/transfer-agreement-from-terminal`, {
        terminal_contract_id: selectedId,
        grade_prices_json,
        blend_requirement_json: blend_requirement_json.length ? blend_requirement_json : null,
        crop_year: cropYear,
      });
      onCreated?.();
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to create transfer agreement'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" alignItems="center" spacing={1}>
          <SwapHorizIcon color="primary" />
          <span>LGX One-Click Transfer Agreement</span>
        </Stack>
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Pick a buyer contract from the terminal. Transfer agreement will be created as LGX-{"<buyer>-<contract#>"}. You only need to add grade prices.
        </Typography>

        <TextField
          select
          fullWidth
          label="Terminal Contract (Buyer)"
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          sx={{ mb: 2 }}
        >
          <MenuItem value="">— Select —</MenuItem>
          {terminalContracts.map(c => (
            <MenuItem key={c.id} value={c.id} disabled={!!c.is_accepted}>
              {c.counterparty?.name || 'Unknown'} — {c.contract_number} ({c.commodity?.name}, {fmt(c.contracted_mt)} MT){c.is_accepted ? ' (Already Accepted)' : ''}
            </MenuItem>
          ))}
        </TextField>

        {selected && (
          <Box sx={{ mb: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="subtitle2">Will create: <strong>{contractNumber}</strong></Typography>
            <Typography variant="body2" color="text.secondary">
              {selected.commodity?.name} · {fmt(selected.contracted_mt)} MT · {selected.price_per_mt ? `$${fmt(selected.price_per_mt)}/MT` : '—'}
            </Typography>
          </Box>
        )}

        <Typography variant="subtitle2" sx={{ mb: 1 }}>Grade Prices (required) — lower-grade material $/MT</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
          {gradePrices.map((row, idx) => (
            <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField size="small" label="Grade" placeholder="Durum #1" value={row.grade || ''}
                onChange={e => setGradePrices(p => p.map((r, i) => i === idx ? { ...r, grade: e.target.value } : r))} sx={{ width: 140 }} />
              <TextField size="small" label="$/MT" type="number" value={row.price_per_mt ?? ''}
                onChange={e => setGradePrices(p => p.map((r, i) => i === idx ? { ...r, price_per_mt: e.target.value } : r))} sx={{ width: 100 }}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }} />
              <IconButton size="small" onClick={() => setGradePrices(p => p.filter((_, i) => i !== idx))}><DeleteIcon /></IconButton>
            </Box>
          ))}
          <Button size="small" startIcon={<AddIcon />} onClick={() => setGradePrices(p => [...p, { grade: '', price_per_mt: '' }])}>
            Add grade price
          </Button>
        </Box>

        <Typography variant="subtitle2" sx={{ mb: 1 }}>Blend Requirement (optional)</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
          {blendRequirement.map((row, idx) => (
            <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField size="small" label="Grade" placeholder="Durum #1" value={row.grade || ''}
                onChange={e => setBlendRequirement(p => p.map((r, i) => i === idx ? { ...r, grade: e.target.value } : r))} sx={{ width: 140 }} />
              <TextField size="small" label="MT" type="number" value={row.mt ?? ''}
                onChange={e => setBlendRequirement(p => p.map((r, i) => i === idx ? { ...r, mt: e.target.value } : r))} sx={{ width: 100 }} />
              <IconButton size="small" onClick={() => setBlendRequirement(p => p.filter((_, i) => i !== idx))}><DeleteIcon /></IconButton>
            </Box>
          ))}
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setBlendRequirement(p => [...p, { grade: '', mt: '' }])}>
            Add blend line
          </Button>
        </Box>

        <TextField select label="Crop Year" value={cropYear} onChange={e => setCropYear(e.target.value)} sx={{ minWidth: 140 }}>
          {CROP_YEARS.map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
        </TextField>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleCreate} disabled={loading || !selectedId}>
          {loading ? 'Creating...' : 'Create Transfer Agreement'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
