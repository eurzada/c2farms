import { useState, useMemo, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Stepper, Step, StepLabel, Alert, Chip, LinearProgress,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';

const STEPS = ['Upload CSV', 'Preview', 'Results'];

export default function TerminalTicketImportDialog({ open, onClose, farmId, onImported }) {
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  const reset = () => {
    setStep(0);
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setLoading(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFileSelect = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    try {
      setLoading(true);
      setError(null);
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post(`/api/farms/${farmId}/terminal/tickets/import/preview`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPreview(res.data);
      setStep(1);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to parse CSV'));
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!preview?.tickets) return;
    try {
      setLoading(true);
      setError(null);
      const res = await api.post(`/api/farms/${farmId}/terminal/tickets/import/commit`, {
        tickets: preview.tickets,
      });
      setResult(res.data);
      setStep(2);
      onImported?.();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to import tickets'));
    } finally {
      setLoading(false);
    }
  };

  const columnDefs = useMemo(() => [
    {
      field: 'status', headerName: 'Status', width: 100, pinned: 'left',
      cellRenderer: p => (
        <Chip
          label={p.value === 'new' ? 'New' : 'Duplicate'}
          size="small"
          color={p.value === 'new' ? 'success' : 'default'}
          variant="outlined"
          sx={{ fontSize: '0.7rem', height: 20 }}
        />
      ),
    },
    { field: 'ticket_date', headerName: 'Date', width: 110 },
    { field: 'ticket_number', headerName: 'Ticket#', width: 90, type: 'numericColumn' },
    { field: 'grower_name', headerName: 'Grower', width: 180 },
    { field: 'product', headerName: 'Product', width: 100 },
    { field: 'weight_kg', headerName: 'Net KG', width: 110, type: 'numericColumn', valueFormatter: p => p.value?.toLocaleString('en-CA') },
    { field: 'moisture_pct', headerName: 'Moist%', width: 80, type: 'numericColumn' },
    { field: 'dockage_pct', headerName: 'Dock%', width: 80, type: 'numericColumn' },
    { field: 'protein_pct', headerName: 'Prot%', width: 80, type: 'numericColumn' },
    { field: 'test_weight', headerName: 'TW', width: 70, type: 'numericColumn' },
    { field: 'hvk_pct', headerName: 'HVK%', width: 70, type: 'numericColumn' },
    { field: 'fmo_number', headerName: 'FMO#', width: 100 },
    { field: 'buyer', headerName: 'Buyer', width: 100 },
    {
      field: 'is_c2_farms', headerName: 'C2', width: 60,
      cellRenderer: p => p.value ? <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} /> : null,
    },
  ], []);

  const defaultColDef = useMemo(() => ({
    sortable: true, filter: true, resizable: true,
  }), []);

  const newCount = preview?.summary?.new_count || 0;
  const dupCount = preview?.summary?.duplicate_count || 0;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
      <DialogTitle>Import Weigh Scale CSV</DialogTitle>
      <DialogContent>
        <Stepper activeStep={step} sx={{ mb: 3, mt: 1 }}>
          {STEPS.map(label => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
        </Stepper>

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
        {loading && <LinearProgress sx={{ mb: 2 }} />}

        {/* Step 0: Upload */}
        {step === 0 && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <UploadFileIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
            <Typography variant="body1" gutterBottom>Select a CSV file from the weigh scale</Typography>
            <Button variant="outlined" component="label" sx={{ mt: 1 }}>
              Choose File
              <input type="file" hidden accept=".csv" onChange={handleFileSelect} />
            </Button>
            {file && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </Typography>
            )}
          </Box>
        )}

        {/* Step 1: Preview */}
        {step === 1 && preview && (
          <Box>
            <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
              <Chip label={`${newCount} new`} color="success" size="small" />
              <Chip label={`${dupCount} duplicates (will skip)`} color="default" size="small" />
              {preview.errors?.length > 0 && (
                <Chip label={`${preview.errors.length} errors`} color="error" size="small" />
              )}
            </Box>
            {preview.errors?.length > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {preview.errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
                {preview.errors.length > 5 && <div>...and {preview.errors.length - 5} more</div>}
              </Alert>
            )}
            <Box
              className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'}
              sx={{ height: 400, width: '100%' }}
            >
              <AgGridReact
                ref={gridRef}
                rowData={preview.tickets}
                columnDefs={columnDefs}
                defaultColDef={defaultColDef}
                animateRows
                getRowId={p => `${p.data.row_number}`}
              />
            </Box>
          </Box>
        )}

        {/* Step 2: Results */}
        {step === 2 && result && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
            <Typography variant="h5" gutterBottom>Import Complete</Typography>
            <Typography variant="body1">{result.created} ticket(s) created</Typography>
            <Typography variant="body2" color="text.secondary">{result.skipped} duplicate(s) skipped</Typography>
            {result.errors?.length > 0 && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                {result.errors.map((e, i) => <div key={i}>{e}</div>)}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {step === 2 ? (
          <Button onClick={handleClose}>Done</Button>
        ) : (
          <>
            <Button onClick={handleClose}>Cancel</Button>
            {step === 0 && (
              <Button variant="contained" onClick={handleUpload} disabled={!file || loading}>
                Upload & Preview
              </Button>
            )}
            {step === 1 && (
              <Button variant="contained" onClick={handleCommit} disabled={newCount === 0 || loading}>
                Import {newCount} Ticket{newCount !== 1 ? 's' : ''}
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
