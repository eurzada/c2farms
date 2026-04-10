import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Button, Chip, Alert, IconButton, TextField, Stack,
  Dialog, DialogTitle, DialogContent, DialogActions, Snackbar, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Select, MenuItem, FormControl, InputLabel, Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import SendIcon from '@mui/icons-material/Send';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import CancelIcon from '@mui/icons-material/Cancel';
import ReplayIcon from '@mui/icons-material/Replay';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { extractErrorMessage } from '../../utils/errorHelpers';

function fmt(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function fmtDec(n) { return (n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// Crop options loaded from API (most-used first, then master list)

const STATUS_COLORS = { draft: 'default', submitted: 'warning', approved: 'success', locked: 'info', rejected: 'error' };

export default function PlanSetup() {
  const { currentFarm, canEdit, isAdmin, fiscalYear: year } = useFarm();
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newCrop, setNewCrop] = useState('');
  const [newAcres, setNewAcres] = useState('');
  const [newYield, setNewYield] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [error, setError] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');
  const [cropOptions, setCropOptions] = useState([]);
  const [usedCrops, setUsedCrops] = useState(new Set());
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  const load = useCallback(async () => {
    if (!currentFarm) return;
    setLoading(true);
    try {
      const [planRes, cropRes] = await Promise.all([
        api.get(`/api/farms/${currentFarm.id}/agronomy/plans?year=${year}`),
        api.get('/api/agronomy/crop-options'),
      ]);
      setPlan(planRes.data || null);
      setCropOptions(cropRes.data.all || []);
      setUsedCrops(new Set(cropRes.data.used || []));
    } catch (err) {
      console.error('Plan load error:', err);
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }, [currentFarm, year]);

  useEffect(() => { load(); }, [load]);

  const createPlan = async () => {
    try {
      await api.post(`/api/farms/${currentFarm.id}/agronomy/plans`, { crop_year: year });
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Error creating plan'));
    }
  };

  const updateStatus = async (status, extra = {}) => {
    try {
      await api.patch(`/api/farms/${currentFarm.id}/agronomy/plans/${plan.id}/status`, { status, ...extra });
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Error updating status'));
    }
  };

  const handleReject = async () => {
    if (!rejectNotes.trim()) return;
    await updateStatus('rejected', { rejection_notes: rejectNotes.trim() });
    setRejectOpen(false);
    setRejectNotes('');
  };

  const handleUnlock = async () => {
    const ok = await confirm({
      title: 'Unlock Plan',
      message: 'This will revert the plan to draft status, allowing edits. Continue?',
      confirmText: 'Unlock',
    });
    if (ok) await updateStatus('draft');
  };

  const addAllocation = async () => {
    if (!newCrop || !newAcres) return;
    try {
      await api.post(`/api/farms/${currentFarm.id}/agronomy/plans/${plan.id}/allocations`, {
        crop: newCrop,
        acres: parseFloat(newAcres),
        target_yield_bu: parseFloat(newYield) || 0,
        commodity_price: parseFloat(newPrice) || 0,
        sort_order: (plan.allocations?.length || 0),
      });
      setAddOpen(false);
      setNewCrop(''); setNewAcres(''); setNewYield(''); setNewPrice('');
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Error adding crop'));
    }
  };

  const updateAllocation = async (id, field, value) => {
    try {
      const parsed = field === 'crop' ? value : (parseFloat(value) || 0);
      // Optimistic local update — avoids re-render that kills focus/tab navigation
      setPlan(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          allocations: prev.allocations.map(a =>
            a.id === id ? { ...a, [field]: parsed } : a
          ),
        };
      });
      const payload = { [field]: parsed };
      await api.patch(`/api/farms/${currentFarm.id}/agronomy/allocations/${id}`, payload);
    } catch (err) {
      console.error('Update error:', err);
      load(); // Re-fetch on error to revert
    }
  };

  const deleteAllocation = async (id) => {
    const ok = await confirm({
      title: 'Delete Allocation',
      message: 'Delete this crop allocation and all its inputs?',
      confirmText: 'Delete',
      confirmColor: 'error',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/farms/${currentFarm.id}/agronomy/allocations/${id}`);
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Error deleting allocation'));
    }
  };

  if (loading) return <Typography>Loading...</Typography>;

  const status = plan?.status || 'draft';
  const isEditable = canEdit && plan && (status === 'draft' || status === 'submitted' || status === 'rejected');
  const totalAcres = plan?.allocations?.reduce((s, a) => s + a.acres, 0) || 0;
  const totalRevenue = plan?.allocations?.reduce((s, a) => s + a.acres * a.target_yield_bu * a.commodity_price, 0) || 0;
  const totalProduction = plan?.allocations?.reduce((s, a) => s + a.acres * a.target_yield_bu, 0) || 0;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h5" fontWeight="bold">Plan Setup</Typography>
          <Typography variant="caption" color="text.secondary">Crop Year {year}</Typography>
        </Box>
        {plan && <Chip label={status.toUpperCase()} color={STATUS_COLORS[status] || 'default'} />}
        {plan?.prepared_by && <Typography variant="body2" color="text.secondary">Prepared by: {plan.prepared_by}</Typography>}
        {plan?.approved_by && <Typography variant="body2" color="text.secondary">Approved by: {plan.approved_by}</Typography>}
        <Box sx={{ flexGrow: 1 }} />
        {isEditable && status === 'draft' && (
          <Button variant="outlined" startIcon={<SendIcon />} onClick={() => updateStatus('submitted')}>
            Submit for Review
          </Button>
        )}
        {plan && isAdmin && status === 'submitted' && (
          <>
            <Button variant="contained" color="success" startIcon={<CheckCircleIcon />} onClick={() => updateStatus('approved')}>
              Approve Plan
            </Button>
            <Button variant="outlined" color="error" startIcon={<CancelIcon />} onClick={() => setRejectOpen(true)}>
              Reject
            </Button>
          </>
        )}
        {plan && isAdmin && status === 'approved' && (
          <>
            <Button variant="outlined" startIcon={<LockIcon />} onClick={() => updateStatus('locked')}>
              Lock Plan
            </Button>
            <Button variant="outlined" color="warning" startIcon={<LockOpenIcon />} onClick={handleUnlock}>
              Unlock
            </Button>
          </>
        )}
        {plan && isAdmin && status === 'locked' && (
          <Button variant="outlined" color="warning" startIcon={<LockOpenIcon />} onClick={handleUnlock}>
            Unlock Plan
          </Button>
        )}
        {plan && canEdit && status === 'rejected' && (
          <Button variant="outlined" startIcon={<ReplayIcon />} onClick={() => updateStatus('submitted')}>
            Resubmit for Review
          </Button>
        )}
      </Box>

      {plan && status === 'rejected' && (
        <Alert severity="error" sx={{ mb: 2 }}>
          <Typography fontWeight="bold">Plan Rejected{plan.rejected_by ? ` by ${plan.rejected_by}` : ''}</Typography>
          {plan.rejection_notes && <Typography variant="body2" sx={{ mt: 0.5 }}>{plan.rejection_notes}</Typography>}
        </Alert>
      )}

      {!plan && (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>No agronomy plan for crop year {year}</Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Create a plan to define crop allocations, yield targets, and input programs.
          </Typography>
          {canEdit && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={createPlan}>
              Create {year} Plan
            </Button>
          )}
        </Paper>
      )}

      {plan && (
        <>
          {/* Summary Cards */}
          <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
            <Paper sx={{ p: 2, flex: 1, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">Total Acres</Typography>
              <Typography variant="h6" fontWeight="bold">{fmt(totalAcres)}</Typography>
            </Paper>
            <Paper sx={{ p: 2, flex: 1, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">Total Production (bu)</Typography>
              <Typography variant="h6" fontWeight="bold">{fmt(totalProduction)}</Typography>
            </Paper>
            <Paper sx={{ p: 2, flex: 1, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">Gross Revenue</Typography>
              <Typography variant="h6" fontWeight="bold">${fmt(totalRevenue)}</Typography>
            </Paper>
            <Paper sx={{ p: 2, flex: 1, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">Crops</Typography>
              <Typography variant="h6" fontWeight="bold">{plan.allocations?.length || 0}</Typography>
            </Paper>
          </Stack>

          {/* Crop Allocation Table */}
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <Typography variant="h6">Crop Allocations</Typography>
            <Box sx={{ flexGrow: 1 }} />
            {isEditable && (
              <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>Add Crop</Button>
            )}
          </Box>

          {(!plan.allocations || plan.allocations.length === 0) ? (
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography color="text.secondary" sx={{ mb: 1 }}>No crops added yet.</Typography>
              {isEditable && (
                <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
                  Add Your First Crop
                </Button>
              )}
            </Paper>
          ) : (
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ '& th': { fontWeight: 'bold', bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.100' } }}>
                    <TableCell>Crop</TableCell>
                    <TableCell align="right">Acres</TableCell>
                    <TableCell align="right">Target Yield (bu/ac)</TableCell>
                    <TableCell align="right">Price ($/bu)</TableCell>
                    <TableCell align="right">Est. Production (bu)</TableCell>
                    <TableCell align="right">Gross Revenue ($)</TableCell>
                    <TableCell align="right">Inputs</TableCell>
                    {isEditable && <TableCell width={50} />}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {plan.allocations.map(alloc => {
                    const prod = alloc.acres * alloc.target_yield_bu;
                    const rev = prod * alloc.commodity_price;
                    const inputCount = alloc.inputs?.length || 0;
                    return (
                      <TableRow key={alloc.id} hover>
                        <TableCell sx={{ fontWeight: 'bold' }}>
                          {isEditable ? (
                            <Select size="small" value={alloc.crop}
                              onChange={e => updateAllocation(alloc.id, 'crop', e.target.value)}
                              sx={{ minWidth: 160, fontWeight: 'bold' }}>
                              {cropOptions.filter(c => c === alloc.crop || !plan?.allocations?.some(a => a.crop === c)).map(c => (
                                <MenuItem key={c} value={c} sx={usedCrops.has(c) ? { fontWeight: 'bold' } : {}}>{c}</MenuItem>
                              ))}
                            </Select>
                          ) : alloc.crop}
                        </TableCell>
                        <TableCell align="right">
                          {isEditable ? (
                            <TextField size="small" type="number" key={`${alloc.id}-acres`} defaultValue={alloc.acres}
                              onBlur={e => { if (parseFloat(e.target.value) !== alloc.acres) updateAllocation(alloc.id, 'acres', e.target.value); }}
                              sx={{ width: 100 }} inputProps={{ style: { textAlign: 'right' } }} />
                          ) : fmt(alloc.acres)}
                        </TableCell>
                        <TableCell align="right">
                          {isEditable ? (
                            <TextField size="small" type="number" key={`${alloc.id}-yield`} defaultValue={alloc.target_yield_bu}
                              onBlur={e => { if (parseFloat(e.target.value) !== alloc.target_yield_bu) updateAllocation(alloc.id, 'target_yield_bu', e.target.value); }}
                              sx={{ width: 80 }} inputProps={{ style: { textAlign: 'right' } }} />
                          ) : fmtDec(alloc.target_yield_bu)}
                        </TableCell>
                        <TableCell align="right">
                          {isEditable ? (
                            <TextField size="small" type="number" key={`${alloc.id}-price`} defaultValue={alloc.commodity_price}
                              onBlur={e => { if (parseFloat(e.target.value) !== alloc.commodity_price) updateAllocation(alloc.id, 'commodity_price', e.target.value); }}
                              sx={{ width: 80 }} inputProps={{ style: { textAlign: 'right' } }} />
                          ) : `$${fmtDec(alloc.commodity_price)}`}
                        </TableCell>
                        <TableCell align="right">{fmt(prod)}</TableCell>
                        <TableCell align="right">${fmt(rev)}</TableCell>
                        <TableCell align="right">
                          <Chip label={`${inputCount} items`} size="small" variant="outlined" tabIndex={-1} />
                        </TableCell>
                        {isEditable && (
                          <TableCell>
                            <Tooltip title="Delete">
                              <IconButton size="small" color="error" tabIndex={-1} onClick={() => deleteAllocation(alloc.id)}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  <TableRow sx={{ '& td': { fontWeight: 'bold', borderTop: 2, borderColor: 'divider' } }}>
                    <TableCell>TOTAL</TableCell>
                    <TableCell align="right">{fmt(totalAcres)}</TableCell>
                    <TableCell align="right" />
                    <TableCell align="right" />
                    <TableCell align="right">{fmt(totalProduction)}</TableCell>
                    <TableCell align="right">${fmt(totalRevenue)}</TableCell>
                    <TableCell align="right" />
                    {isEditable && <TableCell />}
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}

      {/* Add Crop Dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Crop Allocation</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Crop</InputLabel>
              <Select value={newCrop} label="Crop" onChange={e => setNewCrop(e.target.value)}>
                {cropOptions.filter(c => !plan?.allocations?.some(a => a.crop === c)).map((c, i) => {
                  // Add divider between used and unused crops
                  const isFirstUnused = !usedCrops.has(c) && (i === 0 || usedCrops.has(cropOptions.filter(x => !plan?.allocations?.some(a => a.crop === x))[i - 1]));
                  return [
                    isFirstUnused && <Divider key={`div-${c}`} />,
                    <MenuItem key={c} value={c} sx={usedCrops.has(c) ? { fontWeight: 'bold' } : {}}>{c}</MenuItem>,
                  ];
                })}
              </Select>
            </FormControl>
            <TextField label="Acres" type="number" value={newAcres} onChange={e => setNewAcres(e.target.value)} fullWidth />
            <TextField label="Target Yield (bu/ac)" type="number" value={newYield} onChange={e => setNewYield(e.target.value)} fullWidth />
            <TextField label="Commodity Price ($/bu)" type="number" value={newPrice} onChange={e => setNewPrice(e.target.value)} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={addAllocation} disabled={!newCrop || !newAcres}>Add</Button>
        </DialogActions>
      </Dialog>

      {/* Reject Plan Dialog */}
      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Reject Plan</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Provide notes explaining why the plan is being rejected. These will be sent to the submitting agronomist.
          </Typography>
          <TextField
            label="Rejection Notes"
            multiline
            rows={3}
            value={rejectNotes}
            onChange={e => setRejectNotes(e.target.value)}
            fullWidth
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setRejectOpen(false); setRejectNotes(''); }}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleReject} disabled={!rejectNotes.trim()}>
            Reject Plan
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog {...confirmDialogProps} />
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
      </Snackbar>
    </Box>
  );
}
