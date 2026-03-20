import { useState, useCallback, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, Alert, Chip, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, LinearProgress, Stepper, Step, StepLabel,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';

const STEPS = ['Upload', 'Preview', 'Done'];

function fmtK(n) { return n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : '$' + (n || 0).toFixed(0); }

export default function ProcurementImportDialog({ open, onClose, year, onImported }) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

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
      const res = await api.post('/api/agronomy/procurement-contracts/import/preview', formData);
      setPreview(res.data);
      setStep(1);
    } catch (err) {
      setError(extractErrorMessage(err, 'Error parsing procurement contract file'));
    } finally {
      setLoading(false);
    }
  }, [file, year]);

  const handleCommit = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/api/agronomy/procurement-contracts/import/commit', { crop_year: year });
      setResult(res.data.results);
      setStep(2);
      if (onImported) onImported();
    } catch (err) {
      setError(extractErrorMessage(err, 'Error importing procurement contracts'));
    } finally {
      setLoading(false);
    }
  }, [year, onImported]);

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) setFile(f);
  };

  const stats = preview?.stats;
  const contracts = preview?.contracts || [];
  const warnings = preview?.warnings || [];
  const newSuppliers = preview?.newSuppliers || [];

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
      <DialogTitle>Import Procurement Contracts</DialogTitle>
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
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadFileIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
              <Typography>Drag & drop Procurement Contract Excel, or click to browse</Typography>
              {file && <Chip label={file.name} sx={{ mt: 1 }} onDelete={() => setFile(null)} />}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                hidden
                onChange={e => { if (e.target.files[0]) setFile(e.target.files[0]); }}
              />
            </Box>
            <Box sx={{ mt: 2, textAlign: 'center' }}>
              <Button
                variant="outlined"
                startIcon={<UploadFileIcon />}
                onClick={() => fileInputRef.current?.click()}
              >
                Select File
              </Button>
            </Box>
          </Box>
        )}

        {/* Step 1: Preview */}
        {step === 1 && preview && (
          <Box>
            <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }}>
              <Chip label={`${stats?.totalContracts || 0} contracts`} color="primary" />
              <Chip label={`${stats?.totalLines || 0} lines`} color="primary" variant="outlined" />
              <Chip label={fmtK(stats?.totalValue || 0) + ' total value'} color="success" />
              {newSuppliers.length > 0 && (
                <Chip label={`${newSuppliers.length} new supplier${newSuppliers.length > 1 ? 's' : ''}`} color="warning" />
              )}
            </Stack>

            {warnings.length > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {warnings.map((w, i) => <div key={i}>{w}</div>)}
              </Alert>
            )}

            {newSuppliers.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>New Suppliers</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {newSuppliers.map((s, i) => (
                    <Chip key={i} label={s} size="small" color="warning" variant="outlined" />
                  ))}
                </Stack>
              </Box>
            )}

            <Typography variant="subtitle2" sx={{ mb: 1 }}>Contracts Preview (first 20)</Typography>
            <TableContainer component={Paper} sx={{ maxHeight: 400 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Contract #</TableCell>
                    <TableCell>Supplier</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>BU</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell align="right">Lines</TableCell>
                    <TableCell align="right">Value</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {contracts.slice(0, 20).map((c, i) => (
                    <TableRow key={i} hover>
                      <TableCell>{c.contract_number || '—'}</TableCell>
                      <TableCell>{c.supplier || '—'}</TableCell>
                      <TableCell>{c.category || '—'}</TableCell>
                      <TableCell>{c.bu || '—'}</TableCell>
                      <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.description || '—'}
                      </TableCell>
                      <TableCell align="right">{c.lines ?? '—'}</TableCell>
                      <TableCell align="right">{c.value != null ? fmtK(c.value) : '—'}</TableCell>
                      <TableCell>
                        <Chip
                          label={c.status || 'new'}
                          size="small"
                          color={c.status === 'exists' ? 'default' : 'success'}
                          variant="outlined"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {contracts.length > 20 && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Showing 20 of {contracts.length} contracts
              </Typography>
            )}
          </Box>
        )}

        {/* Step 2: Done */}
        {step === 2 && result && (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
            <Typography variant="h6">Import Complete</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              Created {result.contractsCreated} contract{result.contractsCreated !== 1 ? 's' : ''} with {result.linesCreated} line{result.linesCreated !== 1 ? 's' : ''}
            </Typography>
            {result.suppliersCreated > 0 && (
              <Typography color="text.secondary">
                {result.suppliersCreated} new supplier{result.suppliersCreated !== 1 ? 's' : ''} created
              </Typography>
            )}
          </Box>
        )}

        {loading && <LinearProgress sx={{ mt: 2 }} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{step === 2 ? 'Done' : 'Cancel'}</Button>
        {step === 0 && (
          <Button variant="contained" onClick={handleUpload} disabled={!file || loading}>
            {loading ? 'Parsing...' : 'Preview'}
          </Button>
        )}
        {step === 1 && (
          <Button variant="contained" onClick={handleCommit} disabled={loading}>
            {loading ? 'Importing...' : `Import ${stats?.totalContracts || 0} Contracts`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
