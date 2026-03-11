import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Typography, Alert, Chip, Paper, Skeleton } from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import TabPanel from '../../components/shared/TabPanel';
import { Tabs, Tab } from '@mui/material';
import WarehouseIcon from '@mui/icons-material/Warehouse';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';

function BinHeader({ bin }) {
  const fmtKg = kg => kg != null ? `${kg.toLocaleString('en-CA')} kg` : '—';
  return (
    <Paper sx={{ p: 2, mb: 2, display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
      <Box>
        <Typography variant="h6" fontWeight={700}>{bin.name}</Typography>
        <Chip label={bin.current_product_label || 'Empty'} color="primary" variant="outlined" size="small" />
      </Box>
      <Box>
        <Typography variant="caption" color="text.secondary">Balance</Typography>
        <Typography variant="h5" fontWeight={700}>{fmtKg(bin.balance_kg)}</Typography>
      </Box>
      {(bin.c2_balance_kg > 0 || bin.non_c2_balance_kg > 0) && (
        <>
          <Box>
            <Typography variant="caption" color="text.secondary">C2 Farms</Typography>
            <Typography variant="body1" fontWeight={600}>{fmtKg(bin.c2_balance_kg)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Non-C2</Typography>
            <Typography variant="body1" fontWeight={600}>{fmtKg(bin.non_c2_balance_kg)}</Typography>
          </Box>
        </>
      )}
      {bin.capacity_kg && (
        <Box>
          <Typography variant="caption" color="text.secondary">Capacity</Typography>
          <Typography variant="body1">{fmtKg(bin.capacity_kg)} ({((bin.balance_kg / bin.capacity_kg) * 100).toFixed(0)}%)</Typography>
        </Box>
      )}
    </Paper>
  );
}

function BinLedger({ farmId, bin }) {
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!farmId || !bin?.id) return;
    try {
      setLoading(true);
      const res = await api.get(`/api/farms/${farmId}/terminal/bins/${bin.id}/ledger`, { params: { limit: 500 } });
      setRows(res.data.tickets || []);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load bin ledger'));
    } finally {
      setLoading(false);
    }
  }, [farmId, bin?.id]);

  useEffect(() => { load(); }, [load]);

  const columnDefs = useMemo(() => [
    { field: 'ticket_date', headerName: 'Date', width: 110, valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString('en-CA') : '' },
    { field: 'grower_name', headerName: 'Grower Name', width: 200, valueGetter: p => p.data.grower_name || p.data.sold_to || '' },
    { field: 'product', headerName: 'Crop', width: 90 },
    {
      field: 'weight_kg', headerName: 'In', width: 95, type: 'numericColumn',
      valueGetter: p => p.data.direction === 'inbound' ? p.data.weight_kg : null,
      valueFormatter: p => p.value ? p.value.toLocaleString('en-CA') : '',
      cellStyle: { color: '#2e7d32' },
    },
    { field: 'fmo_number', headerName: 'FMO', width: 90 },
    { field: 'ticket_number', headerName: 'Ticket#', width: 80, type: 'numericColumn' },
    { field: 'dockage_pct', headerName: 'Dock%', width: 70, type: 'numericColumn' },
    { field: 'moisture_pct', headerName: 'Moist%', width: 75, type: 'numericColumn' },
    { field: 'test_weight', headerName: 'TW', width: 60, type: 'numericColumn' },
    { field: 'protein_pct', headerName: 'Prot%', width: 70, type: 'numericColumn' },
    { field: 'hvk_pct', headerName: 'HVK%', width: 70, type: 'numericColumn' },
    {
      field: 'rail_car_number', headerName: 'Car/Truck#', width: 120,
      valueGetter: p => p.data.rail_car_number || p.data.vehicle_id || '',
    },
    {
      headerName: 'Out', width: 95, type: 'numericColumn',
      valueGetter: p => p.data.direction === 'outbound' ? (p.data.outbound_kg || p.data.weight_kg) : null,
      valueFormatter: p => p.value ? p.value.toLocaleString('en-CA') : '',
      cellStyle: { color: '#d32f2f' },
    },
    {
      headerName: 'Balance KG', width: 120, type: 'numericColumn',
      valueGetter: p => p.data.running_balance_kg ?? p.data.balance_after_kg,
      valueFormatter: p => p.value != null ? p.value.toLocaleString('en-CA') : '',
      cellStyle: { fontWeight: 700 },
    },
  ], []);

  const defaultColDef = useMemo(() => ({
    sortable: true, filter: true, resizable: true,
  }), []);

  return (
    <Box>
      <BinHeader bin={bin} />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 'calc(100vh - 370px)', width: '100%' }}>
        <AgGridReact
          ref={gridRef}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          getRowId={p => p.data.id}
          loading={loading}
        />
      </Box>
    </Box>
  );
}

export default function TerminalBins() {
  const { currentFarm } = useFarm();
  const [bins, setBins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);

  const farmId = currentFarm?.id;

  useEffect(() => {
    if (!farmId) return;
    api.get(`/api/farms/${farmId}/terminal/bins`).then(res => {
      setBins(res.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [farmId]);

  if (loading) return <Skeleton variant="rounded" height={400} />;
  if (!bins.length) return <Alert severity="info">No bins configured. Seed LGX terminal data to get started.</Alert>;

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>Bin Inventory Ledger</Typography>
      <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2 }}>
        {bins.map(b => (
          <Tab key={b.id} label={`${b.name} (${b.current_product_label || 'Empty'})`} icon={<WarehouseIcon />} iconPosition="start" />
        ))}
      </Tabs>
      {bins.map((bin, idx) => (
        <TabPanel key={bin.id} value={activeTab} index={idx}>
          <BinLedger farmId={farmId} bin={bin} />
        </TabPanel>
      ))}
    </Box>
  );
}
