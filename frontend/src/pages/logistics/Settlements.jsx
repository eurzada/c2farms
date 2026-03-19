import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Button, Stack, Chip, TextField, MenuItem,
  Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Tooltip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  Alert, Divider, Snackbar, Card, CardContent, Collapse,
  Select, FormControl, InputLabel,
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
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import LinkIcon from '@mui/icons-material/Link';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
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
import { useMarketingSocket } from '../../hooks/useMarketingSocket';

const FLAG_COLORS = { ok: 'success', warning: 'warning', error: 'error' };

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
  const [fiscalYearFilter, setFiscalYearFilter] = useState('2026');
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
  const [missingLoads, setMissingLoads] = useState(null);
  const [gapLoading, setGapLoading] = useState(false);
  const [gapMonth, setGapMonth] = useState('');
  const [expandedSections, setExpandedSections] = useState({});
  const [reconOpen, setReconOpen] = useState(false);
  const [reconData, setReconData] = useState(null);
  const [reconLoading, setReconLoading] = useState(false);
  const [reconFrom, setReconFrom] = useState('');
  const [reconTo, setReconTo] = useState('');
  const [selectedCount, setSelectedCount] = useState(0);
  const [contractsList, setContractsList] = useState([]);
  const [counterpartiesList, setCounterpartiesList] = useState([]);
  const [farmUnitOpen, setFarmUnitOpen] = useState(false);
  const [farmUnitData, setFarmUnitData] = useState(null);
  const [farmUnitLoading, setFarmUnitLoading] = useState(false);
  const [farmUnitFrom, setFarmUnitFrom] = useState('');
  const [farmUnitTo, setFarmUnitTo] = useState('');
  const [journalOpen, setJournalOpen] = useState(false);
  const [journalData, setJournalData] = useState(null);
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalContractFilter, setJournalContractFilter] = useState('');
  const [journalPeriodFilter, setJournalPeriodFilter] = useState('');
  const [journalExportedFilter, setJournalExportedFilter] = useState('');
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  const fetchData = useCallback(() => {
    if (!currentFarm) return;
    const params = new URLSearchParams();
    if (statusFilter) params.append('status', statusFilter);
    if (fiscalYearFilter) params.append('fiscal_year', fiscalYearFilter);
    api.get(`/api/farms/${currentFarm.id}/settlements?${params}`).then(res => {
      setSettlements(res.data.settlements || []);
      setTotal(res.data.total || 0);
      setTotalMt(res.data.total_mt || 0);
    });
  }, [currentFarm, statusFilter, fiscalYearFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Real-time updates via socket
  useMarketingSocket(currentFarm?.id, useCallback((event) => {
    if (event === 'settlement:created' || event === 'settlement:approved') {
      fetchData();
    }
  }, [fetchData]));

  const openDetail = useCallback(async (id) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setEditing(false);
    setMissingLoads(null);
    try {
      const res = await api.get(`/api/farms/${currentFarm.id}/settlements/${id}`);
      setDetail(res.data.settlement);
      // Fetch missing loads for this settlement (non-blocking)
      api.get(`/api/farms/${currentFarm.id}/logistics/missing-loads/${id}`)
        .then(mlRes => setMissingLoads(mlRes.data))
        .catch(() => setMissingLoads(null));
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [currentFarm]);

  const navigateDetail = useCallback((direction) => {
    if (!detail || !gridRef.current?.api) return;
    const allRows = [];
    gridRef.current.api.forEachNodeAfterFilterAndSort(n => allRows.push(n.data));
    const idx = allRows.findIndex(r => r.id === detail.id);
    const nextIdx = idx + direction;
    if (nextIdx >= 0 && nextIdx < allRows.length) {
      openDetail(allRows[nextIdx].id);
    }
  }, [detail, openDetail]);

  const handleApproveFromDetail = async () => {
    if (!detail) return;
    const ok = await confirm({
      title: 'Approve Settlement',
      message: `Approve settlement #${detail.settlement_number}? Unresolved lines will be dismissed.`,
      confirmText: 'Approve',
      confirmColor: 'success',
    });
    if (!ok) return;
    try {
      await api.post(`/api/farms/${currentFarm.id}/settlements/bulk-approve`, {
        ids: [detail.id],
        notes: 'Approved from settlement detail',
      });
      setSnack({ open: true, message: 'Settlement approved', severity: 'success' });
      setDetail(prev => prev ? { ...prev, status: 'approved' } : prev);
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to approve'), severity: 'error' });
    }
  };

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

  const handleBulkApprove = async () => {
    const selectedRows = gridRef.current?.api?.getSelectedRows() || [];
    const approvable = selectedRows.filter(s => s.status === 'reconciled');
    if (approvable.length === 0) {
      setSnack({ open: true, message: 'No reconciled settlements selected — only reconciled settlements can be approved', severity: 'info' });
      return;
    }
    const ok = await confirm({
      title: 'Bulk Approve Settlements',
      message: `Approve ${approvable.length} settlement${approvable.length !== 1 ? 's' : ''}? Unresolved lines will be dismissed as prior-year cutoff.`,
      confirmText: 'Approve All',
      confirmColor: 'success',
    });
    if (!ok) return;

    try {
      const ids = approvable.map(s => s.id);
      const res = await api.post(`/api/farms/${currentFarm.id}/settlements/bulk-approve`, {
        ids,
        notes: 'Approved — prior year cutoff',
      });
      const msg = res.data.errors?.length
        ? `${res.data.approved} approved, ${res.data.errors.length} failed: ${res.data.errors[0]}`
        : `${res.data.approved} settlement(s) approved`;
      setSnack({ open: true, message: msg, severity: res.data.approved > 0 ? 'success' : 'warning' });
      setSelectedCount(0);
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to approve settlements'), severity: 'error' });
    }
  };

  const handleBulkUnapprove = async () => {
    const selectedRows = gridRef.current?.api?.getSelectedRows() || [];
    const unapproveList = selectedRows.filter(s => s.status === 'approved');
    if (unapproveList.length === 0) {
      setSnack({ open: true, message: 'No approved settlements selected', severity: 'info' });
      return;
    }
    const ok = await confirm({
      title: 'Unapprove Settlements',
      message: `Revert ${unapproveList.length} approved settlement${unapproveList.length !== 1 ? 's' : ''} back to pending? This will un-settle matched tickets, remove auto-created deliveries and cash flow entries, and clear line matches so you can re-reconcile.`,
      confirmText: 'Unapprove All',
      confirmColor: 'warning',
    });
    if (!ok) return;

    try {
      const ids = unapproveList.map(s => s.id);
      const res = await api.post(`/api/farms/${currentFarm.id}/settlements/bulk-unapprove`, {
        ids,
        notes: 'Unapproved for re-reconciliation',
      });
      setSnack({ open: true, message: `${res.data.unapproved} settlement(s) reverted to pending`, severity: 'success' });
      setSelectedCount(0);
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to unapprove settlements'), severity: 'error' });
    }
  };

  const onSelectionChanged = useCallback(() => {
    setSelectedCount(gridRef.current?.api?.getSelectedRows()?.length || 0);
  }, []);

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

  const handleReconGapReport = async (monthOverride) => {
    setGapOpen(true);
    setGapLoading(true);
    try {
      const params = new URLSearchParams();
      if (fiscalYearFilter) params.append('fiscal_year', fiscalYearFilter);
      const m = typeof monthOverride === 'string' ? monthOverride : gapMonth;
      if (m) params.append('month', m);
      const res = await api.get(`/api/farms/${currentFarm.id}/settlements/reports/recon-gaps?${params}`);
      setGapData(res.data);
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to load report'), severity: 'error' });
      setGapOpen(false);
    } finally {
      setGapLoading(false);
    }
  };

  const [relinking, setRelinking] = useState(false);
  const handleRelinkContracts = async () => {
    setRelinking(true);
    try {
      const res = await api.post(`/api/farms/${currentFarm.id}/settlements/relink-contracts`);
      setSnack({ open: true, message: res.data.message, severity: res.data.linked > 0 ? 'success' : 'info' });
      if (res.data.linked > 0) handleReconGapReport();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to re-link contracts'), severity: 'error' });
    } finally {
      setRelinking(false);
    }
  };

  const fetchReconData = async (from, to) => {
    setReconLoading(true);
    try {
      const fy = fiscalYearFilter || new Date().getFullYear();
      const params = new URLSearchParams({ fiscal_year: fy });
      if (from) params.append('start_date', from);
      if (to) params.append('end_date', to);
      const res = await api.get(`/api/farms/${currentFarm.id}/settlements/reports/monthly-recon?${params}`);
      setReconData(res.data);
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to load reconciliation'), severity: 'error' });
    } finally {
      setReconLoading(false);
    }
  };

  const handleMonthlyRecon = async () => {
    setReconOpen(true);
    setReconFrom('');
    setReconTo('');
    await fetchReconData('', '');
  };

  const buildFarmUnitParams = (from, to) => {
    const fy = fiscalYearFilter || new Date().getFullYear();
    const params = new URLSearchParams({ fiscal_year: fy });
    if (from) params.append('start_date', from);
    if (to) params.append('end_date', to);
    return params;
  };

  const fetchFarmUnitData = async (from, to) => {
    setFarmUnitLoading(true);
    try {
      const params = buildFarmUnitParams(from, to);
      const res = await api.get(`/api/farms/${currentFarm.id}/settlements/reports/by-farm-unit?${params}`);
      setFarmUnitData(res.data);
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to load farm unit report'), severity: 'error' });
    } finally {
      setFarmUnitLoading(false);
    }
  };

  const handleFarmUnitReport = async () => {
    setFarmUnitOpen(true);
    setFarmUnitFrom('');
    setFarmUnitTo('');
    await fetchFarmUnitData('', '');
  };

  const downloadFarmUnitExcel = async () => {
    try {
      const params = buildFarmUnitParams(farmUnitFrom, farmUnitTo);
      const res = await api.get(
        `/api/farms/${currentFarm.id}/settlements/reports/by-farm-unit/excel?${params}`,
        { responseType: 'blob' }
      );
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fy = fiscalYearFilter || new Date().getFullYear();
      a.download = `settlement-by-farm-unit-FY${fy}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to download Excel'), severity: 'error' });
    }
  };

  const handleEnterpriseJournal = async () => {
    setJournalOpen(true);
    setJournalLoading(true);
    try {
      const fy = fiscalYearFilter || new Date().getFullYear();
      const params = new URLSearchParams({ fiscal_year: fy });
      if (journalContractFilter) params.append('contract', journalContractFilter);
      if (journalPeriodFilter) params.append('period', journalPeriodFilter);
      if (journalExportedFilter) params.append('exported', journalExportedFilter);
      const res = await api.get(`/api/farms/${currentFarm.id}/settlements/reports/enterprise-journal?${params}`);
      setJournalData(res.data);
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to load enterprise journal'), severity: 'error' });
      setJournalOpen(false);
    } finally {
      setJournalLoading(false);
    }
  };

  const downloadJournal = async (format) => {
    try {
      const fy = fiscalYearFilter || new Date().getFullYear();
      const ext = format === 'csv' ? 'csv' : format === 'excel' ? 'xlsx' : 'pdf';
      const mime = format === 'csv' ? 'text/csv'
        : format === 'excel' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf';
      const endpoint = format === 'csv' ? 'csv' : format === 'excel' ? 'excel' : 'pdf';
      const params = new URLSearchParams({ fiscal_year: fy });
      if (journalContractFilter) params.append('contract', journalContractFilter);
      if (journalPeriodFilter) params.append('period', journalPeriodFilter);
      if (journalExportedFilter) params.append('exported', journalExportedFilter);
      const res = await api.get(
        `/api/farms/${currentFarm.id}/settlements/reports/enterprise-journal/${endpoint}?${params}`,
        { responseType: 'blob' }
      );
      const blob = new Blob([res.data], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `enterprise-journal-FY${fy}-${new Date().toISOString().slice(0, 10)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, `Failed to download ${format}`), severity: 'error' });
    }
  };

  const toggleSection = (key) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const downloadGapFile = async (format) => {
    try {
      const mimeTypes = { excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf', csv: 'text/csv' };
      const extensions = { excel: 'xlsx', pdf: 'pdf', csv: 'csv' };
      const params = new URLSearchParams();
      if (fiscalYearFilter) params.append('fiscal_year', fiscalYearFilter);
      if (gapMonth) params.append('month', gapMonth);
      const res = await api.get(
        `/api/farms/${currentFarm.id}/settlements/reports/recon-gaps/${format}?${params}`,
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
    const periodLabel = gapData.fiscal_year ? (gapData.month ? `FY${gapData.fiscal_year} — ${gapData.month}` : `FY${gapData.fiscal_year}`) : 'All Time';
    const lines = [
      'Reconciliation Gap Report',
      `Period: ${periodLabel}`,
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
      counterparty_id: detail?.counterparty_id || '',
      status: detail?.status || 'pending',
      notes: detail?.notes || '',
      total_amount: detail?.total_amount ?? '',
    });
    // Fetch contracts and counterparties for dropdowns
    if (currentFarm) {
      api.get(`/api/farms/${currentFarm.id}/marketing/contracts?limit=200`)
        .then(res => setContractsList(res.data.contracts || []))
        .catch(() => {});
      api.get(`/api/farms/${currentFarm.id}/marketing/counterparties`)
        .then(res => setCounterpartiesList(res.data.counterparties || res.data || []))
        .catch(() => {});
    }
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
      if (editForm.counterparty_id !== (detail.counterparty_id || '')) {
        body.counterparty_id = editForm.counterparty_id || null;
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
    {
      headerCheckboxSelection: true,
      checkboxSelection: true,
      headerCheckboxSelectionFilteredOnly: true,
      width: 44,
      flex: 0,
      sortable: false,
      filter: false,
      resizable: false,
      pinned: 'left',
    },
    {
      field: 'settlement_number', headerName: 'Settlement #', minWidth: 140, flex: 1.5,
      cellRenderer: p => (
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <span>{p.value}</span>
          {p.data?.source === 'lgx_transfer' && (
            <Chip label="LGX" size="small" color="secondary" variant="outlined" sx={{ fontSize: 10, height: 18 }} />
          )}
        </Stack>
      ),
    },
    {
      field: 'settlement_date', headerName: 'Date', minWidth: 100, flex: 1,
      valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString() : '',
    },
    { field: 'counterparty.name', headerName: 'Buyer', minWidth: 120, flex: 1.5 },
    { field: 'buyer_format', headerName: 'Format', minWidth: 80, flex: 0.8, valueFormatter: p => p.value?.toUpperCase() || '' },
    {
      headerName: 'Contract #', minWidth: 110, flex: 1.2,
      valueGetter: p => p.data.marketing_contract?.contract_number || p.data.extraction_json?.contract_number || '',
    },
    {
      headerName: 'Commodity', minWidth: 100, flex: 1,
      valueGetter: p => p.data.marketing_contract?.commodity?.name || p.data.extraction_json?.commodity || '',
    },
    {
      field: 'total_mt', headerName: 'Total MT', minWidth: 90, flex: 0.8,
      valueFormatter: p => p.value ? fmt(p.value) : '—',
    },
    {
      field: 'total_amount', headerName: 'Amount', minWidth: 100, flex: 1,
      valueFormatter: p => p.value ? fmtDollar(p.value) : '',
    },
    { field: '_count.lines', headerName: 'Lines', minWidth: 60, flex: 0.5 },
    {
      field: 'avg_mt_per_line', headerName: 'Avg MT/Load', minWidth: 95, flex: 0.8,
      valueFormatter: p => p.value ? fmt(p.value) : '—',
    },
    {
      field: 'status', headerName: 'Status', minWidth: 100, flex: 0.9,
      cellRenderer: p => (
        <Chip label={p.value} size="small" color={STATUS_COLORS[p.value] || 'default'} />
      ),
    },
    {
      headerName: 'Actions', minWidth: 120, width: 140, flex: 0, sortable: false, filter: false, pinned: 'right',
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
            select size="small" label="Fiscal Year" value={fiscalYearFilter}
            onChange={(e) => setFiscalYearFilter(e.target.value)}
            sx={{ minWidth: 120 }}
          >
            <MenuItem value="">All Years</MenuItem>
            <MenuItem value="2022">FY2022</MenuItem>
            <MenuItem value="2023">FY2023</MenuItem>
            <MenuItem value="2024">FY2024</MenuItem>
            <MenuItem value="2025">FY2025</MenuItem>
            <MenuItem value="2026">FY2026</MenuItem>
            <MenuItem value="2027">FY2027</MenuItem>
          </TextField>
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
          {selectedCount > 0 && isAdmin && (
            <>
              <Button
                variant="outlined"
                color="success"
                size="small"
                startIcon={<CheckCircleOutlineIcon />}
                onClick={handleBulkApprove}
              >
                Approve ({selectedCount})
              </Button>
              <Button
                variant="outlined"
                color="warning"
                size="small"
                onClick={handleBulkUnapprove}
              >
                Unapprove ({selectedCount})
              </Button>
            </>
          )}
          <Tooltip title="Missing tickets, settlements, or contracts — what needs attention">
            <Button variant="outlined" color="warning" startIcon={<SummarizeIcon />} onClick={handleReconGapReport}>
              Missing Items
            </Button>
          </Tooltip>
          <Tooltip title="Compare shipped tonnage (tickets) vs settled tonnage (settlements) by commodity, buyer, and month">
            <Button variant="outlined" color="info" startIcon={<CompareArrowsIcon />} onClick={handleMonthlyRecon}>
              Shipped vs Settled
            </Button>
          </Tooltip>
          <Tooltip title="Settlement breakdown by farm location — who shipped what from where">
            <Button variant="outlined" color="secondary" startIcon={<LocationOnIcon />} onClick={handleFarmUnitReport}>
              By Farm Unit
            </Button>
          </Tooltip>
          <Button variant="outlined" sx={{ color: '#6d4c41', borderColor: '#6d4c41', '&:hover': { borderColor: '#4e342e', bgcolor: 'rgba(109,76,65,0.08)' } }} startIcon={<AccountBalanceIcon />} onClick={handleEnterpriseJournal}>
            Enterprise Journal
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
          defaultColDef={{ sortable: true, resizable: true, filter: true, flex: 1 }}
          animateRows
          rowSelection="multiple"
          suppressRowClickSelection
          enableCellTextSelection
          ensureDomOrder
          getRowId={p => p.data?.id}
          onSelectionChanged={onSelectionChanged}
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
      <Dialog open={detailOpen} onClose={() => { setDetailOpen(false); setDetail(null); setEditing(false); setMissingLoads(null); }} maxWidth="lg" fullWidth>
        <DialogTitle>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Tooltip title="Previous settlement">
                <span><IconButton size="small" onClick={() => navigateDetail(-1)} disabled={detailLoading}><NavigateBeforeIcon /></IconButton></span>
              </Tooltip>
              <span>Settlement {detail?.settlement_number ? `#${detail.settlement_number}` : ''}</span>
              <Tooltip title="Next settlement">
                <span><IconButton size="small" onClick={() => navigateDetail(1)} disabled={detailLoading}><NavigateNextIcon /></IconButton></span>
              </Tooltip>
            </Stack>
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
                      select label="Counterparty / Buyer" size="small"
                      value={editForm.counterparty_id}
                      onChange={e => setEditForm(f => ({ ...f, counterparty_id: e.target.value }))}
                      sx={{ minWidth: 220 }}
                      helperText="Who issued this settlement"
                    >
                      <MenuItem value="">— None —</MenuItem>
                      {counterpartiesList.map(cp => (
                        <MenuItem key={cp.id} value={cp.id}>
                          {cp.short_code ? `${cp.short_code} — ` : ''}{cp.name}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select label="Contract #" size="small"
                      value={editForm.contract_number}
                      onChange={e => setEditForm(f => ({ ...f, contract_number: e.target.value }))}
                      helperText="Links to a Marketing Contract (auto-fills commodity)"
                      sx={{ minWidth: 250 }}
                    >
                      <MenuItem value="">— None —</MenuItem>
                      {contractsList.map(c => (
                        <MenuItem key={c.id} value={c.contract_number}>
                          {c.contract_number} — {c.counterparty?.name || ''} — {c.commodity?.name || ''} ({c.contracted_mt} MT)
                        </MenuItem>
                      ))}
                    </TextField>
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

              {/* Missing loads warning */}
              {missingLoads && missingLoads.missing_count > 0 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {missingLoads.missing_count} other load{missingLoads.missing_count > 1 ? 's' : ''}{' '}
                  ({fmt(missingLoads.missing_mt)} MT) shipped on contract {missingLoads.contract_number}{' '}
                  {missingLoads.missing_count > 1 ? 'are' : 'is'} not on any settlement.{' '}
                  Tickets: {missingLoads.missing_tickets.join(', ')}
                </Alert>
              )}

              {/* Settlement Lines */}
              {detail.lines?.length > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>#</TableCell>
                        <TableCell>Ticket #</TableCell>
                        <TableCell>Contract #</TableCell>
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
                          <TableCell>{line.contract_number || '—'}</TableCell>
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
          {detail && isAdmin && detail.status !== 'approved' && (
            <Button color="success" variant="contained" startIcon={<CheckCircleOutlineIcon />} onClick={handleApproveFromDetail}>
              Approve
            </Button>
          )}
          <Button onClick={() => { setDetailOpen(false); setDetail(null); setEditing(false); setMissingLoads(null); }}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Missing Items Report Dialog */}
      <Dialog open={gapOpen} onClose={() => setGapOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Stack direction="row" spacing={2} alignItems="center">
              <span>Missing Items</span>
              <Typography variant="body2" color="text.secondary">
                {fiscalYearFilter ? `FY${fiscalYearFilter}` : 'All Years'}{gapMonth ? ` — ${gapMonth}` : ''}
              </Typography>
              <TextField
                select size="small" label="Month" value={gapMonth}
                onChange={(e) => { setGapMonth(e.target.value); handleReconGapReport(e.target.value); }}
                sx={{ minWidth: 120 }}
              >
                <MenuItem value="">All Months</MenuItem>
                {['Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct'].map(m => (
                  <MenuItem key={m} value={m}>{m}</MenuItem>
                ))}
              </TextField>
            </Stack>
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
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, ml: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      Action: Contract # is on the settlement — retrieve from SharePoint, marketer, or buyer portal
                    </Typography>
                    <Button size="small" variant="outlined" startIcon={relinking ? <CircularProgress size={14} /> : <LinkIcon />} onClick={handleRelinkContracts} disabled={relinking}>
                      Re-link
                    </Button>
                  </Box>
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

      {/* Monthly Three-Way Reconciliation Dialog */}
      <Dialog open={reconOpen} onClose={() => { setReconOpen(false); setReconData(null); }} maxWidth="xl" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <span>Shipped vs Settled — Tonnage Reconciliation</span>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                type="date"
                size="small"
                label="From"
                value={reconFrom}
                onChange={(e) => setReconFrom(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 160 }}
              />
              <TextField
                type="date"
                size="small"
                label="To"
                value={reconTo}
                onChange={(e) => setReconTo(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 160 }}
              />
              <Button
                size="small"
                variant="contained"
                onClick={() => fetchReconData(reconFrom, reconTo)}
                disabled={reconLoading}
              >
                Apply
              </Button>
              {(reconFrom || reconTo) && (
                <Button size="small" variant="text" onClick={() => { setReconFrom(''); setReconTo(''); fetchReconData('', ''); }}>
                  Reset
                </Button>
              )}
              <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                {reconData?.period || ''}
              </Typography>
            </Stack>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {reconLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          )}
          {reconData && !reconLoading && (
            <>
              {/* Summary cards */}
              <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
                <Card variant="outlined" sx={{ flex: 1, minWidth: 150 }}>
                  <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Typography variant="caption" color="text.secondary">Total Shipped</Typography>
                    <Typography variant="h6" fontWeight={700}>{fmt(reconData.totals.total_shipped_mt)} MT</Typography>
                    <Typography variant="caption">{reconData.totals.total_tickets} tickets</Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined" sx={{ flex: 1, minWidth: 150 }}>
                  <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Typography variant="caption" color="text.secondary">Total Settled</Typography>
                    <Typography variant="h6" fontWeight={700}>{fmt(reconData.totals.total_settled_mt)} MT</Typography>
                    <Typography variant="caption">{reconData.totals.total_settlement_lines} lines</Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined" sx={{ flex: 1, minWidth: 150 }}>
                  <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Typography variant="caption" color="text.secondary">Variance</Typography>
                    <Typography variant="h6" fontWeight={700} color={reconData.totals.total_variance_mt > 0 ? 'warning.main' : 'success.main'}>
                      {reconData.totals.total_variance_mt > 0 ? '+' : ''}{fmt(reconData.totals.total_variance_mt)} MT
                    </Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined" sx={{ flex: 1, minWidth: 150 }}>
                  <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Typography variant="caption" color="text.secondary">Issues</Typography>
                    <Typography variant="h6" fontWeight={700}>
                      {reconData.totals.error_count > 0 && <Chip label={`${reconData.totals.error_count} errors`} size="small" color="error" sx={{ mr: 0.5 }} />}
                      {reconData.totals.warning_count > 0 && <Chip label={`${reconData.totals.warning_count} warnings`} size="small" color="warning" />}
                      {reconData.totals.error_count === 0 && reconData.totals.warning_count === 0 && <Chip label="All OK" size="small" color="success" />}
                    </Typography>
                  </CardContent>
                </Card>
              </Box>

              {/* Detail: Shipped vs Settled by Commodity + Buyer + Month */}
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                Shipped vs Settled — by Commodity + Buyer
              </Typography>
              {reconData.detail.length === 0 ? (
                <Alert severity="info" sx={{ mb: 2 }}>No delivery data found for this period.</Alert>
              ) : (
                <TableContainer component={Paper} variant="outlined" sx={{ mb: 3, maxHeight: 400 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Commodity</TableCell>
                        <TableCell>Buyer</TableCell>
                        <TableCell>Month</TableCell>
                        <TableCell align="right">Shipped MT</TableCell>
                        <TableCell align="right">Tickets</TableCell>
                        <TableCell align="right">Settled MT</TableCell>
                        <TableCell align="right">Lines</TableCell>
                        <TableCell align="right">Variance MT</TableCell>
                        <TableCell align="right">Variance %</TableCell>
                        <TableCell align="center">Flag</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {reconData.detail.map((r, i) => (
                        <TableRow key={i} hover sx={r.flag === 'error' ? { bgcolor: 'error.50' } : r.flag === 'warning' ? { bgcolor: 'warning.50' } : undefined}>
                          <TableCell sx={{ fontWeight: 600 }}>{r.commodity}</TableCell>
                          <TableCell>{r.buyer}</TableCell>
                          <TableCell>{r.month_label}</TableCell>
                          <TableCell align="right">{fmt(r.shipped_mt)}</TableCell>
                          <TableCell align="right">{r.ticket_count}</TableCell>
                          <TableCell align="right">{fmt(r.settled_mt)}</TableCell>
                          <TableCell align="right">{r.line_count}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>{r.variance_mt > 0 ? '+' : ''}{fmt(r.variance_mt)}</TableCell>
                          <TableCell align="right">{r.variance_pct > 0 ? '+' : ''}{r.variance_pct}%</TableCell>
                          <TableCell align="center">
                            <Chip label={r.flag.toUpperCase()} size="small" color={FLAG_COLORS[r.flag] || 'default'} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}

              {/* Inventory Summary: Bin Count Change vs Shipments */}
              {reconData.inventory_summary.length > 0 && (
                <>
                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                    Inventory Change vs Shipments — by Commodity
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Compares bin count decrease (opening - closing) against total shipped MT. Large variances indicate missing counts or unrecorded movements.
                  </Typography>
                  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Commodity</TableCell>
                          <TableCell>Month</TableCell>
                          <TableCell align="right">Opening MT</TableCell>
                          <TableCell align="right">Closing MT</TableCell>
                          <TableCell align="right">Inv Change</TableCell>
                          <TableCell align="right">Shipped MT</TableCell>
                          <TableCell align="right">Settled MT</TableCell>
                          <TableCell align="right">Inv vs Shipped</TableCell>
                          <TableCell align="center">Flag</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {reconData.inventory_summary.map((r, i) => (
                          <TableRow key={i} hover sx={r.flag === 'warning' ? { bgcolor: 'warning.50' } : undefined}>
                            <TableCell sx={{ fontWeight: 600 }}>{r.commodity}</TableCell>
                            <TableCell>{r.month_label}</TableCell>
                            <TableCell align="right">{fmt(r.opening_mt)}</TableCell>
                            <TableCell align="right">{fmt(r.closing_mt)}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>{fmt(r.inventory_change_mt)}</TableCell>
                            <TableCell align="right">{fmt(r.total_shipped_mt)}</TableCell>
                            <TableCell align="right">{fmt(r.total_settled_mt)}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600, color: r.flag === 'warning' ? 'warning.main' : undefined }}>
                              {r.inv_vs_shipped_variance > 0 ? '+' : ''}{fmt(r.inv_vs_shipped_variance)}
                            </TableCell>
                            <TableCell align="center">
                              <Chip label={r.flag.toUpperCase()} size="small" color={FLAG_COLORS[r.flag] || 'default'} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setReconOpen(false); setReconData(null); }}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Settlement by Farm Unit Report Dialog */}
      <Dialog open={farmUnitOpen} onClose={() => { setFarmUnitOpen(false); setFarmUnitData(null); }} maxWidth="lg" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <span>Settlement by Farm Unit</span>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                type="date"
                size="small"
                label="From"
                value={farmUnitFrom}
                onChange={(e) => setFarmUnitFrom(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 160 }}
              />
              <TextField
                type="date"
                size="small"
                label="To"
                value={farmUnitTo}
                onChange={(e) => setFarmUnitTo(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 160 }}
              />
              <Button
                size="small"
                variant="contained"
                onClick={() => fetchFarmUnitData(farmUnitFrom, farmUnitTo)}
                disabled={farmUnitLoading}
              >
                Apply
              </Button>
              {(farmUnitFrom || farmUnitTo) && (
                <Button size="small" variant="text" onClick={() => { setFarmUnitFrom(''); setFarmUnitTo(''); fetchFarmUnitData('', ''); }}>
                  Reset
                </Button>
              )}
              <Typography variant="body2" color="text.secondary">{farmUnitData?.period || ''}</Typography>
              {farmUnitData && (
                <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={downloadFarmUnitExcel}>
                  Excel
                </Button>
              )}
            </Stack>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {farmUnitLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          )}
          {farmUnitData && !farmUnitLoading && (
            <>
              {/* Summary cards */}
              <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
                <Card variant="outlined" sx={{ flex: 1, minWidth: 150 }}>
                  <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Typography variant="caption" color="text.secondary">Total Settled</Typography>
                    <Typography variant="h6" fontWeight={700}>{fmt(farmUnitData.summary.total_settled_mt)} MT</Typography>
                    <Typography variant="caption">{farmUnitData.summary.total_lines} lines</Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined" sx={{ flex: 1, minWidth: 150 }}>
                  <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Typography variant="caption" color="text.secondary">Total Revenue</Typography>
                    <Typography variant="h6" fontWeight={700} color="success.main">{fmtDollar(farmUnitData.summary.total_settled_amount)}</Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined" sx={{ flex: 1, minWidth: 150 }}>
                  <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Typography variant="caption" color="text.secondary">Locations</Typography>
                    <Typography variant="h6" fontWeight={700}>{farmUnitData.summary.locations}</Typography>
                    <Typography variant="caption">{farmUnitData.summary.commodities.join(', ')}</Typography>
                  </CardContent>
                </Card>
                {farmUnitData.summary.total_unsettled_mt > 0 && (
                  <Card variant="outlined" sx={{ flex: 1, minWidth: 150 }}>
                    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Typography variant="caption" color="text.secondary">Shipped, Not Settled</Typography>
                      <Typography variant="h6" fontWeight={700} color="warning.main">{fmt(farmUnitData.summary.total_unsettled_mt)} MT</Typography>
                      <Typography variant="caption">{farmUnitData.summary.total_unsettled_tickets} tickets</Typography>
                    </CardContent>
                  </Card>
                )}
              </Box>

              {/* By Location summary */}
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                Summary by Location
              </Typography>
              {farmUnitData.by_location.length === 0 ? (
                <Alert severity="info" sx={{ mb: 2 }}>No approved settlements with matched tickets found for this fiscal year.</Alert>
              ) : (
                <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Location</TableCell>
                        <TableCell align="right">Settled MT</TableCell>
                        <TableCell align="right">Settled $</TableCell>
                        <TableCell align="right">Lines</TableCell>
                        <TableCell>Commodities</TableCell>
                        <TableCell>Buyers</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {farmUnitData.by_location.map((r, i) => (
                        <TableRow key={i} hover>
                          <TableCell sx={{ fontWeight: 600 }}>{r.location}</TableCell>
                          <TableCell align="right">{fmt(r.settled_mt)}</TableCell>
                          <TableCell align="right">{fmtDollar(r.settled_amount)}</TableCell>
                          <TableCell align="right">{r.line_count}</TableCell>
                          <TableCell>{r.commodities.join(', ')}</TableCell>
                          <TableCell>{r.buyers.join(', ')}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow sx={{ bgcolor: 'action.hover' }}>
                        <TableCell sx={{ fontWeight: 700 }}>TOTAL</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt(farmUnitData.summary.total_settled_mt)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>{fmtDollar(farmUnitData.summary.total_settled_amount)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>{farmUnitData.summary.total_lines}</TableCell>
                        <TableCell />
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              )}

              {/* Detail: Location + Commodity + Buyer */}
              {farmUnitData.detail.length > 0 && (
                <>
                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                    Detail — Location + Commodity + Buyer
                  </Typography>
                  <TableContainer component={Paper} variant="outlined" sx={{ mb: 3, maxHeight: 400 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Location</TableCell>
                          <TableCell>Commodity</TableCell>
                          <TableCell>Buyer</TableCell>
                          <TableCell>Contract(s)</TableCell>
                          <TableCell align="right">Settled MT</TableCell>
                          <TableCell align="right">Settled $</TableCell>
                          <TableCell align="right">Avg $/MT</TableCell>
                          <TableCell align="right">Lines</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {farmUnitData.detail.map((r, i) => (
                          <TableRow key={i} hover>
                            <TableCell sx={{ fontWeight: 600 }}>{r.location}</TableCell>
                            <TableCell>{r.commodity}</TableCell>
                            <TableCell>{r.buyer}</TableCell>
                            <TableCell>
                              <Typography variant="caption">{r.contracts.join(', ') || '—'}</Typography>
                            </TableCell>
                            <TableCell align="right">{fmt(r.settled_mt)}</TableCell>
                            <TableCell align="right">{fmtDollar(r.settled_amount)}</TableCell>
                            <TableCell align="right">{r.avg_price_per_mt ? fmtDollar(r.avg_price_per_mt) : '—'}</TableCell>
                            <TableCell align="right">{r.line_count}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              )}

              {/* Unsettled tickets by location */}
              {farmUnitData.unsettled.length > 0 && (
                <>
                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }} color="warning.main">
                    Shipped, Not Yet Settled — by Location
                  </Typography>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Location</TableCell>
                          <TableCell>Commodity</TableCell>
                          <TableCell align="right">Shipped MT</TableCell>
                          <TableCell align="right">Tickets</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {farmUnitData.unsettled.map((r, i) => (
                          <TableRow key={i} hover>
                            <TableCell sx={{ fontWeight: 600 }}>{r.location}</TableCell>
                            <TableCell>{r.commodity}</TableCell>
                            <TableCell align="right">{fmt(r.shipped_mt)}</TableCell>
                            <TableCell align="right">{r.ticket_count}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setFarmUnitOpen(false); setFarmUnitData(null); }}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Enterprise Settlement Journal Dialog */}
      <Dialog open={journalOpen} onClose={() => { setJournalOpen(false); setJournalData(null); }} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <span>Enterprise Settlement Journal</span>
            <Typography variant="caption" sx={{ ml: 2, color: 'text.secondary' }}>
              {journalData?.period || ''}
            </Typography>
          </Box>
          {journalData && (
            <Stack direction="row" spacing={1}>
              {isAdmin && (
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  startIcon={<CheckCircleOutlineIcon />}
                  onClick={async () => {
                    const ids = journalData.by_buyer.flatMap(b => b.settlements.map(s => s.id));
                    if (ids.length === 0) return;
                    try {
                      await api.post(`/api/farms/${currentFarm.id}/settlements/mark-exported`, { ids });
                      setSnack({ open: true, message: `Marked ${ids.length} settlement(s) as exported`, severity: 'success' });
                      handleEnterpriseJournal();
                    } catch (err) {
                      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to mark exported'), severity: 'error' });
                    }
                  }}
                >
                  Mark Exported
                </Button>
              )}
              <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => downloadJournal('csv')}>
                CSV (QBO)
              </Button>
              <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => downloadJournal('excel')}>
                Excel
              </Button>
              <Button size="small" variant="outlined" color="error" startIcon={<PictureAsPdfIcon />} onClick={() => downloadJournal('pdf')}>
                PDF
              </Button>
            </Stack>
          )}
        </DialogTitle>
        <DialogContent dividers>
          {/* Filters */}
          <Stack direction="row" spacing={2} sx={{ mb: 2 }} alignItems="center">
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Contract</InputLabel>
              <Select value={journalContractFilter} onChange={(e) => setJournalContractFilter(e.target.value)} label="Contract">
                <MenuItem value="">All Contracts</MenuItem>
                {contractsList.map(c => (
                  <MenuItem key={c.id} value={c.contract_number}>{c.contract_number} — {c.counterparty?.name || ''}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Period</InputLabel>
              <Select value={journalPeriodFilter} onChange={(e) => setJournalPeriodFilter(e.target.value)} label="Period">
                <MenuItem value="">All Months</MenuItem>
                {[11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(m => (
                  <MenuItem key={m} value={String(m)}>{new Date(2025, m - 1).toLocaleString('en-CA', { month: 'short' })}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>QB Export</InputLabel>
              <Select value={journalExportedFilter} onChange={(e) => setJournalExportedFilter(e.target.value)} label="QB Export">
                <MenuItem value="">All</MenuItem>
                <MenuItem value="not_exported">Not Exported</MenuItem>
                <MenuItem value="exported">Already Exported</MenuItem>
              </Select>
            </FormControl>
            <Button size="small" variant="contained" onClick={handleEnterpriseJournal} disabled={journalLoading}>
              Apply
            </Button>
          </Stack>
          {journalLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          )}
          {journalData && !journalLoading && (
            <>
              {/* Summary Cards */}
              <Stack direction="row" spacing={2} sx={{ mb: 3 }} flexWrap="wrap" useFlexGap>
                <Card variant="outlined" sx={{ minWidth: 140 }}>
                  <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                    <Typography variant="caption" color="text.secondary">Gross Revenue</Typography>
                    <Typography variant="h6" fontWeight={700}>{fmtDollar(journalData.summary.total_gross)}</Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined" sx={{ minWidth: 140 }}>
                  <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                    <Typography variant="caption" color="text.secondary">Total Deductions</Typography>
                    <Typography variant="h6" fontWeight={700} color="error.main">{fmtDollar(journalData.summary.total_deductions)}</Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined" sx={{ minWidth: 140 }}>
                  <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                    <Typography variant="caption" color="text.secondary">Net Payable</Typography>
                    <Typography variant="h6" fontWeight={700} color="success.main">{fmtDollar(journalData.summary.total_net)}</Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined" sx={{ minWidth: 140 }}>
                  <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                    <Typography variant="caption" color="text.secondary">Total MT</Typography>
                    <Typography variant="h6" fontWeight={700}>{fmt(journalData.summary.total_mt)}</Typography>
                    <Typography variant="caption">{journalData.summary.settlement_count} settlements</Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined" sx={{ minWidth: 140 }}>
                  <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                    <Typography variant="caption" color="text.secondary">Avg Gross $/MT</Typography>
                    <Typography variant="h6" fontWeight={700}>{journalData.summary.gross_per_mt ? fmtDollar(journalData.summary.gross_per_mt) : '–'}</Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined" sx={{ minWidth: 140 }}>
                  <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                    <Typography variant="caption" color="text.secondary">Avg Net $/MT</Typography>
                    <Typography variant="h6" fontWeight={700} color="success.main">{journalData.summary.price_per_mt ? fmtDollar(journalData.summary.price_per_mt) : '–'}</Typography>
                  </CardContent>
                </Card>
              </Stack>

              {/* Deduction Categories Breakdown */}
              {journalData.summary.deduction_categories?.length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Deduction Breakdown</Typography>
                  <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Category</TableCell>
                          <TableCell>QBO Account</TableCell>
                          <TableCell align="right">Amount</TableCell>
                          <TableCell align="right">GST</TableCell>
                          <TableCell align="right">PST</TableCell>
                          <TableCell align="right">Count</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {journalData.summary.deduction_categories.map((d, i) => (
                          <TableRow key={i}>
                            <TableCell sx={{ textTransform: 'capitalize' }}>{d.label}</TableCell>
                            <TableCell><Typography variant="caption" color="text.secondary">{d.qbo_account}</Typography></TableCell>
                            <TableCell align="right" sx={{ color: 'error.main' }}>{fmtDollar(d.total)}</TableCell>
                            <TableCell align="right">{d.gst ? fmtDollar(d.gst) : '–'}</TableCell>
                            <TableCell align="right">{d.pst ? fmtDollar(d.pst) : '–'}</TableCell>
                            <TableCell align="right">{d.count}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              )}

              {/* By Buyer */}
              {journalData.by_buyer.map((buyer) => (
                <Box key={buyer.buyer} sx={{ mb: 3 }}>
                  <Box
                    sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', mb: 1 }}
                    onClick={() => toggleSection(`j_${buyer.buyer}`)}
                  >
                    {expandedSections[`j_${buyer.buyer}`] ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                    <Typography variant="subtitle1" fontWeight={700}>{buyer.buyer}</Typography>
                    {buyer.short_code && <Chip label={buyer.short_code} size="small" />}
                    <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                      {buyer.settlements.length} settlements · {fmt(buyer.subtotal_mt)} MT · {fmtDollar(buyer.subtotal_gross)} gross · <strong>{fmtDollar(buyer.subtotal_net)}</strong> net{buyer.subtotal_price_per_mt ? ` · ${fmtDollar(buyer.subtotal_price_per_mt)}/MT` : ''}
                    </Typography>
                  </Box>
                  <Collapse in={expandedSections[`j_${buyer.buyer}`]}>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Settlement #</TableCell>
                            <TableCell>Date</TableCell>
                            <TableCell>Contract</TableCell>
                            <TableCell>Commodity</TableCell>
                            <TableCell>Crop Year</TableCell>
                            <TableCell>Location</TableCell>
                            <TableCell align="right">MT</TableCell>
                            <TableCell align="right">Share</TableCell>
                            <TableCell align="right">Gross</TableCell>
                            <TableCell align="right">Deductions</TableCell>
                            <TableCell align="right">Net</TableCell>
                            <TableCell align="right">$/MT</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {buyer.settlements.map((s) => {
                            const allocs = s.location_allocation || [];
                            if (allocs.length === 0) {
                              return (
                                <TableRow key={s.id} hover sx={s.exported_at ? { opacity: 0.6 } : {}}>
                                  <TableCell>{s.settlement_number}{s.is_transfer ? ' [T]' : ''}{s.exported_at ? ' \u2713' : ''}</TableCell>
                                  <TableCell>{s.date ? new Date(s.date).toLocaleDateString() : '–'}</TableCell>
                                  <TableCell>{s.contract_number || '–'}</TableCell>
                                  <TableCell>{s.commodity || '–'}</TableCell>
                                  <TableCell>{s.crop_year || '–'}</TableCell>
                                  <TableCell sx={{ color: 'text.secondary', fontStyle: 'italic' }}>Unmatched</TableCell>
                                  <TableCell align="right">{s.total_mt ? fmt(s.total_mt) : '–'}</TableCell>
                                  <TableCell />
                                  <TableCell align="right">{fmtDollar(s.gross)}</TableCell>
                                  <TableCell align="right" sx={{ color: 'error.main' }}>{fmtDollar(s.total_deductions)}</TableCell>
                                  <TableCell align="right" sx={{ fontWeight: 600 }}>{fmtDollar(s.net)}</TableCell>
                                  <TableCell align="right" sx={{ fontWeight: 600 }}>{s.price_per_mt ? fmtDollar(s.price_per_mt) : '–'}</TableCell>
                                </TableRow>
                              );
                            }
                            return allocs.map((loc, i) => (
                              <TableRow key={`${s.id}-${loc.location}`} hover sx={s.exported_at ? { opacity: 0.6 } : {}}>
                                <TableCell>{i === 0 ? `${s.settlement_number}${s.is_transfer ? ' [T]' : ''}${s.exported_at ? ' \u2713' : ''}` : ''}</TableCell>
                                <TableCell>{i === 0 ? (s.date ? new Date(s.date).toLocaleDateString() : '–') : ''}</TableCell>
                                <TableCell>{i === 0 ? (s.contract_number || '–') : ''}</TableCell>
                                <TableCell>{i === 0 ? (s.commodity || '–') : ''}</TableCell>
                                <TableCell>{i === 0 ? (s.crop_year || '–') : ''}</TableCell>
                                <TableCell>
                                  <Chip label={loc.location} size="small" variant="outlined" icon={<LocationOnIcon />} />
                                </TableCell>
                                <TableCell align="right">{loc.mt.toLocaleString('en-CA', { minimumFractionDigits: 2 })}</TableCell>
                                <TableCell align="right" sx={{ color: 'text.secondary' }}>{loc.share}%</TableCell>
                                <TableCell align="right">{fmtDollar(loc.gross)}</TableCell>
                                <TableCell align="right" sx={{ color: 'error.main' }}>{fmtDollar(loc.total_deductions)}</TableCell>
                                <TableCell align="right" sx={{ fontWeight: 600 }}>{fmtDollar(loc.net)}</TableCell>
                                <TableCell align="right" sx={{ fontWeight: 600 }}>{loc.price_per_mt ? fmtDollar(loc.price_per_mt) : '–'}</TableCell>
                              </TableRow>
                            ));
                          })}
                          <TableRow sx={{ bgcolor: 'action.hover' }}>
                            <TableCell colSpan={6} sx={{ fontWeight: 700 }}>Subtotal — {buyer.buyer}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt(buyer.subtotal_mt)}</TableCell>
                            <TableCell />
                            <TableCell align="right" sx={{ fontWeight: 700 }}>{fmtDollar(buyer.subtotal_gross)}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700, color: 'error.main' }}>{fmtDollar(buyer.subtotal_gross - buyer.subtotal_net)}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700 }}>{fmtDollar(buyer.subtotal_net)}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700 }}>{buyer.subtotal_price_per_mt ? fmtDollar(buyer.subtotal_price_per_mt) : '–'}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Collapse>
                </Box>
              ))}

              {journalData.by_buyer.length === 0 && (
                <Alert severity="info">No approved settlements found for this fiscal year.</Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setJournalOpen(false); setJournalData(null); }}>Close</Button>
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
