import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Box, Typography, Alert, Chip, Paper, Skeleton, Button, MenuItem, TextField, Snackbar,
  Dialog, DialogTitle, DialogContent, DialogActions, LinearProgress,
} from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import TabPanel from '../../components/shared/TabPanel';
import { Tabs, Tab } from '@mui/material';
import WarehouseIcon from '@mui/icons-material/Warehouse';
import AssignmentIcon from '@mui/icons-material/Assignment';
import MoveToInboxIcon from '@mui/icons-material/MoveToInbox';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';

const fmtKg = kg => kg != null ? `${kg.toLocaleString('en-CA')} kg` : '—';

function BinHeader({ bin }) {
  return (
    <Paper sx={{ p: 2, mb: 2, display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
      <Box>
        <Typography variant="h6" fontWeight={700}>Bin {bin.bin_number}</Typography>
        <Typography variant="body2" color="text.secondary">{bin.name}</Typography>
      </Box>
      <Chip
        label={bin.current_product_label || 'Empty'}
        color={bin.current_product_label ? 'primary' : 'default'}
        variant="outlined"
        size="small"
      />
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

function AllocateTicketsDialog({ open, onClose, farmId, bin, onAllocated }) {
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allocating, setAllocating] = useState(false);
  const [error, setError] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);

  useEffect(() => {
    if (!open || !farmId) return;
    setLoading(true);
    setError(null);
    api.get(`/api/farms/${farmId}/terminal/tickets/unallocated`)
      .then(res => setTickets(res.data.tickets || []))
      .catch(err => setError(extractErrorMessage(err, 'Failed to load unallocated tickets')))
      .finally(() => setLoading(false));
  }, [open, farmId]);

  const columnDefs = useMemo(() => [
    { headerCheckboxSelection: true, checkboxSelection: true, width: 50, pinned: 'left' },
    { field: 'ticket_date', headerName: 'Date', width: 110, valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString('en-CA') : '' },
    { field: 'ticket_number', headerName: 'Ticket#', width: 90, type: 'numericColumn' },
    { field: 'grower_name', headerName: 'Grower', width: 180 },
    { field: 'product', headerName: 'Product', width: 100 },
    { field: 'weight_kg', headerName: 'KG', width: 110, type: 'numericColumn', valueFormatter: p => p.value?.toLocaleString('en-CA') },
    {
      field: 'is_c2_farms', headerName: 'C2', width: 60,
      cellRenderer: p => p.value ? <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} /> : null,
    },
    { field: 'moisture_pct', headerName: 'Moist%', width: 80, type: 'numericColumn' },
    { field: 'scale_source', headerName: 'Source', width: 100 },
  ], []);

  const onSelectionChanged = useCallback(() => {
    const selected = gridRef.current?.api?.getSelectedRows() || [];
    setSelectedIds(selected.map(r => r.id));
  }, []);

  const handleAllocate = async () => {
    if (selectedIds.length === 0) return;
    try {
      setAllocating(true);
      await api.post(`/api/farms/${farmId}/terminal/bins/${bin.id}/allocate-tickets`, {
        ticket_ids: selectedIds,
      });
      onAllocated?.(selectedIds.length);
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to allocate tickets'));
    } finally {
      setAllocating(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>Allocate Unallocated Tickets to Bin {bin?.bin_number}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {allocating && <LinearProgress sx={{ mb: 2 }} />}
        {tickets.length === 0 && !loading ? (
          <Alert severity="info" sx={{ mt: 1 }}>No unallocated inbound tickets found.</Alert>
        ) : (
          <>
            {selectedIds.length > 0 && (
              <Chip label={`${selectedIds.length} selected`} color="primary" size="small" sx={{ mb: 1 }} />
            )}
            <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 400, width: '100%' }}>
              <AgGridReact
                ref={gridRef}
                rowData={tickets}
                columnDefs={columnDefs}
                defaultColDef={{ sortable: true, filter: true, resizable: true }}
                animateRows
                getRowId={p => p.data.id}
                loading={loading}
                rowSelection="multiple"
                suppressRowClickSelection
                onSelectionChanged={onSelectionChanged}
              />
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleAllocate} disabled={selectedIds.length === 0 || allocating}>
          Allocate {selectedIds.length || ''} to Bin {bin?.bin_number}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function BinLedger({ farmId, bin, contracts }) {
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [assignContractId, setAssignContractId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [snackbar, setSnackbar] = useState(null);
  const [allocateOpen, setAllocateOpen] = useState(false);

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
    {
      headerCheckboxSelection: true,
      checkboxSelection: p => p.data.direction === 'inbound',
      width: 50,
      pinned: 'left',
      suppressHeaderMenuButton: true,
    },
    { field: 'ticket_date', headerName: 'Date', width: 110, valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString('en-CA') : '' },
    {
      field: 'direction', headerName: 'Dir', width: 70,
      cellRenderer: p => (
        <Chip
          label={p.value === 'inbound' ? 'IN' : 'OUT'}
          size="small"
          color={p.value === 'inbound' ? 'success' : 'warning'}
          variant="outlined"
          sx={{ fontSize: '0.7rem', height: 20 }}
        />
      ),
    },
    { field: 'grower_name', headerName: 'Source / Buyer', width: 180, valueGetter: p => p.data.grower_name || p.data.sold_to || '' },
    { field: 'product', headerName: 'Crop', width: 90 },
    {
      field: 'weight_kg', headerName: 'Weight KG', width: 110, type: 'numericColumn',
      valueGetter: p => p.data.direction === 'inbound' ? p.data.weight_kg : (p.data.outbound_kg || p.data.weight_kg),
      valueFormatter: p => p.value ? p.value.toLocaleString('en-CA') : '',
    },
    { field: 'ticket_number', headerName: 'Ticket#', width: 80, type: 'numericColumn' },
    {
      headerName: 'Contract', width: 130,
      valueGetter: p => p.data.contract?.contract_number || '',
      cellRenderer: p => p.value ? (
        <Chip label={p.value} size="small" variant="outlined" color="info" sx={{ fontSize: '0.7rem', height: 20 }} />
      ) : null,
    },
    { field: 'fmo_number', headerName: 'FMO', width: 90 },
    { field: 'dockage_pct', headerName: 'Dock%', width: 70, type: 'numericColumn' },
    { field: 'moisture_pct', headerName: 'Moist%', width: 75, type: 'numericColumn' },
    { field: 'protein_pct', headerName: 'Prot%', width: 70, type: 'numericColumn' },
    { field: 'test_weight', headerName: 'TW', width: 60, type: 'numericColumn' },
    { field: 'hvk_pct', headerName: 'HVK%', width: 70, type: 'numericColumn' },
    {
      field: 'rail_car_number', headerName: 'Car/Truck#', width: 120,
      valueGetter: p => p.data.rail_car_number || p.data.vehicle_id || '',
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

  const onSelectionChanged = useCallback(() => {
    const selected = gridRef.current?.api?.getSelectedRows() || [];
    setSelectedIds(selected.filter(r => r.direction === 'inbound').map(r => r.id));
  }, []);

  const handleAssign = async () => {
    if (!assignContractId || selectedIds.length === 0) return;
    try {
      setAssigning(true);
      await api.post(`/api/farms/${farmId}/terminal/tickets/batch-assign-contract`, {
        ticket_ids: selectedIds,
        contract_id: assignContractId,
      });
      setSnackbar(`${selectedIds.length} ticket(s) assigned to contract`);
      setSelectedIds([]);
      setAssignContractId('');
      gridRef.current?.api?.deselectAll();
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to assign tickets'));
    } finally {
      setAssigning(false);
    }
  };

  // Sale contracts for assignment dropdown
  const saleContracts = (contracts || []).filter(c => c.direction === 'sale' && c.status !== 'cancelled');

  return (
    <Box>
      <BinHeader bin={bin} />
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<MoveToInboxIcon />}
          onClick={() => setAllocateOpen(true)}
        >
          Allocate Tickets
        </Button>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* Batch assign toolbar — shown when tickets selected */}
      {selectedIds.length > 0 && (
        <Paper variant="outlined" sx={{ p: 1.5, mb: 2, display: 'flex', alignItems: 'center', gap: 2, bgcolor: 'action.hover' }}>
          <Chip label={`${selectedIds.length} selected`} color="primary" size="small" />
          <TextField
            select
            size="small"
            label="Assign to Contract"
            value={assignContractId}
            onChange={e => setAssignContractId(e.target.value)}
            sx={{ minWidth: 280 }}
          >
            <MenuItem value="">— Select contract —</MenuItem>
            {saleContracts.map(c => (
              <MenuItem key={c.id} value={c.id}>
                {c.contract_number} — {c.counterparty?.name} ({c.commodity?.name}, {c.remaining_mt?.toFixed(0)} MT left)
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            size="small"
            startIcon={<AssignmentIcon />}
            onClick={handleAssign}
            disabled={!assignContractId || assigning}
          >
            Assign
          </Button>
        </Paper>
      )}

      <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 'calc(100vh - 370px)', width: '100%' }}>
        <AgGridReact
          ref={gridRef}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          getRowId={p => p.data.id}
          loading={loading}
          rowSelection="multiple"
          suppressRowClickSelection
          onSelectionChanged={onSelectionChanged}
          isRowSelectable={p => p.data?.direction === 'inbound'}
        />
      </Box>
      <AllocateTicketsDialog
        open={allocateOpen}
        onClose={() => setAllocateOpen(false)}
        farmId={farmId}
        bin={bin}
        onAllocated={(count) => {
          setSnackbar(`${count} ticket(s) allocated to Bin ${bin.bin_number}`);
          load();
        }}
      />
      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar(null)}
        message={snackbar}
      />
    </Box>
  );
}

export default function TerminalBins() {
  const { currentFarm } = useFarm();
  const [bins, setBins] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);

  const farmId = currentFarm?.id;

  useEffect(() => {
    if (!farmId) return;
    Promise.all([
      api.get(`/api/farms/${farmId}/terminal/bins`),
      api.get(`/api/farms/${farmId}/terminal/contracts`, { params: { limit: 500 } }),
    ]).then(([binRes, ctRes]) => {
      setBins(binRes.data || []);
      setContracts(ctRes.data.contracts || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [farmId]);

  if (loading) return <Skeleton variant="rounded" height={400} />;
  if (!bins.length) return <Alert severity="info">No bins configured. Seed LGX terminal data to get started.</Alert>;

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>Bin Inventory (WIP)</Typography>
      <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2 }}>
        {bins.map(b => (
          <Tab
            key={b.id}
            label={`Bin ${b.bin_number}`}
            icon={<WarehouseIcon />}
            iconPosition="start"
          />
        ))}
      </Tabs>
      {bins.map((bin, idx) => (
        <TabPanel key={bin.id} value={activeTab} index={idx}>
          <BinLedger farmId={farmId} bin={bin} contracts={contracts} />
        </TabPanel>
      ))}
    </Box>
  );
}
