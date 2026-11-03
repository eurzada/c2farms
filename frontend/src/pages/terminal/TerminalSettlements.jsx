import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Box, Typography, Button, Alert, Chip, Paper, Grid,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import AddIcon from '@mui/icons-material/Add';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useNavigate } from 'react-router-dom';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { formatCurrency, fmt, fmtDollar } from '../../utils/formatting';
import CreateTerminalSettlementDialog from '../../components/terminal/CreateTerminalSettlementDialog';
import BuyerSettlementUploadDialog from '../../components/terminal/BuyerSettlementUploadDialog';
import TonnageReconciliationDialog from '../../components/terminal/TonnageReconciliationDialog';
import TerminalSettlementDetailDialog from '../../components/terminal/TerminalSettlementDetailDialog';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import useGridState from '../../hooks/useGridState.js';

const STATUS_COLORS = {
  draft: 'default',
  finalized: 'warning',
  pushed: 'success',
};

const TYPE_COLORS = {
  bu_credit: 'info',
  transloading: 'warning',
  grain_sale: 'success',
  // legacy types kept for display of old data
  transfer: 'primary',
  buyer_settlement: 'success',
};

const TYPE_LABELS = {
  bu_credit: 'BU Credit',
  transloading: 'Transloading',
  grain_sale: 'Grain Sale',
  // legacy
  transfer: 'Transfer (legacy)',
  buyer_settlement: 'Grain Sale',
};

