import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Box, Typography, Button, Alert, Chip, Paper, Grid,
  ToggleButton, ToggleButtonGroup, Dialog, DialogTitle, DialogContent, DialogActions,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  CircularProgress, TextField, InputAdornment,
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
import BuyerSettlementReconciliationDialog from '../../components/terminal/BuyerSettlementReconciliationDialog';
import UploadFileIcon from '@mui/icons-material/UploadFile';

const STATUS_COLORS = {
  draft: 'default',
  finalized: 'warning',
  pushed: 'success',
};

const TYPE_COLORS = {
  transfer: 'primary',
  transloading: 'warning',
  buyer_settlement: 'success',
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
  const [buyerUploadOpen, setBuyerUploadOpen] = useState(false);
  const [buyerReconOpen, setBuyerReconOpen] = useState(false);
  const [buyerReconId, setBuyerReconId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

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
    const byType = { transfer: { count: 0, amount: 0 }, transloading: { count: 0, amount: 0 }, buyer_settlement: { count: 0, amount: 0, margin: 0 } };
    for (const r of rows) {
      const t = r.type || 'transfer';
      if (byType[t]) {
        byType[t].count += 1;
        byType[t].amount += parseFloat(r.net_amount) || 0;
        if (t === 'buyer_settlement' && r.realization_json) {
          byType[t].margin += r.realization_json.margin || 0;
        }
      }
    }
    return byType;
  }, [rows]);

  const handleApplyGradePricing = async (id) => {
    try {
      await api.post(`/api/farms/${farmId}/terminal/settlements/${id}/apply-pricing`);
      load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to apply grade pricing — set grade prices on the contract first'));
    }
  };

  const openDetail = async (id) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await api.get(`/api/farms/${farmId}/terminal/settlements/${id}`);
      setDetail(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load settlement'));
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleLineUpdate = async (settlementId, lineId, field, value) => {
    try {
      const res = await api.patch(
        `/api/farms/${farmId}/terminal/settlements/${settlementId}/lines/${lineId}`,
        { [field]: value }
      );
      setDetail(res.data);
      load(); // refresh grid totals too
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to update line'));
    }
  };

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
          label={p.value === 'transfer' ? 'Transfer' : p.value === 'buyer_settlement' ? 'Buyer' : 'Transloading'}
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
      headerName: 'Actions', width: 250, sortable: false, filter: false, pinned: 'right',
      cellRenderer: p => {
        const { id, status, type: sType, settlement_number, net_amount } = p.data;

        // Buyer settlement actions
        if (sType === 'buyer_settlement') {
          if (status === 'draft') {
            return (
              <Button size="small" variant="outlined" color="success" onClick={() => { setBuyerReconId(id); setBuyerReconOpen(true); }}>
                Reconcile
              </Button>
            );
          }
          if (status === 'finalized') {
            return (
              <Button size="small" variant="contained" color="primary" onClick={() => { setBuyerReconId(id); setBuyerReconOpen(true); }}>
                Push to Logistics
              </Button>
            );
          }
          if (status === 'pushed') {
            return (
              <Button size="small" startIcon={<OpenInNewIcon />} onClick={() => navigate('/logistics/settlements')}>
                View in Logistics
              </Button>
            );
          }
          return null;
        }

        // Transfer/transloading actions
        if (status === 'draft') {
          const needsPricing = !net_amount || net_amount === 0;
          return (
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {needsPricing && (
                <Button size="small" variant="outlined" color="warning" onClick={() => handleApplyGradePricing(id)}>
                  Apply Pricing
                </Button>
              )}
              <Button size="small" variant="outlined" onClick={() => handleFinalize(id)}>
                Finalize
              </Button>
            </Box>
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
            <ToggleButton value="buyer_settlement">Buyer</ToggleButton>
          </ToggleButtonGroup>
          <Button variant="outlined" color="success" startIcon={<UploadFileIcon />} onClick={() => setBuyerUploadOpen(true)}>
            Upload Buyer Settlement
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            New Settlement
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* Summary cards */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={4}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="primary">Transfer Settlements</Typography>
            <Typography variant="h6" fontWeight={700}>{summary.transfer.count} settlements</Typography>
            <Typography variant="body2">Total: {fmtDollar(summary.transfer.amount)}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="warning.main">Transloading Settlements</Typography>
            <Typography variant="h6" fontWeight={700}>{summary.transloading.count} settlements</Typography>
            <Typography variant="body2">Total: {fmtDollar(summary.transloading.amount)}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="success.main">Buyer Settlements</Typography>
            <Typography variant="h6" fontWeight={700}>{summary.buyer_settlement.count} settlements</Typography>
            <Typography variant="body2">Total: {fmtDollar(summary.buyer_settlement.amount)}</Typography>
            {summary.buyer_settlement.margin > 0 && (
              <Typography variant="body2" color="success.main">Margin: {fmtDollar(summary.buyer_settlement.margin)}</Typography>
            )}
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
          onRowDoubleClicked={p => openDetail(p.data.id)}
        />
      </Box>

      <CreateTerminalSettlementDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        farmId={farmId}
        onSaved={() => { setCreateOpen(false); load(); }}
      />

      <BuyerSettlementUploadDialog
        open={buyerUploadOpen}
        onClose={() => setBuyerUploadOpen(false)}
        farmId={farmId}
        onSaved={() => { setBuyerUploadOpen(false); load(); }}
      />

      <BuyerSettlementReconciliationDialog
        open={buyerReconOpen}
        onClose={() => { setBuyerReconOpen(false); setBuyerReconId(null); }}
        farmId={farmId}
        settlementId={buyerReconId}
        onDone={load}
      />

      {/* Settlement Detail Dialog */}
      <Dialog open={detailOpen} onClose={() => { setDetailOpen(false); setDetail(null); }} maxWidth="lg" fullWidth>
        <DialogTitle>
          {detail ? (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{detail.settlement_number}</span>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Chip label={detail.type === 'transfer' ? 'Transfer' : detail.type === 'buyer_settlement' ? 'Buyer' : 'Transloading'} size="small" color={TYPE_COLORS[detail.type] || 'default'} variant="outlined" />
                <Chip label={detail.status} size="small" color={STATUS_COLORS[detail.status] || 'default'} />
              </Box>
            </Box>
          ) : 'Settlement Detail'}
        </DialogTitle>
        <DialogContent dividers>
          {detailLoading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>}
          {detail && !detailLoading && (
            <>
              <Box sx={{ display: 'flex', gap: 4, mb: 2 }}>
                <Typography variant="body2"><strong>Contract:</strong> {detail.contract?.contract_number || '—'}</Typography>
                <Typography variant="body2"><strong>Counterparty:</strong> {detail.counterparty?.name || '—'}</Typography>
                <Typography variant="body2"><strong>Date:</strong> {detail.settlement_date ? new Date(detail.settlement_date).toLocaleDateString('en-CA') : '—'}</Typography>
                <Typography variant="body2"><strong>Net Amount:</strong> {fmtDollar(detail.net_amount)}</Typography>
              </Box>

              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Line #</TableCell>
                      <TableCell>Ticket #</TableCell>
                      <TableCell>Source</TableCell>
                      <TableCell>Grade</TableCell>
                      <TableCell align="right">Net MT</TableCell>
                      <TableCell align="right">$/MT</TableCell>
                      <TableCell align="right">Amount</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(detail.lines || []).map(l => {
                      const isDraft = detail.status === 'draft';
                      return (
                        <TableRow key={l.id}>
                          <TableCell>{l.line_number}</TableCell>
                          <TableCell>{l.ticket?.ticket_number || '—'}</TableCell>
                          <TableCell>{l.source_farm_name || '—'}</TableCell>
                          <TableCell>
                            {isDraft ? (
                              <TextField
                                size="small" variant="standard" defaultValue={l.grade || ''}
                                onBlur={e => { if (e.target.value !== (l.grade || '')) handleLineUpdate(detail.id, l.id, 'grade', e.target.value); }}
                                sx={{ width: 110 }}
                              />
                            ) : (l.grade || '—')}
                          </TableCell>
                          <TableCell align="right">{l.net_weight_mt != null ? fmt(l.net_weight_mt) : '—'}</TableCell>
                          <TableCell align="right">
                            {isDraft ? (
                              <TextField
                                size="small" variant="standard" type="number" defaultValue={l.price_per_mt ?? ''}
                                onBlur={e => { if (e.target.value !== String(l.price_per_mt ?? '')) handleLineUpdate(detail.id, l.id, 'price_per_mt', e.target.value); }}
                                sx={{ width: 90 }}
                                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                              />
                            ) : (l.price_per_mt != null ? fmtDollar(l.price_per_mt) : '—')}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>{l.line_amount != null ? fmtDollar(l.line_amount) : '—'}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow sx={{ '& td': { fontWeight: 700, borderTop: '2px solid', borderColor: 'divider' } }}>
                      <TableCell colSpan={4}>Totals ({(detail.lines || []).length} lines)</TableCell>
                      <TableCell align="right">{fmt((detail.lines || []).reduce((s, l) => s + (l.net_weight_mt || 0), 0))}</TableCell>
                      <TableCell />
                      <TableCell align="right">{fmtDollar(detail.net_amount)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>

              {detail.notes && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  <strong>Notes:</strong> {detail.notes}
                </Typography>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          {detail?.status === 'draft' && (
            <>
              <Button color="warning" onClick={() => { handleApplyGradePricing(detail.id); openDetail(detail.id); }}>
                Apply Pricing
              </Button>
              <Button onClick={() => { handleFinalize(detail.id); setDetailOpen(false); setDetail(null); }}>
                Finalize
              </Button>
            </>
          )}
          {detail?.status === 'finalized' && detail?.type === 'transfer' && (
            <Button variant="contained" onClick={() => { handlePush(detail.id); setDetailOpen(false); setDetail(null); }}>
              Push to Logistics
            </Button>
          )}
          <Button onClick={() => { setDetailOpen(false); setDetail(null); }}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
