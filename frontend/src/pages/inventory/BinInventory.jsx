import { useState, useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { Box, Stack, FormControl, InputLabel, Select, MenuItem, Typography, Chip } from '@mui/material';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import { getGridColors } from '../../utils/gridColors';
import api from '../../services/api';

function StatusCell({ value }) {
  const colorMap = { active: 'success', empty: 'default', committed: 'warning', transit: 'info' };
  return <Chip label={value || 'empty'} color={colorMap[value] || 'default'} size="small" variant="outlined" />;
}

export default function BinInventory() {
  const { currentFarm } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const colors = useMemo(() => getGridColors(mode), [mode]);

  const [bins, setBins] = useState([]);
  const [locations, setLocations] = useState([]);
  const [commodities, setCommodities] = useState([]);
  const [filters, setFilters] = useState({ location: '', commodity: '', status: '' });

  useEffect(() => {
    if (!currentFarm) return;
    Promise.all([
      api.get(`/api/farms/${currentFarm.id}/inventory/locations`),
      api.get(`/api/farms/${currentFarm.id}/inventory/commodities`),
    ]).then(([locRes, comRes]) => {
      setLocations(locRes.data.locations || []);
      setCommodities(comRes.data.commodities || []);
    });
  }, [currentFarm]);

  useEffect(() => {
    if (!currentFarm) return;
    const params = new URLSearchParams();
    if (filters.location) params.set('location', filters.location);
    if (filters.commodity) params.set('commodity', filters.commodity);
    if (filters.status) params.set('status', filters.status);
    api.get(`/api/farms/${currentFarm.id}/inventory/bins?${params}`)
      .then(res => setBins(res.data.bins || []));
  }, [currentFarm, filters]);

  const columnDefs = useMemo(() => [
    { field: 'location_name', headerName: 'Location', rowGroup: true, hide: true },
    { field: 'bin_number', headerName: 'Bin #', width: 100 },
    { field: 'bin_type', headerName: 'Type', width: 100 },
    { field: 'capacity_bu', headerName: 'Capacity (bu)', width: 130, valueFormatter: p => p.value ? p.value.toLocaleString() : '-' },
    { field: 'commodity_name', headerName: 'Commodity', width: 150 },
    { field: 'bushels', headerName: 'Bushels', width: 120, valueFormatter: p => p.value ? p.value.toLocaleString() : '0' },
    { field: 'kg', headerName: 'KG', width: 120, valueFormatter: p => p.value ? p.value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '0' },
    { field: 'crop_year', headerName: 'Crop Year', width: 100 },
    { field: 'status', headerName: 'Status', width: 110, cellRenderer: StatusCell },
    { field: 'notes', headerName: 'Notes', flex: 1, minWidth: 150 },
  ], []);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    filter: true,
  }), []);

  const autoGroupColumnDef = useMemo(() => ({
    headerName: 'Location',
    minWidth: 200,
    cellRendererParams: { suppressCount: false },
  }), []);

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>Bin Inventory</Typography>

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
          autoGroupColumnDef={autoGroupColumnDef}
          groupDefaultExpanded={1}
          animateRows
          getRowId={p => p.data?.id}
        />
      </Box>
    </Box>
  );
}
