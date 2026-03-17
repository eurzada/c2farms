import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Paper, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, InputAdornment, CircularProgress, Alert, Divider,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { fmt, fmtDollar } from '../../utils/formatting';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import ConfirmDialog from '../shared/ConfirmDialog';
import RealizationPanel from './RealizationPanel';

const STATUS_COLORS = { draft: 'default', finalized: 'warning', pushed: 'success' };
const TYPE_COLORS = { transfer: 'primary', transloading: 'warning', buyer_settlement: 'success' };

const TYPE_LABELS = {
  transfer: 'Transfer',
  transloading: 'Transloading',
  buyer_settlement: 'Buyer',
};

function formatDate(d) {
  return d ? new Date(d).toLocaleDateString('en-CA') : '—';
}

export default function TerminalSettlementDetailDialog({
  open, onClose, settlementId, farmId, onAction, isAdmin, allSettlements = [],
}) {
  const navigate = useNavigate();
  const { confirm, dialogProps } = useConfirmDialog();

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    if (!farmId || !settlementId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/farms/${farmId}/terminal/settlements/${settlementId}`);
      setDetail(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load settlement'));
    } finally {
      setLoading(false);
    }
  }, [farmId, settlementId]);

  useEffect(() => {
    if (open && settlementId) {
      load();
    } else {
      setDetail(null);
      setError(null);
    }
  }, [open, settlementId, load]);

  // Find paired settlements on the same contract
  const pairedSettlements = useMemo(() => {
    if (!detail?.contract_id || !allSettlements.length) return [];
    return allSettlements.filter(
      s => s.contract_id === detail.contract_id && s.id !== detail.id
    );
  }, [detail, allSettlements]);

  // Paired buyer settlement (for transfer/transloading types)
  const pairedBuyer = useMemo(() => {
    if (detail?.type === 'buyer_settlement') return null;
    return pairedSettlements.find(s => s.type === 'buyer_settlement') || null;
  }, [detail, pairedSettlements]);

  // Paired transfer settlements (for buyer_settlement type)
  const pairedTransfers = useMemo(() => {
    if (detail?.type !== 'buyer_settlement') return [];
    return pairedSettlements.filter(s => s.type === 'transfer' || s.type === 'transloading');
  }, [detail, pairedSettlements]);

  const lines = detail?.lines || [];
  const isDraft = detail?.status === 'draft';
  const isFinalized = detail?.status === 'finalized';
  const isPushed = detail?.status === 'pushed';
  const isBuyer = detail?.type === 'buyer_settlement';
  const isTransfer = detail?.type === 'transfer';
  const isTransloading = detail?.type === 'transloading';

  const totalMT = lines.reduce((s, l) => s + (parseFloat(l.net_weight_mt) || 0), 0);

  // --- Action handlers ---

  const handleLineUpdate = async (lineId, field, value) => {
    try {
      const res = await api.patch(
        `/api/farms/${farmId}/terminal/settlements/${settlementId}/lines/${lineId}`,
        { [field]: value }
      );
      setDetail(res.data);
      onAction?.('updated');
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to update line'));
    }
  };

  const handleApplyPricing = async () => {
    setActionLoading(true);
    try {
      await api.post(`/api/farms/${farmId}/terminal/settlements/${settlementId}/apply-pricing`);
      await load();
      onAction?.('updated');
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to apply grade pricing — set grade prices on the contract first'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleFinalize = async () => {
    setActionLoading(true);
    try {
      await api.post(`/api/farms/${farmId}/terminal/settlements/${settlementId}/finalize`);
      await load();
      onAction?.('updated');
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to finalize settlement'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevertToDraft = async () => {
    setActionLoading(true);
    try {
      await api.post(`/api/farms/${farmId}/terminal/settlements/${settlementId}/revert-draft`);
      await load();
      onAction?.('updated');
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to revert settlement to draft'));
    } finally {
      setActionLoading(false);
    }
  };

  const handlePush = async () => {
    setActionLoading(true);
    try {
      await api.post(`/api/farms/${farmId}/terminal/settlements/${settlementId}/push`);
      await load();
      onAction?.('updated');
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to push settlement'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleInvoice = async () => {
    try {
      const res = await api.get(`/api/farms/${farmId}/terminal/settlements/${settlementId}/invoice`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${detail?.settlement_number || settlementId}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to download invoice'));
    }
  };

  const handleDelete = async () => {
    const messages = {
      draft: 'Delete this draft settlement? This cannot be undone.',
      finalized: 'Delete this finalized settlement? Contract delivery totals will be reversed.',
      pushed: 'Delete this pushed settlement? Both the terminal and logistics settlements will be deleted and contract delivery reversed.',
    };
    const confirmed = await confirm({
      title: 'Delete Settlement',
      message: messages[detail?.status] || 'Delete this settlement?',
      confirmText: 'Delete',
      confirmColor: 'error',
    });
    if (!confirmed) return;

    setActionLoading(true);
    try {
      await api.delete(`/api/farms/${farmId}/terminal/settlements/${settlementId}`);
      onAction?.('deleted');
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to delete settlement'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleReconcile = () => {
    onAction?.('reconcile', settlementId);
    onClose();
  };

  const handleClose = () => {
    onClose();
  };

  // --- Render helpers ---

  const renderLinesTable = () => (
    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 350 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>Line #</TableCell>
            <TableCell>{isBuyer ? 'Rail Car' : 'Ticket #'}</TableCell>
            <TableCell>Source</TableCell>
            <TableCell>Grade</TableCell>
            <TableCell align="right">Net MT</TableCell>
            <TableCell align="right">$/MT</TableCell>
            <TableCell align="right">Amount</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {lines.map(l => (
            <TableRow key={l.id}>
              <TableCell>{l.line_number}</TableCell>
              <TableCell>{l.ticket?.ticket_number || '—'}</TableCell>
              <TableCell>{l.source_farm_name || '—'}</TableCell>
              <TableCell>
                {isDraft ? (
                  <TextField
                    size="small"
                    variant="standard"
                    defaultValue={l.grade || ''}
                    onBlur={e => {
                      if (e.target.value !== (l.grade || '')) {
                        handleLineUpdate(l.id, 'grade', e.target.value);
                      }
                    }}
                    sx={{ width: 110 }}
                  />
                ) : (l.grade || '—')}
              </TableCell>
              <TableCell align="right">
                {l.net_weight_mt != null ? fmt(l.net_weight_mt) : '—'}
              </TableCell>
              <TableCell align="right">
                {isDraft ? (
                  <TextField
                    size="small"
                    variant="standard"
                    type="number"
                    defaultValue={l.price_per_mt ?? ''}
                    onBlur={e => {
                      if (e.target.value !== String(l.price_per_mt ?? '')) {
                        handleLineUpdate(l.id, 'price_per_mt', e.target.value);
                      }
                    }}
                    sx={{ width: 90 }}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    }}
                  />
                ) : (l.price_per_mt != null ? fmtDollar(l.price_per_mt) : '—')}
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>
                {l.line_amount != null ? fmtDollar(l.line_amount) : '—'}
              </TableCell>
            </TableRow>
          ))}
          <TableRow sx={{ '& td': { fontWeight: 700, borderTop: '2px solid', borderColor: 'divider' } }}>
            <TableCell colSpan={4}>Totals ({lines.length} lines)</TableCell>
            <TableCell align="right">{fmt(totalMT)}</TableCell>
            <TableCell />
            <TableCell align="right">{fmtDollar(detail?.net_amount)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
  );

  const renderPairedTransfers = () => {
    if (!isBuyer || pairedTransfers.length === 0) return null;
    return (
      <>
        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          LGX → C2 Transfer Settlements
        </Typography>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Settlement #</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Total MT</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pairedTransfers.map(s => {
                const sMT = (s.lines || []).reduce((sum, l) => sum + (parseFloat(l.net_weight_mt) || 0), 0);
                return (
                  <TableRow key={s.id}>
                    <TableCell>{s.settlement_number}</TableCell>
                    <TableCell>{formatDate(s.settlement_date)}</TableCell>
                    <TableCell>
                      <Chip
                        label={TYPE_LABELS[s.type] || s.type}
                        size="small"
                        color={TYPE_COLORS[s.type] || 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell align="right">{fmt(sMT)}</TableCell>
                    <TableCell align="right">{fmtDollar(s.net_amount)}</TableCell>
                    <TableCell>
                      <Chip
                        label={s.status}
                        size="small"
                        color={STATUS_COLORS[s.status] || 'default'}
                        variant={s.status === 'draft' ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {pairedTransfers.length > 1 && (
                <TableRow sx={{ '& td': { fontWeight: 700, borderTop: '2px solid', borderColor: 'divider' } }}>
                  <TableCell colSpan={3}>Total ({pairedTransfers.length} settlements)</TableCell>
                  <TableCell align="right">
                    {fmt(pairedTransfers.reduce((s, r) => s + (r.lines || []).reduce((a, l) => a + (parseFloat(l.net_weight_mt) || 0), 0), 0))}
                  </TableCell>
                  <TableCell align="right">
                    {fmtDollar(pairedTransfers.reduce((s, r) => s + (parseFloat(r.net_amount) || 0), 0))}
                  </TableCell>
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </>
    );
  };

  const renderPairedBuyer = () => {
    if (isBuyer || !pairedBuyer) return null;
    const bMT = (pairedBuyer.lines || []).reduce((s, l) => s + (parseFloat(l.net_weight_mt) || 0), 0);
    return (
      <>
        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Paired Buyer Settlement
        </Typography>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
            <Typography variant="body2"><strong>Settlement:</strong> {pairedBuyer.settlement_number}</Typography>
            <Typography variant="body2"><strong>Buyer:</strong> {pairedBuyer.counterparty?.name || '—'}</Typography>
            <Typography variant="body2"><strong>Date:</strong> {formatDate(pairedBuyer.settlement_date)}</Typography>
            <Typography variant="body2"><strong>Total MT:</strong> {fmt(bMT)}</Typography>
            <Typography variant="body2" fontWeight={700}><strong>Amount:</strong> {fmtDollar(pairedBuyer.net_amount)}</Typography>
            <Chip
              label={pairedBuyer.status}
              size="small"
              color={STATUS_COLORS[pairedBuyer.status] || 'default'}
              variant={pairedBuyer.status === 'draft' ? 'filled' : 'outlined'}
            />
          </Box>
        </Paper>
      </>
    );
  };

  const renderActions = () => {
    const actions = [];

    // Left-aligned delete (admin only)
    if (isAdmin && detail) {
      actions.push(
        <Button
          key="delete"
          color="error"
          startIcon={<DeleteIcon />}
          onClick={handleDelete}
          disabled={actionLoading}
          sx={{ mr: 'auto' }}
        >
          Delete
        </Button>
      );
    }

    if (!detail) {
      actions.push(<Button key="close" onClick={handleClose}>Close</Button>);
      return actions;
    }

    // Draft + transfer/transloading
    if (isDraft && !isBuyer) {
      const needsPricing = !detail.net_amount || parseFloat(detail.net_amount) === 0;
      if (needsPricing) {
        actions.push(
          <Button
            key="pricing"
            color="warning"
            onClick={handleApplyPricing}
            disabled={actionLoading}
          >
            Apply Pricing
          </Button>
        );
      }
      actions.push(
        <Button
          key="finalize"
          variant="outlined"
          onClick={handleFinalize}
          disabled={actionLoading}
        >
          Finalize
        </Button>
      );
    }

    // Draft + buyer_settlement
    if (isDraft && isBuyer) {
      actions.push(
        <Button
          key="reconcile"
          variant="outlined"
          color="success"
          onClick={handleReconcile}
          disabled={actionLoading}
        >
          Reconcile
        </Button>
      );
    }

    // Finalized + transfer
    if (isFinalized && isTransfer) {
      actions.push(
        <Button
          key="revert"
          color="warning"
          onClick={handleRevertToDraft}
          disabled={actionLoading}
        >
          Revert to Draft
        </Button>
      );
      actions.push(
        <Button
          key="push"
          variant="contained"
          onClick={handlePush}
          disabled={actionLoading}
        >
          Push to Logistics
        </Button>
      );
    }

    // Finalized + transloading
    if (isFinalized && isTransloading) {
      actions.push(
        <Button
          key="revert"
          color="warning"
          onClick={handleRevertToDraft}
          disabled={actionLoading}
        >
          Revert to Draft
        </Button>
      );
      actions.push(
        <Button
          key="invoice"
          variant="outlined"
          onClick={handleInvoice}
          disabled={actionLoading}
        >
          Download Invoice
        </Button>
      );
    }

    // Finalized + buyer_settlement
    if (isFinalized && isBuyer) {
      actions.push(
        <Button
          key="push-buyer"
          variant="contained"
          color="primary"
          onClick={handleReconcile}
          disabled={actionLoading}
        >
          Push to Logistics
        </Button>
      );
    }

    // Pushed
    if (isPushed) {
      actions.push(
        <Button
          key="view-logistics"
          startIcon={<OpenInNewIcon />}
          onClick={() => navigate('/logistics/settlements')}
        >
          View in Logistics
        </Button>
      );
    }

    actions.push(<Button key="close" onClick={handleClose}>Close</Button>);
    return actions;
  };

  return (
    <>
      <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
        <DialogTitle>
          {detail ? (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <span>{detail.settlement_number}</span>
                {detail.counterparty?.name && (
                  <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                    {detail.counterparty.name}
                  </Typography>
                )}
              </Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Chip
                  label={TYPE_LABELS[detail.type] || detail.type}
                  size="small"
                  color={TYPE_COLORS[detail.type] || 'default'}
                  variant="outlined"
                />
                <Chip
                  label={detail.status}
                  size="small"
                  color={STATUS_COLORS[detail.status] || 'default'}
                  variant={detail.status === 'draft' ? 'filled' : 'outlined'}
                />
              </Box>
            </Box>
          ) : 'Settlement Detail'}
        </DialogTitle>

        <DialogContent dividers>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          )}

          {detail && !loading && (
            <>
              {/* Header info */}
              <Box sx={{ display: 'flex', gap: 3, mb: 2, flexWrap: 'wrap' }}>
                <Typography variant="body2">
                  <strong>Contract:</strong> {detail.contract?.contract_number || '—'}
                </Typography>
                <Typography variant="body2">
                  <strong>Counterparty:</strong> {detail.counterparty?.name || '—'}
                </Typography>
                <Typography variant="body2">
                  <strong>Date:</strong> {formatDate(detail.settlement_date)}
                </Typography>
                <Typography variant="body2" fontWeight={700}>
                  <strong>Net Amount:</strong> {fmtDollar(detail.net_amount)}
                </Typography>
              </Box>

              {/* Settlement lines table */}
              {renderLinesTable()}

              {/* Notes */}
              {detail.notes && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  <strong>Notes:</strong> {detail.notes}
                </Typography>
              )}

              {/* Realization panel for buyer settlements */}
              {isBuyer && detail.realization_json && (
                <Box sx={{ mt: 2 }}>
                  <RealizationPanel
                    realization={detail.realization_json}
                    buyerName={detail.counterparty?.name}
                    contractNumber={detail.contract?.contract_number}
                    deductions={detail.deductions_summary || detail.extraction_json?.deductions_summary || []}
                  />
                </Box>
              )}

              {/* Paired transfer settlements (shown for buyer_settlement type) */}
              {renderPairedTransfers()}

              {/* Paired buyer settlement (shown for transfer/transloading type) */}
              {renderPairedBuyer()}
            </>
          )}
        </DialogContent>

        <DialogActions>
          {renderActions()}
        </DialogActions>
      </Dialog>

      <ConfirmDialog {...dialogProps} />
    </>
  );
}
