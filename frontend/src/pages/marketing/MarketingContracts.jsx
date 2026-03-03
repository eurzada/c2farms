import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Button, Stack, Chip, Tabs, Tab, LinearProgress,
  Snackbar, Alert, IconButton, Tooltip, Paper,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditIcon from '@mui/icons-material/Edit';
import SettingsIcon from '@mui/icons-material/Settings';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import ContractFormDialog from '../../components/marketing/ContractFormDialog';
import DeliveryFormDialog from '../../components/marketing/DeliveryFormDialog';
import SettlementDialog from '../../components/marketing/SettlementDialog';
import MarketingSettingsDialog from '../../components/marketing/MarketingSettingsDialog';

const STATUS_TABS = ['All', 'Executed', 'In Delivery', 'Delivered', 'Settled', 'Cancelled'];
const STATUS_MAP = { 'All': null, 'Executed': 'executed', 'In Delivery': 'in_delivery', 'Delivered': 'delivered', 'Settled': 'settled', 'Cancelled': 'cancelled' };

const STATUS_COLORS = {
  executed: 'primary', in_delivery: 'warning', delivered: 'info', settled: 'success', cancelled: 'default',
};

const PRICING_LABELS = {
  flat: 'Flat', basis: 'Basis', hta: 'HTA', min_price: 'Min Price', deferred: 'Deferred',
};

function StatusChip({ value }) {
  return <Chip label={value?.replace('_', ' ')} size="small" color={STATUS_COLORS[value] || 'default'} variant="outlined" />;
}

function PricingChip({ value }) {
  return <Chip label={PRICING_LABELS[value] || value} size="small" variant="filled" sx={{ fontSize: 11 }} />;
}

function ProgressCell({ value }) {
  const pct = value || 0;
  const color = pct >= 100 ? 'success' : pct >= 75 ? 'warning' : 'primary';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', py: 0.5 }}>
      <LinearProgress variant="determinate" value={Math.min(pct, 100)} color={color} sx={{ flex: 1, height: 8, borderRadius: 4 }} />
      <Typography variant="caption" sx={{ minWidth: 40 }}>{pct.toFixed(0)}%</Typography>
    </Box>
  );
}

const fmt = (v, d = 1) => v != null ? v.toLocaleString(undefined, { maximumFractionDigits: d }) : '—';
const fmtDollar = (v) => v != null ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—';

