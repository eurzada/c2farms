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
              Upload an Excel file (.xlsx) matching the inventory spreadsheet format.
              Bins, counts, and contracts will be imported or updated.
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
