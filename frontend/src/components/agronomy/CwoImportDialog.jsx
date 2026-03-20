import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Stepper, Step, StepLabel, Typography, Box, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Chip, TextField, LinearProgress, Select, MenuItem, FormControl,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';

const STEPS = ['Upload File', 'Map & Preview', 'Commit'];

function fmt(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function fmtDec(n, d = 1) { return (n || 0).toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d }); }

export default function CwoImportDialog({ open, onClose, year, onImported }) {
  const { farmUnits } = useFarm();
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [fieldGroups, setFieldGroups] = useState([]); // from CWO file
  const [mappings, setMappings] = useState({}); // fieldGroup → farmId
  const [label, setLabel] = useState('');
  const [result, setResult] = useState(null);

  const reset = () => {
    setStep(0);
    setFile(null);
    setLoading(false);
    setError('');
    setPreview(null);
    setFieldGroups([]);
    setMappings({});
    setLabel('');
    setResult(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // Load saved mappings when dialog opens
  useEffect(() => {
    if (!open) return;
    api.get(`/api/agronomy/field-group-mappings?year=${year}`)
      .then(res => {
        const saved = {};
        for (const m of res.data) saved[m.field_group] = m.farm_id;
        setMappings(prev => ({ ...saved, ...prev }));
      })
      .catch(() => {});
  }, [open, year]);

  const handleUpload = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('crop_year', year);
      formData.append('field_group_mappings', JSON.stringify(mappings));
      const res = await api.post('/api/agronomy/cwo/preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPreview(res.data);
      setFieldGroups(res.data.field_groups || []);
      // Merge saved mappings
      if (res.data.saved_mappings) {
        setMappings(prev => ({ ...res.data.saved_mappings, ...prev }));
      }
      setStep(1);
    } catch (err) {
      setError(extractErrorMessage(err, 'Error parsing CWO file'));
    } finally {
      setLoading(false);
    }
  }, [file, year, mappings]);

  const handleRePreview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Save mappings first
      const mappingArray = Object.entries(mappings)
        .filter(([, farmId]) => farmId)
        .map(([field_group, farm_id]) => ({ field_group, farm_id }));
      if (mappingArray.length > 0) {
        await api.post('/api/agronomy/field-group-mappings', {
          mappings: mappingArray,
          crop_year: year,
        });
      }

      // Re-preview with updated mappings
      const formData = new FormData();
      formData.append('file', file);
      formData.append('crop_year', year);
      formData.append('field_group_mappings', JSON.stringify(mappings));
      const res = await api.post('/api/agronomy/cwo/preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPreview(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Error re-previewing'));
    } finally {
      setLoading(false);
    }
  }, [file, year, mappings]);

  const handleCommit = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/api/agronomy/cwo/commit', {
        crop_year: year,
        label: label || `CWO Import ${year}`,
        field_group_mappings: JSON.stringify(mappings),
      });
      setResult(res.data.results);
      setStep(2);
      if (onImported) onImported();
    } catch (err) {
      setError(extractErrorMessage(err, 'Error committing CWO import'));
    } finally {
      setLoading(false);
    }
  }, [year, label, mappings, onImported]);

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) setFile(f);
  };

  const updateMapping = (fieldGroup, farmId) => {
    setMappings(prev => ({ ...prev, [fieldGroup]: farmId }));
  };

  // Filter farmUnits to only BUs (not enterprise)
  const buFarms = (farmUnits || []).filter(f => !f.is_enterprise);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
      <DialogTitle>Import Cropwise Operations (CWO) Export</DialogTitle>
      <DialogContent>
        <Stepper activeStep={step} sx={{ mb: 3 }}>
          {STEPS.map(l => <Step key={l}><StepLabel>{l}</StepLabel></Step>)}
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
              onClick={() => document.getElementById('cwo-file-input').click()}
            >
              <UploadFileIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
              <Typography>Drag & drop CWO Excel export, or click to browse</Typography>
              {file && <Chip label={file.name} sx={{ mt: 1 }} onDelete={() => setFile(null)} />}
              <input
                id="cwo-file-input"
                type="file"
                accept=".xlsx,.xls"
                hidden
                onChange={e => setFile(e.target.files[0])}
              />
            </Box>
          </Box>
        )}

        {/* Step 1: Map & Preview */}
        {step === 1 && preview && (
          <Box>
            {/* Field Group Mapping */}
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
              Field Group Mapping
            </Typography>
            <Paper sx={{ p: 2, mb: 2, maxHeight: 250, overflow: 'auto' }}>
              {fieldGroups.map(fg => (
                <Box key={fg} sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                  <Typography sx={{ minWidth: 160 }}>{fg}</Typography>
                  <FormControl size="small" sx={{ minWidth: 200 }}>
                    <Select
                      value={mappings[fg] || ''}
                      displayEmpty
                      onChange={e => updateMapping(fg, e.target.value)}
                    >
                      <MenuItem value=""><em>— Unmapped —</em></MenuItem>
                      {buFarms.map(f => (
                        <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {!mappings[fg] && <Chip label="Unmapped" size="small" color="warning" />}
                </Box>
              ))}
              <Button size="small" onClick={handleRePreview} disabled={loading} sx={{ mt: 1 }}>
                Re-preview with updated mappings
              </Button>
            </Paper>

            {/* Summary chips */}
            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
              <Chip label={`${preview.total_farms} farms`} color="primary" />
              <Chip label={`${preview.total_crops} crop allocations`} color="primary" />
              <Chip label={`${preview.total_products} products`} />
              <Chip label={`${preview.matched_products} matched`} color="success" />
              <Chip label={`${preview.unmatched_products} unmatched`} color={preview.unmatched_products > 0 ? 'warning' : 'default'} />
              <Chip label={`${preview.pricing_coverage}% pricing coverage`} color={preview.pricing_coverage > 70 ? 'success' : 'warning'} />
            </Box>

            {preview.warnings?.length > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {preview.warnings.map((w, i) => <div key={i}>{w}</div>)}
              </Alert>
            )}

            {/* Farm-crop preview */}
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>Preview</Typography>
            <TableContainer component={Paper} sx={{ maxHeight: 300 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Farm</TableCell>
                    <TableCell>Crop</TableCell>
                    <TableCell align="right">Acres</TableCell>
                    <TableCell align="right">Yield bu/ac</TableCell>
                    <TableCell align="right">Products</TableCell>
                    <TableCell align="right">Matched</TableCell>
                    <TableCell>Field Groups</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {preview.farm_crops.map((fc, i) => (
                    <TableRow key={i} hover>
                      <TableCell>{fc.farm_name}</TableCell>
                      <TableCell>{fc.crop}</TableCell>
                      <TableCell align="right">{fmt(fc.acres)}</TableCell>
                      <TableCell align="right">{fc.avg_yield_bu > 0 ? fmtDec(fc.avg_yield_bu) : '—'}</TableCell>
                      <TableCell align="right">{fc.product_count}</TableCell>
                      <TableCell align="right">
                        <Chip
                          label={`${fc.matched_count}/${fc.product_count}`}
                          size="small"
                          color={fc.unmatched_count === 0 ? 'success' : 'warning'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>{fc.field_groups.join(', ')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {/* Snapshot label */}
            <TextField
              label="Import Label"
              placeholder="e.g. Spring 2026 Plan"
              value={label}
              onChange={e => setLabel(e.target.value)}
              size="small"
              fullWidth
              sx={{ mt: 2 }}
            />
          </Box>
        )}

        {/* Step 2: Result */}
        {step === 2 && result && (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
            <Typography variant="h6">CWO Import Complete</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {result.plans_created} new plans created
            </Typography>
            <Typography color="text.secondary">
              {result.allocations_created} crop allocations created
            </Typography>
            <Typography color="text.secondary">
              {result.inputs_created} product inputs imported
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
            {loading ? 'Importing...' : `Import ${preview?.total_crops || 0} Crop Plans`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
