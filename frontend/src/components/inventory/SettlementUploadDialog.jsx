import { useState, useEffect, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Alert, Chip, Stack, LinearProgress, TextField, MenuItem, IconButton, Tooltip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  ToggleButton, ToggleButtonGroup, List, ListItem, ListItemIcon, ListItemText,
  CircularProgress, Collapse,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import BoltIcon from '@mui/icons-material/Bolt';
import BatchPredictionIcon from '@mui/icons-material/BatchPrediction';
import DescriptionIcon from '@mui/icons-material/Description';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import SchoolIcon from '@mui/icons-material/School';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
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

/** Editable cell — click to edit, blur to save */
function EditableCell({ value, onChange, align = 'left', type = 'text', sx = {} }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => { setDraft(value ?? ''); }, [value]);

  if (editing) {
    return (
      <TableCell align={align} sx={{ p: 0.5, ...sx }}>
        <TextField
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            const val = type === 'number' ? (draft === '' ? null : parseFloat(draft)) : draft;
            if (val !== value) onChange(val);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.target.blur();
            if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); }
          }}
          size="small"
          type={type === 'number' ? 'number' : 'text'}
          autoFocus
          fullWidth
          variant="standard"
          sx={{ minWidth: 60 }}
          inputProps={{ style: { fontSize: '0.8rem', textAlign: align } }}
        />
      </TableCell>
    );
  }

  const display = type === 'number' && value != null
    ? (typeof value === 'number' ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value)
    : (value || '-');

  return (
    <TableCell
      align={align}
      onClick={() => setEditing(true)}
      sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, p: 0.5, ...sx }}
      title="Click to edit"
    >
      {display}
    </TableCell>
  );
}


const BUYER_OPTIONS = [
  { value: '', label: 'Auto-detect' },
  { value: 'cargill', label: 'Cargill' },
  { value: 'bunge', label: 'Bunge' },
  { value: 'g3', label: 'G3 Canada' },
  { value: 'gsl', label: 'GSL (Grain St-Laurent)' },
  { value: 'jgl', label: 'JGL Commodities' },
  { value: 'ldc', label: 'Louis Dreyfus (LDC)' },
  { value: 'richardson', label: 'Richardson Pioneer' },
  { value: 'wilde_bros', label: 'Wilde Bros. Ag Trading' },
  { value: 'mb_agri', label: 'MB Agri-Food Innovations' },
  { value: 'cenovus', label: 'Cenovus Energy' },
  { value: 'unknown', label: 'Other' },
];

