import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Alert, CircularProgress, Paper, Chip, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, IconButton,
  Select, MenuItem, FormControl,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import LinkIcon from '@mui/icons-material/Link';
import api from '../../services/api';
import { fmtDollar, fmt } from '../../utils/formatting';
import { extractErrorMessage } from '../../utils/errorHelpers';
import RealizationPanel from './RealizationPanel';

export default function BuyerSettlementReconciliationDialog({ open, onClose, farmId, settlementId, onDone }) {
  const [settlement, setSettlement] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reconciling, setReconciling] = useState(false);
  const [realization, setRealization] = useState(null);
  const [realizationLoading, setRealizationLoading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [outboundTickets, setOutboundTickets] = useState([]);
  const [manualMatchLineId, setManualMatchLineId] = useState(null);

  const load = useCallback(async () => {
    if (!farmId || !settlementId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/farms/${farmId}/terminal/settlements/${settlementId}`);
      setSettlement(res.data);
      if (res.data.realization_json) {
        setRealization(res.data.realization_json);
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load settlement'));
    } finally {
      setLoading(false);
    }
  }, [farmId, settlementId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleReconcile = async () => {
    setReconciling(true);
    setError(null);
    try {
      const res = await api.post(`/api/farms/${farmId}/terminal/settlements/${settlementId}/reconcile-buyer`);
      await load();
      if (res.data.match_rate === 100) {
        // Auto-compute realization if fully matched
        handleComputeRealization();
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to reconcile'));
    } finally {
      setReconciling(false);
    }
  };

  const handleComputeRealization = async () => {
    setRealizationLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/farms/${farmId}/terminal/settlements/${settlementId}/realization`);
      setRealization(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to compute realization'));
    } finally {
      setRealizationLoading(false);
    }
  };

  const handleFinalize = async () => {
    setFinalizing(true);
    setError(null);
    try {
      await api.post(`/api/farms/${farmId}/terminal/settlements/${settlementId}/finalize-buyer`);
      await load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to finalize'));
    } finally {
      setFinalizing(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    setError(null);
    try {
      await api.post(`/api/farms/${farmId}/terminal/settlements/${settlementId}/push-buyer`);
      onDone?.();
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to push to logistics'));
    } finally {
      setPushing(false);
    }
  };

  const handleManualMatch = async (lineId, ticketId) => {
    setError(null);
    try {
      await api.post(`/api/farms/${farmId}/terminal/settlements/${settlementId}/lines/${lineId}/manual-match`, {
        ticket_id: ticketId,
      });
      setManualMatchLineId(null);
      await load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to match'));
    }
  };

  const loadOutboundTickets = useCallback(async () => {
    try {
      const res = await api.get(`/api/farms/${farmId}/terminal/tickets`, {
        params: { direction: 'outbound', limit: 500 },
      });
      setOutboundTickets(res.data.tickets || []);
    } catch { /* ignore */ }
  }, [farmId]);

  useEffect(() => {
    if (open && farmId) loadOutboundTickets();
  }, [open, farmId, loadOutboundTickets]);

  const lines = settlement?.lines || [];
  const matchedCount = lines.filter(l => l.match_status === 'matched' || l.match_status === 'manual').length;
  const allMatched = lines.length > 0 && matchedCount === lines.length;
  const isDraft = settlement?.status === 'draft';
  const isFinalized = settlement?.status === 'finalized';

  const deductions = settlement?.deductions_summary || settlement?.extraction_json?.deductions_summary || [];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Buyer Settlement Reconciliation</span>
          {settlement && (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Chip label={settlement.status} size="small" color={
                settlement.status === 'draft' ? 'default' : settlement.status === 'finalized' ? 'warning' : 'success'
              } />
            </Box>
          )}
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
        {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>}

        {settlement && !loading && (
          <>
            {/* Header */}
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                <Typography variant="body2"><strong>Buyer:</strong> {settlement.counterparty?.name || '—'}</Typography>
                <Typography variant="body2"><strong>Contract:</strong> {settlement.contract?.contract_number || '—'}</Typography>
                <Typography variant="body2"><strong>Date:</strong> {settlement.settlement_date ? new Date(settlement.settlement_date).toLocaleDateString('en-CA') : '—'}</Typography>
                <Typography variant="body2"><strong>Gross:</strong> {fmtDollar(settlement.settlement_gross || settlement.gross_amount)}</Typography>
                <Typography variant="body2" fontWeight={700}><strong>Net:</strong> {fmtDollar(settlement.net_amount)}</Typography>
              </Box>
            </Paper>

            {/* Match stats */}
            <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
              <Chip
                icon={allMatched ? <CheckCircleIcon /> : <ErrorIcon />}
                label={`${matchedCount}/${lines.length} matched`}
                color={allMatched ? 'success' : 'warning'}
                variant="outlined"
              />
              {isDraft && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleReconcile}
                  disabled={reconciling}
                >
                  {reconciling ? 'Reconciling...' : 'Auto-Reconcile'}
                </Button>
              )}
            </Box>

            {/* Line reconciliation table */}
            <TableContainer component={Paper} variant="outlined" sx={{ mb: 2, maxHeight: 350 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Rail Car #</TableCell>
                    <TableCell align="right">Net MT</TableCell>
                    <TableCell>Grade</TableCell>
                    <TableCell align="right">$/MT</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell>Match</TableCell>
                    {isDraft && <TableCell>Action</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.map(l => {
                    const isMatched = l.match_status === 'matched' || l.match_status === 'manual';
                    return (
                      <TableRow key={l.id} sx={{ bgcolor: isMatched ? 'success.50' : undefined }}>
                        <TableCell>{l.line_number}</TableCell>
                        <TableCell>
                          {l.ticket?.ticket_number || l.source_farm_name || '—'}
                        </TableCell>
                        <TableCell align="right">{l.net_weight_mt != null ? fmt(l.net_weight_mt) : '—'}</TableCell>
                        <TableCell>{l.grade || '—'}</TableCell>
                        <TableCell align="right">{l.price_per_mt != null ? fmtDollar(l.price_per_mt) : '—'}</TableCell>
                        <TableCell align="right">{l.line_amount != null ? fmtDollar(l.line_amount) : '—'}</TableCell>
                        <TableCell>
                          {isMatched ? (
                            <Tooltip title={`Matched to ticket ${l.ticket?.ticket_number || ''} (${Math.round((l.match_confidence || 0) * 100)}%)`}>
                              <CheckCircleIcon color="success" fontSize="small" />
                            </Tooltip>
                          ) : (
                            <Chip label="Unmatched" size="small" color="warning" variant="outlined" />
                          )}
                        </TableCell>
                        {isDraft && (
                          <TableCell>
                            {!isMatched && (
                              manualMatchLineId === l.id ? (
                                <FormControl size="small" sx={{ minWidth: 150 }}>
                                  <Select
                                    size="small"
                                    value=""
                                    displayEmpty
                                    onChange={(e) => handleManualMatch(l.id, e.target.value)}
                                  >
                                    <MenuItem value="" disabled>Select ticket</MenuItem>
                                    {outboundTickets.map(t => (
                                      <MenuItem key={t.id} value={t.id}>
                                        #{t.ticket_number} ({fmt((t.weight_kg || 0) / 1000)} MT)
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                              ) : (
                                <IconButton size="small" onClick={() => setManualMatchLineId(l.id)}>
                                  <LinkIcon fontSize="small" />
                                </IconButton>
                              )
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  <TableRow sx={{ '& td': { fontWeight: 700, borderTop: '2px solid', borderColor: 'divider' } }}>
                    <TableCell colSpan={2}>Totals ({lines.length} lines)</TableCell>
                    <TableCell align="right">{fmt(lines.reduce((s, l) => s + (l.net_weight_mt || 0), 0))}</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell align="right">{fmtDollar(settlement.net_amount)}</TableCell>
                    <TableCell />
                    {isDraft && <TableCell />}
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>

            {/* Realization Panel */}
            {(realization || settlement.realization_json) && (
              <RealizationPanel
                realization={realization || settlement.realization_json}
                buyerName={settlement.counterparty?.name}
                contractNumber={settlement.contract?.contract_number}
                deductions={deductions}
              />
            )}

            {/* Compute realization button */}
            {allMatched && !realization && !settlement.realization_json && (
              <Box sx={{ mt: 2, textAlign: 'center' }}>
                <Button
                  variant="outlined"
                  onClick={handleComputeRealization}
                  disabled={realizationLoading}
                >
                  {realizationLoading ? 'Computing...' : 'Compute Realization'}
                </Button>
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        {isDraft && allMatched && (realization || settlement?.realization_json) && (
          <Button
            variant="contained"
            color="warning"
            onClick={handleFinalize}
            disabled={finalizing}
          >
            {finalizing ? 'Finalizing...' : 'Finalize'}
          </Button>
        )}
        {isFinalized && (
          <Button
            variant="contained"
            color="primary"
            onClick={handlePush}
            disabled={pushing}
          >
            {pushing ? 'Pushing...' : 'Push Margin to Logistics'}
          </Button>
        )}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
