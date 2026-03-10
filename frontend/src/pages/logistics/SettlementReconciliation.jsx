import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, Stack, Chip, Alert, Paper, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, LinearProgress,
  IconButton, Tooltip, MenuItem, Grid,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import LinkIcon from '@mui/icons-material/Link';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import CancelIcon from '@mui/icons-material/Cancel';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import PercentIcon from '@mui/icons-material/Percent';
import DownloadIcon from '@mui/icons-material/Download';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { useSearchParams } from 'react-router-dom';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';
import { fmt, fmtDollar } from '../../utils/formatting';

const MATCH_STATUS_CONFIG = {
  matched: { color: 'success', icon: <CheckCircleIcon />, label: 'Matched' },
  manual: { color: 'info', icon: <LinkIcon />, label: 'Manual' },
  exception: { color: 'error', icon: <WarningIcon />, label: 'Exception' },
  unmatched: { color: 'warning', icon: <ErrorIcon />, label: 'Unmatched' },
};

function parseExceptionType(reason) {
  if (!reason) return { type: 'Unknown', detail: reason };
  const lower = reason.toLowerCase();
  if (lower.includes('missing_ticket') || lower.includes('no_matching_ticket')) return { type: 'Missing Ticket', detail: reason };
  if (lower.includes('date_mismatch') || lower.includes('date')) return { type: 'Date Mismatch', detail: reason };
  if (lower.includes('weight_mismatch') || lower.includes('weight_diff')) return { type: 'Weight Discrepancy', detail: reason };
  if (lower.includes('commodity_mismatch') || lower.includes('commodity')) return { type: 'Commodity Mismatch', detail: reason };
  if (lower.includes('low_confidence') || lower.includes('contract_mismatch')) return { type: 'Low Confidence', detail: reason };
  return { type: 'Exception', detail: reason };
}

function getActionRecommendation(line, exType) {
  const ticket = line.delivery_ticket;
  switch (exType) {
    case 'Missing Ticket': {
      const dateStr = line.delivery_date ? new Date(line.delivery_date).toLocaleDateString() : 'unknown date';
      return `No matching ticket found. Check with trucker for loads around ${dateStr}. Weight: ${fmt(line.net_weight_mt)} MT.`;
    }
    case 'Date Mismatch': {
      if (!ticket) return 'Matched ticket has a date discrepancy.';
      const sDate = line.delivery_date ? new Date(line.delivery_date).toLocaleDateString() : '—';
      const tDate = ticket.delivery_date ? new Date(ticket.delivery_date).toLocaleDateString() : '—';
      const daysDiff = line.delivery_date && ticket.delivery_date
        ? Math.abs(Math.round((new Date(line.delivery_date) - new Date(ticket.delivery_date)) / (1000 * 60 * 60 * 24)))
        : '?';
      return `Settlement: ${sDate}, Ticket: ${tDate} (${daysDiff} days apart).`;
    }
    case 'Weight Discrepancy': {
      if (!ticket) return 'Weight does not match any ticket.';
      const sWt = line.net_weight_mt;
      const tWt = ticket.net_weight_mt;
      const pctDiff = sWt && tWt ? ((Math.abs(sWt - tWt) / Math.max(sWt, tWt)) * 100).toFixed(1) : '?';
      return `Settlement: ${fmt(sWt)} MT, Ticket: ${fmt(tWt)} MT (${pctDiff}% diff).`;
    }
    case 'Commodity Mismatch':
      return `Settlement commodity "${line.commodity || '—'}" does not match ticket commodity "${ticket?.commodity?.name || '—'}".`;
    case 'Low Confidence':
      return `Match confidence is below threshold. Review the data carefully before accepting.`;
    default:
      return line.exception_reason || 'Review and resolve this exception.';
  }
}

