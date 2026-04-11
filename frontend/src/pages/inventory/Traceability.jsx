import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  FormControl, Grid, IconButton, InputLabel, MenuItem, Paper, Select, Stack,
  Step, StepLabel, Stepper, TextField, Tooltip, Typography, Snackbar, Alert,
  CircularProgress, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import VerifiedIcon from '@mui/icons-material/Verified';
import GppBadIcon from '@mui/icons-material/GppBad';
import LinkIcon from '@mui/icons-material/Link';
import RefreshIcon from '@mui/icons-material/Refresh';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import TimelineIcon from '@mui/icons-material/Timeline';
import api from '../../services/api';
import { useFarm } from '../../contexts/FarmContext';
import { extractErrorMessage } from '../../utils/errorHelpers';

const EVENT_TYPES = ['HARVEST', 'GRADE', 'TRANSFER', 'BLEND', 'SHIP', 'RECEIVE', 'CUSTODY', 'VOID'];

const EVENT_COLORS = {
  HARVEST: 'success',
  GRADE: 'info',
  TRANSFER: 'default',
  BLEND: 'warning',
  SHIP: 'primary',
  RECEIVE: 'secondary',
  CUSTODY: 'default',
  VOID: 'error',
};

const STATUS_COLORS = {
  active: 'success',
  in_transit: 'primary',
  delivered: 'secondary',
  closed: 'default',
  voided: 'error',
};

function shortHash(h) {
  if (!h) return '';
  return `${h.slice(0, 8)}…${h.slice(-6)}`;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString();
}

