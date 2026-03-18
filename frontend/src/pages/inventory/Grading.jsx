import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Stack, FormControl, InputLabel, Select, MenuItem, Typography,
  Button, Alert, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  Table, TableBody, TableCell, TableHead, TableRow, TableContainer, Paper,
  CircularProgress, LinearProgress,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import { getGridColors } from '../../utils/gridColors';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';
import GradingExportButtons from '../../components/inventory/GradingExportButtons';

export default function Grading() {
  const { currentFarm, isEnterprise } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const colors = useMemo(() => getGridColors(mode), [mode]);

  const [grades, setGrades] = useState([]);
  const [locations, setLocations] = useState([]);
  const [commodities, setCommodities] = useState([]);
  const [cropYears, setCropYears] = useState([]);
  const [filters, setFilters] = useState({ location: '', commodity: '', crop_year: '' });
  const [error, setError] = useState(null);

  // Import dialog state
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [confirming, setConfirming] = useState(false);

  // Load metadata
  useEffect(() => {
    if (!currentFarm) return;
    const eq = isEnterprise ? '?enterprise=true' : '';
    Promise.all([
      api.get(`/api/farms/${currentFarm.id}/inventory/locations${eq}`),
      api.get(`/api/farms/${currentFarm.id}/inventory/commodities`),
      api.get(`/api/farms/${currentFarm.id}/inventory/grades/crop-years`),
    ]).then(([locRes, comRes, yearRes]) => {
      setLocations(locRes.data.locations || []);
      setCommodities(comRes.data.commodities || []);
      setCropYears(yearRes.data.crop_years || []);
    });
  }, [currentFarm, isEnterprise]);

  // Load grades
  const loadGrades = useCallback(() => {
    if (!currentFarm) return;
    const params = new URLSearchParams();
    if (filters.location) params.set('location', filters.location);
    if (filters.commodity) params.set('commodity', filters.commodity);
    if (filters.crop_year) params.set('crop_year', filters.crop_year);
    api.get(`/api/farms/${currentFarm.id}/inventory/grades?${params}`)
      .then(res => setGrades(res.data.grades || []))
      .catch(err => setError(extractErrorMessage(err, 'Failed to load grades')));
  }, [currentFarm, filters]);

  useEffect(() => { loadGrades(); }, [loadGrades]);

  const handleCellEdit = useCallback(async (params) => {
    const { data, colDef, newValue } = params;
    try {
      await api.put(`/api/farms/${currentFarm.id}/inventory/grades/${data.id}`, {
        [colDef.field]: newValue,
      });
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to update'));
      loadGrades();
    }
  }, [currentFarm, loadGrades]);

  const columnDefs = useMemo(() => [
    { field: 'location_name', headerName: 'Location', minWidth: 110, flex: 1 },
    {
      field: 'bin_number', headerName: 'Bin #', minWidth: 80, flex: 0.7,
      comparator: (a, b) => {
        const numA = parseInt(a, 10);
        const numB = parseInt(b, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        if (!isNaN(numA)) return -1;
        if (!isNaN(numB)) return 1;
        return String(a).localeCompare(String(b));
      },
      sort: 'asc',
    },
    { field: 'commodity_name', headerName: 'Commodity', minWidth: 110, flex: 1 },
    {
      field: 'inv_crop_year', headerName: 'Crop Year', minWidth: 90, flex: 0.6,
      valueFormatter: p => p.value != null ? String(p.value) : '—',
    },
    {
      field: 'inv_bushels', headerName: 'Inv Bu', minWidth: 90, flex: 0.7,
      valueFormatter: p => p.value != null ? Math.round(p.value).toLocaleString() : '—',
    },
    {
      field: 'inv_mt', headerName: 'Inv MT', minWidth: 80, flex: 0.6,
      valueFormatter: p => p.value != null ? p.value.toFixed(1) : '—',
    },
    { field: 'grade', headerName: 'Grade', minWidth: 180, flex: 1.5, editable: true },
    { field: 'variety', headerName: 'Variety', minWidth: 90, flex: 0.7, editable: true },
    { field: 'grade_reason', headerName: 'Reason', minWidth: 100, flex: 0.8, editable: true },
    {
      field: 'protein_pct', headerName: 'Protein %', minWidth: 85, flex: 0.6, editable: true,
      valueFormatter: p => p.value != null ? p.value.toFixed(2) : '—',
    },
    {
      field: 'moisture_pct', headerName: 'Mst %', minWidth: 75, flex: 0.5, editable: true,
      valueFormatter: p => p.value != null ? p.value.toFixed(2) : '—',
    },
    {
      field: 'dockage_pct', headerName: 'Dkg %', minWidth: 75, flex: 0.5, editable: true,
      valueFormatter: p => p.value != null ? p.value.toFixed(2) : '—',
    },
    {
      field: 'test_weight', headerName: 'TWT', minWidth: 70, flex: 0.5, editable: true,
      valueFormatter: p => p.value != null ? p.value.toFixed(1) : '—',
    },
    { field: 'frost', headerName: 'Frost', minWidth: 70, flex: 0.5, editable: true },
    { field: 'origin', headerName: 'Origin', minWidth: 70, flex: 0.4, hide: true },
    { field: 'colour', headerName: 'Colour', minWidth: 70, flex: 0.4, hide: true, editable: true },
    {
      field: 'falling_number', headerName: 'FN', minWidth: 65, flex: 0.4, hide: true, editable: true,
      valueFormatter: p => p.value != null ? p.value.toFixed(0) : '—',
    },
    {
      field: 'fusarium_pct', headerName: 'FUS %', minWidth: 70, flex: 0.4, hide: true, editable: true,
      valueFormatter: p => p.value != null ? p.value.toFixed(2) : '—',
    },
    {
      field: 'bushels', headerName: 'Grade Bu', minWidth: 80, flex: 0.5, hide: true,
      valueFormatter: p => p.value != null ? p.value.toLocaleString() : '—',
    },
    {
      field: 'status', headerName: 'Status', minWidth: 90, flex: 0.6,
      cellRenderer: ({ value }) => {
        const colorMap = { available: 'success', shipped: 'info', emptied: 'default' };
        return <Chip label={value || 'available'} color={colorMap[value] || 'default'} size="small" variant="outlined" />;
      },
    },
  ], []);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    filter: true,
  }), []);

  // Summary stats
  const stats = useMemo(() => {
    const byLoc = {};
    const byCom = {};
    for (const g of grades) {
      byLoc[g.location_name] = (byLoc[g.location_name] || 0) + 1;
      if (g.commodity_name) byCom[g.commodity_name] = (byCom[g.commodity_name] || 0) + 1;
    }
    return { byLoc, byCom, total: grades.length };
  }, [grades]);

  // Import handlers
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError(null);
    setImportPreview(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post(`/api/farms/${currentFarm.id}/inventory/grades/import`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportPreview(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to parse grading file'));
    } finally {
      setImporting(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview) return;
    setConfirming(true);
    setError(null);
    try {
      await api.post(`/api/farms/${currentFarm.id}/inventory/grades/import/confirm`, {
        grades: importPreview.matched,
        crop_year: importPreview.crop_year,
      });
      setImportOpen(false);
      setImportPreview(null);
      loadGrades();
      // Refresh crop years
      const yearRes = await api.get(`/api/farms/${currentFarm.id}/inventory/grades/crop-years`);
      setCropYears(yearRes.data.crop_years || []);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to import grades'));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>Bin Grading</Typography>
        <Stack direction="row" spacing={2} alignItems="center">
          {currentFarm && <GradingExportButtons farmId={currentFarm.id} filters={filters} />}
          <Button
            variant="contained"
            startIcon={<UploadFileIcon />}
            onClick={() => setImportOpen(true)}
          >
            Import Grading Sheet
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* Summary chips */}
      {grades.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 0.5 }}>
          <Chip label={`${stats.total} grades`} size="small" />
          {Object.entries(stats.byLoc).map(([loc, count]) => (
            <Chip key={loc} label={`${loc}: ${count}`} size="small" variant="outlined" />
          ))}
        </Stack>
      )}

      {/* Filters */}
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Location</InputLabel>
          <Select value={filters.location} label="Location" onChange={e => setFilters(f => ({ ...f, location: e.target.value }))}>
            <MenuItem value="">All</MenuItem>
            {locations.map(l => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Commodity</InputLabel>
          <Select value={filters.commodity} label="Commodity" onChange={e => setFilters(f => ({ ...f, commodity: e.target.value }))}>
            <MenuItem value="">All</MenuItem>
            {commodities.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Crop Year</InputLabel>
          <Select value={filters.crop_year} label="Crop Year" onChange={e => setFilters(f => ({ ...f, crop_year: e.target.value }))}>
            <MenuItem value="">All</MenuItem>
            {cropYears.map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
          </Select>
        </FormControl>
      </Stack>

      {/* ag-Grid */}
      <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 600, width: '100%' }}>
        <AgGridReact
          ref={gridRef}
          rowData={grades}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          getRowId={p => p.data?.id}
          onCellValueChanged={handleCellEdit}
        />
      </Box>

      {/* Import Dialog */}
      <Dialog open={importOpen} onClose={() => { setImportOpen(false); setImportPreview(null); }} maxWidth="lg" fullWidth>
        <DialogTitle>Import Grading Sheet</DialogTitle>
        <DialogContent dividers>
          {!importPreview && !importing && (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="body1" gutterBottom>
                Upload a grading spreadsheet (.xlsb or .xlsx) — supports both Grain Index and EFU formats.
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                The file will be parsed and matched against your bin inventory. You can review matches before confirming.
              </Typography>
              <Button variant="outlined" component="label" sx={{ mt: 2 }}>
                Select File
                <input type="file" hidden accept=".xlsb,.xlsx,.xls" onChange={handleFileUpload} />
              </Button>
            </Box>
          )}

          {importing && (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <CircularProgress sx={{ mb: 2 }} />
              <Typography>Parsing grading file...</Typography>
            </Box>
          )}

          {importPreview && (
            <>
              {/* Summary */}
              <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                <Chip
                  icon={<CheckCircleIcon />}
                  label={`${importPreview.matched.length} matched`}
                  color="success"
                  variant="outlined"
                />
                {importPreview.unmatched.length > 0 && (
                  <Chip
                    icon={<WarningIcon />}
                    label={`${importPreview.unmatched.length} unmatched`}
                    color="warning"
                    variant="outlined"
                  />
                )}
                <Chip label={`${importPreview.match_rate}% match rate`} size="small" />
                <Chip label={`Crop Year: ${importPreview.crop_year}`} size="small" color="info" variant="outlined" />
              </Stack>

              {/* Matched entries table */}
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Matched Entries ({importPreview.matched.length})</Typography>
              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300, mb: 2 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Location</TableCell>
                      <TableCell>Bin #</TableCell>
                      <TableCell>EFU Reference</TableCell>
                      <TableCell>Commodity</TableCell>
                      <TableCell>Grade</TableCell>
                      <TableCell>Prot %</TableCell>
                      <TableCell>Mst %</TableCell>
                      <TableCell>Dkg %</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {importPreview.matched.map((g, i) => (
                      <TableRow key={i}>
                        <TableCell>{g.location_name}</TableCell>
                        <TableCell>{g.bin_number}</TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
                            {g.efu_bin_field}
                          </Typography>
                        </TableCell>
                        <TableCell>{g.commodity}</TableCell>
                        <TableCell>{g.grade}</TableCell>
                        <TableCell>{g.protein_pct != null ? g.protein_pct.toFixed(1) : '—'}</TableCell>
                        <TableCell>{g.moisture_pct != null ? g.moisture_pct.toFixed(1) : '—'}</TableCell>
                        <TableCell>{g.dockage_pct != null ? g.dockage_pct.toFixed(2) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              {/* Unmatched entries */}
              {importPreview.unmatched.length > 0 && (
                <>
                  <Typography variant="subtitle2" color="warning.main" sx={{ mb: 1 }}>
                    Unmatched Entries ({importPreview.unmatched.length}) — will be skipped
                  </Typography>
                  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 200 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>EFU Reference</TableCell>
                          <TableCell>Commodity</TableCell>
                          <TableCell>Grade</TableCell>
                          <TableCell>Inferred Location</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {importPreview.unmatched.map((g, i) => (
                          <TableRow key={i}>
                            <TableCell>{g.efu_bin_field}</TableCell>
                            <TableCell>{g.commodity}</TableCell>
                            <TableCell>{g.grade}</TableCell>
                            <TableCell>{g.location_name || '???'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          {importPreview && (
            <Button
              variant="contained"
              onClick={handleConfirmImport}
              disabled={confirming || !importPreview.matched.length}
            >
              {confirming ? 'Importing...' : `Import ${importPreview.matched.length} Grades`}
            </Button>
          )}
          <Button onClick={() => { setImportOpen(false); setImportPreview(null); }}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
