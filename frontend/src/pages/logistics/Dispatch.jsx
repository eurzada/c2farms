import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, Stack, Chip, Card, CardContent, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, Grid, Snackbar, Alert, IconButton, Tooltip,
  Paper, LinearProgress, Select, InputLabel, FormControl,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import RefreshIcon from '@mui/icons-material/Refresh';
import DoneIcon from '@mui/icons-material/Done';
import CancelIcon from '@mui/icons-material/Cancel';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import PersonIcon from '@mui/icons-material/Person';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import { useFarm } from '../../contexts/FarmContext';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { fmt } from '../../utils/formatting';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import { getSocket } from '../../services/socket';

const URGENCY_COLORS = ['#d32f2f', '#ed6c02', '#1976d2', '#757575'];

export default function Shipping() {
  const { currentFarm, canEdit } = useFarm();
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

  // ─── Trucker State Machine ────────────────────────────────────────
  // State 1: No active claim → show priority board
  // State 2: Has active claim → show ONLY that load, big and clear

  const activeClaim = myLoads.find(l => l.status === 'claimed');

  // Trucker (non-admin) view is the state machine
  const isTrucker = !canEdit;

  if (isTrucker) {
    return (
      <TruckerView
        activeClaim={activeClaim}
        priorities={priorities}
        currentFarm={currentFarm}
        fetchData={fetchData}
        loading={loading}
        snack={snack}
        setSnack={setSnack}
        confirm={confirm}
        dialogProps={dialogProps}
      />
    );
  }

  // ─── Admin/Manager View (Collin) ─────────────────────────────────

  return (
    <ManagerView
      priorities={priorities}
      feed={feed}
      contracts={contracts}
      locations={locations}
      currentFarm={currentFarm}
      fetchData={fetchData}
      loading={loading}
      snack={snack}
      setSnack={setSnack}
      createOpen={createOpen}
      setCreateOpen={setCreateOpen}
      showFeed={showFeed}
      setShowFeed={setShowFeed}
      confirm={confirm}
      dialogProps={dialogProps}
      activeClaim={activeClaim}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TRUCKER VIEW — Poka-yoke: one state, one action, can't mess up
// ═══════════════════════════════════════════════════════════════════════

function TruckerView({ activeClaim, priorities, currentFarm, fetchData, loading, snack, setSnack, confirm, dialogProps }) {

  // ─── STATE 2: Active Load — this is ALL you see ───────────────────
  if (activeClaim) {
    const p = activeClaim.shipping_priority;
    const contract = p?.marketing_contract;
    return (
      <Box sx={{ maxWidth: 500, mx: 'auto', mt: 2 }}>
        <Card sx={{ border: '3px solid #ed6c02', borderRadius: 3 }}>
          <CardContent sx={{ p: 3 }}>
            <Stack alignItems="center" spacing={2}>
              <LocalShippingIcon sx={{ fontSize: 48, color: '#ed6c02' }} />
              <Typography variant="h5" sx={{ fontWeight: 700, textAlign: 'center' }}>
                You're on a load
              </Typography>

              <Paper sx={{ p: 2, width: '100%', bgcolor: '#fff3e0', borderRadius: 2 }}>
                <Stack spacing={1}>
                  <InfoRow label="CROP" value={contract?.commodity?.name} />
                  <InfoRow label="PICKUP" value={`${p?.source_location?.name || '—'}${p?.source_bin ? ` / Bin ${p.source_bin.bin_number}` : ''}`} />
                  <InfoRow label="DELIVER TO" value={contract?.elevator_site || contract?.counterparty?.name || '—'} />
                  <InfoRow label="BUYER" value={contract?.counterparty?.name} />
                  <InfoRow label="CONTRACT" value={contract?.contract_number} />
                  {p?.notes && <InfoRow label="NOTES" value={p.notes} />}
                </Stack>
              </Paper>

              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                When you arrive at the elevator, submit your ticket through the Tickets page.
              </Typography>

              <Button
                variant="outlined"
                color="error"
                size="large"
                fullWidth
                sx={{ mt: 1, py: 1.5 }}
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Cancel This Load?',
                    message: 'Are you sure? You can pick another load from the board.',
                    confirmText: 'Yes, Cancel',
                    confirmColor: 'error',
                  });
                  if (!ok) return;
                  try {
                    await api.post(`/api/farms/${currentFarm.id}/shipping/claims/${activeClaim.id}/cancel`);
                    setSnack({ open: true, message: 'Load cancelled', severity: 'info' });
                    fetchData();
                  } catch (err) {
                    setSnack({ open: true, message: extractErrorMessage(err, 'Failed'), severity: 'error' });
                  }
                }}
              >
                Cancel This Load
              </Button>
            </Stack>
          </CardContent>
        </Card>
        <ConfirmDialog {...dialogProps} />
        <SnackMessage snack={snack} setSnack={setSnack} />
      </Box>
    );
  }

  // ─── STATE 1: No Active Load — Pick from priority board ───────────

  const available = priorities.filter(p => !p.is_paused && p.status === 'active');
  const full = priorities.filter(p => p.target_loads && (p.completed_loads + p.active_loads) >= p.target_loads);
  const pickable = available.filter(p => !full.includes(p));

  return (
    <Box sx={{ maxWidth: 500, mx: 'auto', mt: 2 }}>
      <Stack alignItems="center" spacing={2} sx={{ mb: 3 }}>
        <CheckCircleIcon sx={{ fontSize: 48, color: '#2e7d32' }} />
        <Typography variant="h5" sx={{ fontWeight: 700, textAlign: 'center' }}>
          Ready for a load
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ textAlign: 'center' }}>
          Pick from the list below. Top = highest priority.
        </Typography>
      </Stack>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {pickable.length === 0 && !loading && (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" color="text.secondary">No loads available right now</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Check back or contact your manager.</Typography>
          <Button sx={{ mt: 2 }} onClick={fetchData} variant="outlined">Refresh</Button>
        </Paper>
      )}

      <Stack spacing={2}>
        {pickable.map((p, idx) => {
          const contract = p.marketing_contract;
          const commodity = contract?.commodity?.name || '—';
          const buyer = contract?.counterparty?.name || '—';
          const elevator = contract?.elevator_site || buyer;
          const location = p.source_location?.name || '—';
          const bin = p.source_bin?.bin_number;
          const isTop = idx === 0;

          return (
            <TruckerPriorityCard
              key={p.id}
              priority={p}
              commodity={commodity}
              elevator={elevator}
              location={location}
              bin={bin}
              isTop={isTop}
              currentFarm={currentFarm}
              fetchData={fetchData}
              setSnack={setSnack}
              confirm={confirm}
            />
          );
        })}
      </Stack>

      <ConfirmDialog {...dialogProps} />
      <SnackMessage snack={snack} setSnack={setSnack} />
    </Box>
  );
}

