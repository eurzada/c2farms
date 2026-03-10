import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Alert, Stack, LinearProgress, Chip, Table, TableBody, TableCell, TableRow,
  TableHead, Paper, Checkbox, IconButton, Tooltip, Collapse,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../../services/api';
import { fmt } from '../../utils/formatting';
import { extractErrorMessage } from '../../utils/errorHelpers';

const POLL_INTERVAL = 3000;

export default function ContractBatchImportDialog({ open, onClose, farmId, onImported }) {
  const [step, setStep] = useState('upload'); // upload, processing, preview, done
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [batchId, setBatchId] = useState(null);
  const [batchStatus, setBatchStatus] = useState(null);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [expandedRow, setExpandedRow] = useState(null);
  const [confirmResult, setConfirmResult] = useState(null);
  const pollRef = useRef(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleFilesSelected = (e) => {
    const newFiles = Array.from(e.target.files).filter(f =>
      /\.(pdf|jpg|jpeg|png)$/i.test(f.name)
    );
    e.target.value = '';
    setFiles(prev => [...prev, ...newFiles]);
    setError(null);
  };

  const removeFile = (idx) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmitBatch = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      files.forEach(f => formData.append('files', f));

      const res = await api.post(`/api/farms/${farmId}/marketing/contracts/import-batch`, formData);
      setBatchId(res.data.batchId);
      setBatchStatus({ status: res.data.status, counts: { processing: files.length } });
      setStep('processing');

      // Start polling
      pollRef.current = setInterval(() => pollBatch(res.data.batchId), POLL_INTERVAL);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to create batch'));
    } finally {
      setLoading(false);
    }
  };

  const pollBatch = useCallback(async (id) => {
    try {
      const res = await api.get(`/api/farms/${farmId}/marketing/contracts/import-batch/${id}`);
      setBatchStatus({ status: res.data.status, counts: res.data.counts });

      if (res.data.status === 'ended') {
        clearInterval(pollRef.current);
        pollRef.current = null;

        const items = res.data.results?.items || [];
        setResults(items);

        // Auto-select successful extractions
        const successIds = new Set(items.filter(i => i.status === 'success').map(i => i.custom_id));
        setSelected(successIds);

        setBatchStatus(prev => ({ ...prev, usage: res.data.results?.usage }));
        setStep('preview');
      }
    } catch {
      // Polling error — keep trying
    }
  }, [farmId]);

  const handleToggleSelect = (customId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(customId)) next.delete(customId);
      else next.add(customId);
      return next;
    });
  };

  const handleToggleAll = () => {
    const successItems = results.filter(r => r.status === 'success');
    if (selected.size === successItems.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(successItems.map(r => r.custom_id)));
    }
  };

  const handleConfirm = async () => {
    const extractions = results
      .filter(r => r.status === 'success' && selected.has(r.custom_id))
      .map(r => ({ custom_id: r.custom_id, extraction: r.extraction }));

    if (extractions.length === 0) return;
    setLoading(true);
    setError(null);

    try {
      const res = await api.post(
        `/api/farms/${farmId}/marketing/contracts/import-batch/${batchId}/confirm`,
        { extractions }
      );
      setConfirmResult(res.data);
      setStep('done');
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to save contracts'));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setStep('upload');
    setFiles([]);
    setBatchId(null);
    setBatchStatus(null);
    setResults([]);
    setSelected(new Set());
    setExpandedRow(null);
    setConfirmResult(null);
    setError(null);
    onClose();
    if (confirmResult) onImported?.();
  };

  const successCount = results.filter(r => r.status === 'success').length;
  const errorCount = results.filter(r => r.status !== 'success').length;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        <Stack direction="row" alignItems="center" spacing={1}>
          <CloudUploadIcon />
          <span>Batch Import Contracts</span>
          <Chip label="50% AI discount" size="small" color="success" variant="outlined" />
        </Stack>
      </DialogTitle>
      <DialogContent>
        {loading && <LinearProgress sx={{ mb: 2 }} />}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {/* Step 1: File Upload */}
        {step === 'upload' && (
          <Box>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Upload multiple contract PDFs at once. They'll be processed as a batch using Anthropic's Batch API at 50% reduced cost.
            </Typography>

            <Box
              sx={{
                border: '2px dashed',
                borderColor: 'divider',
                borderRadius: 2,
                p: 4,
                textAlign: 'center',
                mb: 2,
                cursor: 'pointer',
                '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
              }}
              component="label"
            >
              <UploadFileIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
              <Typography variant="h6">Drop files or click to browse</Typography>
              <Typography variant="body2" color="text.secondary">PDF or image files, up to 50 at once</Typography>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple hidden onChange={handleFilesSelected} />
            </Box>

            {files.length > 0 && (
              <Paper variant="outlined" sx={{ maxHeight: 250, overflow: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>File</TableCell>
                      <TableCell align="right">Size</TableCell>
                      <TableCell width={40} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {files.map((f, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{f.name}</TableCell>
                        <TableCell align="right">{(f.size / 1024).toFixed(0)} KB</TableCell>
                        <TableCell>
                          <IconButton size="small" onClick={() => removeFile(idx)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            )}
          </Box>
        )}

        {/* Step 2: Processing */}
        {step === 'processing' && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <LinearProgress sx={{ mb: 3, mx: 'auto', maxWidth: 400 }} />
            <Typography variant="h6" gutterBottom>Processing batch...</Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Claude is extracting contract terms from {files.length} document{files.length !== 1 ? 's' : ''}.
              Batches typically complete within a few minutes.
            </Typography>
            {batchStatus?.counts && (
              <Stack direction="row" spacing={2} justifyContent="center">
                {Object.entries(batchStatus.counts).filter(([, v]) => v > 0).map(([key, val]) => (
                  <Chip key={key} label={`${key}: ${val}`} size="small" variant="outlined" />
                ))}
              </Stack>
            )}
          </Box>
        )}

        {/* Step 3: Preview Results */}
        {step === 'preview' && (
          <Box>
            <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
              <Alert severity="success" sx={{ flex: 1 }}>
                {successCount} of {results.length} contract{results.length !== 1 ? 's' : ''} extracted successfully
              </Alert>
              {errorCount > 0 && (
                <Alert severity="warning" sx={{ flex: 1 }}>
                  {errorCount} failed — expand rows for details
                </Alert>
              )}
            </Stack>

            {batchStatus?.usage && (
              <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  AI: {batchStatus.usage.total_tokens?.toLocaleString()} tokens
                  &middot; Batch price: ${batchStatus.usage.batch_price_usd?.toFixed(4)}
                  &middot; Full price: ${batchStatus.usage.full_price_usd?.toFixed(4)}
                  &middot; <strong>Saved: ${batchStatus.usage.savings_usd?.toFixed(4)}</strong>
                </Typography>
              </Alert>
            )}

            <Paper variant="outlined" sx={{ maxHeight: 400, overflow: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selected.size === successCount && successCount > 0}
                        indeterminate={selected.size > 0 && selected.size < successCount}
                        onChange={handleToggleAll}
                      />
                    </TableCell>
                    <TableCell>File</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Buyer</TableCell>
                    <TableCell>Contract #</TableCell>
                    <TableCell>Commodity</TableCell>
                    <TableCell align="right">Qty (MT)</TableCell>
                    <TableCell align="right">$/bu</TableCell>
                    <TableCell align="right">$/MT</TableCell>
                    <TableCell width={40} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {results.map((r) => (
                    <>
                      <TableRow
                        key={r.custom_id}
                        sx={{ '&:hover': { bgcolor: 'action.hover' }, cursor: 'pointer' }}
                        onClick={() => setExpandedRow(expandedRow === r.custom_id ? null : r.custom_id)}
                      >
                        <TableCell padding="checkbox" onClick={e => e.stopPropagation()}>
                          <Checkbox
                            checked={selected.has(r.custom_id)}
                            disabled={r.status !== 'success'}
                            onChange={() => handleToggleSelect(r.custom_id)}
                          />
                        </TableCell>
                        <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.filename}
                        </TableCell>
                        <TableCell>
                          {r.status === 'success'
                            ? <Chip icon={<CheckCircleIcon />} label="Extracted" size="small" color="success" variant="outlined" />
                            : <Chip icon={<ErrorOutlineIcon />} label={r.status} size="small" color="error" variant="outlined" />
                          }
                        </TableCell>
                        <TableCell>{r.extraction?.buyer || '—'}</TableCell>
                        <TableCell>{r.extraction?.contract_number || '—'}</TableCell>
                        <TableCell>{r.extraction?.commodity || '—'}</TableCell>
                        <TableCell align="right">{r.extraction?.quantity_mt ? fmt(r.extraction.quantity_mt) : '—'}</TableCell>
                        <TableCell align="right">{r.extraction?.price_per_bu ? `$${r.extraction.price_per_bu.toFixed(2)}` : '—'}</TableCell>
                        <TableCell align="right">{r.extraction?.price_per_mt ? `$${fmt(r.extraction.price_per_mt)}` : '—'}</TableCell>
                        <TableCell>
                          <IconButton size="small">
                            {expandedRow === r.custom_id ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                          </IconButton>
                        </TableCell>
                      </TableRow>
                      <TableRow key={`${r.custom_id}-detail`}>
                        <TableCell colSpan={10} sx={{ py: 0, border: expandedRow === r.custom_id ? undefined : 'none' }}>
                          <Collapse in={expandedRow === r.custom_id}>
                            <Box sx={{ py: 1, px: 2 }}>
                              {r.status === 'success' ? (
                                <Table size="small">
                                  <TableBody>
                                    {[
                                      ['Grade', r.extraction.grade],
                                      ['Pricing Type', r.extraction.pricing_type],
                                      ['Price/MT', r.extraction.price_per_mt ? `$${fmt(r.extraction.price_per_mt)}` : null],
                                      ['Basis', r.extraction.basis_level ? `$${fmt(r.extraction.basis_level)}` : null],
                                      ['Futures', r.extraction.futures_reference],
                                      ['Delivery', r.extraction.delivery_period_text || (r.extraction.delivery_start && r.extraction.delivery_end ? `${r.extraction.delivery_start} — ${r.extraction.delivery_end}` : null)],
                                      ['Elevator', r.extraction.elevator_site],
                                      ['Crop Year', r.extraction.crop_year],
                                      ['Special Terms', r.extraction.special_terms],
                                    ].filter(([, v]) => v != null).map(([label, value]) => (
                                      <TableRow key={label}>
                                        <TableCell sx={{ fontWeight: 600, width: 130, py: 0.25, border: 'none' }}>{label}</TableCell>
                                        <TableCell sx={{ py: 0.25, border: 'none' }}>{value}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              ) : (
                                <Alert severity="error" variant="outlined">
                                  {r.error || 'Unknown error'}
                                </Alert>
                              )}
                            </Box>
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    </>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          </Box>
        )}

        {/* Step 4: Done */}
        {step === 'done' && confirmResult && (
          <Box>
            <Alert severity="success" sx={{ mb: 2 }}>
              {confirmResult.created} contract{confirmResult.created !== 1 ? 's' : ''} imported successfully!
              {confirmResult.errors > 0 && ` (${confirmResult.errors} failed)`}
            </Alert>
            {confirmResult.errors > 0 && (
              <Paper variant="outlined" sx={{ maxHeight: 200, overflow: 'auto', mb: 2 }}>
                <Table size="small">
                  <TableBody>
                    {confirmResult.results.filter(r => r.status === 'error').map(r => (
                      <TableRow key={r.custom_id}>
                        <TableCell>{r.custom_id}</TableCell>
                        <TableCell><Typography color="error" variant="body2">{r.error}</Typography></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {step === 'upload' && files.length > 0 && (
          <Button
            variant="contained"
            onClick={handleSubmitBatch}
            disabled={loading || files.length === 0}
            startIcon={<CloudUploadIcon />}
          >
            Submit Batch ({files.length} file{files.length !== 1 ? 's' : ''})
          </Button>
        )}
        {step === 'preview' && (
          <Button
            variant="contained"
            onClick={handleConfirm}
            disabled={loading || selected.size === 0}
          >
            Import {selected.size} Contract{selected.size !== 1 ? 's' : ''}
          </Button>
        )}
        <Button onClick={handleClose}>
          {step === 'done' ? 'Done' : step === 'processing' ? 'Close (batch continues)' : 'Cancel'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
