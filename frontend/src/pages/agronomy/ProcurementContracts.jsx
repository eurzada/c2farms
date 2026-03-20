import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Box, Typography, Paper, Stack, Chip, Tabs, Tab,
  FormControl, InputLabel, Select, MenuItem, TextField, InputAdornment,
  Button, IconButton, Tooltip, Snackbar, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Collapse,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';
import ProcurementImportDialog from '../../components/agronomy/ProcurementImportDialog';

/* ── formatting helpers ──────────────────────────────────────────────── */

function fmt(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function fmtDec(n) { return '$' + (n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtK(n) { return n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : fmtDec(n); }

/* ── constants ───────────────────────────────────────────────────────── */

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'invoiced', label: 'Invoiced' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
];

const CATEGORY_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'fertilizer', label: 'Fertilizer' },
  { value: 'fuel', label: 'Fuel' },
  { value: 'chemical', label: 'Chemical' },
  { value: 'seed', label: 'Seed' },
];

const STATUS_COLORS = {
  ordered: 'default',
  in_transit: 'info',
  delivered: 'success',
  invoiced: 'warning',
  paid: 'secondary',
  cancelled: 'error',
};

const CATEGORY_COLORS = {
  fertilizer: 'info',
  fuel: 'warning',
  chemical: 'success',
  seed: 'primary',
};

const TH = { fontWeight: 'bold', bgcolor: 'action.hover', whiteSpace: 'nowrap', fontSize: '0.78rem', py: 0.75, px: 1 };
const TD = { fontSize: '0.8rem', py: 0.5, px: 1 };

/* ── KPI card ────────────────────────────────────────────────────────── */