function TruckerPriorityCard({ priority: p, commodity, elevator, location, bin, isTop, currentFarm, fetchData, setSnack, confirm }) {
  const contract = p.marketing_contract;
  const pctDone = p.target_loads ? Math.min(100, (p.completed_loads / p.target_loads) * 100) : null;

  const handleClaim = async () => {
    const ok = await confirm({
      title: 'Start This Load?',
      message: (
        `Picking up ${commodity} from ${location}${bin ? ` / Bin ${bin}` : ''}\n` +
        `Delivering to ${elevator}\n` +
        `Contract: ${contract?.contract_number || '—'}\n\n` +
        (p.notes ? `Note: ${p.notes}\n\n` : '') +
        'Confirm to start.'
      ),
      confirmText: 'Start Load',
    });
    if (!ok) return;
    try {
      await api.post(`/api/farms/${currentFarm.id}/shipping/priorities/${p.id}/claim`);
      setSnack({ open: true, message: 'Load started — head to pickup!', severity: 'success' });
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to claim'), severity: 'error' });
    }
  };

  return (
    <Card sx={{
      borderLeft: `6px solid ${isTop ? '#d32f2f' : '#1976d2'}`,
      borderRadius: 2,
      ...(isTop && { boxShadow: '0 2px 12px rgba(211,47,47,0.2)' }),
    }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box sx={{ flex: 1 }}>
            {isTop && (
              <Chip label="TOP PRIORITY" size="small" color="error" sx={{ mb: 0.5, fontWeight: 700, fontSize: 11 }} />
            )}
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {commodity}
            </Typography>
            <Typography variant="body1" sx={{ mt: 0.5 }}>
              {location}{bin ? ` / Bin ${bin}` : ''} → {elevator}
            </Typography>

            {/* Progress */}
            {p.target_loads && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {p.completed_loads}/{p.target_loads} loads
                </Typography>
                <Box sx={{ flex: 1, maxWidth: 120 }}>
                  <LinearProgress variant="determinate" value={pctDone}
                    sx={{ height: 6, borderRadius: 1 }} />
                </Box>
              </Stack>
            )}

            {p.active_truckers?.length > 0 && (
              <Typography variant="body2" color="warning.main" sx={{ mt: 0.5 }}>
                <PersonIcon sx={{ fontSize: 14, verticalAlign: 'middle', mr: 0.5 }} />
                {p.active_truckers.join(', ')} on this now
              </Typography>
            )}

            {p.notes && (
              <Typography variant="body2" sx={{ mt: 0.5, color: '#ed6c02', fontWeight: 500 }}>
                <WarningIcon sx={{ fontSize: 14, verticalAlign: 'middle', mr: 0.5 }} />
                {p.notes}
              </Typography>
            )}
          </Box>

          {/* BIG action button */}
          <Button
            variant="contained"
            color={isTop ? 'error' : 'primary'}
            onClick={handleClaim}
            sx={{
              minWidth: 80,
              minHeight: 60,
              ml: 2,
              fontSize: 14,
              fontWeight: 700,
              borderRadius: 2,
              flexShrink: 0,
            }}
          >
            <Stack alignItems="center">
              <LocalShippingIcon />
              <span>GO</span>
            </Stack>
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MANAGER VIEW (Collin) — same data, admin controls
// ═══════════════════════════════════════════════════════════════════════

function ManagerView({ priorities, feed, contracts, locations, currentFarm, fetchData, loading, snack, setSnack, createOpen, setCreateOpen, showFeed, setShowFeed, confirm, dialogProps, activeClaim }) {

  const handleTogglePause = async (p) => {
    try {
      await api.patch(`/api/farms/${currentFarm.id}/shipping/priorities/${p.id}`, { is_paused: !p.is_paused });
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed'), severity: 'error' });
    }
  };

  const handleMove = async (p, direction) => {
    const idx = priorities.findIndex(x => x.id === p.id);
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= priorities.length) return;
    const reordered = [...priorities];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    try {
      await api.post(`/api/farms/${currentFarm.id}/shipping/reorder`, { ordered_ids: reordered.map(x => x.id) });
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed'), severity: 'error' });
    }
  };

  const handleMarkDone = async (p) => {
    const ok = await confirm({ title: 'Mark as Done', message: `Done shipping ${p.marketing_contract?.commodity?.name} → ${p.marketing_contract?.counterparty?.name}?`, confirmText: 'Done' });
    if (!ok) return;
    try {
      await api.patch(`/api/farms/${currentFarm.id}/shipping/priorities/${p.id}`, { status: 'done' });
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed'), severity: 'error' });
    }
  };

  const [newPriority, setNewPriority] = useState({
    marketing_contract_id: '', source_location_id: '', target_loads: '', notes: '',
  });

  const handleCreate = async () => {
    try {
      await api.post(`/api/farms/${currentFarm.id}/shipping/priorities`, newPriority);
      setSnack({ open: true, message: 'Priority added to board', severity: 'success' });
      setCreateOpen(false);
      setNewPriority({ marketing_contract_id: '', source_location_id: '', target_loads: '', notes: '' });
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed'), severity: 'error' });
    }
  };

  return (
    <Box sx={{ maxWidth: 700, mx: 'auto' }}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          <LocalShippingIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
          Shipping Board
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" onClick={() => setShowFeed(!showFeed)}>
            {showFeed ? 'Hide' : 'Activity'}
          </Button>
          <IconButton onClick={fetchData} size="small"><RefreshIcon /></IconButton>
          <Button startIcon={<AddIcon />} onClick={() => setCreateOpen(true)} variant="contained" size="small">
            Add
          </Button>
        </Stack>
      </Stack>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* Activity Feed */}
      {showFeed && feed.length > 0 && (
        <Paper sx={{ p: 2, mb: 2, maxHeight: 180, overflow: 'auto' }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Live Activity</Typography>
          {feed.map(f => (
            <Typography key={f.id} variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              <strong>{f.trucker}</strong>{' '}
              {f.status === 'claimed' ? 'started' : f.status === 'delivered' ? `delivered ${fmt(f.mt_delivered)} MT` : f.status}{' '}
              {f.commodity} — {timeAgo(f.updated_at)}
            </Typography>
          ))}
        </Paper>
      )}

      {priorities.length === 0 && !loading && (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">No priorities set. Tap "Add" to create the first one.</Typography>
        </Paper>
      )}

      {/* Priority Cards with Admin Controls */}
      <Stack spacing={1.5}>
        {priorities.map((p, idx) => {
          const contract = p.marketing_contract;
          const commodity = contract?.commodity?.name || '—';
          const buyer = contract?.counterparty?.name || '—';
          const elevator = contract?.elevator_site || buyer;
          const location = p.source_location?.name || '—';
          const bin = p.source_bin?.bin_number;
          const pctDone = p.target_loads ? Math.min(100, (p.completed_loads / p.target_loads) * 100) : null;

          return (
            <Card key={p.id} sx={{
              borderLeft: `5px solid ${p.is_paused ? '#bdbdbd' : idx === 0 ? '#d32f2f' : idx <= 2 ? '#ed6c02' : '#1976d2'}`,
              opacity: p.is_paused ? 0.55 : 1,
              borderRadius: 2,
            }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 1 } }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Chip label={`#${idx + 1}`} size="small" sx={{ fontWeight: 700, fontSize: 12, minWidth: 32 }} />
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        {commodity} → {elevator}
                      </Typography>
                      {p.is_paused && <Chip label="PAUSED" size="small" color="default" />}
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      From {location}{bin ? ` / Bin ${bin}` : ''} | {contract?.contract_number || '—'}
                    </Typography>

                    {p.target_loads && (
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                        <Typography variant="body2">{p.completed_loads}/{p.target_loads} loads</Typography>
                        <Box sx={{ flex: 1, maxWidth: 150 }}>
                          <LinearProgress variant="determinate" value={pctDone} sx={{ height: 6, borderRadius: 1 }} />
                        </Box>
                        {p.total_delivered_mt > 0 && (
                          <Typography variant="body2" color="text.secondary">{fmt(p.total_delivered_mt)} MT</Typography>
                        )}
                      </Stack>
                    )}

                    {p.active_truckers?.length > 0 && (
                      <Chip icon={<PersonIcon />} label={p.active_truckers.join(', ')} size="small" color="warning" variant="outlined" sx={{ mt: 0.5 }} />
                    )}

                    {p.notes && (
                      <Typography variant="body2" sx={{ mt: 0.5, fontStyle: 'italic', color: 'text.secondary' }}>{p.notes}</Typography>
                    )}
                  </Box>

                  {/* Admin controls — compact */}
                  <Stack spacing={0} sx={{ ml: 1 }}>
                    <Tooltip title={p.is_paused ? 'Resume' : 'Pause'}>
                      <IconButton size="small" onClick={() => handleTogglePause(p)}>
                        {p.is_paused ? <PlayArrowIcon fontSize="small" color="success" /> : <PauseIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Move up"><IconButton size="small" onClick={() => handleMove(p, 'up')} disabled={idx === 0}><ArrowUpwardIcon fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Move down"><IconButton size="small" onClick={() => handleMove(p, 'down')} disabled={idx === priorities.length - 1}><ArrowDownwardIcon fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Done"><IconButton size="small" color="success" onClick={() => handleMarkDone(p)}><DoneIcon fontSize="small" /></IconButton></Tooltip>
                  </Stack>
                </Stack>
              </CardContent>
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
                <Select value={newPriority.marketing_contract_id}
                  onChange={e => setNewPriority(prev => ({ ...prev, marketing_contract_id: e.target.value }))}
                  label="Contract">
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
                <Select value={newPriority.source_location_id}
                  onChange={e => setNewPriority(prev => ({ ...prev, source_location_id: e.target.value }))}
                  label="Pickup Location">
                  <MenuItem value="">—</MenuItem>
                  {locations.map(l => (<MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={4}>
              <TextField fullWidth label="Target Loads" type="number" value={newPriority.target_loads}
                onChange={e => setNewPriority(prev => ({ ...prev, target_loads: e.target.value }))} placeholder="Opt." />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Notes" multiline rows={2} value={newPriority.notes}
                onChange={e => setNewPriority(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Gate codes, warnings, instructions..." />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!newPriority.marketing_contract_id}>Add to Board</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog {...dialogProps} />
      <SnackMessage snack={snack} setSnack={setSnack} />
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Shared Components
// ═══════════════════════════════════════════════════════════════════════

function InfoRow({ label, value }) {
  return (
    <Stack direction="row" spacing={1}>
      <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 80, color: 'text.secondary' }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{value || '—'}</Typography>
    </Stack>
  );
}

function SnackMessage({ snack, setSnack }) {
  return (
    <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack(s => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
      <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>{snack.message}</Alert>
    </Snackbar>
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
