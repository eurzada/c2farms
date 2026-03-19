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

  // Extract unique quality_json keys across all grades
  const qualityKeys = useMemo(() => {
    const keys = new Set();
    for (const g of grades) {
      if (g.quality_json && typeof g.quality_json === 'object') {
        Object.keys(g.quality_json).forEach(k => keys.add(k));
      }
    }
    return [...keys].sort();
  }, [grades]);

  // Dynamic column defs from quality_json keys
  const qualityColDefs = useMemo(() => qualityKeys.map(key => ({
    field: `quality_json.${key}`,
    headerName: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    valueGetter: p => p.data?.quality_json?.[key] ?? null,
    valueFormatter: p => {
      if (p.value == null) return '—';
      return typeof p.value === 'number' ? p.value.toFixed(2) : String(p.value);
    },
  })), [qualityKeys]);

  // Location names for summary table
  const locationNames = useMemo(() => {
    const locs = new Set(grades.map(g => g.location_name).filter(Boolean));
    return [...locs].sort();
  }, [grades]);

  // Grade summary grouped by commodity x grade
  const gradeSummary = useMemo(() => {
    const groups = {};
    for (const g of grades) {
      const key = `${g.commodity_name || 'Unknown'}|${g.grade_short || g.grade || 'Ungraded'}`;
      if (!groups[key]) {
        groups[key] = {
          commodity: g.commodity_name || 'Unknown',
          grade: g.grade_short || g.grade || 'Ungraded',
          total_mt: 0,
          bin_count: 0,
          by_location: {},
          proteins: [],
        };
      }
      groups[key].total_mt += g.inv_mt || 0;
      groups[key].bin_count++;
      const loc = g.location_name || 'Unknown';
      groups[key].by_location[loc] = (groups[key].by_location[loc] || 0) + (g.inv_mt || 0);
      if (g.protein_pct != null) groups[key].proteins.push(g.protein_pct);
    }
    return Object.values(groups)
      .map(g => ({
        ...g,
        avg_protein: g.proteins.length > 0 ? g.proteins.reduce((s, v) => s + v, 0) / g.proteins.length : null,
      }))
      .sort((a, b) => a.commodity.localeCompare(b.commodity) || a.grade.localeCompare(b.grade));
  }, [grades]);

  const columnDefs = useMemo(() => [
    { field: 'location_name', headerName: 'Location' },
    {
      field: 'bin_number', headerName: 'Bin #',
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
    { field: 'commodity_name', headerName: 'Commodity' },
    {
      field: 'inv_crop_year', headerName: 'Crop Year',
      valueFormatter: p => p.value != null ? String(p.value) : '—',
    },
    {
      field: 'inv_bushels', headerName: 'Inv Bu',
      valueFormatter: p => p.value != null ? Math.round(p.value).toLocaleString() : '—',
    },
    {
      field: 'inv_mt', headerName: 'Inv MT',
      valueFormatter: p => p.value != null ? p.value.toFixed(1) : '—',
    },
    { field: 'grade', headerName: 'Grade', editable: true },
    { field: 'variety', headerName: 'Variety', editable: true },
    { field: 'grade_reason', headerName: 'Reason', editable: true },
    {
      field: 'protein_pct', headerName: 'Protein %', editable: true,
      valueFormatter: p => p.value != null ? p.value.toFixed(2) : '—',
    },
    {
      field: 'moisture_pct', headerName: 'Mst %', editable: true,
      valueFormatter: p => p.value != null ? p.value.toFixed(2) : '—',
    },
    {
      field: 'dockage_pct', headerName: 'Dkg %', editable: true,
      valueFormatter: p => p.value != null ? p.value.toFixed(2) : '—',
    },
    {
      field: 'test_weight', headerName: 'TWT', editable: true,
      valueFormatter: p => p.value != null ? p.value.toFixed(1) : '—',
    },
    { field: 'frost', headerName: 'Frost', editable: true },
    { field: 'origin', headerName: 'Origin' },
    { field: 'colour', headerName: 'Colour', editable: true },
    {
      field: 'falling_number', headerName: 'FN', editable: true,
      valueFormatter: p => p.value != null ? p.value.toFixed(0) : '—',
    },
    {
      field: 'fusarium_pct', headerName: 'FUS %', editable: true,
      valueFormatter: p => p.value != null ? p.value.toFixed(2) : '—',
    },
    {
      field: 'bushels', headerName: 'Grade Bu',
      valueFormatter: p => p.value != null ? p.value.toLocaleString() : '—',
    },
    ...qualityColDefs,
    {
      field: 'status', headerName: 'Status',
      cellRenderer: ({ value }) => {
        const colorMap = { available: 'success', shipped: 'info', emptied: 'default' };
        return <Chip label={value || 'available'} color={colorMap[value] || 'default'} size="small" variant="outlined" />;
      },
    },
  ], [qualityColDefs]);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    filter: true,
    headerClass: 'grading-small-header',
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
      <Box
        className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'}
        sx={{
          height: 600, width: '100%',
          '& .grading-small-header .ag-header-cell-text': { fontSize: '0.7rem' },
        }}
      >
        <AgGridReact
          ref={gridRef}
          rowData={grades}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          getRowId={p => p.data?.id}
          onCellValueChanged={handleCellEdit}
          onFirstDataRendered={({ api }) => api.autoSizeAllColumns()}
        />
      </Box>

      {/* Summary by Grade */}
      {gradeSummary.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>Summary by Grade</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Commodity</TableCell>
                  <TableCell>Grade</TableCell>
                  <TableCell align="right">Bins</TableCell>
                  <TableCell align="right">Total MT</TableCell>
                  <TableCell align="right">Avg Protein</TableCell>
                  {locationNames.map(loc => (
                    <TableCell key={loc} align="right">{loc}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {gradeSummary.map((row, i) => (
                  <TableRow key={i} hover>
                    <TableCell>{row.commodity}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{row.grade}</TableCell>
                    <TableCell align="right">{row.bin_count}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{row.total_mt.toFixed(1)}</TableCell>
                    <TableCell align="right">{row.avg_protein != null ? row.avg_protein.toFixed(2) + '%' : '—'}</TableCell>
                    {locationNames.map(loc => (
                      <TableCell key={loc} align="right">
                        {row.by_location[loc] ? row.by_location[loc].toFixed(1) : '—'}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

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
