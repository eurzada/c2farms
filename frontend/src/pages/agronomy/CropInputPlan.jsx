import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Button, Chip, Alert, IconButton, TextField, Stack,
  Accordion, AccordionSummary, AccordionDetails, Divider, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, Snackbar,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Select, MenuItem, FormControl, InputLabel, Autocomplete,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PriceCheckIcon from '@mui/icons-material/PriceCheck';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';
import FertilizerMatrix from '../../components/agronomy/FertilizerMatrix';

function fmt(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function fmtDec(n, d = 2) { return (n || 0).toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d }); }

// For seed/seed_treatment inputs, use per-varietal acres if set; otherwise fall back to allocation acres
function effectiveAcres(inp, alloc) {
  if ((inp.category === 'seed' || inp.category === 'seed_treatment') && inp.acres != null) {
    return inp.acres;
  }
  return alloc.acres;
}

const CATEGORY_LABELS = {
  seed: 'SEEDING',
  seed_treatment: 'SEEDING',
  fertilizer: 'FERTILIZER',
  chemical: 'CHEMICALS',
};

const TIMING_LABELS = {
  fall_residual: 'Fall Residual',
  preburn: 'Preburn',
  incrop: 'In-Crop',
  fungicide: 'Fungicide',
  desiccation: 'Desiccation',
  seeding: 'Seeding',
};

const TIMING_ORDER = ['fall_residual', 'preburn', 'incrop', 'fungicide', 'desiccation'];

const TIMING_OPTIONS = [
  { value: 'fall_residual', label: 'Fall Residual' },
  { value: 'preburn', label: 'Preburn' },
  { value: 'incrop', label: 'In-Crop' },
  { value: 'fungicide', label: 'Fungicide' },
  { value: 'desiccation', label: 'Desiccation' },
  { value: 'seeding', label: 'Seeding (Seed Treatment)' },
];