export default function MarketingContracts() {
  const { currentFarm, canEdit, isAdmin } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();

  const [contracts, setContracts] = useState([]);
  const [statusFilter, setStatusFilter] = useState(0);
  const [contractDialog, setContractDialog] = useState({ open: false, initial: null });
  const [deliveryDialog, setDeliveryDialog] = useState({ open: false, contract: null });
  const [settlementDialog, setSettlementDialog] = useState({ open: false, contract: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'info' });

  const fetchData = useCallback(() => {
    if (!currentFarm) return;
    const status = STATUS_MAP[STATUS_TABS[statusFilter]];
    const params = status ? `?status=${status}` : '';
    api.get(`/api/farms/${currentFarm.id}/marketing/contracts${params}`)
      .then(res => setContracts(res.data.contracts || []));
  }, [currentFarm, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // KPI computations
  const kpis = useMemo(() => {
    const active = contracts.filter(c => ['executed', 'in_delivery'].includes(c.status));
    return {
      active: active.length,
      committed: active.reduce((s, c) => s + c.contracted_mt, 0),
      value: contracts.filter(c => c.status !== 'cancelled').reduce((s, c) => s + (c.contract_value || 0), 0),
      unpriced: contracts.filter(c => c.pricing_status !== 'priced' && c.status !== 'cancelled').length,
    };
  }, [contracts]);

  const columnDefs = useMemo(() => [
    { field: 'contract_number', headerName: '#', width: 110, pinned: 'left' },
    { field: 'counterparty.name', headerName: 'Buyer', width: 140 },
    { field: 'commodity.name', headerName: 'Crop', width: 120 },
    { field: 'grade', headerName: 'Grade', width: 100 },
    { field: 'pricing_type', headerName: 'Type', width: 90, cellRenderer: p => <PricingChip value={p.value} /> },
    { field: 'contracted_mt', headerName: 'Qty (MT)', width: 110, valueFormatter: p => fmt(p.value) },
    { field: 'delivered_mt', headerName: 'Hauled', width: 100, valueFormatter: p => fmt(p.value) },
    { field: 'remaining_mt', headerName: 'Remaining', width: 100, valueFormatter: p => fmt(p.value) },
    { field: 'pct_complete', headerName: '% Done', width: 140, cellRenderer: ProgressCell },
    { field: 'price_per_bu', headerName: '$/bu', width: 90, valueFormatter: p => p.value ? `$${p.value.toFixed(2)}` : '—' },
    { field: 'contract_value', headerName: 'Value', width: 120, valueFormatter: p => p.value ? `$${(p.value / 1000).toFixed(0)}K` : '—' },
    { field: 'elevator_site', headerName: 'Elevator', width: 120 },
    {
      headerName: 'Delivery Window', width: 160,
      valueGetter: p => {
        const s = p.data.delivery_start ? new Date(p.data.delivery_start).toLocaleDateString('en-CA') : '';
        const e = p.data.delivery_end ? new Date(p.data.delivery_end).toLocaleDateString('en-CA') : '';
        return s || e ? `${s} — ${e}` : '—';
      },
    },
    { field: 'status', headerName: 'Status', width: 120, cellRenderer: p => <StatusChip value={p.value} /> },
    { field: 'pricing_status', headerName: 'Pricing', width: 110, cellRenderer: p => <Chip label={p.value?.replace('_', ' ')} size="small" variant="outlined" sx={{ fontSize: 11 }} /> },
    { field: 'notes', headerName: 'Notes', width: 150, flex: 1 },
    {
      headerName: 'Actions', width: 130, sortable: false, filter: false, pinned: 'right',
      cellRenderer: p => {
        if (!canEdit) return null;
        const c = p.data;
        return (
          <Stack direction="row" spacing={0}>
            {['executed', 'in_delivery'].includes(c.status) && (
              <Tooltip title="Record Delivery">
                <IconButton size="small" onClick={() => setDeliveryDialog({ open: true, contract: c })}>
                  <LocalShippingIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {c.status === 'delivered' && (
              <Tooltip title="Settle">
                <IconButton size="small" color="success" onClick={() => setSettlementDialog({ open: true, contract: c })}>
                  <CheckCircleIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {['executed', 'in_delivery'].includes(c.status) && (
              <Tooltip title="Edit">
                <IconButton size="small" onClick={() => setContractDialog({ open: true, initial: c })}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        );
      },
    },
  ], [canEdit]);

  const defaultColDef = useMemo(() => ({ sortable: true, resizable: true, filter: true }), []);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>Marketing Contracts</Typography>
        <Stack direction="row" spacing={1}>
          {isAdmin && (
            <Tooltip title="Settings">
              <IconButton onClick={() => setSettingsOpen(true)}><SettingsIcon /></IconButton>
            </Tooltip>
          )}
          {canEdit && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setContractDialog({ open: true, initial: null })}>
              New Contract
            </Button>
          )}
        </Stack>
      </Stack>

      {/* KPI Cards */}
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        {[
          { label: 'Active Contracts', value: kpis.active },
          { label: 'Committed MT', value: fmt(kpis.committed, 0) },
          { label: 'Total Value', value: fmtDollar(kpis.value) },
          { label: 'Unpriced', value: kpis.unpriced },
        ].map(k => (
          <Paper key={k.label} sx={{ px: 2.5, py: 1.5, flex: 1, textAlign: 'center' }} variant="outlined">
            <Typography variant="caption" color="text.secondary">{k.label}</Typography>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>{k.value}</Typography>
          </Paper>
        ))}
      </Stack>

      {/* Status Tabs */}
      <Tabs value={statusFilter} onChange={(_, v) => setStatusFilter(v)} sx={{ mb: 1 }}>
        {STATUS_TABS.map(t => <Tab key={t} label={t} />)}
      </Tabs>

      {/* Grid */}
      <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 500, width: '100%' }}>
        <AgGridReact
          ref={gridRef}
          rowData={contracts}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          getRowId={p => p.data?.id}
        />
      </Box>

      {/* Dialogs */}
      <ContractFormDialog
        open={contractDialog.open}
        onClose={() => setContractDialog({ open: false, initial: null })}
        farmId={currentFarm?.id}
        initial={contractDialog.initial}
        onSaved={(warning) => {
          fetchData();
          setContractDialog({ open: false, initial: null });
          if (warning) setSnack({ open: true, message: warning, severity: 'warning' });
        }}
      />

      <DeliveryFormDialog
        open={deliveryDialog.open}
        onClose={() => setDeliveryDialog({ open: false, contract: null })}
        farmId={currentFarm?.id}
        contract={deliveryDialog.contract}
        onSaved={() => { fetchData(); setDeliveryDialog({ open: false, contract: null }); }}
      />

      <SettlementDialog
        open={settlementDialog.open}
        onClose={() => setSettlementDialog({ open: false, contract: null })}
        farmId={currentFarm?.id}
        contract={settlementDialog.contract}
        onSaved={() => { fetchData(); setSettlementDialog({ open: false, contract: null }); }}
      />

      <MarketingSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        farmId={currentFarm?.id}
      />

      <Snackbar open={snack.open} autoHideDuration={6000} onClose={() => setSnack(s => ({ ...s, open: false }))}>
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
