import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, Typography, Button, Chip, Alert,
  Select, MenuItem, FormControl, InputLabel, IconButton,
  Snackbar, Tooltip,
} from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import RefreshIcon from '@mui/icons-material/Refresh';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';
import WorkOrderImportDialog from '../../components/agronomy/WorkOrderImportDialog';

function fmtDec(n, d = 2) { return (n || 0).toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d }); }

const TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'seed', label: 'Seed' },
  { value: 'fertilizer', label: 'Fertilizer' },
  { value: 'chemical', label: 'Chemical' },
  { value: 'adjuvant', label: 'Adjuvant' },
];

export default function ProductLibrary() {
  const [year, setYear] = useState(2026);
  const [typeFilter, setTypeFilter] = useState('');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const gridRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ year });
      if (typeFilter) params.append('type', typeFilter);
      const res = await api.get(`/api/agronomy/product-library?${params}`);
      setProducts(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Error loading product library'));
    } finally {
      setLoading(false);
    }
  }, [year, typeFilter]);

  useEffect(() => { load(); }, [load]);

  const handleCellEdit = useCallback(async (params) => {
    const { id } = params.data;
    const field = params.colDef.field;
    const value = params.newValue;
    try {
      // Use enterprise product endpoint — need enterprise farm id
      // The product library endpoint returns products, we update them via the product's own id
      await api.patch(`/api/agronomy/product-library/${id}`, { [field]: value });
      // No need to reload — ag-grid already updated
    } catch (err) {
      setError(extractErrorMessage(err, 'Error saving'));
      load(); // Revert
    }
  }, [load]);

  const columnDefs = [
    { field: 'name', headerName: 'Product Name', flex: 2, minWidth: 200, filter: true },
    {
      field: 'type', headerName: 'Type', width: 110, filter: true,
      cellRenderer: (p) => {
        const colors = { seed: 'success', fertilizer: 'info', chemical: 'warning', adjuvant: 'default' };
        return <Chip label={p.value} size="small" color={colors[p.value] || 'default'} variant="outlined" />;
      },
    },
    { field: 'analysis_code', headerName: 'Analysis', width: 110 },
    {
      field: 'unit_price', headerName: 'Dealer Price', width: 120, type: 'numericColumn',
      editable: true,
      valueFormatter: p => p.value != null ? `$${fmtDec(p.value)}` : '—',
    },
    { field: 'packaging_unit', headerName: 'Pkg Unit', width: 100 },
    {
      field: 'packaging_volume', headerName: 'Pkg Volume', width: 110, type: 'numericColumn',
      editable: true,
      valueFormatter: p => p.value != null ? fmtDec(p.value, 1) : '—',
    },
    {
      field: 'cost_per_application_unit', headerName: '$/App Unit', width: 120, type: 'numericColumn',
      editable: true,
      valueFormatter: p => p.value != null ? `$${fmtDec(p.value, 4)}` : '—',
    },
    { field: 'dealer_code', headerName: 'Dealer Code', width: 120 },
    { field: 'dealer_name', headerName: 'Dealer', width: 120 },
    {
      headerName: 'Status', width: 100,
      valueGetter: (p) => p.data.cost_per_application_unit > 0 ? 'Priced' : 'No Price',
      cellRenderer: (p) => (
        <Chip
          label={p.value}
          size="small"
          color={p.value === 'Priced' ? 'success' : 'default'}
          variant="outlined"
        />
      ),
    },
  ];

  const pricedCount = products.filter(p => p.cost_per_application_unit > 0).length;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography variant="h5" fontWeight="bold">Product Library</Typography>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Crop Year</InputLabel>
          <Select value={year} label="Crop Year" onChange={e => setYear(e.target.value)}>
            <MenuItem value={2026}>2026</MenuItem>
            <MenuItem value={2025}>2025</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Type</InputLabel>
          <Select value={typeFilter} label="Type" onChange={e => setTypeFilter(e.target.value)}>
            {TYPE_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </Select>
        </FormControl>
        <Box sx={{ flexGrow: 1 }} />
        <Chip
          label={`${pricedCount} of ${products.length} products priced`}
          color={pricedCount === products.length ? 'success' : 'warning'}
        />
        <Tooltip title="Refresh">
          <IconButton onClick={load}><RefreshIcon /></IconButton>
        </Tooltip>
        <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => setImportOpen(true)}>
          Import Work Orders
        </Button>
      </Box>

      {products.length === 0 && !loading ? (
        <Alert severity="info">
          No products in library. Import Work Orders to populate pricing, or products will be auto-created from CWO imports.
        </Alert>
      ) : (
        <Box className="ag-theme-material" sx={{ height: 'calc(100vh - 260px)', width: '100%' }}>
          <AgGridReact
            ref={gridRef}
            rowData={products}
            columnDefs={columnDefs}
            defaultColDef={{
              resizable: true,
              sortable: true,
            }}
            getRowId={p => p.data.id}
            onCellValueChanged={handleCellEdit}
            animateRows
            rowSelection="single"
          />
        </Box>
      )}

      <WorkOrderImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        year={year}
        onImported={load}
      />

      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
      </Snackbar>
    </Box>
  );
}