export default function TerminalSettlements() {
  const { currentFarm, isAdmin } = useFarm();
  const { mode } = useThemeMode();
  const navigate = useNavigate();
  const gridRef = useRef();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [grainSaleUploadOpen, setGrainSaleUploadOpen] = useState(false);
  const [tonnageReconOpen, setTonnageReconOpen] = useState(false);
  const [tonnageReconId, setTonnageReconId] = useState(null);
  const [detailId, setDetailId] = useState(null);

  const { onGridReady, onStateChanged } = useGridState('c2_terminal_settlements_grid');
  const farmId = currentFarm?.id;

  const load = useCallback(async () => {
    if (!farmId) return;
    try {
      setLoading(true);
      const params = filter !== 'all' ? { type: filter } : {};
      const res = await api.get(`/api/farms/${farmId}/terminal/settlements`, {
        params: { ...params, limit: 500 },
      });
      setRows(res.data.settlements || []);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load settlements'));
    } finally {
      setLoading(false);
    }
  }, [farmId, filter]);

  useEffect(() => { load(); }, [load]);

  // Summary — group grain sale + legacy buyer_settlement together
  const summary = useMemo(() => {
    let grainSale = { count: 0, amount: 0 };
    let transloading = { count: 0, amount: 0 };
    let buCredit = { count: 0, amount: 0 };
    for (const r of rows) {
      const t = r.type || 'grain_sale';
      const amt = parseFloat(r.net_amount) || 0;
      if (t === 'grain_sale' || t === 'buyer_settlement' || t === 'transfer') {
        grainSale.count += 1;
        grainSale.amount += amt;
      } else if (t === 'transloading') {
        transloading.count += 1;
        transloading.amount += amt;
      } else if (t === 'bu_credit') {
        buCredit.count += 1;
        buCredit.amount += amt;
      }
    }
    return { grainSale, transloading, buCredit };
  }, [rows]);

  const handleFinalize = async (id) => {
    try {
      await api.post(`/api/farms/${farmId}/terminal/settlements/${id}/finalize`);
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to finalize settlement'));
    }
  };

  const handleInvoice = async (id, settlementNumber) => {
    try {
      const res = await api.get(`/api/farms/${farmId}/terminal/settlements/${id}/invoice`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${settlementNumber || id}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to download invoice'));
    }
  };

  const columnDefs = useMemo(() => [
    { field: 'settlement_number', headerName: 'Settlement #', width: 160 },
    {
      field: 'type', headerName: 'Type', width: 130,
      cellRenderer: p => (
        <Chip
          label={TYPE_LABELS[p.value] || p.value}
          size="small"
          color={TYPE_COLORS[p.value] || 'default'}
          variant="outlined"
        />
      ),
    },
    { field: 'counterparty.name', headerName: 'Counterparty', width: 180 },
    { field: 'contract.contract_number', headerName: 'Contract #', width: 140 },
    {
      field: 'settlement_date', headerName: 'Date', width: 110,
      valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString('en-CA') : '',
    },
    {
      headerName: 'Total MT', width: 110, type: 'numericColumn',
      valueGetter: p => {
        const lines = p.data.lines || [];
        return lines.reduce((s, l) => s + (parseFloat(l.net_weight_mt) || 0), 0);
      },
      valueFormatter: p => p.value ? fmt(p.value) : '',
    },
    {
      field: 'net_amount', headerName: 'Net Amount', width: 130, type: 'numericColumn',
      valueFormatter: p => p.value ? formatCurrency(p.value) : '',
      cellStyle: { fontWeight: 700 },
    },
    {
      field: 'status', headerName: 'Status', width: 120,
      cellRenderer: p => (
        <Chip
          label={p.value === 'draft' ? 'Draft' : p.value === 'finalized' ? 'Finalized' : 'Complete'}
          size="small"
          color={STATUS_COLORS[p.value] || 'default'}
          variant={p.value === 'draft' ? 'filled' : 'outlined'}
        />
      ),
    },
    {
      headerName: 'Actions', width: 220, sortable: false, filter: false, pinned: 'right',
      cellRenderer: p => {
        const { id, status, type: sType, settlement_number } = p.data;

        // Transloading: draft → finalize, finalized → download invoice
        if (sType === 'transloading') {
          if (status === 'draft') {
            return (
              <Button size="small" variant="outlined" onClick={() => handleFinalize(id)}>Finalize</Button>
            );
          }
          if (status === 'finalized') {
            return (
              <Button size="small" variant="outlined" onClick={() => handleInvoice(id, settlement_number)}>
                Download Invoice
              </Button>
            );
          }
          return null;
        }

        // BU Credit: read-only, just view detail
        if (sType === 'bu_credit') {
          return null;
        }

        // Grain sale / legacy buyer_settlement: view detail
        if (sType === 'grain_sale' || sType === 'buyer_settlement' || sType === 'transfer') {
          if (status === 'pushed' || status === 'finalized') {
            return (
              <Button size="small" startIcon={<OpenInNewIcon />} onClick={() => navigate('/logistics/settlements')}>
                View in Logistics
              </Button>
            );
          }
          return null;
        }

        return null;
      },
    },
  ], [farmId, navigate]);

  const defaultColDef = useMemo(() => ({ sortable: true, filter: true, resizable: true }), []);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={700}>Terminal Settlements</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <ToggleButtonGroup size="small" value={filter} exclusive onChange={(_, v) => v && setFilter(v)}>
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="grain_sale">Grain Sales</ToggleButton>
            <ToggleButton value="transloading">Transloading</ToggleButton>
          </ToggleButtonGroup>
          <Button variant="outlined" color="success" startIcon={<UploadFileIcon />} onClick={() => setGrainSaleUploadOpen(true)}>
            Upload Grain Sale PDF
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            New Transloading Invoice
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* Summary cards */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={4}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="success.main">Grain Sale Settlements</Typography>
            <Typography variant="h6" fontWeight={700}>{summary.grainSale.count} settlements</Typography>
            <Typography variant="body2">Total: {fmtDollar(summary.grainSale.amount)}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="warning.main">Transloading Revenue</Typography>
            <Typography variant="h6" fontWeight={700}>{summary.transloading.count} invoices</Typography>
            <Typography variant="body2">Revenue: {fmtDollar(summary.transloading.amount)}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="info.main">BU Farm Credits</Typography>
            <Typography variant="h6" fontWeight={700}>{summary.buCredit.count} allocations</Typography>
            <Typography variant="body2">Allocated: {fmtDollar(summary.buCredit.amount)}</Typography>
          </Paper>
        </Grid>
      </Grid>

      <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 'calc(100vh - 360px)', width: '100%' }}>
        <AgGridReact
          ref={gridRef}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          getRowId={p => p.data.id}
          loading={loading}
          onRowDoubleClicked={p => setDetailId(p.data.id)}
          onGridReady={onGridReady}
          onColumnResized={onStateChanged}
          onColumnMoved={onStateChanged}
          onSortChanged={onStateChanged}
          onColumnVisible={onStateChanged}
        />
      </Box>

      <CreateTerminalSettlementDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        farmId={farmId}
        onSaved={() => { setCreateOpen(false); load(); }}
      />

      <BuyerSettlementUploadDialog
        open={grainSaleUploadOpen}
        onClose={() => setGrainSaleUploadOpen(false)}
        farmId={farmId}
        onSaved={() => { setGrainSaleUploadOpen(false); load(); }}
      />

      <TonnageReconciliationDialog
        open={tonnageReconOpen}
        onClose={() => { setTonnageReconOpen(false); setTonnageReconId(null); }}
        farmId={farmId}
        settlementId={tonnageReconId}
        onDone={load}
      />

      <TerminalSettlementDetailDialog
        open={!!detailId}
        onClose={() => setDetailId(null)}
        settlementId={detailId}
        farmId={farmId}
        isAdmin={isAdmin}
        allSettlements={rows}
        onAction={(action, id) => {
          if (action === 'deleted' || action === 'finalized' || action === 'pushed' || action === 'reverted' || action === 'priced') {
            setDetailId(null);
            load();
          } else if (action === 'tonnage-recon') {
            setDetailId(null);
            setTonnageReconId(id);
            setTonnageReconOpen(true);
          } else if (action === 'refreshDetail') {
            load();
          }
        }}
      />
    </Box>
  );
}