function KpiCard({ label, value, color }) {
  return (
    <Paper variant="outlined" sx={{ px: 2, py: 1.5, minWidth: 130, flex: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
        {label}
      </Typography>
      <Typography variant="h6" fontWeight="bold" color={color || 'text.primary'}>
        {value}
      </Typography>
    </Paper>
  );
}

/* ── main component ──────────────────────────────────────────────────── */

export default function ProcurementContracts({ year }) {
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const [contracts, setContracts] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [selectedContract, setSelectedContract] = useState(null);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'success' });

  /* ── data loading ────────────────────────────────────────────────── */

  const loadContracts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('crop_year', year);
      if (statusFilter) params.set('status', statusFilter);
      if (categoryFilter) params.set('category', categoryFilter);
      if (searchText) params.set('search', searchText);
      const res = await api.get(`/api/agronomy/procurement-contracts?${params}`);
      setContracts(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Error loading procurement contracts'));
    } finally {
      setLoading(false);
    }
  }, [year, statusFilter, categoryFilter, searchText]);

  const loadKpis = useCallback(async () => {
    try {
      const res = await api.get(`/api/agronomy/procurement-kpis?crop_year=${year}`);
      setKpis(res.data);
    } catch {
      // KPIs are supplementary, don't block the page
    }
  }, [year]);

  useEffect(() => { loadContracts(); }, [loadContracts]);
  useEffect(() => { loadKpis(); }, [loadKpis]);

  const handleRefresh = useCallback(() => {
    loadContracts();
    loadKpis();
  }, [loadContracts, loadKpis]);

  /* ── status update ───────────────────────────────────────────────── */

  const handleStatusChange = useCallback(async (contractId, newStatus) => {
    try {
      await api.patch(`/api/agronomy/procurement-contracts/${contractId}`, { status: newStatus });
      setSnack({ open: true, message: `Status updated to ${newStatus.replace('_', ' ')}`, severity: 'success' });
      loadContracts();
      loadKpis();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Error updating status'), severity: 'error' });
    }
  }, [loadContracts, loadKpis]);

  /* ── delete ──────────────────────────────────────────────────────── */

  const handleDelete = useCallback(async (contractId) => {
    try {
      await api.delete(`/api/agronomy/procurement-contracts/${contractId}`);
      setSnack({ open: true, message: 'Contract deleted', severity: 'success' });
      if (selectedContract?.id === contractId) setSelectedContract(null);
      loadContracts();
      loadKpis();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Error deleting contract'), severity: 'error' });
    }
  }, [loadContracts, loadKpis, selectedContract]);

  /* ── ag-Grid column defs ─────────────────────────────────────────── */

  const columnDefs = useMemo(() => [
    {
      field: 'contract_number',
      headerName: 'Contract #',
      pinned: 'left',
      width: 140,
      cellStyle: { fontWeight: 'bold' },
    },
    {
      headerName: 'Supplier',
      width: 160,
      valueGetter: (p) => p.data?.counterparty?.name || '—',
    },
    {
      field: 'input_category',
      headerName: 'Category',
      width: 120,
      cellRenderer: (p) => {
        if (!p.value) return null;
        return (
          <Chip
            label={p.value.charAt(0).toUpperCase() + p.value.slice(1)}
            color={CATEGORY_COLORS[p.value] || 'default'}
            size="small"
            sx={{ fontSize: '0.75rem' }}
          />
        );
      },
    },
    {
      headerName: 'BU(s)',
      width: 150,
      valueGetter: (p) => {
        if (!p.data?.lines?.length) return '—';
        const names = [...new Set(p.data.lines.map(l => l.bu_farm_name).filter(Boolean))];
        return names.length > 1 ? names.join(', ') : names[0] || '—';
      },
    },
    {
      field: 'blend_formula',
      headerName: 'Blend',
      width: 110,
      valueGetter: (p) => p.data?.blend_formula || '—',
    },
    {
      headerName: 'Products',
      width: 110,
      valueGetter: (p) => {
        const n = p.data?.lines?.length || 0;
        return `${n} product${n !== 1 ? 's' : ''}`;
      },
    },
    {
      headerName: 'Total Qty',
      width: 120,
      type: 'numericColumn',
      valueGetter: (p) => {
        if (!p.data?.lines?.length) return 0;
        return p.data.lines.reduce((s, l) => s + (l.qty || 0), 0);
      },
      valueFormatter: (p) => {
        const unit = p.data?.lines?.[0]?.qty_unit || 'units';
        return `${fmt(p.value)} ${unit}`;
      },
    },
    {
      field: 'contract_value',
      headerName: 'Value',
      width: 130,
      type: 'numericColumn',
      valueFormatter: (p) => fmtDec(p.value),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      cellRenderer: (p) => {
        if (!p.value) return null;
        const label = p.value.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
        return (
          <Chip
            label={label}
            color={STATUS_COLORS[p.value] || 'default'}
            size="small"
            sx={{ fontSize: '0.75rem', cursor: 'pointer' }}
          />
        );
      },
    },
    {
      field: 'delivery_window',
      headerName: 'Delivery Window',
      width: 150,
    },
    {
      field: 'payment_due',
      headerName: 'Payment Due',
      width: 130,
    },
  ], []);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    filter: true,
    suppressMovable: false,
  }), []);

  /* ── row click → detail ──────────────────────────────────────────── */

  const handleRowClicked = useCallback((e) => {
    setSelectedContract((prev) => prev?.id === e.data.id ? null : e.data);
  }, []);

  /* ── import complete ─────────────────────────────────────────────── */

  const handleImportComplete = useCallback(() => {
    setImportOpen(false);
    handleRefresh();
    setSnack({ open: true, message: 'Contracts imported successfully', severity: 'success' });
  }, [handleRefresh]);

  /* ── derived KPI values ──────────────────────────────────────────── */

  const kpiCards = useMemo(() => {
    if (!kpis) return [];
    return [
      { label: 'Total Contracts', value: fmt(kpis.totalContracts) },
      { label: 'Total Value', value: fmtK(kpis.totalValue), color: 'primary.main' },
      { label: 'Fertilizer', value: fmtK(kpis.byCategory?.fertilizer?.value || 0), color: 'info.main' },
      { label: 'Fuel', value: fmtK(kpis.byCategory?.fuel?.value || 0), color: 'warning.main' },
      { label: 'Delivered', value: fmt(kpis.byStatus?.delivered?.count || 0), color: 'success.main' },
      { label: 'Outstanding', value: fmt((kpis.byStatus?.ordered?.count || 0) + (kpis.byStatus?.in_transit?.count || 0)), color: 'text.secondary' },
    ];
  }, [kpis]);

  /* ── render ──────────────────────────────────────────────────────── */

  return (
    <Box>
      {/* KPI Cards */}
      {kpis && (
        <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap' }}>
          {kpiCards.map((k) => (
            <KpiCard key={k.label} label={k.label} value={k.value} color={k.color} />
          ))}
        </Stack>
      )}

      {/* Status Tabs */}
      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs
          value={statusFilter}
          onChange={(_, v) => { setStatusFilter(v); setSelectedContract(null); }}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontSize: '0.85rem' } }}
        >
          {STATUS_OPTIONS.map((o) => (
            <Tab key={o.value} value={o.value} label={o.label} />
          ))}
        </Tabs>
      </Paper>

      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>Category</InputLabel>
          <Select value={categoryFilter} label="Category" onChange={(e) => setCategoryFilter(e.target.value)}>
            {CATEGORY_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          size="small"
          placeholder="Search contracts..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          sx={{ minWidth: 200 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />

        <Box sx={{ flex: 1 }} />

        <Tooltip title="Refresh">
          <IconButton size="small" onClick={handleRefresh}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Button
          variant="contained"
          size="small"
          startIcon={<UploadFileIcon />}
          onClick={() => setImportOpen(true)}
        >
          Import Contracts
        </Button>
      </Box>

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {/* ag-Grid */}
      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Box
          className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'}
          sx={{ height: 500, width: '100%' }}
        >
          <AgGridReact
            ref={gridRef}
            rowData={contracts}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            animateRows={true}
            rowSelection="multiple"
            suppressRowClickSelection={true}
            onRowClicked={handleRowClicked}
            getRowId={(p) => p.data.id}
            overlayLoadingTemplate="<span>Loading contracts...</span>"
            overlayNoRowsTemplate="<span>No procurement contracts found</span>"
            loading={loading}
            getRowStyle={(p) => {
              if (selectedContract?.id === p.data?.id) {
                return { backgroundColor: 'rgba(25, 118, 210, 0.08)' };
              }
              return undefined;
            }}
          />
        </Box>
      </Paper>

      {/* Detail Panel (shown below grid when a contract is selected) */}
      <Collapse in={!!selectedContract} timeout={200}>
        {selectedContract && (
          <ContractDetail
            contract={selectedContract}
            onStatusChange={handleStatusChange}
            onDelete={handleDelete}
            onClose={() => setSelectedContract(null)}
          />
        )}
      </Collapse>

      {/* Import Dialog */}
      {importOpen && (
        <ProcurementImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={handleImportComplete}
          year={year}
        />
      )}

      {/* Snackbar */}
      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snack.severity}
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
          variant="filled"
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Contract Detail Panel
   ═══════════════════════════════════════════════════════════════════════════ */

