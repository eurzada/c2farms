import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Button, Stack, Chip, Tabs, Tab,
  Snackbar, Alert, IconButton, Tooltip, Paper, Menu, MenuItem, Checkbox, ListItemText, Divider, CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditIcon from '@mui/icons-material/Edit';
import CancelIcon from '@mui/icons-material/Cancel';
import DeleteIcon from '@mui/icons-material/Delete';
import SettingsIcon from '@mui/icons-material/Settings';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import DescriptionIcon from '@mui/icons-material/Description';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import ContractFormDialog from '../../components/marketing/ContractFormDialog';
import ContractImportDialog from '../../components/marketing/ContractImportDialog';
import ContractBatchImportDialog from '../../components/marketing/ContractBatchImportDialog';
import TransferAgreementFromTerminalDialog from '../../components/marketing/TransferAgreementFromTerminalDialog';
import DeliveryFormDialog from '../../components/marketing/DeliveryFormDialog';
import SettlementDialog from '../../components/marketing/SettlementDialog';
import MarketingSettingsDialog from '../../components/marketing/MarketingSettingsDialog';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { fmt, fmtDollar } from '../../utils/formatting';
import { getSocket } from '../../services/socket';

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
  const [importOpen, setImportOpen] = useState(false);
  const [batchImportOpen, setBatchImportOpen] = useState(false);
  const [lgxTransferOpen, setLgxTransferOpen] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [columnMenuAnchor, setColumnMenuAnchor] = useState(null);
  const [exporting, setExporting] = useState(false);
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  // Column visibility — keys that map to column field names
  const TOGGLEABLE_COLUMNS = [
    { key: 'contract_number', label: '#' },
    { key: 'counterparty.name', label: 'Buyer' },
    { key: 'commodity.name', label: 'Crop' },
    { key: 'grade', label: 'Grade' },
    { key: 'crop_year', label: 'Crop Year' },
    { key: 'pricing_type', label: 'Type' },
    { key: 'contracted_mt', label: 'Qty (MT)' },
    { key: 'price_per_bu', label: '$/bu' },
    { key: 'price_per_mt', label: '$/MT' },
    { key: 'basis_level', label: 'Basis' },
    { key: 'futures_reference', label: 'Futures Ref' },
    { key: 'contract_value', label: 'Value' },
    { key: 'broker', label: 'Broker' },
    { key: 'elevator_site', label: 'Elevator' },
    { key: 'farm_origin', label: 'Origin' },
    { key: 'delivery_window', label: 'Delivery Window' },
    { key: 'tolerance_pct', label: 'Tolerance' },
    { key: 'status', label: 'Status' },
    { key: 'pricing_status', label: 'Pricing' },
    { key: 'settlement_date', label: 'Settled Date' },
    { key: 'settlement_amount', label: 'Settlement $' },
    { key: 'cop_per_mt', label: 'COP/MT' },
    { key: 'notes', label: 'Notes' },
  ];

  const DEFAULT_HIDDEN = ['tolerance_pct', 'farm_origin', 'settlement_date', 'settlement_amount', 'cop_per_mt'];
  const [hiddenColumns, setHiddenColumns] = useState(() => {
    try {
      const saved = localStorage.getItem('c2farms_contracts_hidden_cols');
      return saved ? JSON.parse(saved) : DEFAULT_HIDDEN;
    } catch { return DEFAULT_HIDDEN; }
  });

  const toggleColumn = (key) => {
    setHiddenColumns(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      localStorage.setItem('c2farms_contracts_hidden_cols', JSON.stringify(next));
      return next;
    });
  };

  const handleExportPdf = async () => {
    if (!currentFarm) return;
    setExporting(true);
    try {
      // Map visible column keys to backend column names
      const COL_KEY_MAP = {
        'counterparty.name': 'buyer',
        'commodity.name': 'commodity',
        'pct_complete': 'pct_complete',
        'delivery_window': 'delivery_window',
      };
      const visibleCols = TOGGLEABLE_COLUMNS
        .filter(c => !hiddenColumns.includes(c.key))
        .map(c => COL_KEY_MAP[c.key] || c.key);

      const status = STATUS_MAP[STATUS_TABS[statusFilter]] || undefined;

      const res = await api.post(
        `/api/farms/${currentFarm.id}/marketing/contracts/export-pdf`,
        { columns: visibleCols, status },
        { responseType: 'blob' }
      );
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'marketing-contracts.pdf';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to export PDF'), severity: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const fetchData = useCallback(() => {
    if (!currentFarm) return;
    const status = STATUS_MAP[STATUS_TABS[statusFilter]];
    const params = status ? `?status=${status}` : '';
    api.get(`/api/farms/${currentFarm.id}/marketing/contracts${params}`)
      .then(res => setContracts(res.data.contracts || []));
  }, [currentFarm, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Listen for blend mix updates from terminal
  useEffect(() => {
    const socket = getSocket();
    const handler = () => {
      setSnack({ open: true, message: 'Blend mix updated for a transfer contract', severity: 'info' });
      fetchData();
    };
    socket.on('marketing:blend_mix_updated', handler);
    return () => { socket.off('marketing:blend_mix_updated', handler); };
  }, [fetchData]);

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

  const handleCancelContract = async (c) => {
    const ok = await confirm({
      title: 'Cancel Contract',
      message: `Cancel contract #${c.contract_number}? This cannot be undone.`,
      confirmText: 'Cancel Contract',
      confirmColor: 'error',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/farms/${currentFarm.id}/marketing/contracts/${c.id}`);
      fetchData();
      setSnack({ open: true, message: `Contract #${c.contract_number} cancelled.`, severity: 'info' });
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to cancel contract'), severity: 'error' });
    }
  };

  const handlePermanentDelete = async (c) => {
    const ok = await confirm({
      title: 'Permanently Delete Contract',
      message: `Permanently delete contract #${c.contract_number}? This will erase the record and any linked deliveries. This action cannot be reversed.`,
      confirmText: 'Delete Permanently',
      confirmColor: 'error',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/farms/${currentFarm.id}/marketing/contracts/${c.id}?permanent=true`);
      fetchData();
      setSnack({ open: true, message: `Contract #${c.contract_number} permanently deleted.`, severity: 'warning' });
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to delete contract'), severity: 'error' });
    }
  };

  const handleDeleteSelected = async () => {
    const selectedRows = gridRef.current?.api?.getSelectedRows() || [];
    if (selectedRows.length === 0) return;
    const ok = await confirm({
      title: 'Cancel Contracts',
      message: `Cancel ${selectedRows.length} contract${selectedRows.length !== 1 ? 's' : ''}? This will set them to "Cancelled" status.`,
      confirmText: 'Cancel All',
      confirmColor: 'error',
    });
    if (!ok) return;
    try {
      const ids = selectedRows.map(r => r.id);
      await api.delete(`/api/farms/${currentFarm.id}/marketing/contracts`, { data: { ids } });
      setSelectedCount(0);
      fetchData();
      setSnack({ open: true, message: `${selectedRows.length} contract(s) cancelled.`, severity: 'info' });
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to cancel contracts'), severity: 'error' });
    }
  };

  const handlePermanentDeleteSelected = async () => {
    const selectedRows = gridRef.current?.api?.getSelectedRows() || [];
    if (selectedRows.length === 0) return;
    const ok = await confirm({
      title: 'Permanently Delete Contracts',
      message: `Permanently delete ${selectedRows.length} contract${selectedRows.length !== 1 ? 's' : ''}? This will erase all records and linked deliveries. This cannot be reversed.`,
      confirmText: 'Delete All Permanently',
      confirmColor: 'error',
    });
    if (!ok) return;
    try {
      const ids = selectedRows.map(r => r.id);
      await api.delete(`/api/farms/${currentFarm.id}/marketing/contracts?permanent=true`, { data: { ids } });
      setSelectedCount(0);
      fetchData();
      setSnack({ open: true, message: `${selectedRows.length} contract(s) permanently deleted.`, severity: 'warning' });
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to delete contracts'), severity: 'error' });
    }
  };

  const handleBulkClose = async () => {
    const selectedRows = gridRef.current?.api?.getSelectedRows() || [];
    const closable = selectedRows.filter(r => r.status !== 'settled' && r.status !== 'cancelled');
    if (closable.length === 0) {
      setSnack({ open: true, message: 'All selected contracts are already settled or cancelled', severity: 'info' });
      return;
    }
    const ok = await confirm({
      title: 'Close Contracts (Prior Year Cutoff)',
      message: `Mark ${closable.length} contract${closable.length !== 1 ? 's' : ''} as "Settled"? This is for prior-year cutoff — contracts will be flagged as settled regardless of delivery status.`,
      confirmText: 'Close All',
      confirmColor: 'success',
    });
    if (!ok) return;
    try {
      const ids = closable.map(r => r.id);
      const res = await api.post(`/api/farms/${currentFarm.id}/marketing/contracts/bulk-close`, {
        ids,
        notes: 'Closed — prior year cutoff',
      });
      setSnack({ open: true, message: `${res.data.closed} contract(s) closed`, severity: 'success' });
      setSelectedCount(0);
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to close contracts'), severity: 'error' });
    }
  };

  const onSelectionChanged = useCallback(() => {
    const count = gridRef.current?.api?.getSelectedRows()?.length || 0;
    setSelectedCount(count);
  }, []);

  const columnDefs = useMemo(() => {
    const isHidden = (key) => hiddenColumns.includes(key);
    return [
    {
      headerCheckboxSelection: true,
      checkboxSelection: true,
      headerCheckboxSelectionFilteredOnly: true,
      width: 44,
      sortable: false,
      filter: false,
      resizable: false,
      pinned: 'left',
    },
    {
      field: 'contract_number',
      headerName: '#',
      width: 130,
      pinned: 'left',
      hide: isHidden('contract_number'),
      cellRenderer: p => (
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <span>{p.value}</span>
          {p.data?.contract_type === 'transfer' && (
            <Chip label="LGX" size="small" color="secondary" variant="outlined" sx={{ fontSize: 10, height: 18 }} />
          )}
          {p.data?.blend_mix_updated_at && (Date.now() - new Date(p.data.blend_mix_updated_at).getTime()) < 86400000 && (
            <Chip label="Blend Updated" size="small" color="info" variant="outlined" sx={{ fontSize: 9, height: 16 }} />
          )}
        </Stack>
      ),
    },
    { field: 'counterparty.name', headerName: 'Buyer', width: 140, hide: isHidden('counterparty.name') },
    { field: 'commodity.name', headerName: 'Crop', width: 120, hide: isHidden('commodity.name') },
    { field: 'grade', headerName: 'Grade', width: 100, hide: isHidden('grade') },
    { field: 'crop_year', headerName: 'Crop Year', width: 90, hide: isHidden('crop_year') },
    { field: 'pricing_type', headerName: 'Type', width: 90, cellRenderer: p => <PricingChip value={p.value} />, hide: isHidden('pricing_type') },
    { field: 'contracted_mt', headerName: 'Qty (MT)', width: 110, valueFormatter: p => fmt(p.value), hide: isHidden('contracted_mt') },
    { field: 'price_per_bu', headerName: '$/bu', width: 90, valueFormatter: p => p.value ? `$${p.value.toFixed(2)}` : '—', hide: isHidden('price_per_bu') },
    { field: 'price_per_mt', headerName: '$/MT', width: 100, valueFormatter: p => p.value ? `$${fmt(p.value)}` : '—', hide: isHidden('price_per_mt') },
    { field: 'basis_level', headerName: 'Basis', width: 80, valueFormatter: p => p.value ? `$${p.value.toFixed(2)}` : '—', hide: isHidden('basis_level') },
    { field: 'futures_reference', headerName: 'Futures Ref', width: 120, hide: isHidden('futures_reference') },
    { field: 'contract_value', headerName: 'Value', width: 120, valueFormatter: p => p.value ? `$${(p.value / 1000).toFixed(0)}K` : '—', hide: isHidden('contract_value') },
    { field: 'broker', headerName: 'Broker', width: 110, hide: isHidden('broker') },
    { field: 'elevator_site', headerName: 'Elevator', width: 120, hide: isHidden('elevator_site') },
    { field: 'farm_origin', headerName: 'Origin', width: 100, hide: isHidden('farm_origin') },
    {
      field: 'delivery_window', headerName: 'Delivery Window', width: 160, hide: isHidden('delivery_window'),
      valueGetter: p => {
        const s = p.data.delivery_start ? new Date(p.data.delivery_start).toLocaleDateString('en-CA') : '';
        const e = p.data.delivery_end ? new Date(p.data.delivery_end).toLocaleDateString('en-CA') : '';
        return s || e ? `${s} — ${e}` : '—';
      },
    },
    { field: 'tolerance_pct', headerName: 'Tolerance', width: 80, valueFormatter: p => p.value ? `${p.value}%` : '—', hide: isHidden('tolerance_pct') },
    { field: 'status', headerName: 'Status', width: 120, cellRenderer: p => <StatusChip value={p.value} />, hide: isHidden('status') },
    { field: 'pricing_status', headerName: 'Pricing', width: 110, cellRenderer: p => <Chip label={p.value?.replace('_', ' ')} size="small" variant="outlined" sx={{ fontSize: 11 }} />, hide: isHidden('pricing_status') },
    { field: 'settlement_date', headerName: 'Settled Date', width: 110, valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString('en-CA') : '—', hide: isHidden('settlement_date') },
    { field: 'settlement_amount', headerName: 'Settlement $', width: 120, valueFormatter: p => p.value ? fmtDollar(p.value) : '—', hide: isHidden('settlement_amount') },
    { field: 'cop_per_mt', headerName: 'COP/MT', width: 90, valueFormatter: p => p.value ? `$${fmt(p.value)}` : '—', hide: isHidden('cop_per_mt') },
    { field: 'notes', headerName: 'Notes', width: 150, flex: 1, hide: isHidden('notes') },
    {
      headerName: 'Doc', width: 70, sortable: false, filter: false,
      cellRenderer: p => {
        if (!p.data) return null;
        if (p.data.contract_document_url) {
          return (
            <Tooltip title="View contract document">
              <IconButton size="small" href={p.data.contract_document_url} target="_blank">
                <DescriptionIcon fontSize="small" color="primary" />
              </IconButton>
            </Tooltip>
          );
        }
        if (!canEdit) return null;
        const handleUpload = async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const formData = new FormData();
          formData.append('file', file);
          try {
            await api.post(`/api/farms/${currentFarm.id}/marketing/contracts/${p.data.id}/document`, formData);
            fetchData();
          } catch (err) {
            setSnack({ open: true, message: extractErrorMessage(err, 'Failed to upload document'), severity: 'error' });
          }
        };
        return (
          <>
            <input id={`doc-upload-${p.data.id}`} type="file" accept=".pdf,.doc,.docx,.jpg,.png" hidden onChange={handleUpload} />
            <Tooltip title="Upload contract document">
              <IconButton size="small" onClick={() => document.getElementById(`doc-upload-${p.data.id}`)?.click()}>
                <UploadFileIcon fontSize="small" color="action" />
              </IconButton>
            </Tooltip>
          </>
        );
      },
    },
    {
      headerName: 'Actions', width: 160, sortable: false, filter: false, pinned: 'right',
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
            {c.status !== 'cancelled' && isAdmin && (
              <Tooltip title="Cancel Contract">
                <IconButton size="small" color="error" onClick={() => handleCancelContract(c)}>
                  <CancelIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {isAdmin && (
              <Tooltip title="Delete Permanently">
                <IconButton size="small" color="error" onClick={() => handlePermanentDelete(c)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        );
      },
    },
  ];
  }, [canEdit, isAdmin, hiddenColumns, currentFarm, fetchData]);

  const defaultColDef = useMemo(() => ({ sortable: true, resizable: true, filter: true }), []);

  // Persist column order/width/sort across refreshes
  const COLUMN_STATE_KEY = 'c2farms_contracts_col_state';
  const onGridReady = useCallback((params) => {
    const saved = localStorage.getItem(COLUMN_STATE_KEY);
    if (saved) {
      try { params.api.applyColumnState({ state: JSON.parse(saved), applyOrder: true }); } catch { /* ignore */ }
    }
  }, []);
  const saveColumnState = useCallback(() => {
    if (!gridRef.current?.api) return;
    const state = gridRef.current.api.getColumnState();
    localStorage.setItem(COLUMN_STATE_KEY, JSON.stringify(state));
  }, []);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>Marketing Contracts</Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          {selectedCount > 0 && isAdmin && (
            <>
              <Button
                variant="outlined"
                color="success"
                size="small"
                startIcon={<CheckCircleIcon />}
                onClick={handleBulkClose}
              >
                Close ({selectedCount})
              </Button>
              <Button
                variant="outlined"
                color="error"
                size="small"
                startIcon={<CancelIcon />}
                onClick={handleDeleteSelected}
              >
                Cancel ({selectedCount})
              </Button>
              <Button
                variant="contained"
                color="error"
                size="small"
                startIcon={<DeleteIcon />}
                onClick={handlePermanentDeleteSelected}
              >
                Delete ({selectedCount})
              </Button>
            </>
          )}
          <Tooltip title="Export PDF">
            <IconButton onClick={handleExportPdf} disabled={exporting}>
              {exporting ? <CircularProgress size={20} /> : <PictureAsPdfIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Toggle Columns">
            <IconButton onClick={(e) => setColumnMenuAnchor(e.currentTarget)}>
              <ViewColumnIcon />
            </IconButton>
          </Tooltip>
          {isAdmin && (
            <Tooltip title="Settings">
              <IconButton onClick={() => setSettingsOpen(true)}><SettingsIcon /></IconButton>
            </Tooltip>
          )}
          {canEdit && (
            <>
              <Button variant="outlined" startIcon={<SwapHorizIcon />} onClick={() => setLgxTransferOpen(true)}>
                LGX Transfer
              </Button>
              <Button variant="outlined" startIcon={<FileUploadIcon />} onClick={() => setImportOpen(true)}>
                Import PDF
              </Button>
              <Button variant="outlined" startIcon={<FileUploadIcon />} onClick={() => setBatchImportOpen(true)}>
                Batch Import
              </Button>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setContractDialog({ open: true, initial: null })}>
                New Contract
              </Button>
            </>
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
          rowSelection="multiple"
          suppressRowClickSelection
          getRowId={p => p.data?.id}
          onSelectionChanged={onSelectionChanged}
          onGridReady={onGridReady}
          onColumnMoved={saveColumnState}
          onColumnResized={saveColumnState}
          onSortChanged={saveColumnState}
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

      <ContractImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        farmId={currentFarm?.id}
        onImported={fetchData}
      />

      <ContractBatchImportDialog
        open={batchImportOpen}
        onClose={() => setBatchImportOpen(false)}
        farmId={currentFarm?.id}
        onImported={fetchData}
      />

      <TransferAgreementFromTerminalDialog
        open={lgxTransferOpen}
        onClose={() => setLgxTransferOpen(false)}
        farmId={currentFarm?.id}
        onCreated={fetchData}
      />

      <MarketingSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        farmId={currentFarm?.id}
      />

      {/* Column Toggle Menu */}
      <Menu
        anchorEl={columnMenuAnchor}
        open={Boolean(columnMenuAnchor)}
        onClose={() => setColumnMenuAnchor(null)}
        slotProps={{ paper: { sx: { maxHeight: 400 } } }}
      >
        <MenuItem dense disabled>
          <Typography variant="caption" sx={{ fontWeight: 600 }}>Show/Hide Columns</Typography>
        </MenuItem>
        <Divider />
        {TOGGLEABLE_COLUMNS.map(col => (
          <MenuItem key={col.key} dense onClick={() => toggleColumn(col.key)}>
            <Checkbox size="small" checked={!hiddenColumns.includes(col.key)} sx={{ p: 0, mr: 1 }} />
            <ListItemText primary={col.label} primaryTypographyProps={{ variant: 'body2' }} />
          </MenuItem>
        ))}
      </Menu>

      <Snackbar open={snack.open} autoHideDuration={6000} onClose={() => setSnack(s => ({ ...s, open: false }))}>
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>{snack.message}</Alert>
      </Snackbar>
      <ConfirmDialog {...confirmDialogProps} />
    </Box>
  );
}
