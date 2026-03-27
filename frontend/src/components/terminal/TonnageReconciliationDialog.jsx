import { useState, useCallback, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Box, Typography, Alert, Paper, Grid, Chip, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  CircularProgress,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { formatCurrency, fmt } from '../../utils/formatting';

/**
 * TonnageReconciliationDialog — Three-layer tonnage reconciliation for terminal-routed contracts.
 *
 * Shows:
 *   Layer 1: C2 DeliveryTickets → LGX inbound TerminalTickets
 *   Layer 2: LGX outbound TerminalTickets → Buyer settlement lines
 *   Layer 3: Contract-level aggregate MT comparison
 *
 * On approve: triggers BU credit cascade.
 */
export default function TonnageReconciliationDialog({ open, onClose, farmId, settlementId, onDone }) {
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState(null);
  const [recon, setRecon] = useState(null);
  const [result, setResult] = useState(null);

  const loadRecon = useCallback(async () => {
    if (!farmId || !settlementId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await api.post(`/api/farms/${farmId}/terminal/grain-sale/${settlementId}/reconcile-tonnage`);
      setRecon(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to compute tonnage reconciliation'));
    } finally {
      setLoading(false);
    }
  }, [farmId, settlementId]);

  useEffect(() => {
    if (open) {
      setRecon(null);
      setResult(null);
      setError(null);
      loadRecon();
    }
  }, [open, loadRecon]);

  const handleApprove = async () => {
    try {
      setApproving(true);
      setError(null);
      const res = await api.post(`/api/farms/${farmId}/terminal/grain-sale/${settlementId}/approve-tonnage`);
      setResult(res.data);
      onDone?.();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to approve tonnage reconciliation'));
    } finally {
      setApproving(false);
    }
  };

  const isApproveRecommended = recon?.recommendation?.startsWith('APPROVE');
  const overallVar = recon?.variances?.overall_pct;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        Tonnage Reconciliation
        {recon?.contract && (
          <Chip label={`Contract #${recon.contract.contract_number}`} size="small" variant="outlined" />
        )}
      </DialogTitle>
      <DialogContent>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {result && (
          <Alert severity="success" sx={{ mb: 2 }} icon={<CheckCircleIcon />}>
            Settlement approved. {result.buCredits?.allocations?.length || 0} BU credit allocation(s) created.
            Contract status: {result.contract?.status}.
          </Alert>
        )}

        {recon && !result && (
          <>
            {/* Contract Info */}
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={6} sm={3}>
                  <Typography variant="caption" color="text.secondary">Commodity</Typography>
                  <Typography fontWeight={600}>{recon.contract.commodity}</Typography>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Typography variant="caption" color="text.secondary">Buyer</Typography>
                  <Typography fontWeight={600}>{recon.contract.counterparty}</Typography>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Typography variant="caption" color="text.secondary">Contracted</Typography>
                  <Typography fontWeight={600}>{fmt(recon.contract.contracted_mt)} MT</Typography>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Typography variant="caption" color="text.secondary">Grade Prices</Typography>
                  <Chip
                    label={recon.contract.has_grade_prices ? 'Set' : 'Not set'}
                    size="small"
                    color={recon.contract.has_grade_prices ? 'success' : 'default'}
                    variant="outlined"
                  />
                </Grid>
              </Grid>
            </Paper>

            {/* Three-Layer Flow */}
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>Grain Flow Reconciliation</Typography>
            <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 1, mb: 2, flexWrap: 'wrap' }}>
              <LayerCard
                label="C2 Shipped"
                mt={recon.layers.c2_shipped.total_mt}
                detail={`${recon.layers.c2_shipped.ticket_count} truck loads`}
                source={recon.layers.c2_shipped.source}
                color="primary"
              />
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <VarianceArrow value={recon.variances.c2_vs_lgx_inbound_pct} />
              </Box>
              <LayerCard
                label="LGX Inbound"
                mt={recon.layers.lgx_inbound.total_mt}
                detail={`${recon.layers.lgx_inbound.ticket_count} receiving tickets`}
                source={recon.layers.lgx_inbound.source}
                color="info"
              />
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <ArrowForwardIcon sx={{ color: 'text.disabled' }} />
              </Box>
              <LayerCard
                label="LGX Outbound"
                mt={recon.layers.lgx_outbound.total_mt}
                detail={`${recon.layers.lgx_outbound.ticket_count} rail cars`}
                source={recon.layers.lgx_outbound.source}
                color="warning"
              />
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <VarianceArrow value={recon.variances.lgx_outbound_vs_settled_pct} />
              </Box>
              <LayerCard
                label="Buyer Settled"
                mt={recon.layers.settled.total_mt}
                detail={`${recon.layers.settled.line_count} lines | ${formatCurrency(recon.layers.settled.net_amount)}`}
                source={recon.layers.settled.source}
                color="success"
              />
            </Box>

            {/* Overall Variance */}
            <Paper
              variant="outlined"
              sx={{
                p: 2, mb: 2, textAlign: 'center',
                borderColor: isApproveRecommended ? 'success.main' : 'warning.main',
                borderWidth: 2,
              }}
            >
              <Typography variant="body2" color="text.secondary">Overall Variance (C2 Shipped vs Settled)</Typography>
              <Typography variant="h5" fontWeight={700} color={isApproveRecommended ? 'success.main' : 'warning.main'}>
                {overallVar != null ? `${overallVar > 0 ? '+' : ''}${overallVar}%` : 'N/A'}
              </Typography>
              <Chip
                icon={isApproveRecommended ? <CheckCircleIcon /> : <WarningIcon />}
                label={recon.recommendation}
                color={isApproveRecommended ? 'success' : 'warning'}
                sx={{ mt: 1 }}
              />
            </Paper>

            {/* BU Breakdown */}
            {recon.bu_breakdown.length > 0 && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  BU Farm Contributions (will be used for credit allocation)
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>BU Farm</TableCell>
                        <TableCell align="right">Contributed MT</TableCell>
                        <TableCell align="right">Tickets</TableCell>
                        <TableCell align="right">Share</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {recon.bu_breakdown.map((bu, i) => {
                        const totalMt = recon.layers.lgx_inbound.total_mt || 1;
                        const share = ((bu.contributed_mt / totalMt) * 100).toFixed(1);
                        return (
                          <TableRow key={i}>
                            <TableCell><strong>{bu.bu_farm_name}</strong></TableCell>
                            <TableCell align="right">{fmt(bu.contributed_mt)} MT</TableCell>
                            <TableCell align="right">{bu.ticket_count}</TableCell>
                            <TableCell align="right">{share}%</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{result ? 'Close' : 'Cancel'}</Button>
        {recon && !result && (
          <Button
            variant="contained"
            color={isApproveRecommended ? 'success' : 'warning'}
            onClick={handleApprove}
            disabled={approving}
            startIcon={approving ? <CircularProgress size={16} /> : <CheckCircleIcon />}
          >
            {approving ? 'Approving...' : 'Approve & Allocate BU Credits'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function LayerCard({ label, mt, detail, source, color }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5, flex: 1, minWidth: 120, textAlign: 'center',
        borderColor: `${color}.main`, borderWidth: 1.5,
      }}
    >
      <Typography variant="caption" color={`${color}.main`} fontWeight={600}>{label}</Typography>
      <Typography variant="h6" fontWeight={700}>{fmt(mt)} MT</Typography>
      <Typography variant="caption" color="text.secondary">{detail}</Typography>
    </Paper>
  );
}

function VarianceArrow({ value }) {
  if (value == null) return <ArrowForwardIcon sx={{ color: 'text.disabled' }} />;
  const color = Math.abs(value) <= 3 ? 'success.main' : Math.abs(value) <= 5 ? 'warning.main' : 'error.main';
  return (
    <Box sx={{ textAlign: 'center', px: 0.5 }}>
      <ArrowForwardIcon sx={{ color }} />
      <Typography variant="caption" sx={{ display: 'block', color, fontWeight: 600, fontSize: 10 }}>
        {value > 0 ? '+' : ''}{value}%
      </Typography>
    </Box>
  );
}
