import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Stack, FormControl, InputLabel, Select, MenuItem,
  Button, LinearProgress, Alert, Snackbar, IconButton,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import SendIcon from '@mui/icons-material/Send';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import { getGridColors } from '../../utils/gridColors';
import api from '../../services/api';

function CopyLastRenderer({ data, context }) {
  if (!data) return null;
  return (
    <IconButton size="small" onClick={() => context.onCopyLast(data.id)} title="Copy last count">
      <ContentCopyIcon fontSize="small" />
    </IconButton>
  );
}

export default function FarmManagerView() {
  const { currentFarm, canEdit } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const colors = useMemo(() => getGridColors(mode), [mode]);

  const [locations, setLocations] = useState([]);
  const [commodities, setCommodities] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [period, setPeriod] = useState(null);
  const [rowData, setRowData] = useState([]);
  const [lastCounts, setLastCounts] = useState({});
  const [dirtyBinIds, setDirtyBinIds] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'info' });

  // Fetch locations, commodities, periods on mount
  useEffect(() => {
    if (!currentFarm) return;
    Promise.all([
      api.get(`/api/farms/${currentFarm.id}/inventory/locations`),
      api.get(`/api/farms/${currentFarm.id}/inventory/commodities`),
      api.get(`/api/farms/${currentFarm.id}/inventory/count-periods`),
    ]).then(([locRes, comRes, perRes]) => {
      setLocations(locRes.data.locations || []);
      setCommodities(comRes.data.commodities || []);
      const periods = perRes.data.periods || [];
      const openPeriod = periods.find(p => p.status === 'open') || periods[0];
      setPeriod(openPeriod || null);
    });
  }, [currentFarm]);

  // Commodity lookups
  const commodityNameToId = useMemo(() => {
    const map = {};
    for (const c of commodities) map[c.name] = c.id;
    return map;
  }, [commodities]);

  const commodityNames = useMemo(() => ['', ...commodities.map(c => c.name)], [commodities]);

  // Fetch bins (all locations when selectedLocation is '')
  const fetchBins = useCallback(() => {
    if (!currentFarm) return;
    const params = new URLSearchParams();
    if (selectedLocation) params.set('location', selectedLocation);
    if (period) params.set('periodId', period.id);
    api.get(`/api/farms/${currentFarm.id}/inventory/bins?${params}`)
      .then(res => {
        const bins = res.data.bins || [];
        const rows = bins.map(b => ({
          id: b.id,
          location_id: b.location_id,
          location_name: b.location_name,
          bin_number: b.bin_number,
          bin_type: b.bin_type,
          capacity_bu: b.capacity_bu,
          commodity_id: b.commodity_id || null,
          commodity_name: b.commodity_name || '',
          bushels: b.bushels || 0,
          crop_year: b.crop_year || null,
        }));
        setRowData(rows);
        const snapshot = {};
        for (const r of rows) snapshot[r.id] = { ...r };
        setLastCounts(snapshot);
        setDirtyBinIds(new Set());
      });
  }, [currentFarm, selectedLocation, period]);

  useEffect(() => { fetchBins(); }, [fetchBins]);

  // Cell edit handler
  const onCellValueChanged = useCallback((params) => {
    if (!params.data) return;
    const { data, colDef } = params;
    if (colDef.field === 'commodity_name') {
      data.commodity_id = commodityNameToId[data.commodity_name] || null;
    }
    setDirtyBinIds(prev => new Set(prev).add(data.id));
    setRowData(prev => [...prev]);
  }, [commodityNameToId]);

  // Copy Last — restore row to its initial loaded values
  const onCopyLast = useCallback((binId) => {
    const last = lastCounts[binId];
    if (!last) return;
    setRowData(prev => prev.map(row =>
      row.id === binId
        ? { ...row, commodity_id: last.commodity_id, commodity_name: last.commodity_name, bushels: last.bushels, crop_year: last.crop_year }
        : row
    ));
    setDirtyBinIds(prev => new Set(prev).add(binId));
  }, [lastCounts]);

  // Progress
  const countedBins = rowData.filter(r => r.bushels > 0).length;
  const totalBins = rowData.length;
  const progress = totalBins > 0 ? (countedBins / totalBins) * 100 : 0;

  // Column definitions
  const columnDefs = useMemo(() => [
    { field: 'location_name', headerName: 'Location', rowGroup: true, hide: true },
    { field: 'bin_number', headerName: 'Bin #', width: 100, sort: 'asc' },
    { field: 'bin_type', headerName: 'Type', width: 100 },
    {
      field: 'capacity_bu', headerName: 'Capacity (bu)', width: 130,
      valueFormatter: p => p.value ? p.value.toLocaleString() : '-',
    },
    {
      field: 'commodity_name', headerName: 'Commodity', width: 160,
      editable: canEdit,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: commodityNames },
    },
    {
      field: 'bushels', headerName: 'Bushels', width: 120,
      editable: canEdit,
      valueParser: p => parseFloat(p.newValue) || 0,
      valueFormatter: p => p.value ? p.value.toLocaleString() : '0',
      cellStyle: { backgroundColor: colors.actualCell },
    },
    {
      field: 'crop_year', headerName: 'Crop Year', width: 110,
      editable: canEdit,
      valueParser: p => p.newValue ? parseInt(p.newValue) : null,
    },
    {
      headerName: '', width: 60,
      cellRenderer: CopyLastRenderer,
      sortable: false, filter: false, suppressNavigable: true,
    },
  ], [canEdit, commodityNames, colors]);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    suppressMovable: true,
  }), []);

  const autoGroupColumnDef = useMemo(() => ({
    headerName: 'Location',
    minWidth: 200,
    cellRendererParams: { suppressCount: false },
  }), []);

  // Save / Submit
  const handleSave = async (submit = false) => {
    if (!currentFarm || !period) return;
    setSaving(true);
    try {
      // Create submissions for each unique location
      const locationIds = [...new Set(rowData.map(r => r.location_id))];
      await Promise.all(locationIds.map(locId =>
        api.post(`/api/farms/${currentFarm.id}/inventory/submissions`, {
          count_period_id: period.id,
          location_id: locId,
        })
      ));

      // Bulk upsert counts
      const countsArray = rowData.map(r => ({
        bin_id: r.id,
        commodity_id: r.commodity_id || null,
        bushels: parseFloat(r.bushels) || 0,
        crop_year: r.crop_year ? parseInt(r.crop_year) : null,
        notes: null,
      }));

      await api.post(`/api/farms/${currentFarm.id}/inventory/bin-counts/${period.id}`, { counts: countsArray });

      setSnack({
        open: true,
        message: submit ? 'Count submitted for approval!' : 'Draft saved!',
        severity: 'success',
      });
      setDirtyBinIds(new Set());
      fetchBins();
    } catch (err) {
      setSnack({ open: true, message: err.response?.data?.error || 'Failed to save', severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    return <Alert severity="info">Bin counting is only available to managers and admins.</Alert>;
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>Farm Manager - Bin Count</Typography>

      {period && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Count Period: {new Date(period.period_date).toLocaleDateString('en-CA')} ({period.status})
        </Alert>
      )}

      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Location</InputLabel>
          <Select value={selectedLocation} label="Location" onChange={e => setSelectedLocation(e.target.value)}>
            <MenuItem value="">All Locations</MenuItem>
            {locations.map(l => (
              <MenuItem key={l.id} value={l.id}>{l.name} ({l._count?.bins || 0} bins)</MenuItem>
            ))}
          </Select>
        </FormControl>

        <Box sx={{ flex: 1, maxWidth: 300 }}>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="body2">{countedBins} / {totalBins} bins counted</Typography>
            <Typography variant="body2">{progress.toFixed(0)}%</Typography>
          </Stack>
          <LinearProgress variant="determinate" value={progress} sx={{ height: 8, borderRadius: 4 }} />
        </Box>
      </Stack>

      <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 600, width: '100%' }}>
        <AgGridReact
          ref={gridRef}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          autoGroupColumnDef={autoGroupColumnDef}
          groupDefaultExpanded={1}
          animateRows
          getRowId={p => p.data?.id}
          context={{ onCopyLast }}
          onCellValueChanged={onCellValueChanged}
          singleClickEdit
          enterNavigatesAfterEdit
          stopEditingWhenCellsLoseFocus
        />
      </Box>

      <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
        <Button variant="outlined" startIcon={<SaveIcon />} onClick={() => handleSave(false)} disabled={saving}>
          Save Draft
        </Button>
        <Button variant="contained" startIcon={<SendIcon />} onClick={() => handleSave(true)} disabled={saving}>
          Submit for Approval
        </Button>
      </Stack>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack(s => ({ ...s, open: false }))}>
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
