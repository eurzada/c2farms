import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, MenuItem, Grid, InputAdornment, Box, Typography, IconButton, Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';

const PRICING_TYPES = [
  { value: 'flat', label: 'Flat Price' },
  { value: 'basis', label: 'Basis' },
  { value: 'hta', label: 'HTA (Hedge to Arrive)' },
  { value: 'min_price', label: 'Minimum Price' },
  { value: 'deferred', label: 'Deferred Delivery' },
];

// Crop year = the summer the crop was grown (e.g. 2025 = crop grown summer 2025)
const currentYear = new Date().getFullYear();
const CROP_YEARS = Array.from({ length: 10 }, (_, i) => String(currentYear - i));

const EMPTY = {
  commodity_id: '', counterparty_id: '', crop_year: CROP_YEARS[0], grade: '',
  contract_type: 'third_party', linked_terminal_contract_id: '',
  contracted_mt: '', contracted_bu: '', pricing_type: 'flat', price_per_bu: '', price_per_mt: '', basis_level: '',
  futures_reference: '', futures_price: '', elevator_site: '', farm_origin: '',
  delivery_start: '', delivery_end: '', tolerance_pct: '', broker: '', notes: '',
  grade_prices_json: null,
  blend_requirement_json: null,
};

function parseGradePrices(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseBlendRequirement(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function ContractFormDialog({ open, onClose, farmId, onSaved, initial }) {
  const [form, setForm] = useState(EMPTY);
  const [commodities, setCommodities] = useState([]);
  const [counterparties, setCounterparties] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (!open || !farmId) return;
    Promise.all([
      api.get(`/api/farms/${farmId}/marketing/prices`),
      api.get(`/api/farms/${farmId}/marketing/counterparties`),
    ]).then(([pRes, cpRes]) => {
      setCommodities(pRes.data.prices || []);
      setCounterparties(cpRes.data.counterparties || []);
    });
  }, [open, farmId]);

  const [gradePrices, setGradePrices] = useState([]);
  const [blendRequirement, setBlendRequirement] = useState([]);

  useEffect(() => {
    setSaveError(null);
    if (initial) {
      // Map flat fields only — exclude nested objects (commodity, counterparty, deliveries, etc.) that Prisma rejects
      const { commodity, counterparty, deliveries, linked_terminal_contract, pct_complete, ...flat } = initial;
      setForm({ ...EMPTY, ...flat });
      setGradePrices(parseGradePrices(initial.grade_prices_json));
      setBlendRequirement(parseBlendRequirement(initial.blend_requirement_json));
    } else {
      setForm(EMPTY);
      setGradePrices([]);
      setBlendRequirement([]);
    }
  }, [initial, open]);

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Only send Prisma-acceptable scalar fields — no nested objects (commodity, counterparty, etc.)
      const payload = {
        commodity_id: form.commodity_id,
        counterparty_id: form.counterparty_id,
        contract_type: form.contract_type || 'third_party',
        linked_terminal_contract_id: form.linked_terminal_contract_id || null,
        crop_year: form.crop_year,
        grade: form.grade || null,
        contracted_mt: parseFloat(form.contracted_mt),
        contracted_bu: form.contracted_bu ? parseFloat(form.contracted_bu) : null,
        pricing_type: form.pricing_type,
        price_per_bu: form.price_per_bu ? parseFloat(form.price_per_bu) : null,
        price_per_mt: form.price_per_mt ? parseFloat(form.price_per_mt) : null,
        basis_level: form.basis_level ? parseFloat(form.basis_level) : null,
        futures_reference: form.futures_reference || null,
        futures_price: form.futures_price ? parseFloat(form.futures_price) : null,
        elevator_site: form.elevator_site || null,
        farm_origin: form.farm_origin || null,
        delivery_start: form.delivery_start || null,
        delivery_end: form.delivery_end || null,
        broker: form.broker || null,
        tolerance_pct: form.tolerance_pct ? parseFloat(form.tolerance_pct) : null,
        notes: form.notes || null,
        grade_prices_json: form.contract_type === 'transfer' && gradePrices.length > 0
          ? gradePrices.filter(r => r.grade?.trim()).map(r => ({ grade: r.grade.trim(), price_per_mt: parseFloat(r.price_per_mt) }))
          : null,
        blend_requirement_json: form.contract_type === 'transfer' && blendRequirement.length > 0
          ? blendRequirement.filter(r => r.grade?.trim()).map(r => ({ grade: r.grade.trim(), mt: parseFloat(r.mt) }))
          : null,
      };

      if (initial?.id) {
        await api.put(`/api/farms/${farmId}/marketing/contracts/${initial.id}`, payload);
        onSaved?.();
      } else {
        const res = await api.post(`/api/farms/${farmId}/marketing/contracts`, payload);
        onSaved?.(res.data.warning);
      }
    } catch (err) {
      setSaveError(extractErrorMessage(err, 'Failed to save contract'));
    } finally {
      setSaving(false);
    }
  };

  const showBasis = ['basis', 'hta', 'min_price'].includes(form.pricing_type);
  const showFutures = ['basis', 'hta'].includes(form.pricing_type);
  const showFlat = ['flat', 'deferred', 'min_price'].includes(form.pricing_type);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{initial?.id ? 'Edit Contract' : 'New Marketing Contract'}</DialogTitle>
      <DialogContent>
        {saveError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSaveError(null)}>{saveError}</Alert>}
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={6}>
            <TextField select fullWidth label="Counterparty" value={form.counterparty_id} onChange={set('counterparty_id')} required>
              {counterparties.map(cp => <MenuItem key={cp.id} value={cp.id}>{cp.name} ({cp.short_code})</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={6}>
            <TextField select fullWidth label="Commodity" value={form.commodity_id} onChange={set('commodity_id')} required>
              {commodities.map(c => <MenuItem key={c.commodity_id} value={c.commodity_id}>{c.commodity_name}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={6}>
            <TextField select fullWidth label="Contract Type" value={form.contract_type} onChange={set('contract_type')}>
              <MenuItem value="third_party">Third Party (Buyer)</MenuItem>
              <MenuItem value="transfer">Transfer to LGX</MenuItem>
            </TextField>
          </Grid>
          {form.contract_type === 'transfer' && (
            <>
              <Grid item xs={4}>
                <TextField fullWidth label="Quantity (bu)" value={form.contracted_bu} onChange={set('contracted_bu')} type="number"
                  helperText="Blend recipe component (bu)" />
              </Grid>
              <Grid item xs={4}>
                <TextField fullWidth label="Price $/MT" value={form.price_per_mt} onChange={set('price_per_mt')} type="number"
                  InputProps={{ startAdornment: <InputAdornment position="start">$/MT</InputAdornment> }} />
              </Grid>
              <Grid item xs={12}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Grade Prices (for transfer settlement)</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
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
              </Grid>
              <Grid item xs={12}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Blend Requirement (after Cotecna)</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {blendRequirement.map((row, idx) => (
                    <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <TextField size="small" label="Grade" placeholder="Durum #1" value={row.grade || ''}
                        onChange={e => setBlendRequirement(p => p.map((r, i) => i === idx ? { ...r, grade: e.target.value } : r))} sx={{ width: 140 }} />
                      <TextField size="small" label="MT" type="number" value={row.mt ?? ''}
                        onChange={e => setBlendRequirement(p => p.map((r, i) => i === idx ? { ...r, mt: e.target.value } : r))} sx={{ width: 100 }} />
                      <IconButton size="small" onClick={() => setBlendRequirement(p => p.filter((_, i) => i !== idx))}><DeleteIcon /></IconButton>
                    </Box>
                  ))}
                  <Button size="small" startIcon={<AddIcon />} onClick={() => setBlendRequirement(p => [...p, { grade: '', mt: '' }])}>
                    Add blend line
                  </Button>
                </Box>
              </Grid>
            </>
          )}
          <Grid item xs={4}>
            <TextField select fullWidth label="Crop Year" value={form.crop_year} onChange={set('crop_year')}>
              {CROP_YEARS.map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Grade" value={form.grade} onChange={set('grade')} />
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Quantity (MT)" value={form.contracted_mt} onChange={set('contracted_mt')} type="number" required />
          </Grid>
          <Grid item xs={4}>
            <TextField select fullWidth label="Pricing Type" value={form.pricing_type} onChange={set('pricing_type')}>
              {PRICING_TYPES.map(pt => <MenuItem key={pt.value} value={pt.value}>{pt.label}</MenuItem>)}
            </TextField>
          </Grid>
          {showFlat && (
            <Grid item xs={4}>
              <TextField fullWidth label="Price" value={form.price_per_bu} onChange={set('price_per_bu')} type="number"
                InputProps={{ startAdornment: <InputAdornment position="start">$/bu</InputAdornment> }} />
            </Grid>
          )}
          {showBasis && (
            <Grid item xs={4}>
              <TextField fullWidth label="Basis Level" value={form.basis_level} onChange={set('basis_level')} type="number"
                InputProps={{ startAdornment: <InputAdornment position="start">$/bu</InputAdornment> }} />
            </Grid>
          )}
          {showFutures && (
            <>
              <Grid item xs={4}>
                <TextField fullWidth label="Futures Reference" value={form.futures_reference} onChange={set('futures_reference')} placeholder="e.g. ICE RS May26" />
              </Grid>
              <Grid item xs={4}>
                <TextField fullWidth label="Futures Price" value={form.futures_price} onChange={set('futures_price')} type="number"
                  InputProps={{ startAdornment: <InputAdornment position="start">$/bu</InputAdornment> }} />
              </Grid>
            </>
          )}
          <Grid item xs={4}>
            <TextField fullWidth label="Elevator / Delivery Site" value={form.elevator_site} onChange={set('elevator_site')} />
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Delivery Start" value={form.delivery_start} onChange={set('delivery_start')} type="date" InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Delivery End" value={form.delivery_end} onChange={set('delivery_end')} type="date" InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Broker" value={form.broker} onChange={set('broker')} />
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Tolerance %" value={form.tolerance_pct} onChange={set('tolerance_pct')} type="number" />
          </Grid>
          <Grid item xs={12}>
            <TextField fullWidth label="Notes" value={form.notes} onChange={set('notes')} multiline rows={2} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving || !form.commodity_id || !form.counterparty_id || !form.contracted_mt}>
          {saving ? 'Saving...' : (initial?.id ? 'Update' : 'Create Contract')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
