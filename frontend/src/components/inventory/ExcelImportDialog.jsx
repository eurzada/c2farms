import { useState, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, CircularProgress, Alert, Box, Stack,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import api from '../../services/api';

export default function ExcelImportDialog({ open, onClose, farmId, onImportComplete }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('ready'); // ready | importing | done | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const inputRef = useRef();

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected) {
      setFile(selected);
      setStatus('ready');
      setResult(null);
      setErrorMsg('');
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setStatus('importing');
    setErrorMsg('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await api.post(
        `/api/farms/${farmId}/inventory/import`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setResult(res.data);
      setStatus('done');
      if (onImportComplete) onImportComplete();
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'Import failed. Please check the file format.');
      setStatus('error');
    }
  };

  const handleClose = () => {
    setFile(null);
    setStatus('ready');
    setResult(null);
    setErrorMsg('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Import Inventory from Excel</DialogTitle>
      <DialogContent>
        {status === 'ready' && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Upload a monthly inventory count spreadsheet (.xlsx). Bins, counts, and contracts will be imported or updated.
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ pl: 1 }}>
              • Name the file like <b>Oct 31 2025.xlsx</b> or the sheet tab like <b>Oct 31, 25</b> so the count period is detected automatically<br />
              • Columns: <b>Farm Location</b> | <b>Bin #</b> | <b>Type</b> | <b>Size (bu)</b> | <b>Commodity</b> | <b>Bushels</b> | <b>Kg</b> | <b>Crop Year</b>
            </Typography>
            <Box>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <Button
                variant="outlined"
                startIcon={<UploadFileIcon />}
                onClick={() => inputRef.current?.click()}
              >
                {file ? file.name : 'Choose File'}
              </Button>
            </Box>
          </Stack>
        )}

        {status === 'importing' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 3 }}>
            <CircularProgress size={24} />
            <Typography>Importing {file?.name}...</Typography>
          </Box>
        )}

        {status === 'done' && result && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CheckCircleIcon color="success" />
              <Typography fontWeight={600}>Import complete</Typography>
            </Box>
            <Box sx={{ pl: 1 }}>
              <Typography variant="body2">Commodities: {result.summary.commodities}</Typography>
              <Typography variant="body2">Locations: {result.summary.locations}</Typography>
              <Typography variant="body2">Bins: {result.summary.bins}</Typography>
              <Typography variant="body2">Bin counts: {result.summary.binCounts}</Typography>
              <Typography variant="body2">Contracts: {result.summary.contracts}</Typography>
              <Typography variant="body2">Count periods: {result.summary.periods}</Typography>
            </Box>

            {/* Change summary — show delta from prior period */}
            {result.changes && (
              <Box sx={{ mt: 1, p: 1.5, bgcolor: 'grey.50', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Inventory Change{result.changes.prev_period_label ? ` (${result.changes.prev_period_label} → ${result.changes.period_label})` : ` (${result.changes.period_label})`}
                </Typography>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #ddd' }}>
                      <th style={{ textAlign: 'left', padding: '2px 4px' }}>Commodity</th>
                      {result.changes.prev_period_label && <th style={{ textAlign: 'right', padding: '2px 4px' }}>Previous</th>}
                      <th style={{ textAlign: 'right', padding: '2px 4px' }}>Current</th>
                      {result.changes.prev_period_label && <th style={{ textAlign: 'right', padding: '2px 4px' }}>Change</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {result.changes.commodities.map(c => (
                      <tr key={c.name}>
                        <td style={{ padding: '2px 4px' }}>{c.name}</td>
                        {result.changes.prev_period_label && <td style={{ textAlign: 'right', padding: '2px 4px' }}>{c.previous_mt.toLocaleString()} MT</td>}
                        <td style={{ textAlign: 'right', padding: '2px 4px' }}>{c.current_mt.toLocaleString()} MT</td>
                        {result.changes.prev_period_label && (
                          <td style={{ textAlign: 'right', padding: '2px 4px', color: c.delta_mt < 0 ? '#d32f2f' : c.delta_mt > 0 ? '#2e7d32' : undefined, fontWeight: 600 }}>
                            {c.delta_mt > 0 ? '+' : ''}{c.delta_mt.toLocaleString()} MT
                          </td>
                        )}
                      </tr>
                    ))}
                    <tr style={{ borderTop: '1px solid #ddd', fontWeight: 700 }}>
                      <td style={{ padding: '2px 4px' }}>Total</td>
                      {result.changes.prev_period_label && <td style={{ textAlign: 'right', padding: '2px 4px' }}>{result.changes.total_previous_mt.toLocaleString()} MT</td>}
                      <td style={{ textAlign: 'right', padding: '2px 4px' }}>{result.changes.total_current_mt.toLocaleString()} MT</td>
                      {result.changes.prev_period_label && (
                        <td style={{ textAlign: 'right', padding: '2px 4px', color: result.changes.total_delta_mt < 0 ? '#d32f2f' : result.changes.total_delta_mt > 0 ? '#2e7d32' : undefined }}>
                          {result.changes.total_delta_mt > 0 ? '+' : ''}{result.changes.total_delta_mt.toLocaleString()} MT
                        </td>
                      )}
                    </tr>
                  </tbody>
                </table>
              </Box>
            )}

            {result.errors?.length > 0 && (
              <Alert severity="warning">
                {result.errors.length} warning(s):
                <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                  {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </Alert>
            )}
          </Stack>
        )}

        {status === 'error' && (
          <Alert severity="error" sx={{ mt: 1 }}>{errorMsg}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        {status === 'done' ? (
          <Button onClick={handleClose}>Close</Button>
        ) : (
          <>
            <Button onClick={handleClose}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handleImport}
              disabled={!file || status === 'importing'}
            >
              Import
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