// ─── Summary Card ────────────────────────────────────────────────────
function SummaryCard({ label, value, color, icon }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2, flex: 1, minWidth: 120, textAlign: 'center',
        borderColor: `${color}.main`, borderWidth: 2,
      }}
    >
      <Stack alignItems="center" spacing={0.5}>
        {icon}
        <Typography variant="h5" sx={{ fontWeight: 700, color: `${color}.main` }}>{value}</Typography>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
      </Stack>
    </Paper>
  );
}

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
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [dismissing, setDismissing] = useState(null);

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

  const handleDismiss = async (lineId, notes) => {
    setDismissing(lineId);
    try {
      await api.post(
        `/api/farms/${currentFarm.id}/settlements/${settlementId}/lines/${lineId}/dismiss`,
        { notes }
      );
      fetchSettlement();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setDismissing(null);
    }
  };

  const handleApprove = async () => {
    setApproving(true);
    try {
      await api.post(`/api/farms/${currentFarm.id}/settlements/${settlementId}/approve`);
      setApproveConfirmOpen(false);
      fetchSettlement();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setApproving(false);
    }
  };

  const handleExportExcel = async () => {
    try {
      const res = await api.get(
        `/api/farms/${currentFarm.id}/settlements/${settlementId}/export/excel`,
        { responseType: 'blob' }
      );
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reconciliation-report-${settlement?.settlement_number || 'settlement'}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to download Excel report';
      setError(`Excel export failed: ${msg}`);
    }
  };

  const handleExportPdf = async () => {
    try {
      const res = await api.get(
        `/api/farms/${currentFarm.id}/settlements/${settlementId}/export/pdf`,
        { responseType: 'blob' }
      );
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reconciliation-report-${settlement?.settlement_number || 'settlement'}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to download PDF report';
      setError(`PDF export failed: ${msg}`);
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
  if (!settlement) return <Alert severity="error">Settlement not found</Alert>;

  const matchedCount = settlement.lines.filter(l => l.match_status === 'matched' || l.match_status === 'manual').length;
  const exceptionCount = settlement.lines.filter(l => l.match_status === 'exception').length;
  const unmatchedCount = settlement.lines.filter(l => l.match_status === 'unmatched').length;
  const totalLines = settlement.lines.length;
  const avgConfidence = totalLines > 0
    ? settlement.lines.reduce((s, l) => s + (l.match_confidence || 0), 0) / totalLines
    : 0;
  const canApprove = isAdmin && unmatchedCount === 0 && exceptionCount === 0 && settlement.status !== 'approved';
  const isApproved = settlement.status === 'approved';
  const report = settlement.reconciliation_report;

  // Count lines with marketing contracts for pre-approval summary
  const linesWithContracts = settlement.lines.filter(
    l => l.delivery_ticket?.marketing_contract_id
  ).length;
  const uniqueContracts = new Set(
    settlement.lines
      .filter(l => l.delivery_ticket?.marketing_contract_id)
      .map(l => l.delivery_ticket.marketing_contract_id)
  );

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            Settlement Reconciliation
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {settlement.settlement_number} | {settlement.counterparty?.name || 'Unknown Buyer'} |{' '}
            {settlement.buyer_format?.toUpperCase()}
            {settlement.marketing_contract?.contract_number && ` | Contract #${settlement.marketing_contract.contract_number}`}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip label={settlement.status.toUpperCase()} color={
            settlement.status === 'approved' ? 'success' :
            settlement.status === 'reconciled' ? 'info' :
            settlement.status === 'disputed' ? 'error' : 'warning'
          } />
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={handleExportExcel}>
            Excel
          </Button>
          <Button size="small" variant="outlined" startIcon={<PictureAsPdfIcon />} onClick={handleExportPdf}>
            PDF
          </Button>
          {canEdit && !isApproved && (
            <Button
              variant="contained"
              startIcon={<AutoFixHighIcon />}
              onClick={handleReconcile}
              disabled={reconciling}
            >
              {reconciling ? 'Reconciling...' : 'Run AI Reconciliation'}
            </Button>
          )}
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {reconcileResult && !isApproved && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Reconciliation complete: {reconcileResult.summary.matched} matched,{' '}
          {reconcileResult.summary.exceptions} exceptions,{' '}
          {reconcileResult.summary.unmatched} unmatched out of {reconcileResult.summary.total_lines} lines.
          Average confidence: {(reconcileResult.summary.avg_confidence * 100).toFixed(0)}%
        </Alert>
      )}

      {/* ═══ Post-Approval Report View ═══ */}
      {isApproved && report && (
        <>
          <Alert severity="success" sx={{ mb: 2 }}>
            Settlement approved{report.approved_at ? ` on ${new Date(report.approved_at).toLocaleDateString()}` : ''}.
            All reconciliation is finalized.
          </Alert>

          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={6} sm={3}>
              <SummaryCard
                label="Lines Matched"
                value={`${report.matched_lines + report.manual_lines}/${report.total_lines}`}
                color="success"
                icon={<CheckCircleIcon color="success" />}
              />
            </Grid>
            <Grid item xs={6} sm={3}>
              <SummaryCard
                label="Deliveries Created"
                value={report.deliveries_created}
                color="primary"
                icon={<LocalShippingIcon color="primary" />}
              />
            </Grid>
            <Grid item xs={6} sm={3}>
              <SummaryCard
                label="Contracts Updated"
                value={report.contracts_updated?.length || 0}
                color="info"
                icon={<ReceiptLongIcon color="info" />}
              />
            </Grid>
            <Grid item xs={6} sm={3}>
              <SummaryCard
                label="Cash Flow Total"
                value={fmtDollar(report.cash_flow_total)}
                color="success"
                icon={<AttachMoneyIcon color="success" />}
              />
            </Grid>
          </Grid>

          {/* Per-contract detail */}
          {report.contracts_updated?.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Contract Updates</Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Contract #</TableCell>
                    <TableCell align="right">Total Delivered (MT)</TableCell>
                    <TableCell align="right">Remaining (MT)</TableCell>
                    <TableCell>Previous Status</TableCell>
                    <TableCell>New Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.contracts_updated.map(c => (
                    <TableRow key={c.contract_id}>
                      <TableCell sx={{ fontWeight: 600 }}>{c.contract_number}</TableCell>
                      <TableCell align="right">{fmt(c.delivered_mt)}</TableCell>
                      <TableCell align="right">{fmt(c.remaining_mt)}</TableCell>
                      <TableCell>
                        <Chip label={c.previous_status} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={c.new_status}
                          size="small"
                          color={c.new_status === 'delivered' ? 'success' : c.new_status === 'in_delivery' ? 'info' : 'default'}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          )}
        </>
      )}

      {/* ═══ Summary Cards (always shown) ═══ */}
      {!isApproved && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6} sm={2.4}>
            <SummaryCard label="Matched" value={matchedCount} color="success" icon={<CheckCircleIcon color="success" />} />
          </Grid>
          <Grid item xs={6} sm={2.4}>
            <SummaryCard label="Exceptions" value={exceptionCount} color="error" icon={<WarningIcon color="error" />} />
          </Grid>
          <Grid item xs={6} sm={2.4}>
            <SummaryCard label="Unmatched" value={unmatchedCount} color="warning" icon={<ErrorIcon color="warning" />} />
          </Grid>
          <Grid item xs={6} sm={2.4}>
            <SummaryCard label="Total Value" value={fmtDollar(settlement.total_amount)} color="info" icon={<AttachMoneyIcon color="info" />} />
          </Grid>
          <Grid item xs={6} sm={2.4}>
            <SummaryCard label="Avg Confidence" value={`${(avgConfidence * 100).toFixed(0)}%`} color="primary" icon={<PercentIcon color="primary" />} />
          </Grid>
        </Grid>
      )}

      {/* ═══ Action Items Panel (exceptions) ═══ */}
      {!isApproved && (exceptionCount > 0 || unmatchedCount > 0) && (
        <Paper
          variant="outlined"
          sx={{ p: 2, mb: 3, borderColor: 'error.main', borderWidth: 2 }}
        >
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'error.main' }}>
              Action Required — {exceptionCount + unmatchedCount} line{exceptionCount + unmatchedCount !== 1 ? 's' : ''} need resolution
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={handleExportExcel}>
                Excel
              </Button>
              <Button size="small" variant="outlined" startIcon={<PictureAsPdfIcon />} onClick={handleExportPdf}>
                PDF
              </Button>
            </Stack>
          </Stack>

          <Stack spacing={2}>
            {settlement.lines
              .filter(l => l.match_status === 'exception' || l.match_status === 'unmatched')
              .map(line => {
                const { type: exType } = parseExceptionType(line.exception_reason);
                const recommendation = getActionRecommendation(line, exType);
                const ticket = line.delivery_ticket;

                return (
                  <Paper key={line.id} variant="outlined" sx={{ p: 2 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Box sx={{ flex: 1 }}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                          <Chip label={`Line ${line.line_number}`} size="small" color="error" />
                          <Chip label={exType} size="small" variant="outlined" color="error" />
                          {line.match_confidence != null && (
                            <Typography variant="caption" color="text.secondary">
                              Confidence: {(line.match_confidence * 100).toFixed(0)}%
                            </Typography>
                          )}
                        </Stack>

                        {/* Side-by-side comparison */}
                        <Grid container spacing={2} sx={{ mb: 1 }}>
                          <Grid item xs={12} sm={6}>
                            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>Settlement Line</Typography>
                            <Typography variant="body2">Ticket #: {line.ticket_number_on_settlement || 'N/A'}</Typography>
                            <Typography variant="body2">Weight: {fmt(line.net_weight_mt, 3)} MT</Typography>
                            <Typography variant="body2">Date: {line.delivery_date ? new Date(line.delivery_date).toLocaleDateString() : 'N/A'}</Typography>
                            <Typography variant="body2">Commodity: {line.commodity || 'N/A'}</Typography>
                          </Grid>
                          {ticket && (
                            <Grid item xs={12} sm={6}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>Closest Ticket Match</Typography>
                              <Typography variant="body2">Ticket #: {ticket.ticket_number}</Typography>
                              <Typography variant="body2">Weight: {fmt(ticket.net_weight_mt, 3)} MT</Typography>
                              <Typography variant="body2">Date: {ticket.delivery_date ? new Date(ticket.delivery_date).toLocaleDateString() : 'N/A'}</Typography>
                              <Typography variant="body2">Location: {ticket.location?.name || 'N/A'}</Typography>
                            </Grid>
                          )}
                        </Grid>

                        <Alert severity="warning" variant="outlined" sx={{ py: 0.5 }}>
                          <Typography variant="body2">{recommendation}</Typography>
                        </Alert>
                      </Box>

                      {/* Action buttons */}
                      {canEdit && (
                        <Stack spacing={1} sx={{ ml: 2, minWidth: 120 }}>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<LinkIcon />}
                            onClick={() => setManualMatchDialog({ open: true, line })}
                          >
                            Manual Match
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="warning"
                            startIcon={<CancelIcon />}
                            disabled={dismissing === line.id}
                            onClick={() => handleDismiss(line.id, `Dismissed by user — ${exType}`)}
                          >
                            {dismissing === line.id ? 'Dismissing...' : 'Dismiss'}
                          </Button>
                        </Stack>
                      )}
                    </Stack>
                  </Paper>
                );
              })}
          </Stack>
        </Paper>
      )}

      {/* ═══ Pre-Approval Summary ═══ */}
      {canApprove && (
        <Paper
          variant="outlined"
          sx={{ p: 2, mb: 3, borderColor: 'success.main', borderWidth: 2, bgcolor: 'success.50' }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'success.dark', mb: 1 }}>
            Ready for Approval
          </Typography>
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            All {totalLines} line{totalLines !== 1 ? 's' : ''} resolved ({matchedCount} matched).
          </Typography>
          {linesWithContracts > 0 && (
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              Will record {linesWithContracts} deliver{linesWithContracts !== 1 ? 'ies' : 'y'} against {uniqueContracts.size} marketing contract{uniqueContracts.size !== 1 ? 's' : ''}.
            </Typography>
          )}
          {settlement.total_amount > 0 && (
            <Typography variant="body2" sx={{ mb: 1 }}>
              Will create {fmtDollar(settlement.total_amount)} in actual cash flow receipts.
            </Typography>
          )}
          <Button
            variant="contained"
            color="success"
            startIcon={<DoneAllIcon />}
            onClick={() => setApproveConfirmOpen(true)}
          >
            Approve Settlement
          </Button>
        </Paper>
      )}

      {/* ═══ Matched Lines Table ═══ */}
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        {isApproved ? 'Settlement Lines' : 'All Lines'}
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
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
              {!isApproved && <TableCell width={80}>Actions</TableCell>}
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
                    {line.delivery_ticket ? (() => {
                      const buyerNum = String(line.ticket_number_on_settlement || '').replace(/[^0-9]/g, '');
                      const matchedNum = String(line.delivery_ticket.ticket_number || '').replace(/[^0-9]/g, '');
                      const ticketNumsMatch = buyerNum && matchedNum && Number(buyerNum) === Number(matchedNum);
                      return (
                        <Stack spacing={0}>
                          <Typography variant="body2" color={ticketNumsMatch ? 'text.primary' : 'error.main'}>
                            Ticket #{line.delivery_ticket.ticket_number}
                            {!ticketNumsMatch && ' ⚠'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {line.delivery_ticket.net_weight_mt?.toFixed(2)} MT |{' '}
                            {line.delivery_ticket.commodity?.name} |{' '}
                            {line.delivery_ticket.location?.name}
                          </Typography>
                          {!ticketNumsMatch && (
                            <Typography variant="caption" color="error.main">
                              Buyer ticket #{line.ticket_number_on_settlement} does not match
                            </Typography>
                          )}
                        </Stack>
                      );
                    })() : (
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
                  {!isApproved && (
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
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* ═══ Manual Match Dialog ═══ */}
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

      {/* ═══ Approve Confirmation Dialog ═══ */}
      <Dialog
        open={approveConfirmOpen}
        onClose={() => setApproveConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Confirm Approval</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This action cannot be undone.
          </Alert>
          <Typography variant="body2" gutterBottom>
            Approving will:
          </Typography>
          <Typography variant="body2" component="ul" sx={{ pl: 2, mb: 0 }}>
            <li>Mark all matched tickets as settled</li>
            {linesWithContracts > 0 && (
              <li>Record {linesWithContracts} delivery record{linesWithContracts !== 1 ? 's' : ''} against {uniqueContracts.size} marketing contract{uniqueContracts.size !== 1 ? 's' : ''}</li>
            )}
            {settlement.total_amount > 0 && (
              <li>Create {fmtDollar(settlement.total_amount)} in actual cash flow receipts</li>
            )}
            <li>Update contract hauled amounts and statuses</li>
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApproveConfirmOpen(false)} disabled={approving}>Cancel</Button>
          <Button
            variant="contained"
            color="success"
            onClick={handleApprove}
            disabled={approving}
            startIcon={<DoneAllIcon />}
          >
            {approving ? 'Approving...' : 'Approve'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