export default function SettlementUploadDialog({ open, onClose, farmId, onUploaded }) {
  const [mode, setMode] = useState('instant'); // instant or batch
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [buyerFormat, setBuyerFormat] = useState('');

  // Two-step flow: extract → review/edit → save
  const [step, setStep] = useState('upload'); // upload | review | saved
  const [extraction, setExtraction] = useState(null);
  const [detectedFormat, setDetectedFormat] = useState('');
  const [usage, setUsage] = useState(null);
  const [editedLines, setEditedLines] = useState([]);
  const [editedHeader, setEditedHeader] = useState({});
  const [correctionHint, setCorrectionHint] = useState('');
  const [showHintSection, setShowHintSection] = useState(false);
  const [hasEdits, setHasEdits] = useState(false);

  // Saved result
  const [savedResult, setSavedResult] = useState(null);

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
      // Extract only — don't save yet
      const res = await api.post(`/api/farms/${farmId}/settlements/extract`, formData);
      setExtraction(res.data.extraction);
      setDetectedFormat(res.data.buyer_format);
      setUsage(res.data.usage);
      // Initialize editable lines from extraction
      const lines = (res.data.extraction?.lines || []).map((line, i) => ({
        ...line,
        line_number: line.line_number || i + 1,
      }));
      setEditedLines(lines);
      setEditedHeader({
        settlement_number: res.data.extraction?.settlement_number || '',
        settlement_date: res.data.extraction?.settlement_date || '',
        contract_number: res.data.extraction?.contract_number || '',
        commodity: res.data.extraction?.commodity || '',
        total_net_amount: res.data.extraction?.total_net_amount || null,
        total_gross_amount: res.data.extraction?.total_gross_amount || null,
      });
      setStep('review');
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleLineEdit = (lineIndex, field, value) => {
    setEditedLines(prev => {
      const updated = [...prev];
      updated[lineIndex] = { ...updated[lineIndex], [field]: value };
      return updated;
    });
    setHasEdits(true);
  };

  const handleHeaderEdit = (field, value) => {
    setEditedHeader(prev => ({ ...prev, [field]: value }));
    setHasEdits(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Build corrected extraction from edits
      const correctedExtraction = {
        ...extraction,
        ...editedHeader,
        lines: editedLines,
      };

      const res = await api.post(`/api/farms/${farmId}/settlements/save-reviewed`, {
        extraction: correctedExtraction,
        buyer_format: detectedFormat,
        usage,
        hint: correctionHint || null,
      });

      setSavedResult(res.data);
      setStep('saved');
      onUploaded?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  // Batch mode handlers (unchanged)
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
      setBatchPolling(true);
      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await api.get(`/api/farms/${farmId}/settlements/batch/${res.data.batch_id}`);
          setBatchResult(pollRes.data);
          if (['completed', 'failed', 'expired'].includes(pollRes.data.status)) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setBatchPolling(false);
            if (pollRes.data.status === 'completed') onUploaded?.();
          }
        } catch {
          // silently continue polling
        }
      }, 5000);
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setStep('upload');
    setExtraction(null);
    setEditedLines([]);
    setEditedHeader({});
    setCorrectionHint('');
    setShowHintSection(false);
    setHasEdits(false);
    setSavedResult(null);
    setBatchResult(null);
    setSelectedFiles([]);
    setError(null);
    setBuyerFormat('');
    setDetectedFormat('');
    setUsage(null);
    setMode('instant');
    setLoading(false);
    setSaving(false);
    setBatchPolling(false);
    onClose();
  };

  const hasResult = step === 'saved' || !!batchResult;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        {step === 'upload' && 'Upload Settlement Document'}
        {step === 'review' && 'Review & Correct Extraction'}
        {step === 'saved' && 'Settlement Saved'}
      </DialogTitle>
      <DialogContent>
        {(loading || saving) && <LinearProgress sx={{ mb: 2 }} />}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {/* ─── Step 1: Upload ─── */}
        {step === 'upload' && !batchResult && (
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
                <Typography color="text.secondary" sx={{ mb: 1 }}>
                  Claude AI extracts data, then you can review and correct before saving.
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 3, display: 'block' }}>
                  Click any cell in the preview to correct wrong values. Your corrections train future imports.
                </Typography>

                <TextField
                  select label="Buyer Format (optional)" value={buyerFormat}
                  onChange={(e) => setBuyerFormat(e.target.value)}
                  sx={{ mb: 3, minWidth: 200 }} size="small" helperText="Auto-detected if left blank"
                >
                  {BUYER_OPTIONS.map(o => (
                    <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                  ))}
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

        {/* ─── Step 2: Review & Edit ─── */}
        {step === 'review' && extraction && (
          <Box>
            {(() => {
              const contracts = [...new Set(editedLines.map(l => l.contract_number).filter(Boolean))];
              return contracts.length > 1 ? (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Multi-contract detected ({contracts.join(', ')}). This will auto-split into {contracts.length} separate settlements on save.
                </Alert>
              ) : null;
            })()}
            <Stack direction="row" spacing={2} sx={{ mb: 2 }} flexWrap="wrap" alignItems="center">
              <Chip label={detectedFormat?.toUpperCase() || 'UNKNOWN'} variant="outlined" color="primary" />
              <Chip label={`${editedLines.length} line(s)`} />
              {hasEdits && <Chip label="Edited" color="warning" size="small" icon={<EditIcon />} />}
            </Stack>

            {/* Editable header fields */}
            <Stack direction="row" spacing={2} sx={{ mb: 2 }} flexWrap="wrap">
              <TextField
                label="Settlement #" size="small" value={editedHeader.settlement_number || ''}
                onChange={(e) => handleHeaderEdit('settlement_number', e.target.value)}
                sx={{ minWidth: 140 }}
              />
              <TextField
                label="Date" size="small" type="date" value={editedHeader.settlement_date || ''}
                onChange={(e) => handleHeaderEdit('settlement_date', e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 140 }}
              />
              <TextField
                label="Contract #" size="small" value={editedHeader.contract_number || ''}
                onChange={(e) => handleHeaderEdit('contract_number', e.target.value)}
                sx={{ minWidth: 140 }}
              />
              <TextField
                label="Commodity" size="small" value={editedHeader.commodity || ''}
                onChange={(e) => handleHeaderEdit('commodity', e.target.value)}
                sx={{ minWidth: 140 }}
              />
              <TextField
                label="Total Net $" size="small" type="number" value={editedHeader.total_net_amount ?? ''}
                onChange={(e) => handleHeaderEdit('total_net_amount', e.target.value ? parseFloat(e.target.value) : null)}
                sx={{ minWidth: 120 }}
              />
            </Stack>

            {/* Editable lines table */}
            <Alert severity="info" variant="outlined" sx={{ mb: 1 }}>
              <Typography variant="caption">
                Click any cell to edit. Fix wrong ticket numbers, weights, or amounts before saving.
              </Typography>
            </Alert>

            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 400 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, p: 0.5 }}>#</TableCell>
                    <TableCell sx={{ fontWeight: 700, p: 0.5 }}>Ticket #</TableCell>
                    <TableCell sx={{ fontWeight: 700, p: 0.5 }}>Date</TableCell>
                    <TableCell sx={{ fontWeight: 700, p: 0.5 }}>Contract</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, p: 0.5 }}>Net MT</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, p: 0.5 }}>Price/MT</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, p: 0.5 }}>Gross $</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, p: 0.5 }}>Net $</TableCell>
                    <TableCell sx={{ fontWeight: 700, p: 0.5 }}>Grade</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {editedLines.map((line, idx) => (
                    <TableRow key={idx} hover>
                      <TableCell sx={{ p: 0.5, color: 'text.secondary' }}>{line.line_number}</TableCell>
                      <EditableCell
                        value={line.ticket_number}
                        onChange={(v) => handleLineEdit(idx, 'ticket_number', v)}
                        sx={{ fontWeight: 600, minWidth: 80 }}
                      />
                      <EditableCell
                        value={line.delivery_date}
                        onChange={(v) => handleLineEdit(idx, 'delivery_date', v)}
                        sx={{ minWidth: 90 }}
                      />
                      <EditableCell
                        value={line.contract_number}
                        onChange={(v) => handleLineEdit(idx, 'contract_number', v)}
                        sx={{ minWidth: 80 }}
                      />
                      <EditableCell
                        value={line.net_weight_mt}
                        onChange={(v) => handleLineEdit(idx, 'net_weight_mt', v)}
                        align="right" type="number"
                      />
                      <EditableCell
                        value={line.price_per_mt}
                        onChange={(v) => handleLineEdit(idx, 'price_per_mt', v)}
                        align="right" type="number"
                      />
                      <EditableCell
                        value={line.line_gross}
                        onChange={(v) => handleLineEdit(idx, 'line_gross', v)}
                        align="right" type="number"
                      />
                      <EditableCell
                        value={line.line_net}
                        onChange={(v) => handleLineEdit(idx, 'line_net', v)}
                        align="right" type="number"
                      />
                      <EditableCell
                        value={line.grade}
                        onChange={(v) => handleLineEdit(idx, 'grade', v)}
                      />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {/* Training hint section */}
            <Box sx={{ mt: 2 }}>
              <Button
                size="small"
                startIcon={<SchoolIcon />}
                endIcon={showHintSection ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                onClick={() => setShowHintSection(!showHintSection)}
                color="secondary"
              >
                Train AI for Future Imports
              </Button>
              <Collapse in={showHintSection}>
                <Alert severity="info" variant="outlined" sx={{ mt: 1, mb: 1 }}>
                  <Typography variant="caption">
                    Describe what the AI got wrong so it learns for next time. Example: &quot;The Receipt Number
                    (highlighted yellow) is the ticket number, NOT the Source NBR from the EFT page.&quot;
                  </Typography>
                </Alert>
                <TextField
                  fullWidth
                  multiline
                  rows={3}
                  placeholder={`Example: "For G3 settlements, each ticket has its own Receipt Number on the detail pages. Don't use the batch number from the EFT page as the ticket number."`}
                  value={correctionHint}
                  onChange={(e) => setCorrectionHint(e.target.value)}
                  size="small"
                  label={`Correction hint for ${detectedFormat?.toUpperCase() || 'this buyer'}`}
                />
              </Collapse>
            </Box>

            <UsageInfo usage={usage} />
          </Box>
        )}

        {/* ─── Step 3: Saved ─── */}
        {step === 'saved' && savedResult && (
          <Box>
            {savedResult.split && savedResult.settlements ? (
              // Multi-contract split view
              <>
                <Alert severity="info" sx={{ mb: 2 }}>
                  Multi-contract settlement detected and auto-split into {savedResult.settlements.length} separate settlements for independent reconciliation.
                </Alert>
                {savedResult.settlements.map((s) => (
                  <Stack key={s.id} direction="row" spacing={2} sx={{ mb: 1.5 }} flexWrap="wrap" alignItems="center">
                    <Chip label={`#${s.settlement_number}`} color="primary" />
                    <Chip label={s.marketing_contract?.contract_number || 'No contract'} variant="outlined" size="small" />
                    <Chip label={s.marketing_contract?.commodity?.name || s.lines?.[0]?.commodity || '—'} size="small" />
                    {s.total_amount && (
                      <Chip label={`$${s.total_amount.toLocaleString()}`} color="success" size="small" />
                    )}
                    <Chip label={`${s.lines?.length || 0} line(s)`} size="small" />
                  </Stack>
                ))}
              </>
            ) : (
              // Single settlement view
              <Stack direction="row" spacing={2} sx={{ mb: 2 }} flexWrap="wrap">
                <Chip label={`Settlement #${savedResult.settlement?.settlement_number}`} color="primary" />
                <Chip label={savedResult.buyer_format?.toUpperCase() || 'UNKNOWN'} variant="outlined" />
                {savedResult.settlement?.counterparty?.name && (
                  <Chip label={savedResult.settlement.counterparty.name} color="info" variant="outlined" />
                )}
                {savedResult.settlement?.total_amount && (
                  <Chip label={`$${savedResult.settlement.total_amount.toLocaleString()}`} color="success" />
                )}
                <Chip label={`${savedResult.settlement?.lines?.length || 0} line(s)`} />
              </Stack>
            )}

            <Alert severity="success" sx={{ mt: 1 }}>
              {savedResult.split
                ? `${savedResult.settlements.length} settlements saved${correctionHint ? ' with training hint' : ''}. Run AI Reconciliation on each to match delivery tickets.`
                : `Settlement saved${correctionHint ? ' with training hint' : ''}. You can now run AI Reconciliation to match these lines to delivery tickets.`
              }
            </Alert>
            {correctionHint && (
              <Alert severity="info" variant="outlined" sx={{ mt: 1 }} icon={<SchoolIcon />}>
                <Typography variant="caption">
                  Training hint saved for <strong>{detectedFormat?.toUpperCase()}</strong> imports. The AI will apply this correction on future extractions.
                </Typography>
              </Alert>
            )}
            <UsageInfo usage={savedResult?.usage} />
          </Box>
        )}

        {/* ─── Batch result (unchanged) ─── */}
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
        {step === 'review' && (
          <>
            <Button onClick={() => { setStep('upload'); setExtraction(null); }} disabled={saving}>
              Back
            </Button>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={saving}
              startIcon={saving ? <CircularProgress size={16} /> : (correctionHint ? <SchoolIcon /> : <SaveIcon />)}
              color={correctionHint ? 'secondary' : 'primary'}
            >
              {saving ? 'Saving...' : correctionHint ? 'Save & Train' : 'Save Settlement'}
            </Button>
          </>
        )}
        {step !== 'review' && (
          <Button onClick={handleClose}>{hasResult ? 'Done' : 'Cancel'}</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
