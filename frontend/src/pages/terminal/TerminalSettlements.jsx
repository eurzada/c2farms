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

const STATUS_COLORS = {
  draft: 'default',
  finalized: 'warning',
  pushed: 'success',
};

const TYPE_COLORS = {
  transfer: 'primary',
  transloading: 'warning',
};

export default function TerminalSettlements() {
  const { currentFarm } = useFarm();
  const { mode } = useThemeMode();
  const navigate = useNavigate();
  const gridRef = useRef();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);

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

  // Summary calculations
  const summary = useMemo(() => {
    const byType = { transfer: { count: 0, amount: 0 }, transloading: { count: 0, amount: 0 } };
    for (const r of rows) {
      const t = r.type || 'transfer';
      if (byType[t]) {
        byType[t].count += 1;
        byType[t].amount += parseFloat(r.net_amount) || 0;
      }
    }
    return byType;
  }, [rows]);

  const handleFinalize = async (id) => {
    try {
      await api.post(`/api/farms/${farmId}/terminal/settlements/${id}/finalize`);
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to finalize settlement'));
    }
  };

  const handlePush = async (id) => {
    try {
      await api.post(`/api/farms/${farmId}/terminal/settlements/${id}/push`);
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to push settlement'));
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
      field: 'type', headerName: 'Type', width: 120,
      cellRenderer: p => (
        <Chip
          label={p.value === 'transfer' ? 'Transfer' : 'Transloading'}
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
          label={p.value === 'draft' ? 'Draft' : p.value === 'finalized' ? 'Finalized' : 'Pushed'}
          size="small"
          color={STATUS_COLORS[p.value] || 'default'}
          variant={p.value === 'draft' ? 'filled' : 'outlined'}
        />
      ),
    },
    {
      headerName: 'Actions', width: 180, sortable: false, filter: false, pinned: 'right',
      cellRenderer: p => {
        const { id, status, type: sType, settlement_number } = p.data;
        if (status === 'draft') {
          return (
            <Button size="small" variant="outlined" onClick={() => handleFinalize(id)}>
              Finalize
            </Button>
          );
        }
        if (status === 'finalized' && sType === 'transfer') {
          return (
            <Button size="small" variant="contained" color="primary" onClick={() => handlePush(id)}>
              Push to Logistics
            </Button>
          );
        }
        if (status === 'finalized' && sType === 'transloading') {
          return (
            <Button size="small" variant="outlined" onClick={() => handleInvoice(id, settlement_number)}>
              Download Invoice
            </Button>
          );
        }
        if (status === 'pushed') {
          return (
            <Button
              size="small"
              startIcon={<OpenInNewIcon />}
              onClick={() => navigate('/logistics/settlements')}
            >
              View in Logistics
            </Button>
          );
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
            <ToggleButton value="transfer">Transfer</ToggleButton>
            <ToggleButton value="transloading">Transloading</ToggleButton>
          </ToggleButtonGroup>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            New Settlement
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* Summary cards */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="primary">Transfer Settlements</Typography>
            <Typography variant="h6" fontWeight={700}>{summary.transfer.count} settlements</Typography>
            <Typography variant="body2">Total: {fmtDollar(summary.transfer.amount)}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="warning.main">Transloading Settlements</Typography>
            <Typography variant="h6" fontWeight={700}>{summary.transloading.count} settlements</Typography>
            <Typography variant="body2">Total: {fmtDollar(summary.transloading.amount)}</Typography>
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
        />
      </Box>

      <CreateTerminalSettlementDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        farmId={farmId}
        onSaved={() => { setCreateOpen(false); load(); }}
      />
    </Box>
  );
}
