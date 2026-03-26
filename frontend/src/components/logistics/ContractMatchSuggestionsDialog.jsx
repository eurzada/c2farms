import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  Chip, Stack, CircularProgress, Alert, Tooltip, IconButton,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CloseIcon from '@mui/icons-material/Close';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { fmtDollar } from '../../utils/formatting';

const CONFIDENCE_COLORS = { high: 'success', medium: 'warning', low: 'error' };

export default function ContractMatchSuggestionsDialog({ open, onClose, farmId, onLinked }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [linking, setLinking] = useState({});
  const [linked, setLinked] = useState({});

  const fetchSuggestions = useCallback(async () => {
    if (!farmId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.post(`/api/farms/${farmId}/settlements/suggest-contract-matches`);
      setData(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load suggestions'));
    } finally {
      setLoading(false);
    }
  }, [farmId]);

  useEffect(() => {
    if (open) {
      setLinked({});
      fetchSuggestions();
    }
  }, [open, fetchSuggestions]);

  const handleAccept = async (group, suggestion) => {
    const key = group.extracted_contract_number;
    setLinking(prev => ({ ...prev, [key]: true }));
    try {
      // Link all settlements in this group to the chosen contract
      for (const sid of group.settlement_ids) {
        await api.patch(`/api/farms/${farmId}/settlements/${sid}`, {
          contract_number: suggestion.contract_number,
        });
      }
      setLinked(prev => ({ ...prev, [key]: suggestion.contract_number }));
      if (onLinked) onLinked();
    } catch (err) {
      setError(extractErrorMessage(err, `Failed to link ${key}`));
    } finally {
      setLinking(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleAcceptAllHigh = async () => {
    if (!data?.suggestions) return;
    const highGroups = data.suggestions.filter(
      g => g.suggestions[0]?.confidence === 'high' && !linked[g.extracted_contract_number]
    );
    for (const group of highGroups) {
      await handleAccept(group, group.suggestions[0]);
    }
  };

  const highCount = data?.suggestions?.filter(
    g => g.suggestions[0]?.confidence === 'high' && !linked[g.extracted_contract_number]
  ).length || 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">Contract Match Suggestions</Typography>
          <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {loading && (
          <Stack alignItems="center" spacing={2} sx={{ py: 4 }}>
            <CircularProgress />
            <Typography color="text.secondary">Analyzing contract numbers...</Typography>
          </Stack>
        )}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {!loading && data && data.suggestions.length === 0 && (
          <Alert severity="info">
            No fuzzy matches found. All orphaned settlements either have exact matches (use Re-link)
            or their contract numbers are too different from any existing contract.
          </Alert>
        )}
        {!loading && data && data.suggestions.length > 0 && (
          <>
            <Alert severity="info" sx={{ mb: 2 }}>
              Found {data.suggestions.length} group(s) of orphaned settlements with possible contract matches.
              Review the suggestions below and accept or skip each one.
            </Alert>
            {highCount > 0 && (
              <Button
                variant="contained"
                color="success"
                size="small"
                onClick={handleAcceptAllHigh}
                sx={{ mb: 2 }}
              >
                Accept All High Confidence ({highCount})
              </Button>
            )}
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Extracted Contract #</TableCell>
                    <TableCell>Buyer</TableCell>
                    <TableCell align="right">Settlements</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell>Best Match</TableCell>
                    <TableCell>Commodity</TableCell>
                    <TableCell>Confidence</TableCell>
                    <TableCell>Reason</TableCell>
                    <TableCell align="center">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.suggestions.map((group) => {
                    const best = group.suggestions[0];
                    const key = group.extracted_contract_number;
                    const isLinked = !!linked[key];
                    const isLinking = !!linking[key];
                    return (
                      <TableRow key={key} sx={isLinked ? { opacity: 0.5 } : undefined}>
                        <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {group.extracted_contract_number}
                        </TableCell>
                        <TableCell>{group.buyer}</TableCell>
                        <TableCell align="right">{group.settlement_count}</TableCell>
                        <TableCell align="right">{fmtDollar(group.total_amount)}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>
                          {best.contract_number}
                          {best.counterparty && (
                            <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                              ({best.counterparty})
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>{best.commodity}</TableCell>
                        <TableCell>
                          <Chip
                            label={best.confidence}
                            size="small"
                            color={CONFIDENCE_COLORS[best.confidence]}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption">{best.reason}</Typography>
                        </TableCell>
                        <TableCell align="center">
                          {isLinked ? (
                            <Chip label="Linked" size="small" color="success" variant="outlined" />
                          ) : (
                            <Tooltip title={`Link ${group.settlement_count} settlement(s) to ${best.contract_number}`}>
                              <IconButton
                                size="small"
                                color="success"
                                onClick={() => handleAccept(group, best)}
                                disabled={isLinking}
                              >
                                {isLinking ? <CircularProgress size={16} /> : <CheckCircleOutlineIcon />}
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
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
