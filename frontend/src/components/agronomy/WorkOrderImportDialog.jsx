import { useState, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Stepper, Step, StepLabel, Typography, Box, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Chip, LinearProgress,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';

const STEPS = ['Upload File', 'Map & Preview', 'Commit'];

function fmt(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function fmtDec(n) { return (n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function WorkOrderImportDialog({ open, onClose, year, onImported }) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  const reset = () => {
    setStep(0);
    setFile(null);
    setLoading(false);
    setError('');
    setPreview(null);
    setResult(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleUpload = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('crop_year', year);
      const res = await api.post('/api/agronomy/work-orders/preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPreview(res.data);
      setStep(1);
    } catch (err) {
      setError(extractErrorMessage(err, 'Error parsing work order file'));
    } finally {
      setLoading(false);
    }
  }, [file, year]);

  const handleCommit = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/api/agronomy/work-orders/commit', { crop_year: year });
      setResult(res.data.results);
      setStep(2);
      if (onImported) onImported();
    } catch (err) {
      setError(extractErrorMessage(err, 'Error committing work orders'));
    } finally {
      setLoading(false);
    }
  }, [year, onImported]);

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) setFile(f);
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Import Work Orders (Synergy)</DialogTitle>
      <DialogContent>
        <Stepper activeStep={step} sx={{ mb: 3 }}>
          {STEPS.map(label => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
        </Stepper>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {/* Step 0: Upload */}
        {step === 0 && (
          <Box>
            <Box
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              sx={{
                border: '2px dashed', borderColor: 'divider', borderRadius: 2,
                p: 4, textAlign: 'center', cursor: 'pointer',
                '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
              }}
              onClick={() => document.getElementById('wo-file-input').click()}
            >
              <UploadFileIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
              <Typography>Drag & drop Synergy Work Order Excel, or click to browse</Typography>
              {file && <Chip label={file.name} sx={{ mt: 1 }} onDelete={() => setFile(null)} />}
              <input
                id="wo-file-input"
                type="file"
                accept=".xlsx,.xls"
                hidden
                onChange={e => setFile(e.target.files[0])}
              />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Expected format: 16-column Synergy export (Customer, Work Order, Product Code, Product Name, Qty, Price, etc.)
            </Typography>
          </Box>
        )}

        {/* Step 1: Preview */}
        {step === 1 && preview && (
          <Box>
            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
              <Chip label={`${preview.total_lines} lines`} color="primary" />
              <Chip label={`$${fmt(preview.total_value)} total value`} color="success" />
              <Chip label={`${preview.new_product_count} new products`} color="warning" />
            </Box>

            {preview.warnings?.length > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {preview.warnings.map((w, i) => <div key={i}>{w}</div>)}
              </Alert>
            )}

            <Typography variant="subtitle2" sx={{ mb: 1 }}>Entity Summary</Typography>
            <TableContainer component={Paper} sx={{ mb: 2, maxHeight: 200 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Entity</TableCell>
                    <TableCell align="right">Lines</TableCell>
                    <TableCell align="right">Total $</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(preview.entity_summary).map(([name, data]) => (
                    <TableRow key={name}>
                      <TableCell>
                        {name}
                        {!data.farm_id && <Chip label="Unmapped" size="small" color="warning" sx={{ ml: 1 }} />}
                      </TableCell>
                      <TableCell align="right">{data.lines}</TableCell>
                      <TableCell align="right">${fmt(data.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Typography variant="subtitle2" sx={{ mb: 1 }}>Product Lines (first 50)</Typography>
            <TableContainer component={Paper} sx={{ maxHeight: 300 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Product</TableCell>
                    <TableCell>Code</TableCell>
                    <TableCell>Packaging</TableCell>
                    <TableCell align="right">Unit Price</TableCell>
                    <TableCell align="right">$/App Unit</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {preview.lines.slice(0, 50).map((line, i) => (
                    <TableRow key={i} hover>
                      <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {line.product_name}
                      </TableCell>
                      <TableCell>{line.product_code}</TableCell>
                      <TableCell>{line.packaging_unit}</TableCell>
                      <TableCell align="right">${fmtDec(line.unit_price)}</TableCell>
                      <TableCell align="right">
                        {line.cost_per_application_unit ? `$${fmtDec(line.cost_per_application_unit)}` : '—'}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={line.is_new_product ? 'New' : 'Exists'}
                          size="small"
                          color={line.is_new_product ? 'warning' : 'success'}
                          variant="outlined"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {/* Step 2: Result */}
        {step === 2 && result && (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
            <Typography variant="h6">Import Complete</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {result.lines_created} work order lines imported
            </Typography>
            <Typography color="text.secondary">
              {result.products_upserted} products updated in library
            </Typography>
          </Box>
        )}

        {loading && <LinearProgress sx={{ mt: 2 }} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{step === 2 ? 'Close' : 'Cancel'}</Button>
        {step === 0 && (
          <Button variant="contained" onClick={handleUpload} disabled={!file || loading}>
            {loading ? 'Parsing...' : 'Upload & Preview'}
          </Button>
        )}
        {step === 1 && (
          <Button variant="contained" onClick={handleCommit} disabled={loading}>
            {loading ? 'Importing...' : `Import ${preview?.total_lines || 0} Lines`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
