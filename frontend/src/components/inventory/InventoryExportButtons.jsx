import { useState } from 'react';
import {
  Button, CircularProgress, Snackbar, Alert, Menu, MenuItem, ListItemText, Stack,
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

const CSV_TYPES = [
  { key: 'inventory', label: 'Bin Inventory' },
  { key: 'contracts', label: 'Contracts' },
  { key: 'reconciliation', label: 'Reconciliation' },
  { key: 'available', label: 'Available to Sell' },
];

export default function InventoryExportButtons({ farmId, filters = {} }) {
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [error, setError] = useState('');
  const [csvAnchor, setCsvAnchor] = useState(null);

  const handleExcel = async () => {
    setExportingExcel(true);
    setError('');
    try {
      const res = await api.post(`/api/farms/${farmId}/inventory/export/excel`, {}, { responseType: 'blob' });
      downloadBlob(new Blob([res.data]), 'inventory-report.xlsx');
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
      const body = {};
      if (filters.location) body.locationId = filters.location;
      const res = await api.post(`/api/farms/${farmId}/inventory/export/pdf`, body, { responseType: 'blob' });
      downloadBlob(new Blob([res.data]), 'inventory-report.pdf');
    } catch {
      setError('PDF export failed.');
    } finally {
      setExportingPdf(false);
    }
  };

  const handleCsv = async (type) => {
    setCsvAnchor(null);
    setExportingCsv(true);
    setError('');
    try {
      const res = await api.post(`/api/farms/${farmId}/inventory/export/csv/${type}`, {}, { responseType: 'blob' });
      downloadBlob(new Blob([res.data]), `inventory-${type}.csv`);
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
        onClick={(e) => setCsvAnchor(e.currentTarget)}
        disabled={exportingCsv}
      >
        CSV
      </Button>
      <Menu
        anchorEl={csvAnchor}
        open={Boolean(csvAnchor)}
        onClose={() => setCsvAnchor(null)}
      >
        {CSV_TYPES.map(({ key, label }) => (
          <MenuItem key={key} onClick={() => handleCsv(key)}>
            <ListItemText>{label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
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
