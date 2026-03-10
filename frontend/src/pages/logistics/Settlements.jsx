import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Button, Stack, Chip, TextField, MenuItem,
  Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Tooltip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  Alert, Divider, Snackbar, Card, CardContent, Collapse,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay';
import CircularProgress from '@mui/material/CircularProgress';
import DeleteIcon from '@mui/icons-material/Delete';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import EditIcon from '@mui/icons-material/Edit';
import SummarizeIcon from '@mui/icons-material/Summarize';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { useNavigate } from 'react-router-dom';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import SettlementUploadDialog from '../../components/inventory/SettlementUploadDialog';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { fmt, fmtDollar } from '../../utils/formatting';

const STATUS_COLORS = {
  pending: 'warning',
  reconciled: 'info',
  disputed: 'error',
  approved: 'success',
};

const STORAGE_KEY = 'c2_settlements_grid_state';

function loadGridState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch { return {}; }
}

function saveGridState(patch) {
  const prev = loadGridState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prev, ...patch }));
}

export default function Settlements() {
  const { currentFarm, canEdit, isAdmin } = useFarm();
  const { mode } = useThemeMode();
  const navigate = useNavigate();
  const gridRef = useRef();

  const savedState = useRef(loadGridState());
  const [settlements, setSettlements] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalMt, setTotalMt] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState(savedState.current.statusFilter || '');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'success' });
  const [reconAllLoading, setReconAllLoading] = useState(false);
  const [gapOpen, setGapOpen] = useState(false);
  const [gapData, setGapData] = useState(null);
  const [gapLoading, setGapLoading] = useState(false);
  const [expandedSections, setExpandedSections] = useState({});
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  const fetchData = useCallback(() => {
    if (!currentFarm) return;
    const params = new URLSearchParams();
    if (statusFilter) params.append('status', statusFilter);
    api.get(`/api/farms/${currentFarm.id}/settlements?${params}`).then(res => {
      setSettlements(res.data.settlements || []);
      setTotal(res.data.total || 0);
      setTotalMt(res.data.total_mt || 0);
    });
  }, [currentFarm, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openDetail = useCallback(async (id) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setEditing(false);
    try {
      const res = await api.get(`/api/farms/${currentFarm.id}/settlements/${id}`);
      setDetail(res.data.settlement);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [currentFarm]);

  const handleDelete = async (id, number) => {
    const ok = await confirm({
      title: 'Delete Settlement',
      message: `Delete settlement #${number}? This will permanently remove it and all its lines.`,
      confirmText: 'Delete',
      confirmColor: 'error',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/farms/${currentFarm.id}/settlements/${id}`);
      fetchData();
      if (detail?.id === id) { setDetailOpen(false); setDetail(null); }
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to delete settlement'), severity: 'error' });
    }
  };

  const pendingCount = settlements.filter(s => s.status === 'pending').length;

  const handleReconcileAll = async () => {
    const ok = await confirm({
      title: 'Reconcile All Pending',
      message: `Run AI reconciliation on ${pendingCount} pending settlement${pendingCount !== 1 ? 's' : ''}? This may take a moment.`,
      confirmText: 'Reconcile All',
    });
    if (!ok) return;
    setReconAllLoading(true);
    try {
      const res = await api.post(`/api/farms/${currentFarm.id}/settlements/reconcile-all`);
      const { succeeded, failed, total: t } = res.data;
      setSnack({
        open: true,
        message: `Reconciled ${succeeded} of ${t} settlements${failed ? ` (${failed} failed)` : ''}`,
        severity: failed ? 'warning' : 'success',
      });
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Reconcile all failed'), severity: 'error' });
    } finally {
      setReconAllLoading(false);
    }
  };

  const handleReconGapReport = async () => {
    setGapOpen(true);
    setGapLoading(true);
    try {
      const res = await api.get(`/api/farms/${currentFarm.id}/settlements/reports/recon-gaps`);
      setGapData(res.data);
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to load report'), severity: 'error' });
      setGapOpen(false);
    } finally {
      setGapLoading(false);
    }
  };

  const toggleSection = (key) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const downloadGapFile = async (format) => {
    try {
      const mimeTypes = { excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf', csv: 'text/csv' };
      const extensions = { excel: 'xlsx', pdf: 'pdf', csv: 'csv' };
      const res = await api.get(
        `/api/farms/${currentFarm.id}/settlements/reports/recon-gaps/${format}`,
        { responseType: 'blob' }
      );
      const blob = new Blob([res.data], { type: mimeTypes[format] });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recon-gap-report-${new Date().toISOString().slice(0, 10)}.${extensions[format]}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, `Failed to download ${format}`), severity: 'error' });
    }
  };

  const copyGapReport = () => {
    if (!gapData) return;
    const { summary, sections } = gapData;
    const lines = [
      'Reconciliation Gap Report',
      `Generated: ${new Date().toLocaleDateString()}`,
      '',
      `Shipped, No Settlement: ${summary.shipped_no_settlement}`,
      `Settled, No Contract in System: ${summary.settled_no_contract}`,
      `Settlement Lines, Missing Tickets: ${summary.missing_ticket_lines}`,
      `Shipped, No Contract Reference: ${summary.shipped_no_contract_ref}`,
      `Contracts with No Activity: ${summary.contracts_no_activity}`,
      '',
    ];
    if (sections.shipped_no_settlement.length) {
      lines.push('--- Shipped, No Settlement ---');
      for (const r of sections.shipped_no_settlement) {
        lines.push(`  ${r.contract_number || '(no contract)'} | ${r.buyer_name} | ${r.commodity} | ${r.ticket_count} tickets | ${r.total_mt} MT`);
      }
      lines.push('');
    }
    if (sections.settled_no_contract.length) {
      lines.push('--- Settled, No Contract in System ---');
      for (const r of sections.settled_no_contract) {
        lines.push(`  ${r.contract_number} | ${r.buyer} | ${r.commodity} | ${r.settlement_count} settlements | ${fmtDollar(r.total_amount)}`);
      }
      lines.push('');
    }
    if (sections.contracts_no_activity.length) {
      lines.push('--- Contracts with No Activity ---');
      for (const r of sections.contracts_no_activity) {
        lines.push(`  ${r.contract_number} | ${r.counterparty} | ${r.commodity} | ${r.contracted_mt} MT | ${r.status}`);
      }
    }
    navigator.clipboard.writeText(lines.join('\n'));
    setSnack({ open: true, message: 'Report copied to clipboard', severity: 'success' });
  };

  const startEditing = () => {
    setEditing(true);
    setEditForm({
      contract_number: detail?.marketing_contract?.contract_number || '',
      status: detail?.status || 'pending',
      notes: detail?.notes || '',
      total_amount: detail?.total_amount ?? '',
    });
  };

  const handleSave = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      const body = {};
      // Only send changed fields
      if (editForm.contract_number !== (detail.marketing_contract?.contract_number || '')) {
        body.contract_number = editForm.contract_number;
      }
      if (editForm.status !== detail.status) {
        body.status = editForm.status;
      }
      if (editForm.notes !== (detail.notes || '')) {
        body.notes = editForm.notes;
      }
      const amt = editForm.total_amount === '' ? null : parseFloat(editForm.total_amount);
      if (amt !== detail.total_amount) {
        body.total_amount = amt;
      }

      if (Object.keys(body).length === 0) {
        setEditing(false);
        return;
      }

      const res = await api.patch(`/api/farms/${currentFarm.id}/settlements/${detail.id}`, body);
      // Refresh the full detail (PATCH returns limited includes)
      const fullRes = await api.get(`/api/farms/${currentFarm.id}/settlements/${detail.id}`);
      setDetail(fullRes.data.settlement);
      setEditing(false);
      setSnack({ open: true, message: 'Settlement updated', severity: 'success' });
      fetchData(); // refresh grid too
    } catch (err) {
      setSnack({ open: true, message: err.response?.data?.error || 'Update failed', severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const columnDefs = useMemo(() => [
    { field: 'settlement_number', headerName: 'Settlement #', width: 140 },
    {
      field: 'settlement_date', headerName: 'Date', width: 110,
      valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString() : '',
    },
    { field: 'counterparty.name', headerName: 'Buyer', width: 150 },
    { field: 'buyer_format', headerName: 'Format', width: 100, valueFormatter: p => p.value?.toUpperCase() || '' },
    { field: 'marketing_contract.contract_number', headerName: 'Contract #', width: 130 },
    { field: 'marketing_contract.commodity.name', headerName: 'Commodity', width: 120 },
    {
      field: 'total_amount', headerName: 'Amount', width: 120,
      valueFormatter: p => p.value ? fmtDollar(p.value) : '',
    },
    { field: '_count.lines', headerName: 'Lines', width: 70 },
    {
      field: 'status', headerName: 'Status', width: 110,
      cellRenderer: p => (
        <Chip label={p.value} size="small" color={STATUS_COLORS[p.value] || 'default'} />
      ),
    },
    {
      headerName: 'Actions', width: 160, sortable: false, filter: false, pinned: 'right',
      cellRenderer: p => (
        <Stack direction="row" spacing={0} alignItems="center">
          <Tooltip title="View Details">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); openDetail(p.data.id); }}>
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Reconcile">
            <IconButton size="small" color="primary" onClick={(e) => { e.stopPropagation(); navigate(`/logistics/settlement-recon?id=${p.data.id}`); }}>
              <AutoFixHighIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {isAdmin && (
            <Tooltip title="Delete">
              <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); handleDelete(p.data.id, p.data.settlement_number); }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      ),
    },
  ], [navigate, openDetail, isAdmin]);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>Settlements</Typography>
          <Typography variant="body2" color="text.secondary">
            {total} settlement{total !== 1 ? 's' : ''}{totalMt > 0 ? ` | ${fmt(totalMt)} MT delivered` : ''}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <TextField
            select size="small" label="Status" value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); saveGridState({ statusFilter: e.target.value }); }}
            sx={{ minWidth: 120 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="pending">Pending</MenuItem>
            <MenuItem value="reconciled">Reconciled</MenuItem>
            <MenuItem value="disputed">Disputed</MenuItem>
            <MenuItem value="approved">Approved</MenuItem>
          </TextField>
          <Button variant="outlined" color="warning" startIcon={<SummarizeIcon />} onClick={handleReconGapReport}>
            Recon Gap Report
          </Button>
          {canEdit && pendingCount > 0 && (
            <Button
              variant="outlined"
              startIcon={reconAllLoading ? <CircularProgress size={16} /> : <PlaylistPlayIcon />}
              onClick={handleReconcileAll}
              disabled={reconAllLoading}
            >
              {reconAllLoading ? 'Reconciling...' : `Reconcile All (${pendingCount})`}
            </Button>
          )}
          {canEdit && (
            <Button variant="contained" startIcon={<FileUploadIcon />} onClick={() => setUploadOpen(true)}>
              Upload Settlement
            </Button>
          )}
        </Stack>
      </Stack>

      <Box
        className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'}
        sx={{ height: 500, width: '100%' }}
      >
        <AgGridReact
          ref={gridRef}
          rowData={settlements}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true, filter: true }}
          animateRows
          enableCellTextSelection
          ensureDomOrder
          getRowId={p => p.data?.id}
          onRowDoubleClicked={p => openDetail(p.data.id)}
          onGridReady={(params) => {
            const s = savedState.current;
            if (s.sortModel?.length) {
              params.api.applyColumnState({ state: s.sortModel, defaultState: { sort: null } });
            }
            if (s.columnState) {
              params.api.applyColumnState({ state: s.columnState });
            }
          }}
          onSortChanged={() => {
            const colState = gridRef.current?.api?.getColumnState();
            const sortModel = colState?.filter(c => c.sort);
            saveGridState({ sortModel, columnState: colState });
          }}
        />
      </Box>

      <SettlementUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        farmId={currentFarm?.id}
        onUploaded={fetchData}
      />

      {/* Settlement Detail Dialog */}
      <Dialog open={detailOpen} onClose={() => { setDetailOpen(false); setDetail(null); setEditing(false); }} maxWidth="lg" fullWidth>
        <DialogTitle>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <span>Settlement {detail?.settlement_number ? `#${detail.settlement_number}` : ''}</span>
            <Stack direction="row" spacing={1} alignItems="center">
              {detail && (
                <Chip label={editing ? editForm.status : detail.status} size="small" color={STATUS_COLORS[editing ? editForm.status : detail.status] || 'default'} />
              )}
              {detail?.buyer_format && (
                <Chip label={detail.buyer_format.toUpperCase()} size="small" variant="outlined" />
              )}
              {detail && canEdit && !editing && (
                <Tooltip title="Edit Settlement">
                  <IconButton size="small" onClick={startEditing}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {detailLoading && <Typography color="text.secondary">Loading...</Typography>}
          {!detailLoading && !detail && <Alert severity="error">Settlement not found.</Alert>}
          {detail && (
            <>
              {/* Header info — editable or read-only */}
              {editing ? (
                <Stack spacing={2} sx={{ mb: 2 }}>
                  <Stack direction="row" spacing={2} flexWrap="wrap">
                    <TextField
                      label="Contract #" size="small" value={editForm.contract_number}
                      onChange={e => setEditForm(f => ({ ...f, contract_number: e.target.value }))}
                      helperText="Links to a Marketing Contract (auto-fills commodity)"
                      sx={{ minWidth: 200 }}
                    />
                    <TextField
                      select label="Status" size="small" value={editForm.status}
                      onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                      sx={{ minWidth: 150 }}
                    >
                      <MenuItem value="pending">Pending</MenuItem>
                      <MenuItem value="reconciled">Reconciled</MenuItem>
                      <MenuItem value="disputed">Disputed</MenuItem>
                      <MenuItem value="approved">Approved</MenuItem>
                    </TextField>
                    <TextField
                      label="Total Amount" size="small" type="number" value={editForm.total_amount}
                      onChange={e => setEditForm(f => ({ ...f, total_amount: e.target.value }))}
                      sx={{ minWidth: 160 }}
                    />
                  </Stack>
                  <TextField
                    label="Notes" size="small" multiline rows={2} fullWidth value={editForm.notes}
                    onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  />
                  <Stack direction="row" spacing={1}>
                    <Button variant="contained" size="small" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
                      {saving ? 'Saving...' : 'Save Changes'}
                    </Button>
                    <Button size="small" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
                  </Stack>
                </Stack>
              ) : (
                <Stack direction="row" spacing={4} sx={{ mb: 2 }} flexWrap="wrap">
                  <Box>
                    <Typography variant="caption" color="text.secondary">Date</Typography>
                    <Typography variant="body2">{detail.settlement_date ? new Date(detail.settlement_date).toLocaleDateString() : '—'}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Buyer</Typography>
                    <Typography variant="body2">{detail.counterparty?.name || '—'}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Contract</Typography>
                    <Typography variant="body2" color={detail.marketing_contract?.contract_number ? 'text.primary' : 'warning.main'}>
                      {detail.marketing_contract?.contract_number || '— (click edit to set)'}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Commodity</Typography>
                    <Typography variant="body2" color={detail.marketing_contract?.commodity?.name ? 'text.primary' : 'warning.main'}>
                      {detail.marketing_contract?.commodity?.name || '— (set contract #)'}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Total Amount</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{fmtDollar(detail.total_amount)}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Lines</Typography>
                    <Typography variant="body2">{detail.lines?.length || 0}</Typography>
                  </Box>
                </Stack>
              )}

              {detail.notes && !editing && (
                <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
                  <Typography variant="body2">{detail.notes}</Typography>
                </Alert>
              )}

              <Divider sx={{ mb: 2 }} />

              {/* Settlement Lines */}
              {detail.lines?.length > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>#</TableCell>
                        <TableCell>Ticket #</TableCell>
                        <TableCell>Date</TableCell>
                        <TableCell>Grade</TableCell>
                        <TableCell align="right">Gross MT</TableCell>
                        <TableCell align="right">Net MT</TableCell>
                        <TableCell align="right">$/MT</TableCell>
                        <TableCell align="right">$/bu</TableCell>
                        <TableCell align="right">Gross $</TableCell>
                        <TableCell align="right">Net $</TableCell>
                        <TableCell>Match</TableCell>
                        <TableCell>Matched Ticket</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detail.lines.map(line => (
                        <TableRow key={line.id} sx={{
                          bgcolor: line.match_status === 'matched' ? 'success.50'
                            : line.match_status === 'exception' ? 'error.50'
                            : line.match_status === 'manual' ? 'info.50'
                            : undefined,
                        }}>
                          <TableCell>{line.line_number}</TableCell>
                          <TableCell>{line.ticket_number_on_settlement || '—'}</TableCell>
                          <TableCell>{line.delivery_date ? new Date(line.delivery_date).toLocaleDateString() : '—'}</TableCell>
                          <TableCell>{line.grade || '—'}</TableCell>
                          <TableCell align="right">{fmt(line.gross_weight_mt)}</TableCell>
                          <TableCell align="right">{fmt(line.net_weight_mt)}</TableCell>
                          <TableCell align="right">{line.price_per_mt ? fmtDollar(line.price_per_mt) : '—'}</TableCell>
                          <TableCell align="right">{line.price_per_bu ? fmtDollar(line.price_per_bu) : '—'}</TableCell>
                          <TableCell align="right">{line.line_gross ? fmtDollar(line.line_gross) : '—'}</TableCell>
                          <TableCell align="right">{line.line_net ? fmtDollar(line.line_net) : '—'}</TableCell>
                          <TableCell>
                            <Chip
                              label={line.match_status}
                              size="small"
                              color={line.match_status === 'matched' ? 'success' : line.match_status === 'exception' ? 'error' : line.match_status === 'manual' ? 'info' : 'default'}
                              variant="outlined"
                              sx={{ fontSize: 11 }}
                            />
                          </TableCell>
                          <TableCell>
                            {line.delivery_ticket ? (
                              <Typography variant="caption">
                                #{line.delivery_ticket.id?.substring(0, 8)} &middot; {line.delivery_ticket.location?.name || ''} &middot; {fmt(line.delivery_ticket.net_weight_mt)} MT
                              </Typography>
                            ) : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography color="text.secondary">No line items extracted.</Typography>
              )}

              {/* Deductions summary */}
              {detail.lines?.some(l => l.deductions_json?.length > 0) && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Deductions</Typography>
                  <Table size="small" sx={{ maxWidth: 400 }}>
                    <TableBody>
                      {Object.entries(
                        detail.lines.flatMap(l => l.deductions_json || []).reduce((acc, d) => {
                          acc[d.name] = (acc[d.name] || 0) + (d.amount || 0);
                          return acc;
                        }, {})
                      ).map(([name, amount]) => (
                        <TableRow key={name}>
                          <TableCell>{name}</TableCell>
                          <TableCell align="right">{fmtDollar(amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}

              {/* AI usage info */}
              {detail.usage_json && (
                <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
                  <Typography variant="caption">
                    AI: {(detail.usage_json.total_tokens || detail.usage_json.total_input_tokens + detail.usage_json.total_output_tokens)?.toLocaleString()} tokens
                    {detail.usage_json.total_estimated_cost_usd != null && <> &middot; ~${detail.usage_json.total_estimated_cost_usd.toFixed(4)} USD</>}
                    {detail.usage_json.estimated_cost_usd != null && <> &middot; ~${detail.usage_json.estimated_cost_usd.toFixed(4)} USD</>}
                    {detail.usage_json.batch_discount && <> &middot; {detail.usage_json.batch_discount} batch discount</>}
                  </Typography>
                </Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          {detail && isAdmin && (
            <Button
              color="error" startIcon={<DeleteIcon />}
              onClick={() => handleDelete(detail.id, detail.settlement_number)}
            >
              Delete
            </Button>
          )}
          {detail && (
            <Button
              startIcon={<AutoFixHighIcon />}
              onClick={() => { setDetailOpen(false); navigate(`/logistics/settlement-recon?id=${detail.id}`); }}
            >
              Reconcile
            </Button>
          )}
          <Button onClick={() => { setDetailOpen(false); setDetail(null); setEditing(false); }}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Recon Gap Report Dialog */}
      <Dialog open={gapOpen} onClose={() => setGapOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <span>Reconciliation Gap Report</span>
            {gapData && (
              <Stack direction="row" spacing={1}>
                <Tooltip title="Copy to clipboard">
                  <IconButton size="small" onClick={copyGapReport}>
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => downloadGapFile('excel')}>
                  Excel
                </Button>
                <Button size="small" variant="outlined" startIcon={<PictureAsPdfIcon />} onClick={() => downloadGapFile('pdf')}>
                  PDF
                </Button>
                <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => downloadGapFile('csv')}>
                  CSV
                </Button>
              </Stack>
            )}
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {gapLoading && <Typography color="text.secondary">Loading...</Typography>}
          {gapData && !gapLoading && (
            <>
              <Stack direction="row" spacing={2} sx={{ mb: 3 }} flexWrap="wrap" useFlexGap>
                {[
                  { key: 'shipped_no_settlement', label: 'Shipped, No Settlement', color: 'warning.main' },
                  { key: 'settled_no_contract', label: 'Settled, No Contract', color: 'error.main' },
                  { key: 'missing_ticket_lines', label: 'Missing Tickets', color: 'error.main' },
                  { key: 'shipped_no_contract_ref', label: 'No Contract Ref', color: 'warning.main' },
                  { key: 'contracts_no_activity', label: 'Contracts, No Activity', color: 'info.main' },
                ].map(({ key, label, color }) => (
                  <Card key={key} variant="outlined" sx={{ minWidth: 160, flex: '1 1 160px', cursor: 'pointer', '&:hover': { borderColor: color } }} onClick={() => toggleSection(key)}>
                    <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                      <Typography variant="h5" sx={{ fontWeight: 700, color }}>{gapData.summary[key]}</Typography>
                      <Typography variant="caption" color="text.secondary">{label}</Typography>
                    </CardContent>
                  </Card>
                ))}
              </Stack>

              {gapData.summary.shipped_no_settlement + gapData.summary.settled_no_contract + gapData.summary.missing_ticket_lines + gapData.summary.shipped_no_contract_ref + gapData.summary.contracts_no_activity === 0 && (
                <Alert severity="success">No reconciliation gaps found. All tickets, settlements, and contracts are linked.</Alert>
              )}

              {/* Section 1: Shipped, No Settlement */}
              {gapData.sections.shipped_no_settlement.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Button size="small" onClick={() => toggleSection('shipped_no_settlement')} startIcon={expandedSections.shipped_no_settlement ? <ExpandLessIcon /> : <ExpandMoreIcon />} sx={{ mb: 0.5 }}>
                    Shipped, No Settlement ({gapData.sections.shipped_no_settlement.length})
                  </Button>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, ml: 1 }}>
                    Action: Retrieve settlement from buyer portal or marketer
                  </Typography>
                  <Collapse in={!!expandedSections.shipped_no_settlement}>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Contract #</TableCell>
                            <TableCell>Buyer</TableCell>
                            <TableCell>Commodity</TableCell>
                            <TableCell align="right">Tickets</TableCell>
                            <TableCell align="right">Total MT</TableCell>
                            <TableCell>Related Settlement #s</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {gapData.sections.shipped_no_settlement.map((r, i) => (
                            <TableRow key={i} hover>
                              <TableCell sx={{ fontWeight: 600 }}>{r.contract_number || '(none)'}</TableCell>
                              <TableCell>{r.buyer_name}</TableCell>
                              <TableCell>{r.commodity}</TableCell>
                              <TableCell align="right">{r.ticket_count}</TableCell>
                              <TableCell align="right">{fmt(r.total_mt)}</TableCell>
                              <TableCell>{r.related_settlements?.join(', ') || '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Collapse>
                </Box>
              )}

              {/* Section 2: Settled, No Contract in System */}
              {gapData.sections.settled_no_contract.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Button size="small" onClick={() => toggleSection('settled_no_contract')} startIcon={expandedSections.settled_no_contract ? <ExpandLessIcon /> : <ExpandMoreIcon />} sx={{ mb: 0.5 }}>
                    Settled, No Contract in System ({gapData.sections.settled_no_contract.length})
                  </Button>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, ml: 1 }}>
                    Action: Contract # is on the settlement — retrieve from SharePoint, marketer, or buyer portal
                  </Typography>
                  <Collapse in={!!expandedSections.settled_no_contract}>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Contract #</TableCell>
                            <TableCell>Buyer</TableCell>
                            <TableCell>Commodity</TableCell>
                            <TableCell align="right">Settlements</TableCell>
                            <TableCell align="right">Total Amount</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {gapData.sections.settled_no_contract.map((r, i) => (
                            <TableRow key={i} hover>
                              <TableCell sx={{ fontWeight: 600 }}>{r.contract_number}</TableCell>
                              <TableCell>{r.buyer}</TableCell>
                              <TableCell>{r.commodity}</TableCell>
                              <TableCell align="right">{r.settlement_count}</TableCell>
                              <TableCell align="right">{fmtDollar(r.total_amount)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Collapse>
                </Box>
              )}

              {/* Section 3: Settlement Lines, Missing Tickets */}
              {gapData.sections.missing_ticket_lines.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Button size="small" onClick={() => toggleSection('missing_ticket_lines')} startIcon={expandedSections.missing_ticket_lines ? <ExpandLessIcon /> : <ExpandMoreIcon />} sx={{ mb: 0.5 }}>
                    Settlement Lines, Missing Tickets ({gapData.sections.missing_ticket_lines.length})
                  </Button>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, ml: 1 }}>
                    Action: Ticket #s and settlement # are known — retrieve from Traction Ag or ticketing system
                  </Typography>
                  <Collapse in={!!expandedSections.missing_ticket_lines}>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Settlement #</TableCell>
                            <TableCell>Contract #</TableCell>
                            <TableCell>Buyer</TableCell>
                            <TableCell>Ticket # on Settlement</TableCell>
                            <TableCell align="right">Net MT</TableCell>
                            <TableCell>Date</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {gapData.sections.missing_ticket_lines.map((r, i) => (
                            <TableRow key={i} hover>
                              <TableCell>{r.settlement_number}</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>{r.contract_number || '—'}</TableCell>
                              <TableCell>{r.buyer}</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>{r.ticket_number_on_settlement || '—'}</TableCell>
                              <TableCell align="right">{fmt(r.net_weight_mt)}</TableCell>
                              <TableCell>{r.delivery_date || '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Collapse>
                </Box>
              )}

              {/* Section 4: Shipped, No Contract Reference */}
              {gapData.sections.shipped_no_contract_ref.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Button size="small" onClick={() => toggleSection('shipped_no_contract_ref')} startIcon={expandedSections.shipped_no_contract_ref ? <ExpandLessIcon /> : <ExpandMoreIcon />} sx={{ mb: 0.5 }}>
                    Shipped, No Contract Reference ({gapData.sections.shipped_no_contract_ref.length})
                  </Button>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, ml: 1 }}>
                    Action: These tickets have no contract # — assign contract # in ticketing system
                  </Typography>
                  <Collapse in={!!expandedSections.shipped_no_contract_ref}>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Buyer</TableCell>
                            <TableCell>Commodity</TableCell>
                            <TableCell align="right">Tickets</TableCell>
                            <TableCell align="right">Total MT</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {gapData.sections.shipped_no_contract_ref.map((r, i) => (
                            <TableRow key={i} hover>
                              <TableCell sx={{ fontWeight: 600 }}>{r.buyer_name}</TableCell>
                              <TableCell>{r.commodity}</TableCell>
                              <TableCell align="right">{r.ticket_count}</TableCell>
                              <TableCell align="right">{fmt(r.total_mt)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Collapse>
                </Box>
              )}

              {/* Section 5: Contracts with No Activity */}
              {gapData.sections.contracts_no_activity.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Button size="small" onClick={() => toggleSection('contracts_no_activity')} startIcon={expandedSections.contracts_no_activity ? <ExpandLessIcon /> : <ExpandMoreIcon />} sx={{ mb: 0.5 }}>
                    Contracts with No Activity ({gapData.sections.contracts_no_activity.length})
                  </Button>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, ml: 1 }}>
                    Action: Verify delivery schedule — may be future-dated or fallen through the cracks
                  </Typography>
                  <Collapse in={!!expandedSections.contracts_no_activity}>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Contract #</TableCell>
                            <TableCell>Counterparty</TableCell>
                            <TableCell>Commodity</TableCell>
                            <TableCell align="right">Contracted MT</TableCell>
                            <TableCell>Delivery Start</TableCell>
                            <TableCell>Delivery End</TableCell>
                            <TableCell>Urgency</TableCell>
                            <TableCell>Status</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {gapData.sections.contracts_no_activity.map((r, i) => (
                            <TableRow key={i} hover sx={r.urgency === 'OVERDUE' ? { bgcolor: 'error.50' } : r.urgency === 'Due soon' ? { bgcolor: 'warning.50' } : undefined}>
                              <TableCell sx={{ fontWeight: 600 }}>{r.contract_number}</TableCell>
                              <TableCell>{r.counterparty}</TableCell>
                              <TableCell>{r.commodity}</TableCell>
                              <TableCell align="right">{fmt(r.contracted_mt)}</TableCell>
                              <TableCell>{r.delivery_start || '—'}</TableCell>
                              <TableCell>{r.delivery_end || '—'}</TableCell>
                              <TableCell>
                                {r.urgency === 'OVERDUE' ? <Chip label="OVERDUE" size="small" color="error" /> :
                                 r.urgency === 'Due soon' ? <Chip label="Due soon" size="small" color="warning" /> :
                                 r.urgency || '—'}
                              </TableCell>
                              <TableCell>
                                <Chip label={r.status} size="small" variant="outlined" />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Collapse>
                </Box>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGapOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
        onClose={() => setSnack(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>
          {snack.message}
        </Alert>
      </Snackbar>
      <ConfirmDialog {...confirmDialogProps} />
    </Box>
  );
}
