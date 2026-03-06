import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Button, Chip, Alert, IconButton, TextField, Stack,
  Dialog, DialogTitle, DialogContent, DialogActions, Snackbar,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Select, MenuItem, FormControl, InputLabel, Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import SendIcon from '@mui/icons-material/Send';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import LockIcon from '@mui/icons-material/Lock';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { extractErrorMessage } from '../../utils/errorHelpers';

function fmt(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function fmtDec(n) { return (n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const CROP_OPTIONS = [
  'Canola', 'Spring Wheat', 'Spring Durum Wheat', 'Spring Barley',
  'Chickpeas', 'Small Red Lentils', 'Yellow Field Peas', 'Flax',
];

const STATUS_COLORS = { draft: 'default', submitted: 'warning', approved: 'success', locked: 'info' };

export default function PlanSetup() {
  const { currentFarm, canEdit, isAdmin } = useFarm();
  const [year, setYear] = useState(2026);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newCrop, setNewCrop] = useState('');
  const [newAcres, setNewAcres] = useState('');
  const [newYield, setNewYield] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [error, setError] = useState('');
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  const load = useCallback(async () => {
    if (!currentFarm) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/farms/${currentFarm.id}/agronomy/plans?year=${year}`);
      setPlan(res.data || null);
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

  const updateStatus = async (status) => {
    try {
      await api.patch(`/api/farms/${currentFarm.id}/agronomy/plans/${plan.id}/status`, { status });
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Error updating status'));
    }
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
      await api.patch(`/api/farms/${currentFarm.id}/agronomy/allocations/${id}`, { [field]: parseFloat(value) || 0 });
      load();
    } catch (err) {
      console.error('Update error:', err);
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
  const isEditable = canEdit && plan && (status === 'draft' || status === 'submitted');
  const totalAcres = plan?.allocations?.reduce((s, a) => s + a.acres, 0) || 0;
  const totalRevenue = plan?.allocations?.reduce((s, a) => s + a.acres * a.target_yield_bu * a.commodity_price, 0) || 0;
  const totalProduction = plan?.allocations?.reduce((s, a) => s + a.acres * a.target_yield_bu, 0) || 0;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight="bold">Plan Setup</Typography>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Crop Year</InputLabel>
          <Select value={year} label="Crop Year" onChange={e => setYear(e.target.value)}>
            <MenuItem value={2026}>2026</MenuItem>
            <MenuItem value={2025}>2025</MenuItem>
            <MenuItem value={2027}>2027</MenuItem>
          </Select>
        </FormControl>
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
          <Button variant="contained" color="success" startIcon={<CheckCircleIcon />} onClick={() => updateStatus('approved')}>
            Approve Plan
          </Button>
        )}
        {plan && isAdmin && status === 'approved' && (
          <Button variant="outlined" startIcon={<LockIcon />} onClick={() => updateStatus('locked')}>
            Lock Plan
          </Button>
        )}
      </Box>

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
                  <TableRow sx={{ '& th': { fontWeight: 'bold', bgcolor: 'grey.100' } }}>
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
                        <TableCell sx={{ fontWeight: 'bold' }}>{alloc.crop}</TableCell>
                        <TableCell align="right">
                          {isEditable ? (
                            <TextField size="small" type="number" defaultValue={alloc.acres}
                              onBlur={e => updateAllocation(alloc.id, 'acres', e.target.value)}
                              sx={{ width: 100 }} inputProps={{ style: { textAlign: 'right' } }} />
                          ) : fmt(alloc.acres)}
                        </TableCell>
                        <TableCell align="right">
                          {isEditable ? (
                            <TextField size="small" type="number" defaultValue={alloc.target_yield_bu}
                              onBlur={e => updateAllocation(alloc.id, 'target_yield_bu', e.target.value)}
                              sx={{ width: 80 }} inputProps={{ style: { textAlign: 'right' } }} />
                          ) : fmtDec(alloc.target_yield_bu)}
                        </TableCell>
                        <TableCell align="right">
                          {isEditable ? (
                            <TextField size="small" type="number" defaultValue={alloc.commodity_price}
                              onBlur={e => updateAllocation(alloc.id, 'commodity_price', e.target.value)}
                              sx={{ width: 80 }} inputProps={{ style: { textAlign: 'right' } }} />
                          ) : `$${fmtDec(alloc.commodity_price)}`}
                        </TableCell>
                        <TableCell align="right">{fmt(prod)}</TableCell>
                        <TableCell align="right">${fmt(rev)}</TableCell>
                        <TableCell align="right">
                          <Chip label={`${inputCount} items`} size="small" variant="outlined" />
                        </TableCell>
                        {isEditable && (
                          <TableCell>
                            <Tooltip title="Delete">
                              <IconButton size="small" color="error" onClick={() => deleteAllocation(alloc.id)}>
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
                {CROP_OPTIONS.filter(c => !plan?.allocations?.some(a => a.crop === c)).map(c => (
                  <MenuItem key={c} value={c}>{c}</MenuItem>
                ))}
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

      <ConfirmDialog {...confirmDialogProps} />
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
      </Snackbar>
    </Box>
  );
}
