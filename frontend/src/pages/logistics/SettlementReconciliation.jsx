import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, Stack, Chip, Alert, Paper, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, LinearProgress,
  Accordion, AccordionSummary, AccordionDetails, IconButton, Tooltip,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import LinkIcon from '@mui/icons-material/Link';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { useSearchParams } from 'react-router-dom';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';

const MATCH_STATUS_CONFIG = {
  matched: { color: 'success', icon: <CheckCircleIcon />, label: 'Matched' },
  manual: { color: 'info', icon: <LinkIcon />, label: 'Manual' },
  exception: { color: 'error', icon: <WarningIcon />, label: 'Exception' },
  unmatched: { color: 'warning', icon: <ErrorIcon />, label: 'Unmatched' },
};

export default function SettlementReconciliation() {
  const { currentFarm, isAdmin, canEdit } = useFarm();
  const [searchParams] = useSearchParams();
  const settlementId = searchParams.get('id');

  const [settlement, setSettlement] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState(null);
  const [error, setError] = useState(null);
  const [manualMatchDialog, setManualMatchDialog] = useState({ open: false, line: null });
  const [manualTicketId, setManualTicketId] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [tickets, setTickets] = useState([]);

  const fetchSettlement = useCallback(() => {
    if (!currentFarm || !settlementId) return;
    setLoading(true);
    api.get(`/api/farms/${currentFarm.id}/settlements/${settlementId}`)
      .then(res => setSettlement(res.data.settlement))
      .catch(err => setError(err.response?.data?.error || err.message))
      .finally(() => setLoading(false));
  }, [currentFarm, settlementId]);

  const fetchTickets = useCallback(() => {
    if (!currentFarm) return;
    api.get(`/api/farms/${currentFarm.id}/tickets?limit=500&settled=false`)
      .then(res => setTickets(res.data.tickets || []));
  }, [currentFarm]);

  useEffect(() => { fetchSettlement(); fetchTickets(); }, [fetchSettlement, fetchTickets]);

  const handleReconcile = async () => {
    setReconciling(true);
    setError(null);
    try {
      const res = await api.post(`/api/farms/${currentFarm.id}/settlements/${settlementId}/reconcile`);
      setReconcileResult(res.data);
      fetchSettlement();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setReconciling(false);
    }
  };

  const handleManualMatch = async () => {
    if (!manualMatchDialog.line || !manualTicketId) return;
    try {
      await api.post(
        `/api/farms/${currentFarm.id}/settlements/${settlementId}/lines/${manualMatchDialog.line.id}/match`,
        { ticket_id: manualTicketId, notes: manualNotes }
      );
      setManualMatchDialog({ open: false, line: null });
      setManualTicketId('');
      setManualNotes('');
      fetchSettlement();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleApprove = async () => {
    try {
      await api.post(`/api/farms/${currentFarm.id}/settlements/${settlementId}/approve`);
      fetchSettlement();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  if (!settlementId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">Select a settlement from the Settlements tab to reconcile.</Alert>
      </Box>
    );
  }

  if (loading) return <LinearProgress />;

  if (!settlement) {
    return <Alert severity="error">Settlement not found</Alert>;
  }

  const matchedCount = settlement.lines.filter(l => l.match_status === 'matched' || l.match_status === 'manual').length;
  const exceptionCount = settlement.lines.filter(l => l.match_status === 'exception').length;
  const unmatchedCount = settlement.lines.filter(l => l.match_status === 'unmatched').length;
  const canApprove = isAdmin && unmatchedCount === 0 && exceptionCount === 0 && settlement.status !== 'approved';

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            Settlement Reconciliation
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {settlement.settlement_number} | {settlement.counterparty?.name || 'Unknown Buyer'} |{' '}
            {settlement.buyer_format?.toUpperCase()}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Chip label={settlement.status.toUpperCase()} color={MATCH_STATUS_CONFIG[settlement.status]?.color || 'default'} />
          {canEdit && settlement.status !== 'approved' && (
            <Button
              variant="contained"
              startIcon={<AutoFixHighIcon />}
              onClick={handleReconcile}
              disabled={reconciling}
            >
              {reconciling ? 'Reconciling...' : 'Run AI Reconciliation'}
            </Button>
          )}
          {canApprove && (
            <Button variant="contained" color="success" startIcon={<DoneAllIcon />} onClick={handleApprove}>
              Approve All
            </Button>
          )}
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {reconcileResult && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Reconciliation complete: {reconcileResult.summary.matched} matched,{' '}
          {reconcileResult.summary.exceptions} exceptions,{' '}
          {reconcileResult.summary.unmatched} unmatched out of {reconcileResult.summary.total_lines} lines.
          Average confidence: {(reconcileResult.summary.avg_confidence * 100).toFixed(0)}%
        </Alert>
      )}

      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <Chip icon={<CheckCircleIcon />} label={`${matchedCount} Matched`} color="success" />
        <Chip icon={<WarningIcon />} label={`${exceptionCount} Exceptions`} color="error" />
        <Chip icon={<ErrorIcon />} label={`${unmatchedCount} Unmatched`} color="warning" />
        {settlement.total_amount && (
          <Chip label={`Total: $${settlement.total_amount.toLocaleString()}`} variant="outlined" />
        )}
      </Stack>

      {/* Settlement Lines */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={50}>#</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Buyer Ticket #</TableCell>
              <TableCell>Date</TableCell>
              <TableCell align="right">Net MT</TableCell>
              <TableCell align="right">Price/MT</TableCell>
              <TableCell align="right">Net $</TableCell>
              <TableCell>Matched Ticket</TableCell>
              <TableCell>Confidence</TableCell>
              <TableCell width={80}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {settlement.lines.map(line => {
              const statusConfig = MATCH_STATUS_CONFIG[line.match_status] || MATCH_STATUS_CONFIG.unmatched;
              return (
                <TableRow
                  key={line.id}
                  sx={{
                    bgcolor: line.match_status === 'matched' || line.match_status === 'manual'
                      ? 'success.50'
                      : line.match_status === 'exception'
                        ? 'error.50'
                        : 'warning.50',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <TableCell>{line.line_number}</TableCell>
                  <TableCell>
                    <Chip
                      icon={statusConfig.icon}
                      label={statusConfig.label}
                      size="small"
                      color={statusConfig.color}
                    />
                  </TableCell>
                  <TableCell>{line.ticket_number_on_settlement || '-'}</TableCell>
                  <TableCell>{line.delivery_date ? new Date(line.delivery_date).toLocaleDateString() : '-'}</TableCell>
                  <TableCell align="right">{line.net_weight_mt?.toFixed(2) || '-'}</TableCell>
                  <TableCell align="right">{line.price_per_mt ? `$${line.price_per_mt.toFixed(2)}` : '-'}</TableCell>
                  <TableCell align="right">{line.line_net ? `$${line.line_net.toLocaleString()}` : '-'}</TableCell>
                  <TableCell>
                    {line.delivery_ticket ? (
                      <Stack spacing={0}>
                        <Typography variant="body2">
                          Ticket #{line.delivery_ticket.ticket_number}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {line.delivery_ticket.net_weight_mt?.toFixed(2)} MT |{' '}
                          {line.delivery_ticket.commodity?.name} |{' '}
                          {line.delivery_ticket.location?.name}
                        </Typography>
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">-</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {line.match_confidence != null ? (
                      <Stack direction="row" alignItems="center" spacing={0.5}>
                        <LinearProgress
                          variant="determinate"
                          value={line.match_confidence * 100}
                          color={line.match_confidence >= 0.8 ? 'success' : line.match_confidence >= 0.5 ? 'warning' : 'error'}
                          sx={{ flex: 1, height: 6, borderRadius: 3, minWidth: 60 }}
                        />
                        <Typography variant="caption">{(line.match_confidence * 100).toFixed(0)}%</Typography>
                      </Stack>
                    ) : '-'}
                  </TableCell>
                  <TableCell>
                    {canEdit && (line.match_status === 'unmatched' || line.match_status === 'exception') && (
                      <Tooltip title="Manual match">
                        <IconButton
                          size="small"
                          onClick={() => setManualMatchDialog({ open: true, line })}
                        >
                          <LinkIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Exception details */}
      {settlement.lines.filter(l => l.exception_reason).length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="h6" gutterBottom>Exception Details</Typography>
          {settlement.lines.filter(l => l.exception_reason).map(line => (
            <Accordion key={line.id} variant="outlined">
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip
                    label={`Line ${line.line_number}`}
                    size="small"
                    color={MATCH_STATUS_CONFIG[line.match_status]?.color || 'default'}
                  />
                  <Typography variant="body2">{line.exception_reason}</Typography>
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <Stack direction="row" spacing={4}>
                  <Box>
                    <Typography variant="subtitle2">Settlement Line</Typography>
                    <Typography variant="body2">Ticket #: {line.ticket_number_on_settlement || 'N/A'}</Typography>
                    <Typography variant="body2">Weight: {line.net_weight_mt?.toFixed(3)} MT</Typography>
                    <Typography variant="body2">Date: {line.delivery_date ? new Date(line.delivery_date).toLocaleDateString() : 'N/A'}</Typography>
                  </Box>
                  {line.delivery_ticket && (
                    <Box>
                      <Typography variant="subtitle2">Closest Match</Typography>
                      <Typography variant="body2">Ticket #: {line.delivery_ticket.ticket_number}</Typography>
                      <Typography variant="body2">Weight: {line.delivery_ticket.net_weight_mt?.toFixed(3)} MT</Typography>
                      <Typography variant="body2">Date: {new Date(line.delivery_ticket.delivery_date).toLocaleDateString()}</Typography>
                      <Typography variant="body2">Location: {line.delivery_ticket.location?.name || 'N/A'}</Typography>
                    </Box>
                  )}
                </Stack>
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      )}

      {/* Manual Match Dialog */}
      <Dialog
        open={manualMatchDialog.open}
        onClose={() => setManualMatchDialog({ open: false, line: null })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Manual Match — Line {manualMatchDialog.line?.line_number}</DialogTitle>
        <DialogContent>
          {manualMatchDialog.line && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2">
                Buyer Ticket #: {manualMatchDialog.line.ticket_number_on_settlement || 'N/A'}
              </Typography>
              <Typography variant="body2">
                Weight: {manualMatchDialog.line.net_weight_mt?.toFixed(3)} MT
              </Typography>
            </Box>
          )}
          <Divider sx={{ mb: 2 }} />
          <TextField
            select
            fullWidth
            label="Select Delivery Ticket"
            value={manualTicketId}
            onChange={(e) => setManualTicketId(e.target.value)}
            sx={{ mb: 2 }}
          >
            {tickets.map(t => (
              <MenuItem key={t.id} value={t.id}>
                #{t.ticket_number} — {t.net_weight_mt?.toFixed(2)} MT — {t.commodity?.name} — {new Date(t.delivery_date).toLocaleDateString()}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            fullWidth
            label="Notes (optional)"
            value={manualNotes}
            onChange={(e) => setManualNotes(e.target.value)}
            multiline
            rows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManualMatchDialog({ open: false, line: null })}>Cancel</Button>
          <Button variant="contained" onClick={handleManualMatch} disabled={!manualTicketId}>
            Confirm Match
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