export default function Traceability() {
  const { currentFarm } = useFarm();
  const [lots, setLots] = useState([]);
  const [selectedLot, setSelectedLot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [verification, setVerification] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'success' });

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    crop_year: new Date().getFullYear(),
    crop_type: '',
    variety: '',
    grade: '',
    farm_site: '',
    bushels: '',
    net_weight_mt: '',
    notes: '',
  });

  const [eventOpen, setEventOpen] = useState(false);
  const [eventForm, setEventForm] = useState({
    event_type: 'SHIP',
    bushels: '',
    net_weight_mt: '',
    destination: '',
    ticket_number: '',
    contract_number: '',
    grade: '',
    protein_pct: '',
    moisture_pct: '',
    notes: '',
  });

  const loadLots = useCallback(async () => {
    if (!currentFarm) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/farms/${currentFarm.id}/traceability/lots`);
      setLots(res.data.lots || []);
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to load lots'), severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, [currentFarm]);

  useEffect(() => { loadLots(); }, [loadLots]);

  const loadLotDetail = useCallback(async (lotId) => {
    if (!currentFarm || !lotId) return;
    try {
      const res = await api.get(`/api/farms/${currentFarm.id}/traceability/lots/${lotId}`);
      setSelectedLot(res.data.lot);
      setVerification(null);
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to load lot'), severity: 'error' });
    }
  }, [currentFarm]);

  const handleCreateLot = async () => {
    if (!createForm.crop_type || !createForm.crop_year) {
      setSnack({ open: true, message: 'Crop year and crop type are required', severity: 'warning' });
      return;
    }
    try {
      const payload = {
        ...createForm,
        crop_year: parseInt(createForm.crop_year, 10),
        bushels: createForm.bushels ? parseFloat(createForm.bushels) : undefined,
        net_weight_mt: createForm.net_weight_mt ? parseFloat(createForm.net_weight_mt) : undefined,
      };
      const res = await api.post(`/api/farms/${currentFarm.id}/traceability/lots`, payload);
      setSnack({ open: true, message: `Lot ${res.data.lot.lot_code} created`, severity: 'success' });
      setCreateOpen(false);
      setCreateForm({ crop_year: new Date().getFullYear(), crop_type: '', variety: '', grade: '', farm_site: '', bushels: '', net_weight_mt: '', notes: '' });
      await loadLots();
      await loadLotDetail(res.data.lot.id);
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to create lot'), severity: 'error' });
    }
  };

  const handleAppendBlock = async () => {
    if (!selectedLot) return;
    try {
      const payload = {
        ...eventForm,
        bushels: eventForm.bushels ? parseFloat(eventForm.bushels) : undefined,
        net_weight_mt: eventForm.net_weight_mt ? parseFloat(eventForm.net_weight_mt) : undefined,
        protein_pct: eventForm.protein_pct ? parseFloat(eventForm.protein_pct) : undefined,
        moisture_pct: eventForm.moisture_pct ? parseFloat(eventForm.moisture_pct) : undefined,
      };
      await api.post(`/api/farms/${currentFarm.id}/traceability/lots/${selectedLot.id}/blocks`, payload);
      setSnack({ open: true, message: `${eventForm.event_type} block appended`, severity: 'success' });
      setEventOpen(false);
      setEventForm({ event_type: 'SHIP', bushels: '', net_weight_mt: '', destination: '', ticket_number: '', contract_number: '', grade: '', protein_pct: '', moisture_pct: '', notes: '' });
      await loadLotDetail(selectedLot.id);
      await loadLots();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to append block'), severity: 'error' });
    }
  };

  const handleVerify = async () => {
    if (!selectedLot) return;
    setVerifying(true);
    try {
      const res = await api.get(`/api/farms/${currentFarm.id}/traceability/lots/${selectedLot.id}/verify`);
      setVerification(res.data);
      setSnack({
        open: true,
        message: res.data.valid ? 'Chain verified — no tampering detected' : `Chain invalid: ${res.data.errors.length} error(s)`,
        severity: res.data.valid ? 'success' : 'error',
      });
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Verification failed'), severity: 'error' });
    } finally {
      setVerifying(false);
    }
  };

  const copyLotCode = (code) => {
    navigator.clipboard?.writeText(code);
    setSnack({ open: true, message: `Copied ${code}`, severity: 'info' });
  };

  const chainBlocks = useMemo(() => selectedLot?.blocks || [], [selectedLot]);

  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LinkIcon /> Traceability Ledger
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Tamper-evident provenance chain from bin to buyer
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button startIcon={<RefreshIcon />} onClick={loadLots} disabled={loading}>Refresh</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            New Lot
          </Button>
        </Stack>
      </Stack>

      <Grid container spacing={2}>
        {/* Lot list */}
        <Grid item xs={12} md={5}>
          <Paper variant="outlined" sx={{ maxHeight: '72vh', overflow: 'auto' }}>
            <TableContainer>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Lot Code</TableCell>
                    <TableCell>Crop</TableCell>
                    <TableCell align="right">Bushels</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Blocks</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading && (
                    <TableRow><TableCell colSpan={5} align="center"><CircularProgress size={20} /></TableCell></TableRow>
                  )}
                  {!loading && lots.length === 0 && (
                    <TableRow><TableCell colSpan={5} align="center">
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                        No traceability lots yet. Click "New Lot" to register a harvest.
                      </Typography>
                    </TableCell></TableRow>
                  )}
                  {lots.map((lot) => (
                    <TableRow
                      key={lot.id}
                      hover
                      selected={selectedLot?.id === lot.id}
                      onClick={() => loadLotDetail(lot.id)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{lot.lot_code}</Typography>
                          <Tooltip title="Copy lot code">
                            <IconButton size="small" onClick={(e) => { e.stopPropagation(); copyLotCode(lot.lot_code); }}>
                              <ContentCopyIcon fontSize="inherit" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{lot.crop_type}</Typography>
                        <Typography variant="caption" color="text.secondary">{lot.crop_year} {lot.variety || ''}</Typography>
                      </TableCell>
                      <TableCell align="right">{lot.total_bushels?.toLocaleString()}</TableCell>
                      <TableCell>
                        <Chip label={lot.status} size="small" color={STATUS_COLORS[lot.status] || 'default'} variant="outlined" />
                      </TableCell>
                      <TableCell align="right">{lot.block_count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        {/* Chain detail */}
        <Grid item xs={12} md={7}>
          <Paper variant="outlined" sx={{ p: 2, minHeight: '72vh' }}>
            {!selectedLot && (
              <Box sx={{ textAlign: 'center', color: 'text.secondary', py: 8 }}>
                <TimelineIcon sx={{ fontSize: 48, opacity: 0.3 }} />
                <Typography>Select a lot to inspect its provenance chain</Typography>
              </Box>
            )}
            {selectedLot && (
              <Box>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
                  <Box>
                    <Typography variant="h6" sx={{ fontFamily: 'monospace' }}>{selectedLot.lot_code}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {selectedLot.crop_type} · {selectedLot.crop_year}
                      {selectedLot.variety && ` · ${selectedLot.variety}`}
                      {selectedLot.grade && ` · Grade ${selectedLot.grade}`}
                    </Typography>
                    {selectedLot.farm_site && (
                      <Typography variant="caption" color="text.secondary">Origin: {selectedLot.farm_site}</Typography>
                    )}
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={verification?.valid ? <VerifiedIcon /> : verification && !verification.valid ? <GppBadIcon /> : <VerifiedIcon />}
                      color={verification?.valid ? 'success' : verification && !verification.valid ? 'error' : 'primary'}
                      onClick={handleVerify}
                      disabled={verifying}
                    >
                      {verifying ? 'Verifying…' : 'Verify Chain'}
                    </Button>
                    <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setEventOpen(true)}>
                      Append Event
                    </Button>
                  </Stack>
                </Stack>

                <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                  <Chip size="small" label={`Status: ${selectedLot.status}`} color={STATUS_COLORS[selectedLot.status] || 'default'} />
                  <Chip size="small" label={`${selectedLot.block_count} blocks`} variant="outlined" />
                  <Chip size="small" label={`${selectedLot.total_bushels?.toLocaleString() || 0} bu`} variant="outlined" />
                </Stack>

                <Box sx={{ mb: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, fontFamily: 'monospace', fontSize: 11 }}>
                  <div>genesis: {selectedLot.genesis_hash}</div>
                  <div>tip:&nbsp;&nbsp;&nbsp;&nbsp; {selectedLot.current_hash}</div>
                </Box>

                {verification && !verification.valid && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>Chain verification failed</Typography>
                    {verification.errors.map((e, i) => (
                      <Typography key={i} variant="caption" display="block">
                        Block #{e.blockIndex}: [{e.code}] {e.message}
                      </Typography>
                    ))}
                  </Alert>
                )}
                {verification && verification.valid && (
                  <Alert severity="success" sx={{ mb: 2 }}>
                    Chain verified: {verification.block_count} block(s), hash links intact, signatures valid.
                  </Alert>
                )}

                <Divider sx={{ mb: 2 }}>Provenance Timeline</Divider>

                <Stepper orientation="vertical" activeStep={chainBlocks.length}>
                  {chainBlocks.map((block) => (
                    <Step key={block.id} expanded>
                      <StepLabel
                        icon={
                          <Chip
                            size="small"
                            label={block.event_type}
                            color={EVENT_COLORS[block.event_type] || 'default'}
                          />
                        }
                      >
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>#{block.block_index}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatDate(block.event_timestamp)}
                          </Typography>
                          {block.actor_name && (
                            <Typography variant="caption" color="text.secondary">· {block.actor_name}</Typography>
                          )}
                        </Stack>
                      </StepLabel>
                      <Box sx={{ pl: 4, pb: 2 }}>
                        <Grid container spacing={1}>
                          {block.bushels != null && (
                            <Grid item xs={6}><Typography variant="caption">Bushels: {block.bushels.toLocaleString()}</Typography></Grid>
                          )}
                          {block.net_weight_mt != null && (
                            <Grid item xs={6}><Typography variant="caption">Weight: {block.net_weight_mt} MT</Typography></Grid>
                          )}
                          {block.grade && (
                            <Grid item xs={6}><Typography variant="caption">Grade: {block.grade}</Typography></Grid>
                          )}
                          {block.protein_pct != null && (
                            <Grid item xs={6}><Typography variant="caption">Protein: {block.protein_pct}%</Typography></Grid>
                          )}
                          {block.moisture_pct != null && (
                            <Grid item xs={6}><Typography variant="caption">Moisture: {block.moisture_pct}%</Typography></Grid>
                          )}
                          {block.destination && (
                            <Grid item xs={12}><Typography variant="caption">Destination: {block.destination}</Typography></Grid>
                          )}
                          {block.ticket_number && (
                            <Grid item xs={6}><Typography variant="caption">Ticket: {block.ticket_number}</Typography></Grid>
                          )}
                          {block.contract_number && (
                            <Grid item xs={6}><Typography variant="caption">Contract: {block.contract_number}</Typography></Grid>
                          )}
                          {block.notes && (
                            <Grid item xs={12}><Typography variant="caption" color="text.secondary">{block.notes}</Typography></Grid>
                          )}
                        </Grid>
                        <Box sx={{ mt: 1, fontFamily: 'monospace', fontSize: 10, color: 'text.secondary' }}>
                          <Tooltip title={block.block_hash}><span>hash: {shortHash(block.block_hash)}</span></Tooltip>
                          <span> ← </span>
                          <Tooltip title={block.previous_hash}><span>prev: {shortHash(block.previous_hash)}</span></Tooltip>
                        </Box>
                      </Box>
                    </Step>
                  ))}
                </Stepper>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Create Lot Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Traceability Lot (Genesis Block)</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={6}>
              <TextField fullWidth label="Crop Year" type="number"
                value={createForm.crop_year}
                onChange={(e) => setCreateForm({ ...createForm, crop_year: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Crop Type" placeholder="wheat, canola, durum…"
                value={createForm.crop_type}
                onChange={(e) => setCreateForm({ ...createForm, crop_type: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Variety"
                value={createForm.variety}
                onChange={(e) => setCreateForm({ ...createForm, variety: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Grade" placeholder="1 CWRS"
                value={createForm.grade}
                onChange={(e) => setCreateForm({ ...createForm, grade: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Farm Site / Field"
                placeholder="e.g. SE-23-45-10-W4"
                value={createForm.farm_site}
                onChange={(e) => setCreateForm({ ...createForm, farm_site: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Bushels" type="number"
                value={createForm.bushels}
                onChange={(e) => setCreateForm({ ...createForm, bushels: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Net Weight (MT)" type="number"
                value={createForm.net_weight_mt}
                onChange={(e) => setCreateForm({ ...createForm, net_weight_mt: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth multiline rows={2} label="Notes"
                value={createForm.notes}
                onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateLot}>Create Lot</Button>
        </DialogActions>
      </Dialog>

      {/* Append Event Dialog */}
      <Dialog open={eventOpen} onClose={() => setEventOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Append Event Block</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Event Type</InputLabel>
                <Select
                  label="Event Type"
                  value={eventForm.event_type}
                  onChange={(e) => setEventForm({ ...eventForm, event_type: e.target.value })}
                >
                  {EVENT_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Bushels" type="number"
                value={eventForm.bushels}
                onChange={(e) => setEventForm({ ...eventForm, bushels: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Net Weight (MT)" type="number"
                value={eventForm.net_weight_mt}
                onChange={(e) => setEventForm({ ...eventForm, net_weight_mt: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Grade"
                value={eventForm.grade}
                onChange={(e) => setEventForm({ ...eventForm, grade: e.target.value })}
              />
            </Grid>
            <Grid item xs={3}>
              <TextField fullWidth label="Protein %" type="number"
                value={eventForm.protein_pct}
                onChange={(e) => setEventForm({ ...eventForm, protein_pct: e.target.value })}
              />
            </Grid>
            <Grid item xs={3}>
              <TextField fullWidth label="Moisture %" type="number"
                value={eventForm.moisture_pct}
                onChange={(e) => setEventForm({ ...eventForm, moisture_pct: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Destination" placeholder="Cargill Rosetown"
                value={eventForm.destination}
                onChange={(e) => setEventForm({ ...eventForm, destination: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Ticket #"
                value={eventForm.ticket_number}
                onChange={(e) => setEventForm({ ...eventForm, ticket_number: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Contract #"
                value={eventForm.contract_number}
                onChange={(e) => setEventForm({ ...eventForm, contract_number: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth multiline rows={2} label="Notes"
                value={eventForm.notes}
                onChange={(e) => setEventForm({ ...eventForm, notes: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEventOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAppendBlock}>Append Block</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack({ ...snack, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snack.severity} onClose={() => setSnack({ ...snack, open: false })}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
