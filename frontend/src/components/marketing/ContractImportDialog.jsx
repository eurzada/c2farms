import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Alert, Stack, LinearProgress, Chip, Table, TableBody, TableCell, TableRow, Paper,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import api from '../../services/api';

function classifyError(err) {
  const data = err.response?.data;
  const code = data?.code;
  if (code === 'NO_API_KEY') return 'AI extraction is not configured. Contact your administrator.';
  if (code === 'INVALID_API_KEY') return 'AI API key is invalid. Contact your administrator.';
  if (code === 'INSUFFICIENT_CREDITS') return 'AI credits exhausted. Add funds at console.anthropic.com.';
  if (code === 'RATE_LIMITED') return 'AI service is busy. Wait a moment and try again.';
  if (code === 'API_OVERLOADED') return 'AI service is temporarily overloaded. Try again shortly.';
  return data?.error || err.message;
}

const fmt = (v) => v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';

export default function ContractImportDialog({ open, onClose, farmId, onImported }) {
  const [step, setStep] = useState('upload'); // upload, preview, done
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [extraction, setExtraction] = useState(null);
  const [usage, setUsage] = useState(null);
  const [contract, setContract] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [duplicate, setDuplicate] = useState(null);

  // Clean up blob URL on unmount or reset
  useEffect(() => {
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
  }, [pdfUrl]);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setLoading(true);
    setError(null);
    setDuplicate(null);

    // Create blob URL for PDF preview
    const blobUrl = URL.createObjectURL(file);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(blobUrl);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post(`/api/farms/${farmId}/marketing/contracts/import-pdf`, formData);
      setExtraction(res.data.extraction);
      setUsage(res.data.usage);

      // Check for duplicate
      if (res.data.extraction?.contract_number) {
        try {
          const dupRes = await api.post(`/api/farms/${farmId}/marketing/contracts/import-pdf/check-duplicate`, {
            contract_number: res.data.extraction.contract_number,
          });
          if (dupRes.data.duplicate) setDuplicate(dupRes.data.existing);
        } catch { /* ignore duplicate check errors */ }
      }

      setStep('preview');
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post(`/api/farms/${farmId}/marketing/contracts/import-pdf/confirm`, { extraction, usage });
      setContract(res.data.contract);
      setStep('done');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setStep('upload');
    setExtraction(null);
    setUsage(null);
    setContract(null);
    setError(null);
    setPdfUrl(null);
    setDuplicate(null);
    onClose();
    if (contract) onImported?.();
  };

  const handleBack = () => {
    setStep('upload');
    setExtraction(null);
    setDuplicate(null);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null);
  };

  const isPreviewStep = step === 'preview' && extraction;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth={isPreviewStep ? 'xl' : 'sm'} fullWidth>
      <DialogTitle>Import Contract from PDF</DialogTitle>
      <DialogContent>
        {loading && <LinearProgress sx={{ mb: 2 }} />}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {step === 'upload' && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <UploadFileIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" gutterBottom>Upload Buyer Contract</Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              Upload a contract PDF from any grain buyer. Claude AI will extract the terms automatically.
            </Typography>
            <Button variant="contained" component="label" disabled={loading}>
              Choose File (PDF/Image)
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" hidden onChange={handleFileUpload} />
            </Button>
          </Box>
        )}

        {isPreviewStep && (
          <Stack direction="row" spacing={2} sx={{ minHeight: 500 }}>
            {/* PDF Preview */}
            {pdfUrl && (
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Document Preview</Typography>
                <Box
                  component="iframe"
                  src={pdfUrl}
                  sx={{ width: '100%', height: 480, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
                />
              </Box>
            )}

            {/* Extracted Data */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Extracted Contract Terms</Typography>

              {duplicate && (
                <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Duplicate contract detected
                  </Typography>
                  <Typography variant="body2">
                    Contract #{duplicate.contract_number} already exists ({duplicate.buyer} — {duplicate.commodity}, {fmt(duplicate.contracted_mt)} MT, status: {duplicate.status}).
                    {duplicate.delivered_mt > 0
                      ? ` ${fmt(duplicate.delivered_mt)} MT already delivered. Confirming will update the contract but preserve delivery records.`
                      : ' Confirming will overwrite the existing contract.'}
                  </Typography>
                </Alert>
              )}

              <Paper variant="outlined" sx={{ mb: 2 }}>
                <Table size="small">
                  <TableBody>
                    {[
                      ['Buyer', extraction.buyer],
                      ['Contract #', extraction.contract_number],
                      ['Date', extraction.contract_date],
                      ['Commodity', extraction.commodity],
                      ['Grade', extraction.grade],
                      ['Quantity (MT)', fmt(extraction.quantity_mt)],
                      ['Price/MT', extraction.price_per_mt ? `$${fmt(extraction.price_per_mt)}` : null],
                      ['Price/bu', extraction.price_per_bu ? `$${fmt(extraction.price_per_bu)}` : null],
                      ['Pricing Type', extraction.pricing_type],
                      ['Basis', extraction.basis_level ? `$${fmt(extraction.basis_level)}` : null],
                      ['Futures Ref', extraction.futures_reference],
                      ['Delivery Period', extraction.delivery_period_text || (extraction.delivery_start && extraction.delivery_end ? `${extraction.delivery_start} — ${extraction.delivery_end}` : null)],
                      ['Elevator', extraction.elevator_site],
                      ['Crop Year', extraction.crop_year],
                      ['Special Terms', extraction.special_terms],
                    ].filter(([, v]) => v != null && v !== '—').map(([label, value]) => (
                      <TableRow key={label}>
                        <TableCell sx={{ fontWeight: 600, width: 130, py: 0.5 }}>{label}</TableCell>
                        <TableCell sx={{ py: 0.5 }}>{value}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>

              {usage && (
                <Alert severity="info" variant="outlined" sx={{ mb: 1 }}>
                  <Typography variant="caption">
                    AI: {usage.total_tokens?.toLocaleString()} tokens &middot; ~${usage.estimated_cost_usd?.toFixed(4)} USD
                  </Typography>
                </Alert>
              )}
            </Box>
          </Stack>
        )}

        {step === 'done' && contract && (
          <Box>
            <Alert severity="success" sx={{ mb: 2 }}>
              Contract {duplicate ? 'updated' : 'created'} successfully!
            </Alert>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Chip label={`#${contract.contract_number}`} color="primary" />
              <Chip label={contract.counterparty?.name} color="info" variant="outlined" />
              <Chip label={contract.commodity?.name} variant="outlined" />
              <Chip label={`${fmt(contract.contracted_mt)} MT`} />
              {contract.price_per_bu && <Chip label={`$${contract.price_per_bu.toFixed(2)}/bu`} color="success" />}
            </Stack>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {step === 'preview' && (
          <Button onClick={handleBack} disabled={loading}>
            Back
          </Button>
        )}
        {step === 'preview' && (
          <Button
            variant="contained"
            onClick={handleConfirm}
            disabled={loading}
            color={duplicate ? 'warning' : 'primary'}
          >
            {duplicate ? 'Update Existing Contract' : 'Confirm & Create Contract'}
          </Button>
        )}
        <Button onClick={handleClose}>{step === 'done' ? 'Done' : 'Cancel'}</Button>
      </DialogActions>
    </Dialog>
  );
}
