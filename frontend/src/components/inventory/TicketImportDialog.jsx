import { useState, useMemo, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Stepper, Step, StepLabel, Alert, Chip, Stack, LinearProgress,
} from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';

const steps = ['Upload CSV', 'Preview & Match', 'Import'];

function MatchChip({ value }) {
  if (!value) return <Chip label="No match" size="small" color="warning" variant="outlined" />;
  return <Chip label={value} size="small" color="success" variant="outlined" />;
}

export default function TicketImportDialog({ open, onClose, farmId, onImported }) {
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [importResult, setImportResult] = useState(null);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post(`/api/farms/${farmId}/tickets/import/preview`, formData);
      setPreview(res.data);
      setActiveStep(1);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!preview?.tickets) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.post(`/api/farms/${farmId}/tickets/import/commit`, {
        tickets: preview.tickets,
      });
      setImportResult(res.data);
      setActiveStep(2);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setActiveStep(0);
    setPreview(null);
    setImportResult(null);
    setError(null);
    onClose();
    if (importResult) onImported?.();
  };

  const columnDefs = useMemo(() => [
    {
      field: 'status', headerName: '', width: 70, sortable: false,
      cellRenderer: p => p.value === 'new'
        ? <Chip label="New" size="small" color="primary" />
        : <Chip label="Update" size="small" color="info" />,
    },
    { field: 'ticket_number', headerName: 'Ticket #', width: 110 },
    { field: 'delivery_date', headerName: 'Date', width: 110 },
    { field: 'crop_name', headerName: 'Crop', width: 120 },
    { field: 'net_weight_mt', headerName: 'Net MT', width: 100, valueFormatter: p => p.value?.toFixed(2) },
    { field: 'contract_match', headerName: 'Contract', width: 180, cellRenderer: p => <MatchChip value={p.value} /> },
    { field: 'counterparty_match', headerName: 'Buyer', width: 140, cellRenderer: p => <MatchChip value={p.value} /> },
    { field: 'location_match', headerName: 'Location', width: 120, cellRenderer: p => <MatchChip value={p.value} /> },
    { field: 'bin_match', headerName: 'Bin', width: 140, cellRenderer: p => <MatchChip value={p.value} /> },
    { field: 'operator_name', headerName: 'Operator', width: 140 },
    { field: 'destination', headerName: 'Destination', width: 140 },
  ], []);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xl" fullWidth>
      <DialogTitle>Import Delivery Tickets from Traction Ag</DialogTitle>
      <DialogContent>
        <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
          {steps.map(label => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
        </Stepper>

        {loading && <LinearProgress sx={{ mb: 2 }} />}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {activeStep === 0 && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <UploadFileIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" gutterBottom>Upload Traction Ag CSV Export</Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              Export "Physical Crop Transfers" from Traction Ag and upload the CSV file.
            </Typography>
            <Button variant="contained" component="label" disabled={loading}>
              Choose CSV File
              <input type="file" accept=".csv" hidden onChange={handleFileUpload} />
            </Button>
          </Box>
        )}

        {activeStep === 1 && preview && (
          <Box>
            <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
              <Chip label={`${preview.summary.total} tickets`} color="primary" />
              <Chip label={`${preview.summary.new_count} new`} color="success" />
              <Chip label={`${preview.summary.update_count} updates`} color="info" />
              <Chip
                icon={preview.summary.matched_contracts > 0 ? <CheckCircleIcon /> : <ErrorIcon />}
                label={`${preview.summary.matched_contracts} contracts matched`}
                color={preview.summary.unmatched_contracts === 0 ? 'success' : 'warning'}
              />
            </Stack>

            {preview.errors.length > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {preview.errors.length} row(s) skipped: {preview.errors.slice(0, 3).join('; ')}
                {preview.errors.length > 3 && ` and ${preview.errors.length - 3} more...`}
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
                defaultColDef={{ sortable: true, resizable: true, filter: true }}
                animateRows
                getRowId={p => p.data?.ticket_number}
              />
            </Box>
          </Box>
        )}

        {activeStep === 2 && importResult && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
            <Typography variant="h6" gutterBottom>Import Complete</Typography>
            <Stack direction="row" spacing={2} justifyContent="center" sx={{ mb: 2 }}>
              <Chip label={`${importResult.created} created`} color="success" />
              <Chip label={`${importResult.updated} updated`} color="info" />
            </Stack>
            {importResult.errors.length > 0 && (
              <Alert severity="warning">
                {importResult.errors.length} error(s): {importResult.errors.slice(0, 5).join('; ')}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{activeStep === 2 ? 'Done' : 'Cancel'}</Button>
        {activeStep === 1 && (
          <Button variant="contained" onClick={handleImport} disabled={loading || !preview?.tickets?.length}>
            Import {preview?.summary?.total} Tickets
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
