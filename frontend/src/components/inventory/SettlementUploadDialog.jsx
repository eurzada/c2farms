import { useState, useEffect, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Alert, Chip, Stack, LinearProgress, TextField, MenuItem,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  ToggleButton, ToggleButtonGroup, List, ListItem, ListItemIcon, ListItemText,
  CircularProgress,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import BoltIcon from '@mui/icons-material/Bolt';
import BatchPredictionIcon from '@mui/icons-material/BatchPrediction';
import DescriptionIcon from '@mui/icons-material/Description';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import api from '../../services/api';

function classifyError(err) {
  const data = err.response?.data;
  const code = data?.code;
  if (code === 'NO_API_KEY') return 'AI extraction is not configured. Contact your administrator to set up the Anthropic API key.';
  if (code === 'INVALID_API_KEY') return 'AI API key is invalid. Contact your administrator to update it.';
  if (code === 'INSUFFICIENT_CREDITS') return 'AI service credits exhausted. Contact your administrator to add funds at console.anthropic.com.';
  if (code === 'RATE_LIMITED') return 'AI service is busy. Please wait a moment and try again.';
  if (code === 'API_OVERLOADED') return 'AI service is temporarily overloaded. Please try again in a few minutes.';
  if (code === 'TRUNCATED') return 'Document is too large for AI extraction. Try uploading a smaller or cleaner PDF.';
  if (code === 'TOKEN_LIMIT') return 'Document exceeds AI processing limits. Try fewer pages.';
  return data?.error || err.message;
}

function UsageInfo({ usage }) {
  if (!usage) return null;
  return (
    <Alert severity="info" variant="outlined" sx={{ mt: 1 }}>
      <Typography variant="caption" component="div">
        <strong>AI Usage:</strong>{' '}
        {usage.total_tokens?.toLocaleString() || usage.total_input_tokens?.toLocaleString()} tokens
        {(usage.total_estimated_cost_usd ?? usage.estimated_cost_usd) != null && (
          <> &middot; ~${(usage.total_estimated_cost_usd ?? usage.estimated_cost_usd).toFixed(4)} USD</>
        )}
        {usage.batch_discount && <> &middot; {usage.batch_discount} batch discount applied</>}
        {usage.steps?.map((s, i) => (
          <span key={i}> &middot; {s.step}: {s.model?.split('-').slice(1, 3).join('-')} ({s.input_tokens + s.output_tokens} tok)</span>
        ))}
      </Typography>
    </Alert>
  );
}

export default function SettlementUploadDialog({ open, onClose, farmId, onUploaded }) {
  const [mode, setMode] = useState('instant'); // instant or batch
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [buyerFormat, setBuyerFormat] = useState('');

  // Instant mode state
  const [result, setResult] = useState(null);

  // Batch mode state
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [batchResult, setBatchResult] = useState(null);
  const [batchPolling, setBatchPolling] = useState(false);
  const pollRef = useRef(null);

  // Clean up polling on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const handleInstantUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (buyerFormat) formData.append('buyer_format', buyerFormat);
      const res = await api.post(`/api/farms/${farmId}/settlements/upload`, formData);
      setResult(res.data);
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleBatchFilesSelect = (e) => {
    setSelectedFiles(Array.from(e.target.files));
    setError(null);
  };

  const handleBatchSubmit = async () => {
    if (!selectedFiles.length) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      selectedFiles.forEach(f => formData.append('files', f));
      const res = await api.post(`/api/farms/${farmId}/settlements/batch-upload`, formData);
      setBatchResult(res.data);
      // Start polling
      setBatchPolling(true);
      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await api.get(`/api/farms/${farmId}/settlements/batch/${res.data.batch_id}`);
          setBatchResult(pollRes.data);
          if (['completed', 'failed', 'expired'].includes(pollRes.data.status)) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setBatchPolling(false);
          }
        } catch {
          // silently continue polling
        }
      }, 5000); // poll every 5 seconds
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setResult(null);
    setBatchResult(null);
    setSelectedFiles([]);
    setError(null);
    setBuyerFormat('');
    setMode('instant');
    setLoading(false);
    setBatchPolling(false);
    onClose();
    if (result || batchResult?.status === 'completed') onUploaded?.();
  };

  const settlement = result?.settlement;
  const extraction = result?.extraction;
  const hasResult = !!result || !!batchResult;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
      <DialogTitle>Upload Settlement Document</DialogTitle>
      <DialogContent>
        {loading && <LinearProgress sx={{ mb: 2 }} />}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {/* Mode selector - only show before results */}
        {!hasResult && (
          <>
            <ToggleButtonGroup
              value={mode}
              exclusive
              onChange={(_, v) => v && setMode(v)}
              size="small"
              sx={{ mb: 3 }}
            >
              <ToggleButton value="instant">
                <BoltIcon sx={{ mr: 0.5 }} /> Instant (single file)
              </ToggleButton>
              <ToggleButton value="batch">
                <BatchPredictionIcon sx={{ mr: 0.5 }} /> Batch (50% cheaper)
              </ToggleButton>
            </ToggleButtonGroup>

            {mode === 'instant' && (
              <Box sx={{ textAlign: 'center', py: 3 }}>
                <UploadFileIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h6" gutterBottom>Upload Settlement PDF or Image</Typography>
                <Typography color="text.secondary" sx={{ mb: 3 }}>
                  Upload a single settlement document. Claude AI extracts data instantly.
                </Typography>

                <TextField
                  select label="Buyer Format (optional)" value={buyerFormat}
                  onChange={(e) => setBuyerFormat(e.target.value)}
                  sx={{ mb: 3, minWidth: 200 }} size="small" helperText="Auto-detected if left blank"
                >
                  <MenuItem value="">Auto-detect</MenuItem>
                  <MenuItem value="cargill">Cargill</MenuItem>
                  <MenuItem value="bunge">Bunge</MenuItem>
                  <MenuItem value="jgl">JGL Commodities</MenuItem>
                  <MenuItem value="unknown">Other</MenuItem>
                </TextField>

                <Box>
                  <Button variant="contained" component="label" disabled={loading}>
                    Choose File (PDF/Image)
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" hidden onChange={handleInstantUpload} />
                  </Button>
                </Box>
              </Box>
            )}

            {mode === 'batch' && (
              <Box sx={{ textAlign: 'center', py: 3 }}>
                <BatchPredictionIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h6" gutterBottom>Batch Upload — 50% Off</Typography>
                <Typography color="text.secondary" sx={{ mb: 2 }}>
                  Upload multiple settlement PDFs at once. Processed via Anthropic Batch API at half the cost.
                  Results typically arrive within minutes.
                </Typography>

                <Button variant="outlined" component="label" sx={{ mb: 2 }}>
                  Select PDFs ({selectedFiles.length} selected)
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple hidden onChange={handleBatchFilesSelect} />
                </Button>

                {selectedFiles.length > 0 && (
                  <Box sx={{ mb: 2, maxHeight: 200, overflow: 'auto' }}>
                    <List dense>
                      {selectedFiles.map((f, i) => (
                        <ListItem key={i}>
                          <ListItemIcon><DescriptionIcon fontSize="small" /></ListItemIcon>
                          <ListItemText primary={f.name} secondary={`${(f.size / 1024).toFixed(0)} KB`} />
                        </ListItem>
                      ))}
                    </List>
                  </Box>
                )}

                <Button
                  variant="contained" onClick={handleBatchSubmit}
                  disabled={loading || !selectedFiles.length}
                >
                  Submit Batch ({selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''})
                </Button>
              </Box>
            )}
          </>
        )}

        {/* Instant result */}
        {result && settlement && (
          <Box>
            <Stack direction="row" spacing={2} sx={{ mb: 2 }} flexWrap="wrap">
              <Chip label={`Settlement #${settlement.settlement_number}`} color="primary" />
              <Chip label={result.buyer_format?.toUpperCase() || 'UNKNOWN'} variant="outlined" />
              {settlement.counterparty?.name && (
                <Chip label={settlement.counterparty.name} color="info" variant="outlined" />
              )}
              {settlement.total_amount && (
                <Chip label={`$${settlement.total_amount.toLocaleString()}`} color="success" />
              )}
              <Chip label={`${settlement.lines?.length || 0} line(s)`} />
            </Stack>

            {extraction && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Extracted Data
                </Typography>
                <Stack direction="row" spacing={3} sx={{ mb: 1 }}>
                  <Typography variant="body2"><strong>Date:</strong> {extraction.settlement_date || 'N/A'}</Typography>
                  <Typography variant="body2"><strong>Contract:</strong> {extraction.contract_number || 'N/A'}</Typography>
                  <Typography variant="body2"><strong>Commodity:</strong> {extraction.commodity || 'N/A'}</Typography>
                </Stack>
              </Box>
            )}

            {settlement.lines?.length > 0 && (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>#</TableCell>
                      <TableCell>Ticket #</TableCell>
                      <TableCell>Date</TableCell>
                      <TableCell align="right">Net MT</TableCell>
                      <TableCell align="right">Price/MT</TableCell>
                      <TableCell align="right">Gross $</TableCell>
                      <TableCell align="right">Net $</TableCell>
                      <TableCell>Grade</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {settlement.lines.map(line => (
                      <TableRow key={line.id}>
                        <TableCell>{line.line_number}</TableCell>
                        <TableCell>{line.ticket_number_on_settlement || '-'}</TableCell>
                        <TableCell>{line.delivery_date ? new Date(line.delivery_date).toLocaleDateString() : '-'}</TableCell>
                        <TableCell align="right">{line.net_weight_mt?.toFixed(2) || '-'}</TableCell>
                        <TableCell align="right">{line.price_per_mt ? `$${line.price_per_mt.toFixed(2)}` : '-'}</TableCell>
                        <TableCell align="right">{line.line_gross ? `$${line.line_gross.toLocaleString()}` : '-'}</TableCell>
                        <TableCell align="right">{line.line_net ? `$${line.line_net.toLocaleString()}` : '-'}</TableCell>
                        <TableCell>{line.grade || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            <Alert severity="success" sx={{ mt: 2 }}>
              Settlement saved. You can now run AI Reconciliation to match these lines to delivery tickets.
            </Alert>
            <UsageInfo usage={result?.usage} />
          </Box>
        )}

        {/* Batch result */}
        {batchResult && (
          <Box>
            <Stack direction="row" spacing={2} sx={{ mb: 2 }} alignItems="center">
              <Chip
                label={batchResult.status?.toUpperCase()}
                color={batchResult.status === 'completed' ? 'success' : batchResult.status === 'failed' ? 'error' : 'warning'}
              />
              <Typography variant="body2">
                {batchResult.completed_count || 0} / {batchResult.total_requests} processed
                {batchResult.failed_count > 0 && ` (${batchResult.failed_count} failed)`}
              </Typography>
              {batchPolling && <CircularProgress size={20} />}
            </Stack>

            {batchResult.status === 'processing' && (
              <LinearProgress
                variant="determinate"
                value={batchResult.total_requests ? ((batchResult.completed_count || 0) / batchResult.total_requests) * 100 : 0}
                sx={{ mb: 2 }}
              />
            )}

            {batchResult.settlements?.length > 0 && (
              <List dense>
                {batchResult.settlements.map(s => (
                  <ListItem key={s.id}>
                    <ListItemIcon>
                      {s.extraction_status === 'completed' ? <CheckCircleIcon color="success" fontSize="small" />
                        : s.extraction_status === 'failed' ? <ErrorIcon color="error" fontSize="small" />
                        : <HourglassTopIcon color="warning" fontSize="small" />}
                    </ListItemIcon>
                    <ListItemText
                      primary={s.settlement_number}
                      secondary={`${s.buyer_format || 'unknown'} ${s.total_amount ? `· $${s.total_amount.toLocaleString()}` : ''}`}
                    />
                  </ListItem>
                ))}
              </List>
            )}

            {batchResult.status === 'completed' && (
              <>
                <Alert severity="success" sx={{ mt: 1 }}>
                  Batch complete! {batchResult.completed_count} settlement{batchResult.completed_count !== 1 ? 's' : ''} extracted at 50% off.
                </Alert>
                {batchResult.estimated_cost_usd != null && (
                  <UsageInfo usage={{
                    total_input_tokens: batchResult.total_input_tokens,
                    total_output_tokens: batchResult.total_output_tokens,
                    total_tokens: batchResult.total_input_tokens + batchResult.total_output_tokens,
                    total_estimated_cost_usd: batchResult.estimated_cost_usd,
                    batch_discount: '50%',
                  }} />
                )}
              </>
            )}

            {batchResult.status === 'failed' && (
              <Alert severity="error" sx={{ mt: 1 }}>
                Batch failed: {batchResult.error_message || 'Unknown error'}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{hasResult ? 'Done' : 'Cancel'}</Button>
      </DialogActions>
    </Dialog>
  );
}
