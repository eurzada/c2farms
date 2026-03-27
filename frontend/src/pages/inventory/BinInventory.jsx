import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { Box, Stack, FormControl, InputLabel, Select, MenuItem, Typography, Chip, Snackbar, Alert } from '@mui/material';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import { getGridColors } from '../../utils/gridColors';
import api from '../../services/api';
import InventoryExportButtons from '../../components/inventory/InventoryExportButtons';
import useGridState from '../../hooks/useGridState.js';

const PURPOSE_OPTIONS = ['market', 'seed', 'feed', 'reserved', 'consumption'];

function StatusCell({ value }) {
  const colorMap = { active: 'success', empty: 'default', committed: 'warning', transit: 'info' };
  return <Chip label={value || 'empty'} color={colorMap[value] || 'default'} size="small" variant="outlined" />;
}

export default function BinInventory() {
  const { currentFarm, isEnterprise } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const { onGridReady, onStateChanged } = useGridState('c2_inventory_bins_grid');
  const colors = useMemo(() => getGridColors(mode), [mode]);

  const [bins, setBins] = useState([]);
  const [locations, setLocations] = useState([]);
  const [commodities, setCommodities] = useState([]);
  const [filters, setFilters] = useState({ location: '', commodity: '', status: '' });
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'success' });

  useEffect(() => {
    if (!currentFarm) return;
    const eq = isEnterprise ? '?enterprise=true' : '';
    Promise.all([
      api.get(`/api/farms/${currentFarm.id}/inventory/locations${eq}`),
      api.get(`/api/farms/${currentFarm.id}/inventory/commodities`),
    ]).then(([locRes, comRes]) => {
      setLocations(locRes.data.locations || []);
      setCommodities(comRes.data.commodities || []);
    });
  }, [currentFarm, isEnterprise]);

  useEffect(() => {
    if (!currentFarm) return;
    const params = new URLSearchParams();
    if (isEnterprise) params.set('enterprise', 'true');
    if (filters.location) params.set('location', filters.location);
    if (filters.commodity) params.set('commodity', filters.commodity);
    if (filters.status) params.set('status', filters.status);
    api.get(`/api/farms/${currentFarm.id}/inventory/bins?${params}`)
      .then(res => setBins(res.data.bins || []));
  }, [currentFarm, filters, isEnterprise]);

  const columnDefs = useMemo(() => [
    { field: 'location_name', headerName: 'Location', minWidth: 110, flex: 1.2 },
    { field: 'bin_number', headerName: 'Bin #', minWidth: 70, flex: 0.6, comparator: (a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      if (!isNaN(numA)) return -1;
      if (!isNaN(numB)) return 1;
      return String(a).localeCompare(String(b));
    }, sort: 'asc' },
    { field: 'bin_type', headerName: 'Type', minWidth: 80, flex: 0.7 },
    { field: 'capacity_bu', headerName: 'Capacity (bu)', minWidth: 100, flex: 1, valueFormatter: p => p.value ? p.value.toLocaleString() : '-' },
    { field: 'commodity_name', headerName: 'Commodity', minWidth: 110, flex: 1.2 },
    { field: 'bushels', headerName: 'Bushels', minWidth: 90, flex: 0.9, valueFormatter: p => p.value ? p.value.toLocaleString() : '0' },
    { field: 'kg', headerName: 'KG', minWidth: 90, flex: 0.9, valueFormatter: p => p.value ? p.value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '0' },
    { field: 'crop_year', headerName: 'Crop Year', minWidth: 80, flex: 0.7 },
    { field: 'status', headerName: 'Status', minWidth: 90, flex: 0.8, cellRenderer: StatusCell },
    { field: 'notes', headerName: 'Notes', minWidth: 120, flex: 1.5 },
    {
      field: 'purpose', headerName: 'Purpose', minWidth: 120, flex: 0.9,
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: PURPOSE_OPTIONS },
      cellRenderer: ({ value }) => {
        const colorMap = { market: 'success', seed: 'info', feed: 'warning', reserved: 'error', consumption: 'default' };
        const label = (value || 'market').charAt(0).toUpperCase() + (value || 'market').slice(1);
        return <Chip label={label} color={colorMap[value] || 'default'} size="small" variant="outlined" />;
      },
    },
  ], []);

  const handleCellEdit = useCallback(async (params) => {
    const { data, colDef, newValue } = params;
    if (colDef.field !== 'purpose') return;
    try {
      await api.put(`/api/farms/${currentFarm.id}/inventory/bins/${data.id}`, { purpose: newValue });
      setSnack({ open: true, message: `Bin ${data.bin_number} set to "${newValue}"`, severity: 'success' });
    } catch {
      setSnack({ open: true, message: 'Failed to update bin purpose', severity: 'error' });
      // Reload to revert
      const params2 = new URLSearchParams();
      if (isEnterprise) params2.set('enterprise', 'true');
      if (filters.location) params2.set('location', filters.location);
      if (filters.commodity) params2.set('commodity', filters.commodity);
      if (filters.status) params2.set('status', filters.status);
      api.get(`/api/farms/${currentFarm.id}/inventory/bins?${params2}`)
        .then(res => setBins(res.data.bins || []));
    }
  }, [currentFarm, isEnterprise, filters]);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    filter: true,
  }), []);


  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>Bin Inventory</Typography>
        <InventoryExportButtons farmId={currentFarm?.id} filters={filters} />
      </Stack>

      {/* Filter toolbar */}
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
          <InputLabel>Status</InputLabel>
          <Select value={filters.status} label="Status" onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="empty">Empty</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      {/* ag-Grid */}
      <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 600, width: '100%' }}>
        <AgGridReact
          ref={gridRef}
          rowData={bins}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          singleClickEdit
          getRowId={p => p.data?.id}
          onCellValueChanged={handleCellEdit}
          onGridReady={onGridReady}
          onColumnResized={onStateChanged}
          onColumnMoved={onStateChanged}
          onSortChanged={onStateChanged}
          onColumnVisible={onStateChanged}
          getRowStyle={params => {
            if (params.data?.purpose && params.data.purpose !== 'market') {
              return { backgroundColor: mode === 'dark' ? 'rgba(255,152,0,0.08)' : 'rgba(255,152,0,0.06)' };
            }
            return null;
          }}
        />
      </Box>

      <Snackbar open={snack.open} autoHideDuration={3000} onClose={() => setSnack(s => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
