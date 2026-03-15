import { useState, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Alert, CircularProgress, Paper, Chip, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Divider,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import api from '../../services/api';
import { fmtDollar, fmt } from '../../utils/formatting';
import { extractErrorMessage } from '../../utils/errorHelpers';

export default function BuyerSettlementUploadDialog({ open, onClose, farmId, onSaved }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const reset = useCallback(() => {
    setFile(null);
    setUploading(false);
    setError(null);
    setResult(null);
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setError(null);
      setResult(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) {
      setFile(f);
      setError(null);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file || !farmId) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post(`/api/farms/${farmId}/terminal/settlements/upload-buyer-pdf`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      setResult(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to upload and extract settlement'));
    } finally {
      setUploading(false);
    }
  };

  const handleSave = () => {
    if (result?.settlement) {
      onSaved?.(result.settlement);
    }
    handleClose();
  };

  const extraction = result?.extraction;
  const settlement = result?.settlement;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Upload Buyer Settlement PDF</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {!result && (
          <>
            <Box
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              sx={{
                border: '2px dashed',
                borderColor: file ? 'success.main' : 'divider',
                borderRadius: 2,
                p: 4,
                textAlign: 'center',
                cursor: 'pointer',
                mb: 2,
                bgcolor: file ? 'success.50' : 'transparent',
              }}
              onClick={() => document.getElementById('buyer-pdf-input')?.click()}
            >
              <input
                id="buyer-pdf-input"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                hidden
                onChange={handleFileChange}
              />
              <CloudUploadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
              <Typography variant="body1" gutterBottom>
                {file ? file.name : 'Drop buyer settlement PDF here or click to browse'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Supports JGL, Cargill, Richardson, Bunge, GSL formats
              </Typography>
            </Box>

            {uploading && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'center', py: 2 }}>
                <CircularProgress size={24} />
                <Typography>Extracting settlement data with AI...</Typography>
              </Box>
            )}
          </>
        )}

        {result && extraction && (
          <>
            <Alert severity="success" sx={{ mb: 2 }}>
              Settlement extracted successfully — {extraction.lines?.length || 0} line(s)
            </Alert>

            {/* Extraction preview */}
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 1 }}>
                <Typography variant="body2"><strong>Buyer:</strong> {extraction.buyer || '—'}</Typography>
                <Typography variant="body2"><strong>Contract #:</strong> {extraction.contract_number || '—'}</Typography>
                <Typography variant="body2"><strong>Commodity:</strong> {extraction.commodity || '—'}</Typography>
                <Typography variant="body2"><strong>Date:</strong> {extraction.settlement_date || '—'}</Typography>
              </Box>
              <Divider sx={{ my: 1 }} />
              <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                <Typography variant="body2">
                  <strong>Gross:</strong> {fmtDollar(extraction.total_gross_amount || extraction.settlement_gross)}
                </Typography>
                <Typography variant="body2" color="error">
                  <strong>Deductions:</strong> {fmtDollar((extraction.deductions_summary || []).reduce((s, d) => s + (d.amount || 0), 0))}
                </Typography>
                <Typography variant="body2" fontWeight={700}>
                  <strong>Net:</strong> {fmtDollar(extraction.total_net_amount)}
                </Typography>
              </Box>
            </Paper>

            {/* Contract linkage */}
            {settlement?.contract && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <CheckCircleIcon color="success" fontSize="small" />
                <Typography variant="body2">
                  Linked to contract: <strong>{settlement.contract.contract_number}</strong>
                </Typography>
              </Box>
            )}
            {!settlement?.contract && extraction.contract_number && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Contract #{extraction.contract_number} not found in terminal contracts — you can link it later
              </Alert>
            )}

            {/* Deductions breakdown */}
            {extraction.deductions_summary?.length > 0 && (
              <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Deductions</Typography>
                {extraction.deductions_summary.map((d, i) => (
                  <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">{d.name}</Typography>
                    <Typography variant="body2" color={d.amount < 0 ? 'error' : 'text.primary'}>
                      {fmtDollar(d.amount)}
                    </Typography>
                  </Box>
                ))}
              </Paper>
            )}

            {/* Line preview (limited) */}
            <Typography variant="subtitle2" gutterBottom>
              {extraction.lines?.length || 0} line(s) extracted
            </Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Ticket #</TableCell>
                    <TableCell>Grade</TableCell>
                    <TableCell align="right">Net MT</TableCell>
                    <TableCell align="right">$/MT</TableCell>
                    <TableCell align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(extraction.lines || []).map((line, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{line.line_number || idx + 1}</TableCell>
                      <TableCell>{line.ticket_number || '—'}</TableCell>
                      <TableCell>{line.grade || '—'}</TableCell>
                      <TableCell align="right">{line.net_weight_mt != null ? fmt(line.net_weight_mt) : '—'}</TableCell>
                      <TableCell align="right">{line.price_per_mt != null ? fmtDollar(line.price_per_mt) : '—'}</TableCell>
                      <TableCell align="right">{line.line_gross != null ? fmtDollar(line.line_gross) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {/* Usage */}
            {result.usage && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                AI: {result.usage.total_tokens?.toLocaleString()} tokens (~${result.usage.total_estimated_cost_usd?.toFixed(4)})
              </Typography>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        {!result ? (
          <>
            <Button onClick={handleClose}>Cancel</Button>
            <Button variant="contained" onClick={handleUpload} disabled={!file || uploading}>
              {uploading ? 'Extracting...' : 'Upload & Extract'}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={handleClose}>Cancel</Button>
            <Button variant="contained" onClick={handleSave} color="success">
              Save Draft Settlement
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
