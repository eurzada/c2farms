import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Button, Stack, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, Grid, Snackbar, Alert, IconButton, Tooltip, Paper, LinearProgress,
  Select, InputLabel, FormControl, Checkbox, ListItemText, OutlinedInput,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SendIcon from '@mui/icons-material/Send';
import CancelIcon from '@mui/icons-material/Cancel';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import RefreshIcon from '@mui/icons-material/Refresh';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import { fmt, fmtDollar } from '../../utils/formatting';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import useGridState from '../../hooks/useGridState.js';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import { getSocket } from '../../services/socket';

const STATUS_COLORS = {
  draft: 'default', dispatched: 'primary', in_progress: 'warning', complete: 'success', cancelled: 'error',
};

const ASSIGNMENT_COLORS = {
  pending: 'default', acknowledged: 'info', loading: 'warning', en_route: 'primary', delivered: 'success',
};

export default function Dispatch() {
  const { currentFarm, canEdit, isAdmin } = useFarm();
  const { mode } = useThemeMode();
  const agTheme = mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

  const [dashboard, setDashboard] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'info' });
  const [createOpen, setCreateOpen] = useState(false);
  const [locations, setLocations] = useState([]);
  const [truckers, setTruckers] = useState([]);
  const { confirm, dialogProps } = useConfirmDialog();

  const contractGridRef = useRef();
  const orderGridRef = useRef();
  const { onGridReady: onContractGridReady, onStateChanged: onContractStateChanged } = useGridState('c2_dispatch_contracts_grid');
  const { onGridReady: onOrderGridReady, onStateChanged: onOrderStateChanged } = useGridState('c2_dispatch_orders_grid');

  const fetchData = useCallback(async () => {
    if (!currentFarm) return;
    setLoading(true);
    try {
      const [dashRes, ordersRes, locRes] = await Promise.all([
        api.get(`/api/farms/${currentFarm.id}/dispatch/dashboard`),
        api.get(`/api/farms/${currentFarm.id}/dispatch/orders`),
        api.get(`/api/farms/${currentFarm.id}/inventory/locations`),
      ]);
      setDashboard(dashRes.data);
      setOrders(ordersRes.data.orders);
      setLocations(locRes.data.locations || []);
      setTruckers(dashRes.data.truckers || []);
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to load dispatch data'), severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, [currentFarm]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Real-time updates
  useEffect(() => {
    if (!currentFarm) return;
    const socket = getSocket();
    const handler = () => fetchData();
    socket?.on('dispatch:order_dispatched', handler);
    socket?.on('dispatch:assignment_updated', handler);
    socket?.on('dispatch:assignment_delivered', handler);
    return () => {
      socket?.off('dispatch:order_dispatched', handler);
      socket?.off('dispatch:assignment_updated', handler);
      socket?.off('dispatch:assignment_delivered', handler);
    };
  }, [currentFarm, fetchData]);

  // ─── Contract Queue Grid ──────────────────────────────────────────

  const contractColDefs = useMemo(() => [
    { field: 'contract_number', headerName: '#', width: 120 },
    { field: 'buyer', headerName: 'Buyer', width: 140 },
    { field: 'commodity', headerName: 'Crop', width: 110 },
    { field: 'grade', headerName: 'Grade', width: 90 },
    { field: 'elevator_site', headerName: 'Elevator', width: 120 },
    { field: 'contracted_mt', headerName: 'Contracted', width: 100, valueFormatter: p => fmt(p.value) },
    { field: 'delivered_mt', headerName: 'Hauled', width: 90, valueFormatter: p => fmt(p.value) },
    { field: 'remaining_mt', headerName: 'Remaining', width: 100, valueFormatter: p => fmt(p.value),
      cellStyle: p => p.value > 0 ? { color: '#ed6c02', fontWeight: 600 } : { color: '#2e7d32' } },
    { field: 'pct_complete', headerName: '% Done', width: 120,
      cellRenderer: p => {
        const pct = Math.min(p.value || 0, 100);
        const color = pct >= 100 ? '#2e7d32' : pct >= 50 ? '#1976d2' : '#ed6c02';
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', pr: 1 }}>
            <Box sx={{ flex: 1, bgcolor: '#e0e0e0', borderRadius: 1, height: 8, overflow: 'hidden' }}>
              <Box sx={{ width: `${pct}%`, bgcolor: color, height: '100%', borderRadius: 1 }} />
            </Box>
            <Typography variant="caption" sx={{ minWidth: 36, textAlign: 'right', fontSize: 11 }}>{pct.toFixed(0)}%</Typography>
          </Box>
        );
      },
    },
    { field: 'delivery_end', headerName: 'Deadline', width: 100,
      valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString('en-CA') : '—',
      cellStyle: p => {
        if (!p.value) return null;
        const daysLeft = Math.ceil((new Date(p.value) - new Date()) / 86400000);
        if (daysLeft < 0) return { color: '#d32f2f', fontWeight: 700 };
        if (daysLeft < 7) return { color: '#ed6c02', fontWeight: 600 };
        return null;
      },
    },
    {
      headerName: '', width: 60, sortable: false, filter: false,
      cellRenderer: p => canEdit ? (
        <Tooltip title="Create Shipment Order">
          <IconButton size="small" color="primary" onClick={() => {
            setCreateOpen(true);
            setNewOrder(prev => ({
              ...prev,
              marketing_contract_id: p.data.id,
              _contract_label: `${p.data.contract_number} — ${p.data.buyer} — ${p.data.commodity}`,
            }));
          }}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null,
    },
  ], [canEdit]);

  // ─── Active Orders Grid ───────────────────────────────────────────

  const orderColDefs = useMemo(() => [
    { field: 'marketing_contract.contract_number', headerName: 'Contract', width: 120,
      valueGetter: p => p.data?.marketing_contract?.contract_number || '—' },
    { field: 'marketing_contract.counterparty.name', headerName: 'Buyer', width: 130,
      valueGetter: p => p.data?.marketing_contract?.counterparty?.name || '—' },
    { field: 'marketing_contract.commodity.name', headerName: 'Crop', width: 100,
      valueGetter: p => p.data?.marketing_contract?.commodity?.name || '—' },
    { field: 'source_location.name', headerName: 'From', width: 110,
      valueGetter: p => p.data?.source_location?.name || '—' },
    { field: 'target_loads', headerName: 'Target', width: 70 },
    { field: 'completed_loads', headerName: 'Done', width: 70 },
    { field: 'total_delivered_mt', headerName: 'MT Delivered', width: 100, valueFormatter: p => fmt(p.value) },
    { field: 'status', headerName: 'Status', width: 110,
      cellRenderer: p => <Chip label={p.value?.replace('_', ' ')} size="small" color={STATUS_COLORS[p.value] || 'default'} variant="outlined" /> },
    { field: 'assignments', headerName: 'Truckers', width: 200,
      valueGetter: p => p.data?.assignments?.map(a => a.trucker?.name).join(', ') || '—',
    },
    { field: 'delivery_window_end', headerName: 'Due', width: 100,
      valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString('en-CA') : '—' },
    {
      headerName: 'Actions', width: 120, sortable: false, filter: false,
      cellRenderer: p => {
        if (!canEdit) return null;
        const o = p.data;
        return (
          <Stack direction="row" spacing={0}>
            {o.status === 'draft' && (
              <Tooltip title="Dispatch">
                <IconButton size="small" color="primary" onClick={() => handleDispatch(o)}>
                  <SendIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {['draft', 'dispatched', 'in_progress'].includes(o.status) && (
              <Tooltip title="Cancel">
                <IconButton size="small" color="error" onClick={() => handleCancel(o)}>
                  <CancelIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        );
      },
    },
  ], [canEdit]);

  // ─── Handlers ─────────────────────────────────────────────────────

  const handleDispatch = async (order) => {
    const ok = await confirm({
      title: 'Dispatch Order',
      message: `Dispatch this shipment order? ${order.assignments?.length || 0} trucker(s) will see it in their assignments.`,
      confirmText: 'Dispatch',
    });
    if (!ok) return;
    try {
      await api.post(`/api/farms/${currentFarm.id}/dispatch/orders/${order.id}/dispatch`, {
        trucker_ids: order.assignments?.map(a => a.trucker?.id) || [],
      });
      setSnack({ open: true, message: 'Order dispatched', severity: 'success' });
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to dispatch'), severity: 'error' });
    }
  };

  const handleCancel = async (order) => {
    const ok = await confirm({
      title: 'Cancel Order',
      message: 'Cancel this shipment order? Active assignments will be affected.',
      confirmText: 'Cancel Order',
      confirmColor: 'error',
    });
    if (!ok) return;
    try {
      await api.post(`/api/farms/${currentFarm.id}/dispatch/orders/${order.id}/cancel`);
      setSnack({ open: true, message: 'Order cancelled', severity: 'info' });
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to cancel'), severity: 'error' });
    }
  };

  // ─── Create Order Dialog ──────────────────────────────────────────

  const [newOrder, setNewOrder] = useState({
    marketing_contract_id: '', source_location_id: '', source_bin_id: '',
    target_loads: 1, estimated_mt_per_load: '', delivery_window_start: '', delivery_window_end: '',
    notes: '', trucker_ids: [], auto_dispatch: false, _contract_label: '',
  });

  const handleCreate = async () => {
    try {
      await api.post(`/api/farms/${currentFarm.id}/dispatch/orders`, newOrder);
      setSnack({ open: true, message: newOrder.auto_dispatch ? 'Order created and dispatched' : 'Order created as draft', severity: 'success' });
      setCreateOpen(false);
      setNewOrder({ marketing_contract_id: '', source_location_id: '', source_bin_id: '', target_loads: 1, estimated_mt_per_load: '', delivery_window_start: '', delivery_window_end: '', notes: '', trucker_ids: [], auto_dispatch: false, _contract_label: '' });
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to create order'), severity: 'error' });
    }
  };

  const defaultColDef = useMemo(() => ({ sortable: true, resizable: true, filter: true }), []);
  const contractQueue = dashboard?.contract_queue || [];

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          <LocalShippingIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
          Dispatch Board
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button startIcon={<RefreshIcon />} onClick={fetchData} variant="outlined" size="small">Refresh</Button>
          {canEdit && (
            <Button startIcon={<AddIcon />} onClick={() => setCreateOpen(true)} variant="contained">
              New Shipment Order
            </Button>
          )}
        </Stack>
      </Stack>

      {/* KPI Summary */}
      {dashboard && (
        <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
          <Paper sx={{ p: 2, flex: 1, textAlign: 'center' }}>
            <Typography variant="h4" color="primary">{dashboard.active_orders?.length || 0}</Typography>
            <Typography variant="body2" color="text.secondary">Active Orders</Typography>
          </Paper>
          <Paper sx={{ p: 2, flex: 1, textAlign: 'center' }}>
            <Typography variant="h4" color="warning.main">{contractQueue.length}</Typography>
            <Typography variant="body2" color="text.secondary">Contracts to Fill</Typography>
          </Paper>
          <Paper sx={{ p: 2, flex: 1, textAlign: 'center' }}>
            <Typography variant="h4" color="success.main">
              {truckers.filter(t => t.trucker_status === 'available' && !t.is_busy).length}
              <Typography component="span" variant="h6" color="text.secondary"> / {truckers.length}</Typography>
            </Typography>
            <Typography variant="body2" color="text.secondary">Truckers Available</Typography>
          </Paper>
          <Paper sx={{ p: 2, flex: 1, textAlign: 'center' }}>
            <Typography variant="h4">{dashboard.recent_tickets?.length || 0}</Typography>
            <Typography variant="body2" color="text.secondary">Loads This Week</Typography>
          </Paper>
        </Stack>
      )}

      {/* Contract Queue */}
      <Typography variant="h6" sx={{ mb: 1 }}>Contracts to Fill</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Contracts with remaining volume, sorted by delivery deadline. Click + to create a shipment order.
      </Typography>
      <Box className={agTheme} sx={{ height: 300, width: '100%', mb: 3 }}>
        <AgGridReact
          ref={contractGridRef}
          rowData={contractQueue}
          columnDefs={contractColDefs}
          defaultColDef={defaultColDef}
          animateRows
          getRowId={p => p.data?.id}
          onGridReady={onContractGridReady}
          onColumnResized={onContractStateChanged}
          onColumnMoved={onContractStateChanged}
          onSortChanged={onContractStateChanged}
          onColumnVisible={onContractStateChanged}
        />
      </Box>

      {/* Active Orders */}
      <Typography variant="h6" sx={{ mb: 1 }}>Shipment Orders</Typography>
      <Box className={agTheme} sx={{ height: 350, width: '100%', mb: 3 }}>
        <AgGridReact
          ref={orderGridRef}
          rowData={orders}
          columnDefs={orderColDefs}
          defaultColDef={defaultColDef}
          animateRows
          getRowId={p => p.data?.id}
          onGridReady={onOrderGridReady}
          onColumnResized={onOrderStateChanged}
          onColumnMoved={onOrderStateChanged}
          onSortChanged={onOrderStateChanged}
          onColumnVisible={onOrderStateChanged}
        />
      </Box>

      {/* Trucker Roster */}
      {truckers.length > 0 && (
        <>
          <Typography variant="h6" sx={{ mb: 1 }}>Trucker Roster</Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 3, flexWrap: 'wrap', gap: 1 }}>
            {truckers.map(t => (
              <Paper key={t.id} sx={{ p: 1.5, minWidth: 160 }}>
                <Typography variant="subtitle2">{t.name}</Typography>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Chip
                    label={t.is_busy ? 'On Load' : (t.trucker_status || 'available')}
                    size="small"
                    color={t.is_busy ? 'warning' : t.trucker_status === 'off' ? 'default' : 'success'}
                    variant="outlined"
                  />
                  {t.truck_capacity_mt && (
                    <Typography variant="caption" color="text.secondary">{t.truck_capacity_mt} MT</Typography>
                  )}
                </Stack>
              </Paper>
            ))}
          </Stack>
        </>
      )}

      {/* Create Order Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Shipment Order</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Contract *</InputLabel>
                <Select
                  value={newOrder.marketing_contract_id}
                  onChange={e => setNewOrder(prev => ({ ...prev, marketing_contract_id: e.target.value }))}
                  label="Contract *"
                >
                  {contractQueue.map(c => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.contract_number} — {c.buyer} — {c.commodity} ({fmt(c.remaining_mt)} MT remaining)
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>Pickup Location</InputLabel>
                <Select
                  value={newOrder.source_location_id}
                  onChange={e => setNewOrder(prev => ({ ...prev, source_location_id: e.target.value }))}
                  label="Pickup Location"
                >
                  <MenuItem value="">—</MenuItem>
                  {locations.map(l => (
                    <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={3}>
              <TextField fullWidth label="Target Loads" type="number" value={newOrder.target_loads}
                onChange={e => setNewOrder(prev => ({ ...prev, target_loads: parseInt(e.target.value) || 1 }))} />
            </Grid>
            <Grid item xs={3}>
              <TextField fullWidth label="MT/Load" type="number" value={newOrder.estimated_mt_per_load}
                onChange={e => setNewOrder(prev => ({ ...prev, estimated_mt_per_load: e.target.value }))} />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Window Start" type="date" InputLabelProps={{ shrink: true }}
                value={newOrder.delivery_window_start}
                onChange={e => setNewOrder(prev => ({ ...prev, delivery_window_start: e.target.value }))} />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Window End" type="date" InputLabelProps={{ shrink: true }}
                value={newOrder.delivery_window_end}
                onChange={e => setNewOrder(prev => ({ ...prev, delivery_window_end: e.target.value }))} />
            </Grid>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Assign Truckers</InputLabel>
                <Select
                  multiple
                  value={newOrder.trucker_ids}
                  onChange={e => setNewOrder(prev => ({ ...prev, trucker_ids: e.target.value }))}
                  input={<OutlinedInput label="Assign Truckers" />}
                  renderValue={selected => selected.map(id => truckers.find(t => t.id === id)?.name).filter(Boolean).join(', ')}
                >
                  {truckers.map(t => (
                    <MenuItem key={t.id} value={t.id}>
                      <Checkbox checked={newOrder.trucker_ids.includes(t.id)} />
                      <ListItemText primary={t.name} secondary={t.truck_capacity_mt ? `${t.truck_capacity_mt} MT` : null} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Notes" multiline rows={2} value={newOrder.notes}
                onChange={e => setNewOrder(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Gate codes, special instructions, elevator slot times..." />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="outlined" onClick={handleCreate} disabled={!newOrder.marketing_contract_id}>
            Save as Draft
          </Button>
          <Button variant="contained" startIcon={<SendIcon />}
            onClick={() => { setNewOrder(prev => ({ ...prev, auto_dispatch: true })); setTimeout(handleCreate, 0); }}
            disabled={!newOrder.marketing_contract_id || newOrder.trucker_ids.length === 0}>
            Create & Dispatch
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog {...dialogProps} />
      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack(s => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
