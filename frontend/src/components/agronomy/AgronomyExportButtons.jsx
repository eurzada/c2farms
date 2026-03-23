import { useState } from 'react';
import {
  Button, CircularProgress, Snackbar, Alert, Stack,
} from '@mui/material';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import TableViewIcon from '@mui/icons-material/TableView';
import TextSnippetIcon from '@mui/icons-material/TextSnippet';
import api from '../../services/api';

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => window.URL.revokeObjectURL(url), 5000);
}

export default function AgronomyExportButtons({ farmId, year }) {
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [error, setError] = useState('');

  const handleExcel = async () => {
    setExportingExcel(true);
    setError('');
    try {
      const res = await api.post(`/api/farms/${farmId}/agronomy/export/excel?year=${year}`, {}, { responseType: 'blob' });
      downloadBlob(new Blob([res.data]), `crop-input-plan-${year}.xlsx`);
    } catch {
      setError('Excel export failed.');
    } finally {
      setExportingExcel(false);
    }
  };

  const handlePdf = async () => {
    setExportingPdf(true);
    setError('');
    try {
      const res = await api.post(`/api/farms/${farmId}/agronomy/export/pdf?year=${year}`, {}, { responseType: 'blob' });
      downloadBlob(new Blob([res.data]), `crop-input-plan-${year}.pdf`);
    } catch {
      setError('PDF export failed.');
    } finally {
      setExportingPdf(false);
    }
  };

  const handleCsv = async () => {
    setExportingCsv(true);
    setError('');
    try {
      const res = await api.post(`/api/farms/${farmId}/agronomy/export/csv?year=${year}`, {}, { responseType: 'blob' });
      downloadBlob(new Blob([res.data]), `crop-input-plan-${year}.csv`);
    } catch {
      setError('CSV export failed.');
    } finally {
      setExportingCsv(false);
    }
  };

  return (
    <Stack direction="row" spacing={1}>
      <Button
        variant="outlined"
        size="small"
        startIcon={exportingExcel ? <CircularProgress size={16} /> : <TableViewIcon />}
        onClick={handleExcel}
        disabled={exportingExcel}
      >
        Excel
      </Button>
      <Button
        variant="outlined"
        size="small"
        startIcon={exportingPdf ? <CircularProgress size={16} /> : <PictureAsPdfIcon />}
        onClick={handlePdf}
        disabled={exportingPdf}
      >
        PDF
      </Button>
      <Button
        variant="outlined"
        size="small"
        startIcon={exportingCsv ? <CircularProgress size={16} /> : <TextSnippetIcon />}
        onClick={handleCsv}
        disabled={exportingCsv}
      >
        CSV
      </Button>
      <Snackbar
        open={!!error}
        autoHideDuration={4000}
        onClose={() => setError('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
      </Snackbar>
    </Stack>
  );
}