function ContractDetail({ contract, onStatusChange, onDelete, onClose }) {
  const nextStatuses = useMemo(() => {
    const flow = {
      ordered: ['in_transit', 'delivered', 'cancelled'],
      in_transit: ['delivered', 'cancelled'],
      delivered: ['invoiced', 'cancelled'],
      invoiced: ['paid', 'cancelled'],
      paid: [],
      cancelled: [],
    };
    return flow[contract.status] || [];
  }, [contract.status]);

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography variant="subtitle1" fontWeight="bold">
            Contract #{contract.contract_number}
          </Typography>
          <Chip
            label={(contract.input_category || '').charAt(0).toUpperCase() + (contract.input_category || '').slice(1)}
            color={CATEGORY_COLORS[contract.input_category] || 'default'}
            size="small"
          />
          <Chip
            label={(contract.status || '').replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
            color={STATUS_COLORS[contract.status] || 'default'}
            size="small"
          />
          {contract.counterparty?.name && (
            <Typography variant="body2" color="text.secondary">
              {contract.counterparty.name}
            </Typography>
          )}
        </Stack>
        <IconButton size="small" onClick={onClose}>
          <ExpandLessIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Contract summary row */}
      <Stack direction="row" spacing={4} sx={{ mb: 2 }}>
        {contract.description && (
          <Box>
            <Typography variant="caption" color="text.secondary">Description</Typography>
            <Typography variant="body2">{contract.description}</Typography>
          </Box>
        )}
        {contract.blend_formula && (
          <Box>
            <Typography variant="caption" color="text.secondary">Blend</Typography>
            <Typography variant="body2">{contract.blend_formula}</Typography>
          </Box>
        )}
        <Box>
          <Typography variant="caption" color="text.secondary">Value</Typography>
          <Typography variant="body2" fontWeight="bold">{fmtDec(contract.contract_value)}</Typography>
        </Box>
        {contract.delivery_window && (
          <Box>
            <Typography variant="caption" color="text.secondary">Delivery</Typography>
            <Typography variant="body2">{contract.delivery_window}</Typography>
          </Box>
        )}
        {contract.payment_due && (
          <Box>
            <Typography variant="caption" color="text.secondary">Payment Due</Typography>
            <Typography variant="body2">{contract.payment_due}</Typography>
          </Box>
        )}
      </Stack>

      {/* Status actions */}
      {nextStatuses.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', mr: 1 }}>
            Update status:
          </Typography>
          {nextStatuses.map((s) => (
            <Button
              key={s}
              size="small"
              variant="outlined"
              color={STATUS_COLORS[s] === 'default' ? 'inherit' : (STATUS_COLORS[s] || 'inherit')}
              onClick={() => onStatusChange(contract.id, s)}
              sx={{ textTransform: 'none', fontSize: '0.8rem' }}
            >
              {s.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </Button>
          ))}
        </Stack>
      )}

      {/* Line items table */}
      {contract.lines?.length > 0 && (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={TH}>#</TableCell>
                <TableCell sx={TH}>Product</TableCell>
                <TableCell sx={TH}>Code</TableCell>
                <TableCell sx={TH}>Analysis</TableCell>
                <TableCell sx={TH}>BU</TableCell>
                <TableCell sx={{ ...TH, textAlign: 'right' }}>Qty</TableCell>
                <TableCell sx={TH}>Unit</TableCell>
                <TableCell sx={{ ...TH, textAlign: 'right' }}>$/Unit</TableCell>
                <TableCell sx={{ ...TH, textAlign: 'right' }}>Total</TableCell>
                <TableCell sx={{ ...TH, textAlign: 'right' }}>Delivered</TableCell>
                <TableCell sx={TH}>Notes</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {contract.lines.map((line) => (
                <TableRow key={line.id} hover>
                  <TableCell sx={TD}>{line.line_number}</TableCell>
                  <TableCell sx={{ ...TD, fontWeight: 500 }}>{line.product_name || '—'}</TableCell>
                  <TableCell sx={TD}>{line.product_code || '—'}</TableCell>
                  <TableCell sx={TD}>{line.product_analysis || '—'}</TableCell>
                  <TableCell sx={TD}>{line.bu_farm_name || '—'}</TableCell>
                  <TableCell sx={{ ...TD, textAlign: 'right' }}>{fmt(line.qty)}</TableCell>
                  <TableCell sx={TD}>{line.qty_unit || '—'}</TableCell>
                  <TableCell sx={{ ...TD, textAlign: 'right' }}>{fmtDec(line.unit_price)}</TableCell>
                  <TableCell sx={{ ...TD, textAlign: 'right', fontWeight: 'bold' }}>{fmtDec(line.line_total)}</TableCell>
                  <TableCell sx={{ ...TD, textAlign: 'right' }}>{fmt(line.delivered_qty)}</TableCell>
                  <TableCell sx={TD}>{line.notes || '—'}</TableCell>
                </TableRow>
              ))}
              {/* Totals row */}
              <TableRow>
                <TableCell colSpan={5} sx={{ ...TD, fontWeight: 'bold', borderTop: 2, borderColor: 'divider' }}>
                  Total ({contract.lines.length} line{contract.lines.length !== 1 ? 's' : ''})
                </TableCell>
                <TableCell sx={{ ...TD, textAlign: 'right', fontWeight: 'bold', borderTop: 2, borderColor: 'divider' }}>
                  {fmt(contract.lines.reduce((s, l) => s + (l.qty || 0), 0))}
                </TableCell>
                <TableCell sx={{ ...TD, borderTop: 2, borderColor: 'divider' }} />
                <TableCell sx={{ ...TD, borderTop: 2, borderColor: 'divider' }} />
                <TableCell sx={{ ...TD, textAlign: 'right', fontWeight: 'bold', borderTop: 2, borderColor: 'divider' }}>
                  {fmtDec(contract.lines.reduce((s, l) => s + (l.line_total || 0), 0))}
                </TableCell>
                <TableCell sx={{ ...TD, textAlign: 'right', fontWeight: 'bold', borderTop: 2, borderColor: 'divider' }}>
                  {fmt(contract.lines.reduce((s, l) => s + (l.delivered_qty || 0), 0))}
                </TableCell>
                <TableCell sx={{ ...TD, borderTop: 2, borderColor: 'divider' }} />
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Notes */}
      {contract.notes && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, fontStyle: 'italic' }}>
          {contract.notes}
        </Typography>
      )}
    </Paper>
  );
}
