import { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Alert, Box, Typography, TextField, MenuItem,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  Chip, CircularProgress, Divider,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { fmt, fmtDollar } from '../../utils/formatting';

export default function TransferReconciliationDialog({ open, onClose, farmId, onDone }) {
  const [contracts, setContracts] = useState([]);
  const [selectedContractId, setSelectedContractId] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Load transfer contracts
  useEffect(() => {
    if (!open || !farmId) return;
    setResult(null);
    setSelectedContractId('');
    setError(null);
    setSuccess(null);
    api.get(`/api/farms/${farmId}/terminal/contracts`, { params: { direction: 'sale', limit: 100 } })
      .then(res => {
        // Filter to transfer-type contracts (internal C2 transfers)
        const all = res.data.contracts || [];
        setContracts(all);
      })
      .catch(err => setError(extractErrorMessage(err, 'Failed to load contracts')));
  }, [open, farmId]);

  const handleReconcile = async () => {
    if (!selectedContractId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post(`/api/farms/${farmId}/terminal/contracts/${selectedContractId}/reconcile-transfer`);
      setResult(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Reconciliation failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!result?.matched?.length) return;
    setApproving(true);
    setError(null);
    try {
      const matches = result.matched.map(m => ({
        terminal_ticket_id: m.terminal_ticket_id,
        delivery_ticket_id: m.delivery_ticket_id,
        grade_override: m.grade || null,
      }));
      const res = await api.post(
        `/api/farms/${farmId}/terminal/contracts/${selectedContractId}/reconcile-transfer/approve`,
        { matches }
      );
      setSuccess(`Settlement created and pushed. ${res.data.matched_count} tickets matched, ${fmt(res.data.total_mt)} MT.`);
      onDone?.();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to create settlement'));
    } finally {
      setApproving(false);
    }
  };

  // Estimate total value from contract grade pricing
  const estimatedValue = useMemo(() => {
    if (!result?.matched?.length || !result?.contract?.grade_prices_json) return null;
    const priceMap = {};
    for (const gp of (result.contract.grade_prices_json || [])) {
      if (gp.grade && gp.price_per_mt != null) priceMap[gp.grade.toLowerCase()] = gp.price_per_mt;
    }
    let total = 0;
    let allPriced = true;
    for (const m of result.matched) {
      const grade = (m.grade || '').toLowerCase();
      const price = priceMap[grade];
      if (price != null && m.delivery_weight_mt) {
        total += price * m.delivery_weight_mt;
      } else {
        allPriced = false;
      }
    }
    return { total, allPriced };
  }, [result]);

  const selectedContract = contracts.find(c => c.id === selectedContractId);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>Transfer Reconciliation</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

        {!success && (
          <>
            {/* Contract picker */}
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end', mb: 3 }}>
              <TextField
                select
                label="Select Contract"
                value={selectedContractId}
                onChange={e => { setSelectedContractId(e.target.value); setResult(null); }}
                sx={{ minWidth: 350 }}
                size="small"
              >
                <MenuItem value="">— Select a contract —</MenuItem>
                {contracts.map(c => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.contract_number} — {c.counterparty?.name || '?'} — {c.commodity?.name || '?'} ({fmt(c.contracted_mt)} MT)
                  </MenuItem>
                ))}
              </TextField>
              <Button
                variant="contained"
                onClick={handleReconcile}
                disabled={!selectedContractId || loading}
              >
                {loading ? <CircularProgress size={20} /> : 'Run Reconciliation'}
              </Button>
            </Box>

            {/* Results */}
            {result && (
              <>
                {/* Summary bar */}
                <Box sx={{ display: 'flex', gap: 3, mb: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <Typography variant="body2">
                    <strong>Contract:</strong> {result.contract.contract_number}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Commodity:</strong> {result.contract.commodity}
                  </Typography>
                  <Typography variant="body2" color="success.main">
                    <CheckCircleIcon sx={{ fontSize: 16, verticalAlign: 'text-bottom', mr: 0.3 }} />
                    {result.summary.matched} matched ({fmt(result.summary.matched_mt)} MT)
                  </Typography>
                  {result.unmatched_terminal.length > 0 && (
                    <Typography variant="body2" color="warning.main">
                      <WarningAmberIcon sx={{ fontSize: 16, verticalAlign: 'text-bottom', mr: 0.3 }} />
                      {result.unmatched_terminal.length} unmatched LGX
                    </Typography>
                  )}
                  {result.unmatched_delivery.length > 0 && (
                    <Typography variant="body2" color="text.secondary">
                      {result.unmatched_delivery.length} unmatched C2
                    </Typography>
                  )}
                  {estimatedValue && (
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      Est. Value: {fmtDollar(estimatedValue.total)}{!estimatedValue.allPriced ? ' (partial)' : ''}
                    </Typography>
                  )}
                </Box>

                {/* Matched pairs */}
                {result.matched.length > 0 && (
                  <>
                    <Typography variant="subtitle2" sx={{ mb: 1 }} color="success.main">
                      Matched Pairs ({result.matched.length})
                    </Typography>
                    <TableContainer component={Paper} variant="outlined" sx={{ mb: 3, maxHeight: 300 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell>LGX Ticket #</TableCell>
                            <TableCell>C2 Ticket #</TableCell>
                            <TableCell>Date</TableCell>
                            <TableCell>Commodity</TableCell>
                            <TableCell align="right">Weight MT</TableCell>
                            <TableCell>Grade</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {result.matched.map((m, i) => (
                            <TableRow key={i} sx={{ bgcolor: 'success.main', '& td': { bgcolor: 'transparent' } }}
                              hover
                            >
                              <TableCell>{m.terminal_ticket_number}</TableCell>
                              <TableCell>{m.delivery_ticket_number}</TableCell>
                              <TableCell>{m.delivery_date ? new Date(m.delivery_date).toLocaleDateString('en-CA') : ''}</TableCell>
                              <TableCell>{m.delivery_commodity || m.terminal_product}</TableCell>
                              <TableCell align="right">{fmt(m.delivery_weight_mt)}</TableCell>
                              <TableCell>
                                {m.grade ? (
                                  <Chip label={m.grade} size="small" variant="outlined" />
                                ) : (
                                  <Chip label="No grade" size="small" color="warning" variant="outlined" />
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </>
                )}

                {/* Unmatched LGX tickets */}
                {result.unmatched_terminal.length > 0 && (
                  <>
                    <Typography variant="subtitle2" sx={{ mb: 1 }} color="warning.main">
                      Unmatched LGX Tickets ({result.unmatched_terminal.length}) — fix ticket data and re-run
                    </Typography>
                    <TableContainer component={Paper} variant="outlined" sx={{ mb: 3, maxHeight: 200 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell>Ticket #</TableCell>
                            <TableCell>FMO #</TableCell>
                            <TableCell>Date</TableCell>
                            <TableCell>Product</TableCell>
                            <TableCell align="right">Weight KG</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {result.unmatched_terminal.map(t => (
                            <TableRow key={t.id} hover>
                              <TableCell sx={{ fontWeight: 600 }}>{t.ticket_number}</TableCell>
                              <TableCell>{t.fmo_number || '—'}</TableCell>
                              <TableCell>{t.ticket_date ? new Date(t.ticket_date).toLocaleDateString('en-CA') : ''}</TableCell>
                              <TableCell>{t.product}</TableCell>
                              <TableCell align="right">{t.weight_kg?.toLocaleString()}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </>
                )}

                {/* Unmatched delivery tickets */}
                {result.unmatched_delivery.length > 0 && (
                  <>
                    <Typography variant="subtitle2" sx={{ mb: 1 }} color="text.secondary">
                      Unmatched C2 Delivery Tickets ({result.unmatched_delivery.length})
                    </Typography>
                    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 200 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell>Ticket #</TableCell>
                            <TableCell>Date</TableCell>
                            <TableCell>Commodity</TableCell>
                            <TableCell align="right">Net MT</TableCell>
                            <TableCell>Grade</TableCell>
                            <TableCell>Contract #</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {result.unmatched_delivery.map(d => (
                            <TableRow key={d.id} hover>
                              <TableCell sx={{ fontWeight: 600 }}>{d.ticket_number}</TableCell>
                              <TableCell>{d.delivery_date ? new Date(d.delivery_date).toLocaleDateString('en-CA') : ''}</TableCell>
                              <TableCell>{d.commodity}</TableCell>
                              <TableCell align="right">{fmt(d.net_weight_mt)}</TableCell>
                              <TableCell>{d.grade || '—'}</TableCell>
                              <TableCell>{d.contract_number || '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </>
                )}
              </>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        {result?.matched?.length > 0 && !success && (
          <Button
            variant="contained"
            color="success"
            onClick={handleApprove}
            disabled={approving}
          >
            {approving ? <CircularProgress size={20} /> : `Create Settlement & Push (${result.matched.length} tickets)`}
          </Button>
        )}
        <Button onClick={onClose}>{success ? 'Done' : 'Close'}</Button>
      </DialogActions>
    </Dialog>
  );
}
