import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, Stack, Chip, Card, CardContent, CardActions, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, Grid, Snackbar, Alert, IconButton, Tooltip,
  Paper, LinearProgress, Select, InputLabel, FormControl, Switch, FormControlLabel, Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import RefreshIcon from '@mui/icons-material/Refresh';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import DoneIcon from '@mui/icons-material/Done';
import CancelIcon from '@mui/icons-material/Cancel';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import PersonIcon from '@mui/icons-material/Person';
import { useFarm } from '../../contexts/FarmContext';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { fmt } from '../../utils/formatting';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import { getSocket } from '../../services/socket';

const URGENCY_COLORS = ['#d32f2f', '#ed6c02', '#1976d2', '#757575'];

function getUrgencyColor(rank, total) {
  if (rank <= 1) return URGENCY_COLORS[0]; // red — top priority
  if (rank <= 3) return URGENCY_COLORS[1]; // orange
  if (rank <= total * 0.6) return URGENCY_COLORS[2]; // blue
  return URGENCY_COLORS[3]; // grey
}

export default function Shipping() {
  const { currentFarm, canEdit, isAdmin } = useFarm();
  const { user } = useAuth();

  const [priorities, setPriorities] = useState([]);
  const [feed, setFeed] = useState([]);
  const [myLoads, setMyLoads] = useState([]);
  const [locations, setLocations] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'info' });
  const [createOpen, setCreateOpen] = useState(false);
  const [showFeed, setShowFeed] = useState(false);
  const { confirm, dialogProps } = useConfirmDialog();

  const fetchData = useCallback(async () => {
    if (!currentFarm) return;
    setLoading(true);
    try {
      const [prioRes, feedRes, loadsRes, locRes, contractRes] = await Promise.all([
        api.get(`/api/farms/${currentFarm.id}/shipping/priorities`),
        api.get(`/api/farms/${currentFarm.id}/shipping/feed`),
        api.get(`/api/farms/${currentFarm.id}/shipping/my-loads`),
        api.get(`/api/farms/${currentFarm.id}/inventory/locations`),
        api.get(`/api/farms/${currentFarm.id}/marketing/contracts?status=executed,in_delivery`).catch(() => ({ data: { contracts: [] } })),
      ]);
      setPriorities(prioRes.data.priorities || []);
      setFeed(feedRes.data.feed || []);
      setMyLoads(loadsRes.data.loads || []);
      setLocations(locRes.data.locations || []);
      // Filter to contracts with remaining volume
      setContracts((contractRes.data.contracts || contractRes.data || []).filter(c => c.remaining_mt > 0));
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to load'), severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, [currentFarm]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Real-time updates
  useEffect(() => {
    if (!currentFarm) return;
    const socket = getSocket();
    const handler = () => fetchData();
    const events = ['shipping:priority_added', 'shipping:priority_updated', 'shipping:reordered',
      'shipping:load_claimed', 'shipping:load_cancelled', 'shipping:load_delivered'];
    events.forEach(e => socket?.on(e, handler));
    return () => events.forEach(e => socket?.off(e, handler));
  }, [currentFarm, fetchData]);

  // ─── Handlers ─────────────────────────────────────────────────────

  const handleClaim = async (priorityId) => {
    try {
      await api.post(`/api/farms/${currentFarm.id}/shipping/priorities/${priorityId}/claim`);
      setSnack({ open: true, message: 'Load claimed — go get it!', severity: 'success' });
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to claim load'), severity: 'error' });
    }
  };

  const handleCancelClaim = async (claimId) => {
    try {
      await api.post(`/api/farms/${currentFarm.id}/shipping/claims/${claimId}/cancel`);
      setSnack({ open: true, message: 'Load cancelled', severity: 'info' });
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to cancel'), severity: 'error' });
    }
  };

  const handleTogglePause = async (priority) => {
    try {
      await api.patch(`/api/farms/${currentFarm.id}/shipping/priorities/${priority.id}`, {
        is_paused: !priority.is_paused,
      });
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to update'), severity: 'error' });
    }
  };

  const handleMove = async (priority, direction) => {
    const idx = priorities.findIndex(p => p.id === priority.id);
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= priorities.length) return;

    const reordered = [...priorities];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];

    try {
      await api.post(`/api/farms/${currentFarm.id}/shipping/reorder`, {
        ordered_ids: reordered.map(p => p.id),
      });
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to reorder'), severity: 'error' });
    }
  };

  const handleMarkDone = async (priority) => {
    const ok = await confirm({ title: 'Mark as Done', message: `Mark "${priority.marketing_contract?.commodity?.name} → ${priority.marketing_contract?.counterparty?.name}" as done?`, confirmText: 'Done' });
    if (!ok) return;
    try {
      await api.patch(`/api/farms/${currentFarm.id}/shipping/priorities/${priority.id}`, { status: 'done' });
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed'), severity: 'error' });
    }
  };

  // ─── Create Dialog ────────────────────────────────────────────────

  const [newPriority, setNewPriority] = useState({
    marketing_contract_id: '', source_location_id: '', target_loads: '', notes: '',
  });

  const handleCreate = async () => {
    try {
      await api.post(`/api/farms/${currentFarm.id}/shipping/priorities`, newPriority);
      setSnack({ open: true, message: 'Priority added', severity: 'success' });
      setCreateOpen(false);
      setNewPriority({ marketing_contract_id: '', source_location_id: '', target_loads: '', notes: '' });
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to create'), severity: 'error' });
    }
  };

  // ─── My Active Claims ────────────────────────────────────────────

  const activeClaims = myLoads.filter(l => l.status === 'claimed');

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          <LocalShippingIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
          Shipping Board
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" onClick={() => setShowFeed(!showFeed)}>
            {showFeed ? 'Hide Feed' : 'Activity'}
          </Button>
          <IconButton onClick={fetchData}><RefreshIcon /></IconButton>
          {canEdit && (
            <Button startIcon={<AddIcon />} onClick={() => setCreateOpen(true)} variant="contained" size="small">
              Add Priority
            </Button>
          )}
        </Stack>
      </Stack>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* My Active Claims Banner */}
      {activeClaims.length > 0 && (
        <Paper sx={{ p: 2, mb: 2, bgcolor: 'warning.light', color: 'warning.contrastText' }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Your Active Loads</Typography>
          {activeClaims.map(claim => {
            const p = claim.shipping_priority;
            return (
              <Stack key={claim.id} direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                <Typography variant="body2">
                  {p?.marketing_contract?.commodity?.name} → {p?.marketing_contract?.counterparty?.name}
                  {p?.source_location && ` (from ${p.source_location.name})`}
                </Typography>
                <Button size="small" color="inherit" variant="outlined" onClick={() => handleCancelClaim(claim.id)}>
                  Cancel
                </Button>
              </Stack>
            );
          })}
        </Paper>
      )}

      {/* Activity Feed */}
      {showFeed && feed.length > 0 && (
        <Paper sx={{ p: 2, mb: 2, maxHeight: 200, overflow: 'auto' }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Recent Activity</Typography>
          {feed.map(f => (
            <Typography key={f.id} variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              <strong>{f.trucker}</strong>{' '}
              {f.status === 'claimed' ? 'started' : f.status === 'delivered' ? 'delivered' : f.status}{' '}
              {f.commodity} {f.mt_delivered > 0 ? `(${fmt(f.mt_delivered)} MT)` : ''}{' '}
              — {timeAgo(f.updated_at)}
            </Typography>
          ))}
        </Paper>
      )}

      {/* Priority Cards */}
      {priorities.length === 0 && !loading && (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">No shipping priorities set. {canEdit ? 'Click "Add Priority" to get started.' : 'Ask your manager to set up priorities.'}</Typography>
        </Paper>
      )}

      <Stack spacing={1.5}>
        {priorities.map((p, idx) => {
          const contract = p.marketing_contract;
          const commodity = contract?.commodity?.name || '—';
          const buyer = contract?.counterparty?.name || '—';
          const elevator = contract?.elevator_site || buyer;
          const location = p.source_location?.name || '—';
          const bin = p.source_bin?.bin_number;
          const pctDone = p.target_loads ? Math.min(100, (p.completed_loads / p.target_loads) * 100) : null;
          const urgencyColor = getUrgencyColor(idx + 1, priorities.length);

          return (
            <Card key={p.id} sx={{
              borderLeft: `4px solid ${p.is_paused ? '#bdbdbd' : urgencyColor}`,
              opacity: p.is_paused ? 0.6 : 1,
            }}>
              <CardContent sx={{ pb: 1 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      {commodity} → {elevator}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      From: {location}{bin ? ` / Bin ${bin}` : ''} | Contract: {contract?.contract_number || '—'}
                    </Typography>
                  </Box>
                  {p.is_paused && <Chip label="PAUSED" size="small" color="default" />}
                </Stack>

                {/* Progress */}
                <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1 }}>
                  {p.target_loads && (
                    <>
                      <Typography variant="body2">
                        <strong>{p.completed_loads}</strong> / {p.target_loads} loads
                      </Typography>
                      <Box sx={{ flex: 1, maxWidth: 200 }}>
                        <LinearProgress variant="determinate" value={pctDone}
                          sx={{ height: 8, borderRadius: 1, bgcolor: '#e0e0e0',
                            '& .MuiLinearProgress-bar': { bgcolor: pctDone >= 100 ? '#2e7d32' : urgencyColor } }} />
                      </Box>
                    </>
                  )}
                  {p.total_delivered_mt > 0 && (
                    <Typography variant="body2" color="text.secondary">{fmt(p.total_delivered_mt)} MT shipped</Typography>
                  )}
                  {p.active_truckers.length > 0 && (
                    <Chip icon={<PersonIcon />} label={p.active_truckers.join(', ')} size="small" color="warning" variant="outlined" />
                  )}
                </Stack>

                {p.notes && (
                  <Typography variant="body2" sx={{ mt: 0.5, fontStyle: 'italic', color: 'text.secondary' }}>
                    {p.notes}
                  </Typography>
                )}
              </CardContent>

              <CardActions sx={{ justifyContent: 'space-between', pt: 0, px: 2, pb: 1 }}>
                {/* Trucker action */}
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<LocalShippingIcon />}
                  onClick={() => handleClaim(p.id)}
                  disabled={p.is_paused || (p.target_loads && p.completed_loads + p.active_loads >= p.target_loads)}
                >
                  Start Load
                </Button>

                {/* Admin controls */}
                {canEdit && (
                  <Stack direction="row" spacing={0}>
                    <Tooltip title={p.is_paused ? 'Resume' : 'Pause'}>
                      <IconButton size="small" onClick={() => handleTogglePause(p)}>
                        {p.is_paused ? <PlayArrowIcon fontSize="small" /> : <PauseIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Move up">
                      <IconButton size="small" onClick={() => handleMove(p, 'up')} disabled={idx === 0}>
                        <ArrowUpwardIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Move down">
                      <IconButton size="small" onClick={() => handleMove(p, 'down')} disabled={idx === priorities.length - 1}>
                        <ArrowDownwardIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Mark done">
                      <IconButton size="small" color="success" onClick={() => handleMarkDone(p)}>
                        <DoneIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                )}
              </CardActions>
            </Card>
          );
        })}
      </Stack>

      {/* Create Priority Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Shipping Priority</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Contract</InputLabel>
                <Select
                  value={newPriority.marketing_contract_id}
                  onChange={e => setNewPriority(prev => ({ ...prev, marketing_contract_id: e.target.value }))}
                  label="Contract"
                >
                  {contracts.map(c => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.contract_number} — {c.counterparty?.name || c.buyer_name} — {c.commodity?.name} ({fmt(c.remaining_mt)} MT left)
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={8}>
              <FormControl fullWidth>
                <InputLabel>Pickup Location</InputLabel>
                <Select
                  value={newPriority.source_location_id}
                  onChange={e => setNewPriority(prev => ({ ...prev, source_location_id: e.target.value }))}
                  label="Pickup Location"
                >
                  <MenuItem value="">—</MenuItem>
                  {locations.map(l => (
                    <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={4}>
              <TextField fullWidth label="Target Loads" type="number" value={newPriority.target_loads}
                onChange={e => setNewPriority(prev => ({ ...prev, target_loads: e.target.value }))}
                placeholder="Optional" />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Notes" multiline rows={2} value={newPriority.notes}
                onChange={e => setNewPriority(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Gate codes, instructions, warnings..." />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!newPriority.marketing_contract_id}>
            Add to Board
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog {...dialogProps} />
      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack(s => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