function InputSection({ title, inputs, allocation, canEdit, onAdd, onDelete, onUpdate, products = [] }) {
  const productOptions = products.map(p => p.name);
  const totalCost = inputs.reduce((s, i) => s + i.rate * i.cost_per_unit * effectiveAcres(i, allocation), 0);
  const costPerAcre = allocation.acres ? totalCost / allocation.acres : 0;
  const isSeeding = title === 'SEEDING';
  const seedAcresSum = isSeeding ? inputs.filter(i => i.category === 'seed').reduce((s, i) => s + (i.acres ?? 0), 0) : 0;
  const hasAcresWarning = isSeeding && seedAcresSum > 0 && seedAcresSum > allocation.acres;

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>{title}</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>${fmtDec(costPerAcre)}/ac | ${fmt(totalCost)}</Typography>
      </Box>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': { py: 0.5, fontSize: '0.75rem', fontWeight: 'bold' } }}>
              <TableCell>Product</TableCell>
              {isSeeding && <TableCell align="right">Acres</TableCell>}
              {title === 'FERTILIZER' && <TableCell>Analysis</TableCell>}
              {title === 'CHEMICALS' && <TableCell>Timing</TableCell>}
              <TableCell align="right">Rate</TableCell>
              <TableCell>Unit</TableCell>
              <TableCell align="right">$/Unit</TableCell>
              <TableCell align="right">$/Acre</TableCell>
              <TableCell align="right">Total $</TableCell>
              {canEdit && <TableCell width={40} />}
            </TableRow>
          </TableHead>
          <TableBody>
            {inputs.map(inp => {
              const cpa = inp.rate * inp.cost_per_unit;
              return (
                <TableRow key={inp.id} hover sx={{ '& td': { py: 0.25 } }}>
                  <TableCell>
                    {canEdit && productOptions.length > 0 ? (
                      <Autocomplete
                        size="small"
                        freeSolo
                        options={productOptions}
                        value={inp.product_name}
                        onChange={(_, val) => {
                          const match = products.find(p => p.name === val);
                          const updates = { product_name: val || '' };
                          if (match) {
                            updates.cost_per_unit = match.cost_per_application_unit ?? match.default_cost ?? inp.cost_per_unit;
                            if (match.default_rate && !inp.rate) updates.rate = match.default_rate;
                            if (match.default_unit) updates.rate_unit = match.default_unit;
                          }
                          onUpdate(inp.id, updates);
                        }}
                        onInputChange={(_, val, reason) => {
                          if (reason === 'input') onUpdate(inp.id, { product_name: val });
                        }}
                        renderInput={(params) => (
                          <TextField {...params} placeholder="Select product..."
                            sx={{ minWidth: 140 }}
                            slotProps={{ htmlInput: { ...params.inputProps, style: { fontSize: '0.8rem', padding: '2px 4px' } } }}
                          />
                        )}
                        disableClearable
                        sx={{ '& .MuiOutlinedInput-root': { py: 0 } }}
                      />
                    ) : inp.product_name}
                  </TableCell>
                  {isSeeding && (
                    <TableCell align="right">
                      {canEdit && inp.category === 'seed' ? (
                        <TextField size="small" type="number"
                          key={`${inp.id}-acres`}
                          defaultValue={inp.acres ?? ''}
                          placeholder={String(allocation.acres)}
                          onBlur={e => {
                            const val = e.target.value;
                            const newAcres = val === '' ? null : (parseFloat(val) || 0);
                            if (newAcres !== inp.acres) onUpdate(inp.id, { acres: newAcres });
                          }}
                          sx={{ width: 80 }} inputProps={{ style: { textAlign: 'right', fontSize: '0.8rem' } }} />
                      ) : inp.category === 'seed' ? fmt(inp.acres ?? allocation.acres) : '—'}
                    </TableCell>
                  )}
                  {title === 'FERTILIZER' && <TableCell sx={{ color: 'text.secondary' }}>{inp.product_analysis || '—'}</TableCell>}
                  {title === 'CHEMICALS' && <TableCell><Chip label={TIMING_LABELS[inp.timing] || inp.timing || '—'} size="small" variant="outlined" /></TableCell>}
                  <TableCell align="right">
                    {canEdit ? (
                      <TextField size="small" type="number"
                        key={`${inp.id}-rate`}
                        defaultValue={inp.rate}
                        onBlur={e => {
                          const val = parseFloat(e.target.value) || 0;
                          if (val !== inp.rate) onUpdate(inp.id, { rate: val });
                        }}
                        sx={{ width: 70 }} inputProps={{ style: { textAlign: 'right', fontSize: '0.8rem' } }} />
                    ) : fmtDec(inp.rate)}
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.8rem' }}>{inp.rate_unit}</TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                      {inp.cost_per_unit > 0 ? (
                        <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main' }} />
                      ) : (
                        <WarningAmberIcon sx={{ fontSize: 14, color: 'warning.main' }} />
                      )}
                      {canEdit ? (
                        <TextField size="small" type="number"
                          key={`${inp.id}-cpu`}
                          defaultValue={inp.cost_per_unit}
                          onBlur={e => {
                            const val = parseFloat(e.target.value) || 0;
                            if (val !== inp.cost_per_unit) onUpdate(inp.id, { cost_per_unit: val });
                          }}
                          sx={{ width: 80 }} inputProps={{ style: { textAlign: 'right', fontSize: '0.8rem' } }} />
                      ) : `$${fmtDec(inp.cost_per_unit, 4)}`}
                    </Box>
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 500 }}>${fmtDec(cpa)}</TableCell>
                  <TableCell align="right">${fmt(cpa * effectiveAcres(inp, allocation))}</TableCell>
                  {canEdit && (
                    <TableCell>
                      <IconButton size="small" color="error" onClick={() => onDelete(inp.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {canEdit && (
        <Button size="small" startIcon={<AddIcon />} onClick={() => onAdd(title.toLowerCase())} sx={{ mt: 0.5 }}>
          Add {title === 'SEEDING' ? 'Seed' : title === 'FERTILIZER' ? 'Fertilizer' : 'Chemical'}
        </Button>
      )}
      {hasAcresWarning && (
        <Alert severity="warning" sx={{ mt: 0.5, py: 0 }}>
          Seed varietal acres ({fmt(seedAcresSum)}) exceed crop allocation ({fmt(allocation.acres)} ac)
        </Alert>
      )}
    </Box>
  );
}

export default function CropInputPlan() {
  const { currentFarm, farmUnits, canEdit: userCanEdit } = useFarm();
  const [year, setYear] = useState(2026);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [addDialog, setAddDialog] = useState(null); // { allocId, category }
  const [newInput, setNewInput] = useState({ product_name: '', rate: '', rate_unit: 'lbs/acre', cost_per_unit: '', product_analysis: '', timing: '', acres: '' });
  const [error, setError] = useState('');
  const [fertProducts, setFertProducts] = useState([]);
  const [chemProducts, setChemProducts] = useState([]);
  const [seedProducts, setSeedProducts] = useState([]);
  const [copyDialog, setCopyDialog] = useState(null); // { allocId, crop }
  const [copySourceFarm, setCopySourceFarm] = useState('');
  const [copySourceAllocs, setCopySourceAllocs] = useState([]);
  const [copySourceAllocId, setCopySourceAllocId] = useState('');
  const [copyLoading, setCopyLoading] = useState(false);
  const [applyingPricing, setApplyingPricing] = useState(false);

  const load = useCallback(async () => {
    if (!currentFarm) return;
    setLoading(true);
    try {
      const [planRes, fertRes, chemRes, seedRes] = await Promise.all([
        api.get(`/api/farms/${currentFarm.id}/agronomy/plans?year=${year}`),
        api.get(`/api/farms/${currentFarm.id}/agronomy/products?type=fertilizer`),
        api.get(`/api/farms/${currentFarm.id}/agronomy/products?type=chemical`),
        api.get(`/api/farms/${currentFarm.id}/agronomy/products?type=seed`),
      ]);
      setPlan(planRes.data);
      setFertProducts(fertRes.data);
      setChemProducts(chemRes.data);
      setSeedProducts(seedRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [currentFarm, year]);

  useEffect(() => { load(); }, [load]);

  const saveFertilizers = useCallback(async (allocId, rows) => {
    try {
      await api.put(`/api/farms/${currentFarm.id}/agronomy/allocations/${allocId}/fertilizers`, { rows });
    } catch (err) {
      setError(extractErrorMessage(err, 'Error saving fertilizers'));
    }
  }, [currentFarm]);

  const updateAllocTargets = useCallback(async (allocId, fields) => {
    try {
      await api.patch(`/api/farms/${currentFarm.id}/agronomy/allocations/${allocId}`, fields);
    } catch (err) {
      setError(extractErrorMessage(err, 'Error updating targets'));
    }
  }, [currentFarm]);

  const status = plan?.status || 'draft';
  const canEdit = userCanEdit && plan && (status === 'draft' || status === 'submitted');

  const updateInput = async (inputId, data) => {
    try {
      await api.patch(`/api/farms/${currentFarm.id}/agronomy/inputs/${inputId}`, data);
      load();
    } catch (err) {
      console.error(err);
    }
  };

  const deleteInput = async (inputId) => {
    try {
      await api.delete(`/api/farms/${currentFarm.id}/agronomy/inputs/${inputId}`);
      load();
    } catch (err) {
      console.error(err);
    }
  };

  const addInput = async () => {
    if (!addDialog || !newInput.product_name) return;
    // Map UI category to DB category
    let cat;
    if (addDialog.category === 'seeding') {
      cat = 'seed';
    } else if (addDialog.category === 'chemicals') {
      // Seeding timing in chemicals section → seed_treatment category
      cat = newInput.timing === 'seeding' ? 'seed_treatment' : 'chemical';
    } else {
      cat = addDialog.category;
    }
    try {
      const body = {
        category: cat,
        product_name: newInput.product_name,
        rate: parseFloat(newInput.rate) || 0,
        rate_unit: newInput.rate_unit,
        cost_per_unit: parseFloat(newInput.cost_per_unit) || 0,
        product_analysis: newInput.product_analysis || null,
        timing: newInput.timing === 'seeding' ? null : (newInput.timing || null),
        sort_order: 99,
      };
      // Include per-varietal acres for seed inputs
      if (cat === 'seed' && newInput.acres !== '') {
        body.acres = parseFloat(newInput.acres) || null;
      }
      await api.post(`/api/farms/${currentFarm.id}/agronomy/allocations/${addDialog.allocId}/inputs`, body);
      setAddDialog(null);
      setNewInput({ product_name: '', rate: '', rate_unit: 'lbs/acre', cost_per_unit: '', product_analysis: '', timing: '', acres: '' });
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Error adding input'));
    }
  };

  // Copy Inputs: fetch source farm's allocations when farm selected
  const handleCopyFarmChange = async (farmId) => {
    setCopySourceFarm(farmId);
    setCopySourceAllocId('');
    setCopySourceAllocs([]);
    if (!farmId) return;
    try {
      const res = await api.get(`/api/farms/${farmId}/agronomy/plans?year=${year}`);
      const allocs = res.data?.allocations || [];
      setCopySourceAllocs(allocs);
      // Auto-select matching crop if exists
      const match = allocs.find(a => a.crop === copyDialog?.crop);
      if (match) setCopySourceAllocId(match.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyInputs = async () => {
    if (!copySourceAllocId || !copyDialog) return;
    setCopyLoading(true);
    try {
      await api.post(`/api/farms/${currentFarm.id}/agronomy/allocations/${copyDialog.allocId}/copy-inputs`, {
        sourceAllocId: copySourceAllocId,
      });
      setCopyDialog(null);
      setCopySourceFarm('');
      setCopySourceAllocId('');
      setCopySourceAllocs([]);
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Error copying inputs'));
    } finally {
      setCopyLoading(false);
    }
  };

  const handleApplyPricing = async () => {
    setApplyingPricing(true);
    try {
      await api.post(`/api/farms/${currentFarm.id}/agronomy/apply-pricing`, { crop_year: year });
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Error applying pricing'));
    } finally {
      setApplyingPricing(false);
    }
  };

  if (loading) return <Typography>Loading...</Typography>;
  if (!plan) {
    return (
      <Box>
        <Typography variant="h5" fontWeight="bold" sx={{ mb: 2 }}>Crop Input Plan</Typography>
        <Alert severity="info">No plan found for crop year {year}. Create one in Plan Setup first.</Alert>
      </Box>
    );
  }
  if (!plan.allocations || plan.allocations.length === 0) {
    return (
      <Box>
        <Typography variant="h5" fontWeight="bold" sx={{ mb: 2 }}>Crop Input Plan</Typography>
        <Alert severity="info">No crops allocated yet. Add crops in Plan Setup first, then come here to add seed, fertilizer, and chemical inputs.</Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Typography variant="h5" fontWeight="bold">Crop Input Plan</Typography>
        <Chip label={status.toUpperCase()} color={status === 'approved' ? 'success' : 'default'} size="small" />
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Crop Year</InputLabel>
          <Select value={year} label="Crop Year" onChange={e => setYear(e.target.value)}>
            <MenuItem value={2026}>2026</MenuItem>
            <MenuItem value={2025}>2025</MenuItem>
          </Select>
        </FormControl>
        {canEdit && (
          <Button
            variant="outlined"
            size="small"
            startIcon={<PriceCheckIcon />}
            onClick={handleApplyPricing}
            disabled={applyingPricing}
          >
            {applyingPricing ? 'Applying...' : 'Auto-fill Prices'}
          </Button>
        )}
      </Box>

      {plan.allocations?.map(alloc => {
        const seedInputs = alloc.inputs?.filter(i => i.category === 'seed' || i.category === 'seed_treatment') || [];
        const fertInputs = alloc.inputs?.filter(i => i.category === 'fertilizer') || [];
        const chemInputs = (alloc.inputs?.filter(i => i.category === 'chemical') || [])
          .sort((a, b) => {
            const ai = TIMING_ORDER.indexOf(a.timing);
            const bi = TIMING_ORDER.indexOf(b.timing);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
          });
        const totalCost = alloc.inputs?.reduce((s, i) => s + i.rate * i.cost_per_unit * effectiveAcres(i, alloc), 0) || 0;
        const totalPerAcre = alloc.acres ? totalCost / alloc.acres : 0;
        const revenue = alloc.acres * alloc.target_yield_bu * alloc.commodity_price;

        return (
          <Accordion key={alloc.id} defaultExpanded sx={{ mb: 1 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%', pr: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>{alloc.crop}</Typography>
                <Chip label={`${fmt(alloc.acres)} ac`} size="small" />
                <Chip label={`Target: ${alloc.target_yield_bu} bu/ac`} size="small" variant="outlined" />
                {canEdit && (
                  <Tooltip title="Copy inputs from another farm">
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); setCopyDialog({ allocId: alloc.id, crop: alloc.crop }); }}>
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                <Box sx={{ flexGrow: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  ${fmtDec(totalPerAcre)}/ac | Total: ${fmt(totalCost)} | Margin: ${fmt(revenue - totalCost)}
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {/* Seeding section — always show if has inputs or can add */}
              {(seedInputs.length > 0 || canEdit) && (
                <InputSection title="SEEDING" inputs={seedInputs} allocation={alloc}
                  canEdit={canEdit} onAdd={() => setAddDialog({ allocId: alloc.id, category: 'seeding' })}
                  onDelete={deleteInput} onUpdate={updateInput}
                  products={seedProducts.filter(p =>
                    !p.crop_filter || p.crop_filter.split(',').map(s => s.trim()).includes(alloc.crop)
                  )} />
              )}
              {/* Fertilizer matrix — always show if has inputs, products exist, or can edit */}
              {(fertInputs.length > 0 || fertProducts.length > 0 || canEdit) && (
                <FertilizerMatrix
                  allocation={alloc}
                  products={fertProducts}
                  canEdit={canEdit}
                  onSave={saveFertilizers}
                  onAllocUpdate={updateAllocTargets}
                />
              )}
              {/* Chemicals section — always show if has inputs or can add */}
              {(chemInputs.length > 0 || canEdit) && (
                <InputSection title="CHEMICALS" inputs={chemInputs} allocation={alloc}
                  canEdit={canEdit} onAdd={() => setAddDialog({ allocId: alloc.id, category: 'chemicals' })}
                  onDelete={deleteInput} onUpdate={updateInput} products={chemProducts} />
              )}
              <Divider sx={{ my: 1 }} />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Typography variant="subtitle1" fontWeight="bold">
                  Total {alloc.crop}: ${fmtDec(totalPerAcre)}/acre | ${fmt(totalCost)}
                </Typography>
              </Box>
            </AccordionDetails>
          </Accordion>
        );
      })}

      {/* Add Input Dialog */}
      <Dialog open={!!addDialog} onClose={() => setAddDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Add {addDialog?.category === 'seeding' ? 'Seed' : 'Chemical'} Input</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {/* Chemicals: timing first, then filtered product list */}
            {addDialog?.category === 'chemicals' && (
              <FormControl fullWidth>
                <InputLabel>Timing *</InputLabel>
                <Select value={newInput.timing} label="Timing *" onChange={e => setNewInput({ ...newInput, timing: e.target.value, product_name: '', rate: '', cost_per_unit: '' })}>
                  {TIMING_OPTIONS.map(t => (
                    <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {(() => {
              let prods = [];
              if (addDialog?.category === 'seeding') {
                // Seed products filtered by crop
                const alloc = plan?.allocations?.find(a => a.id === addDialog?.allocId);
                prods = seedProducts.filter(p =>
                  !p.crop_filter || p.crop_filter.split(',').map(s => s.trim()).includes(alloc?.crop)
                );
              } else if (addDialog?.category === 'chemicals' && newInput.timing) {
                // Filter chemical products by selected timing
                prods = chemProducts.filter(p => {
                  if (!p.timing_tags) return true; // null timing_tags = show everywhere
                  const tags = p.timing_tags.split(',').map(s => s.trim());
                  return tags.includes(newInput.timing);
                });
              } else if (addDialog?.category === 'fertilizer') {
                prods = fertProducts;
              }
              return prods.length > 0 ? (
                <Autocomplete
                  freeSolo
                  options={prods.map(p => p.name)}
                  value={newInput.product_name}
                  onChange={(_, val) => {
                    const match = prods.find(p => p.name === val);
                    setNewInput({
                      ...newInput,
                      product_name: val || '',
                      cost_per_unit: match?.cost_per_application_unit ? String(match.cost_per_application_unit)
                        : match?.default_cost ? String(match.default_cost) : newInput.cost_per_unit,
                      rate: match?.default_rate ? String(match.default_rate) : newInput.rate,
                      rate_unit: match?.default_unit || newInput.rate_unit,
                    });
                  }}
                  onInputChange={(_, val, reason) => {
                    if (reason === 'input') setNewInput({ ...newInput, product_name: val });
                  }}
                  renderInput={(params) => <TextField {...params} label="Product Name" fullWidth />}
                  disabled={addDialog?.category === 'chemicals' && !newInput.timing}
                />
              ) : (
                <TextField
                  label="Product Name"
                  value={newInput.product_name}
                  onChange={e => setNewInput({ ...newInput, product_name: e.target.value })}
                  fullWidth
                  disabled={addDialog?.category === 'chemicals' && !newInput.timing}
                  helperText={addDialog?.category === 'chemicals' && !newInput.timing ? 'Select timing first' : ''}
                />
              );
            })()}
            <Stack direction="row" spacing={2}>
              <TextField label="Rate" type="number" value={newInput.rate} onChange={e => setNewInput({ ...newInput, rate: e.target.value })} sx={{ flex: 1 }} />
              <FormControl sx={{ flex: 1 }}>
                <InputLabel>Unit</InputLabel>
                <Select value={newInput.rate_unit} label="Unit" onChange={e => setNewInput({ ...newInput, rate_unit: e.target.value })}>
                  <MenuItem value="lbs/acre">lbs/acre</MenuItem>
                  <MenuItem value="L/acre">L/acre</MenuItem>
                  <MenuItem value="US Gal/Acre">US Gal/Acre</MenuItem>
                  <MenuItem value="per acre">per acre</MenuItem>
                </Select>
              </FormControl>
            </Stack>
            <TextField label="Cost per Unit ($)" type="number" value={newInput.cost_per_unit} onChange={e => setNewInput({ ...newInput, cost_per_unit: e.target.value })} fullWidth />
            {addDialog?.category === 'seeding' && (() => {
              const alloc = plan?.allocations?.find(a => a.id === addDialog?.allocId);
              const existingSeedAcres = alloc?.inputs?.filter(i => i.category === 'seed').reduce((s, i) => s + (i.acres || 0), 0) || 0;
              const remaining = alloc ? alloc.acres - existingSeedAcres : 0;
              return (
                <TextField
                  label="Acres for this varietal"
                  type="number"
                  value={newInput.acres}
                  onChange={e => setNewInput({ ...newInput, acres: e.target.value })}
                  fullWidth
                  helperText={remaining > 0 ? `${fmt(remaining)} of ${fmt(alloc?.acres)} ac remaining` : `Total crop: ${fmt(alloc?.acres)} ac`}
                />
              );
            })()}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={addInput} disabled={!newInput.product_name}>Add</Button>
        </DialogActions>
      </Dialog>

      {/* Copy Inputs Dialog */}
      <Dialog open={!!copyDialog} onClose={() => setCopyDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Copy Inputs to {copyDialog?.crop}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Copy product list, application rates, and costs from another farm's crop plan.
            This will replace any existing inputs on this allocation.
          </Typography>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Source Farm</InputLabel>
              <Select value={copySourceFarm} label="Source Farm" onChange={e => handleCopyFarmChange(e.target.value)}>
                {(farmUnits || []).filter(f => f.id !== currentFarm?.id).map(f => (
                  <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            {copySourceAllocs.length > 0 && (
              <FormControl fullWidth>
                <InputLabel>Source Crop</InputLabel>
                <Select value={copySourceAllocId} label="Source Crop" onChange={e => setCopySourceAllocId(e.target.value)}>
                  {copySourceAllocs.map(a => {
                    const inputCount = a.inputs?.length || 0;
                    return (
                      <MenuItem key={a.id} value={a.id}>
                        {a.crop} ({fmt(a.acres)} ac) — {inputCount} inputs
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>
            )}
            {copySourceFarm && copySourceAllocs.length === 0 && (
              <Alert severity="info">No crop allocations found for this farm in {year}.</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCopyDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleCopyInputs} disabled={!copySourceAllocId || copyLoading}>
            {copyLoading ? 'Copying...' : 'Copy Inputs'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
      </Snackbar>
    </Box>
  );
}
