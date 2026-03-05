import { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, Alert, Chip, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  CircularProgress,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import api from '../../services/api';

function fmt(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }

export default function ImportDialog({ open, onClose, year, onImported }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [committed, setCommitted] = useState(null);

  const reset = () => { setFile(null); setPreview(null); setError(''); setCommitted(null); };
  const handleClose = () => { reset(); onClose(); if (committed) onImported?.(); };

  const handlePreview = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post('/api/agronomy/import/preview', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPreview(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to parse file');
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/api/agronomy/import/commit', { crop_year: year });
      setCommitted(res.data.results);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to import');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Import Crop Allocations</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {committed ? (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
            <Typography variant="h6" gutterBottom>Import Complete</Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ mt: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ '& th': { fontWeight: 'bold' } }}>
                    <TableCell>Farm</TableCell>
                    <TableCell align="right">Crops</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {committed.map(r => (
                    <TableRow key={r.farm_name}>
                      <TableCell>{r.farm_name}</TableCell>
                      <TableCell align="right">{r.crops}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        ) : !preview ? (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Upload an Excel or CSV with your crop allocations across all farms.
              One row per farm + crop. Input programs are added per-farm afterwards.
            </Typography>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Required columns: <strong>Farm, Crop, Acres</strong>. Optional: <strong>Yield Target, Price</strong>.
            </Typography>

            <Button variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={async () => {
              const res = await api.get('/api/agronomy/template', { responseType: 'blob' });
              const url = URL.createObjectURL(res.data);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'agronomy-import-template.xlsx';
              a.click();
              URL.revokeObjectURL(url);
            }} sx={{ mb: 3 }}>
              Download Template
            </Button>

            <Box
              sx={{
                border: '2px dashed',
                borderColor: file ? 'primary.main' : 'grey.400',
                borderRadius: 2,
                p: 4,
                textAlign: 'center',
                bgcolor: file ? 'primary.main' + '08' : 'grey.50',
                cursor: 'pointer',
              }}
              onClick={() => document.getElementById('agro-import-file').click()}
            >
              <input
                id="agro-import-file"
                type="file"
                accept=".xlsx,.csv"
                onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); setError(''); }}
                style={{ display: 'none' }}
              />
              <UploadFileIcon sx={{ fontSize: 48, color: file ? 'primary.main' : 'grey.500', mb: 1 }} />
              {file ? (
                <Typography fontWeight="bold">{file.name}</Typography>
              ) : (
                <Typography color="text.secondary">Click to select a file (.xlsx or .csv)</Typography>
              )}
            </Box>
          </Box>
        ) : (
          <Box>
            <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
              <Chip label={`${preview.total_farms} farms`} color="primary" />
              <Chip label={`${preview.total_crops} crops`} color="primary" variant="outlined" />
            </Stack>

            {preview.warnings?.length > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {preview.warnings.map((w, i) => <div key={i}>{w}</div>)}
              </Alert>
            )}

            {preview.farms.map(farm => (
              <Box key={farm.farm_id} sx={{ mb: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 0.5 }}>{farm.farm_name}</Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ '& th': { fontWeight: 'bold', fontSize: '0.8rem' } }}>
                        <TableCell>Crop</TableCell>
                        <TableCell align="right">Acres</TableCell>
                        <TableCell align="right">Yield Target</TableCell>
                        <TableCell align="right">Price</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {farm.crops.map(c => (
                        <TableRow key={c.crop}>
                          <TableCell>{c.crop}</TableCell>
                          <TableCell align="right">{fmt(c.acres)}</TableCell>
                          <TableCell align="right">{c.target_yield_bu || '—'}</TableCell>
                          <TableCell align="right">{c.commodity_price ? `$${c.commodity_price.toFixed(2)}` : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            ))}

            <Alert severity="info" variant="outlined">
              This will create plans and replace any existing draft allocations for crop year {year}.
            </Alert>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{committed ? 'Done' : 'Cancel'}</Button>
        {!committed && !preview && file && (
          <Button variant="contained" onClick={handlePreview} disabled={loading}>
            {loading ? <CircularProgress size={20} /> : 'Preview'}
          </Button>
        )}
        {!committed && preview && (
          <>
            <Button onClick={reset}>Back</Button>
            <Button variant="contained" color="success" onClick={handleCommit} disabled={loading}>
              {loading ? <CircularProgress size={20} /> : `Import ${preview.total_farms} Farms`}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
