import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Button, Stack, Chip, TextField, MenuItem, Menu, ListItemIcon, ListItemText,
  Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Snackbar, Alert, Tooltip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  Popover, FormControlLabel, Checkbox, FormGroup,
} from '@mui/material';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import SummarizeIcon from '@mui/icons-material/Summarize';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import TableChartIcon from '@mui/icons-material/TableChart';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import TextSnippetIcon from '@mui/icons-material/TextSnippet';
import InputAdornment from '@mui/material/InputAdornment';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import { connectSocket } from '../../services/socket';
import EditIcon from '@mui/icons-material/Edit';
import TicketImportDialog from '../../components/inventory/TicketImportDialog';
import TicketEditDialog from '../../components/logistics/TicketEditDialog';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { extractErrorMessage } from '../../utils/errorHelpers';

export default function Tickets() {
  const { currentFarm, canEdit, isAdmin } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const [tickets, setTickets] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [settledFilter, setSettledFilter] = useState('');
  const [matchFilter, setMatchFilter] = useState('');
  const [fiscalYearFilter, setFiscalYearFilter] = useState('2026');
  const [photoUrl, setPhotoUrl] = useState(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [activeCounterpartyId, setActiveCounterpartyId] = useState(null);
  const [activeCommodityId, setActiveCommodityId] = useState(null);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'error' });
  const [unmatchedReportOpen, setUnmatchedReportOpen] = useState(false);
  const [colAnchor, setColAnchor] = useState(null);
  const [hiddenCols, setHiddenCols] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('c2_tickets_hidden_cols')) || {};
      // Remove legacy columns that no longer exist
      delete saved.gross_weight_mt;
      delete saved.tare_weight_mt;
      delete saved.dockage_pct;
      return saved;
    } catch { return {}; }
  });
  const [editTicket, setEditTicket] = useState(null);
  const [exportAnchor, setExportAnchor] = useState(null);
  const { confirm, dialogProps } = useConfirmDialog();

  // Listen for real-time mobile ticket uploads
  useEffect(() => {
    if (!currentFarm) return;
    const s = connectSocket();
    s.emit('join-farm', currentFarm.id);
    const handler = (data) => {
      if (data?.ticket) {
        setTickets(prev => [data.ticket, ...prev]);
        setTotal(prev => prev + 1);
      }
    };
    s.on('ticket-created', handler);
    return () => {
      s.off('ticket-created', handler);
      s.emit('leave-farm', currentFarm.id);
    };
  }, [currentFarm]);

  const fetchData = useCallback(() => {
    if (!currentFarm) return;
    const params = new URLSearchParams();
    if (settledFilter !== '') params.append('settled', settledFilter);
    if (matchFilter !== '') params.append('matched', matchFilter);
    if (fiscalYearFilter !== '') params.append('fiscal_year', fiscalYearFilter);
    params.append('limit', '5000');

    const statsParams = new URLSearchParams();
    if (fiscalYearFilter !== '') statsParams.append('fiscal_year', fiscalYearFilter);

    Promise.all([
      api.get(`/api/farms/${currentFarm.id}/tickets?${params}`),
      api.get(`/api/farms/${currentFarm.id}/tickets/stats/summary?${statsParams}`),
    ]).then(([tRes, sRes]) => {
      setTickets(tRes.data.tickets || []);
      setTotal(tRes.data.total || 0);
      setStats(sRes.data);
    });
  }, [currentFarm, settledFilter, matchFilter, fiscalYearFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDeleteSelected = async () => {
    const selectedRows = gridRef.current?.api?.getSelectedRows() || [];
    if (selectedRows.length === 0) return;
    const ok = await confirm({
      title: 'Delete Tickets',
      message: `Delete ${selectedRows.length} ticket${selectedRows.length !== 1 ? 's' : ''}? This cannot be undone.`,
      confirmText: 'Delete',
      confirmColor: 'error',
    });
    if (!ok) return;

    try {
      const ids = selectedRows.map(r => r.id);
      await api.delete(`/api/farms/${currentFarm.id}/tickets`, { data: { ids } });
      setSelectedCount(0);
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to delete tickets'), severity: 'error' });
    }
  };

  const handleBulkSettle = async () => {
    const selectedRows = gridRef.current?.api?.getSelectedRows() || [];
    if (selectedRows.length === 0) return;
    const unsettled = selectedRows.filter(r => !r.settled);
    if (unsettled.length === 0) {
      setSnack({ open: true, message: 'All selected tickets are already settled', severity: 'info' });
      return;
    }
    const ok = await confirm({
      title: 'Mark Tickets as Settled',
      message: `Mark ${unsettled.length} unsettled ticket${unsettled.length !== 1 ? 's' : ''} as settled? This is for prior-year cutoff — tickets will be flagged as settled without a matching settlement.`,
      confirmText: 'Mark Settled',
      confirmColor: 'success',
    });
    if (!ok) return;

    try {
      const ids = unsettled.map(r => r.id);
      await api.patch(`/api/farms/${currentFarm.id}/tickets/bulk-settle`, {
        ids,
        notes: 'Marked settled — prior year cutoff',
      });
      setSnack({ open: true, message: `${unsettled.length} ticket(s) marked as settled`, severity: 'success' });
      setSelectedCount(0);
      fetchData();
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Failed to mark tickets as settled'), severity: 'error' });
    }
  };

  const onSelectionChanged = useCallback(() => {
    const count = gridRef.current?.api?.getSelectedRows()?.length || 0;
    setSelectedCount(count);
  }, []);

  const handleExport = async (format) => {
    setExportAnchor(null);
    try {
      const params = new URLSearchParams();
      if (fiscalYearFilter) params.append('fiscal_year', fiscalYearFilter);
      if (settledFilter) params.append('settled', settledFilter);
      if (matchFilter) params.append('matched', matchFilter);

      const ext = { excel: 'xlsx', pdf: 'pdf', csv: 'csv' }[format];
      const res = await api.get(`/api/farms/${currentFarm.id}/tickets/export/${format}`, {
        params, responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tickets-${new Date().toISOString().slice(0, 10)}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setSnack({ open: true, message: extractErrorMessage(err, 'Export failed'), severity: 'error' });
    }
  };

  // Build unmatched tickets report grouped by contract #
  const unmatchedReport = useMemo(() => {
    const unmatched = tickets.filter(t => !t.settlement_lines?.length);
    const groups = {};
    for (const t of unmatched) {
      const key = t.contract_number || '(No Contract)';
      if (!groups[key]) {
        groups[key] = { contract_number: key, buyer: t.buyer_name || t.counterparty?.name || '', crop: t.commodity?.name || '', tickets: 0, total_mt: 0 };
      }
      groups[key].tickets++;
      groups[key].total_mt += t.net_weight_mt || 0;
      if (!groups[key].buyer && (t.buyer_name || t.counterparty?.name)) groups[key].buyer = t.buyer_name || t.counterparty?.name;
      if (!groups[key].crop && t.commodity?.name) groups[key].crop = t.commodity.name;
    }
    return Object.values(groups).sort((a, b) => a.contract_number.localeCompare(b.contract_number));
  }, [tickets]);

  const unmatchedTotal = useMemo(() => ({
    tickets: unmatchedReport.reduce((s, g) => s + g.tickets, 0),
    mt: unmatchedReport.reduce((s, g) => s + g.total_mt, 0),
  }), [unmatchedReport]);

  const copyUnmatchedReport = () => {
    const lines = ['Not Reconciled — Tickets Report', `Generated: ${new Date().toLocaleDateString()}`, ''];
    lines.push(`Total: ${unmatchedTotal.tickets} tickets, ${unmatchedTotal.mt.toFixed(2)} Unload MT`, '');
    lines.push('Contract #\tBuyer\tCrop\tTickets\tUnload MT');
    for (const g of unmatchedReport) {
      lines.push(`${g.contract_number}\t${g.buyer}\t${g.crop}\t${g.tickets}\t${g.total_mt.toFixed(2)}`);
    }
    navigator.clipboard.writeText(lines.join('\n'));
    setSnack({ open: true, message: 'Report copied to clipboard', severity: 'success' });
  };

  const downloadUnmatchedCsv = () => {
    const rows = [['Contract #', 'Buyer', 'Crop', 'Tickets', 'Unload MT']];
    for (const g of unmatchedReport) {
      rows.push([g.contract_number, g.buyer, g.crop, g.tickets, g.total_mt.toFixed(2)]);
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `not-reconciled-tickets-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleCol = (field) => {
    setHiddenCols(prev => {
      const next = { ...prev, [field]: !prev[field] };
      localStorage.setItem('c2_tickets_hidden_cols', JSON.stringify(next));
      return next;
    });
  };

  const sourceChipColors = { mobile: 'info', traction_ag: 'default', manual: 'default' };
  const sourceLabels = { mobile: 'Mobile', traction_ag: 'Traction', manual: 'Manual' };

  // Toggleable columns — field key to headerName
  const toggleableColumns = [
    { field: 'ticket_number', headerName: 'Ticket #' },
    { field: 'source_timestamp', headerName: 'Timestamp' },
    { field: 'delivery_date', headerName: 'Date' },
    { field: 'crop_year', headerName: 'Crop Yr' },
    { field: 'commodity.name', headerName: 'Crop' },
    { field: 'net_weight_mt', headerName: 'Unload MT' },
    { field: 'location.name', headerName: 'Location' },
    { field: 'bin_label', headerName: 'Bin/Bag' },
    { field: 'buyer_name', headerName: 'Buyer' },
    { field: 'contract_number', headerName: 'Contract #' },
    { field: 'moisture_pct', headerName: 'Moist%' },
    { field: 'grade', headerName: 'Grade' },
    { field: 'operator_name', headerName: 'Operator' },
    { field: 'destination', headerName: 'Destination' },
    { field: 'source_system', headerName: 'Source' },
    { field: 'match', headerName: 'Settlement' },
    { field: 'settled', headerName: 'Paid' },
  ];

  const columnDefs = useMemo(() => [
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
      headerName: '', width: 50, sortable: false, filter: false, resizable: false,
      cellRenderer: p => p.data?.photo_thumbnail_url
        ? <img
            src={p.data.photo_thumbnail_url}
            alt="ticket"
            style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', cursor: 'pointer' }}
            onClick={() => setPhotoUrl(p.data.photo_url)}
          />
        : null,
    },
    canEdit && {
      colId: 'edit', headerName: '', width: 52, sortable: false, filter: false, resizable: false,
      cellRenderer: p => (
        <Tooltip title="Edit ticket">
          <span
            role="button"
            onClick={() => setEditTicket(p.data)}
            style={{ cursor: 'pointer', fontSize: 16, lineHeight: '32px', textAlign: 'center', display: 'block', overflow: 'visible' }}
          >&#9998;</span>
        </Tooltip>
      ),
    },
    !hiddenCols['ticket_number'] && { field: 'ticket_number', headerName: 'Ticket #', width: 100 },
    !hiddenCols['source_timestamp'] && {
      field: 'source_timestamp', headerName: 'Timestamp', width: 145,
      valueFormatter: p => {
        if (!p.value) return '';
        const d = new Date(p.value);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      },
    },
    !hiddenCols['delivery_date'] && {
      field: 'delivery_date', headerName: 'Date', width: 95,
      valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString() : '',
    },
    !hiddenCols['crop_year'] && { field: 'crop_year', headerName: 'Crop Yr', width: 75 },
    !hiddenCols['commodity.name'] && { field: 'commodity.name', headerName: 'Crop', width: 100 },
    !hiddenCols['net_weight_mt'] && {
      field: 'net_weight_mt', headerName: 'Unload MT', width: 85,
      valueFormatter: p => p.value?.toFixed(2),
    },
    !hiddenCols['location.name'] && { field: 'location.name', headerName: 'Location', width: 100 },
    !hiddenCols['bin_label'] && { field: 'bin_label', headerName: 'Bin/Bag', width: 100 },
    !hiddenCols['buyer_name'] && { field: 'buyer_name', headerName: 'Buyer', width: 120 },
    !hiddenCols['contract_number'] && { field: 'contract_number', headerName: 'Contract #', width: 120 },
    !hiddenCols['moisture_pct'] && {
      field: 'moisture_pct', headerName: 'Moist%', width: 70,
      valueFormatter: p => p.value != null ? (p.value * 100).toFixed(1) + '%' : '',
    },
    !hiddenCols['grade'] && { field: 'grade', headerName: 'Grade', width: 70 },
    !hiddenCols['operator_name'] && { field: 'operator_name', headerName: 'Operator', width: 110 },
    !hiddenCols['destination'] && { field: 'destination', headerName: 'Destination', width: 110 },
    !hiddenCols['source_system'] && {
      field: 'source_system', headerName: 'Source', width: 85,
      cellRenderer: p => {
        const src = p.value || 'traction_ag';
        return <Chip label={sourceLabels[src] || src} size="small" color={sourceChipColors[src] || 'default'} variant="outlined" />;
      },
    },
    !hiddenCols['match'] && {
      headerName: 'Settlement', width: 120, colId: 'match',
      valueGetter: p => {
        const sl = p.data?.settlement_lines?.[0];
        if (!sl) return 'Not Reconciled';
        return `#${sl.settlement?.settlement_number || '?'}`;
      },
      cellRenderer: p => {
        const sl = p.data?.settlement_lines?.[0];
        if (!sl) return <Chip label="Not Reconciled" size="small" color="default" variant="outlined" />;
        const sStatus = sl.settlement?.status;
        const color = sStatus === 'approved' ? 'success' : sStatus === 'reconciled' ? 'info' : 'warning';
        return (
          <Tooltip title={`Settlement ${sl.settlement?.settlement_number} (${sStatus})`}>
            <Chip label={`#${sl.settlement?.settlement_number}`} size="small" color={color} variant="outlined" />
          </Tooltip>
        );
      },
    },
    !hiddenCols['settled'] && {
      field: 'settled', headerName: 'Paid', width: 75,
      cellRenderer: p => p.value
        ? <Chip label="Paid" size="small" color="success" />
        : <Chip label="No" size="small" color="default" variant="outlined" />,
    },
  ].filter(Boolean), [hiddenCols, canEdit]);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>Delivery Tickets</Typography>
          <Typography variant="body2" color="text.secondary">
            Showing {total} of {stats ? stats.total : total}
            {stats ? <> &mdash; {stats.matched || 0} reconciled to settlements &middot; {stats.settled} paid &middot; {stats.unsettled} awaiting payment</> : ''}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          {selectedCount > 0 && isAdmin && (
            <>
              <Button
                variant="outlined"
                color="success"
                size="small"
                startIcon={<CheckCircleOutlineIcon />}
                onClick={handleBulkSettle}
              >
                Mark Settled ({selectedCount})
              </Button>
              <Button
                variant="outlined"
                color="error"
                size="small"
                startIcon={<DeleteIcon />}
                onClick={handleDeleteSelected}
              >
                Delete ({selectedCount})
              </Button>
            </>
          )}
          <TextField
            select
            size="small"
            label="Fiscal Year"
            value={fiscalYearFilter}
            onChange={(e) => setFiscalYearFilter(e.target.value)}
            sx={{ minWidth: 120 }}
          >
            <MenuItem value="">All Years</MenuItem>
            {[2022, 2023, 2024, 2025, 2026, 2027].map(fy => (
              <MenuItem key={fy} value={String(fy)}>
                FY{fy} (Nov {String(fy - 1).slice(-2)} – Oct {String(fy).slice(-2)})
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Reconciled"
            value={matchFilter}
            onChange={(e) => setMatchFilter(e.target.value)}
            sx={{ minWidth: 130 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="true">Reconciled</MenuItem>
            <MenuItem value="false">Not Reconciled</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="Payment"
            value={settledFilter}
            onChange={(e) => setSettledFilter(e.target.value)}
            sx={{ minWidth: 130 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="true">Paid</MenuItem>
            <MenuItem value="false">Awaiting Payment</MenuItem>
          </TextField>
          <Tooltip title="Toggle columns">
            <IconButton size="small" onClick={(e) => setColAnchor(e.currentTarget)}>
              <ViewColumnIcon />
            </IconButton>
          </Tooltip>
          {unmatchedTotal.tickets > 0 && (
            <Button variant="outlined" color="warning" startIcon={<SummarizeIcon />} onClick={() => setUnmatchedReportOpen(true)}>
              Not Reconciled ({unmatchedTotal.tickets})
            </Button>
          )}
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={(e) => setExportAnchor(e.currentTarget)}>
            Export
          </Button>
          <Menu anchorEl={exportAnchor} open={Boolean(exportAnchor)} onClose={() => setExportAnchor(null)}>
            <MenuItem onClick={() => handleExport('excel')}>
              <ListItemIcon><TableChartIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Excel (.xlsx)</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleExport('pdf')}>
              <ListItemIcon><PictureAsPdfIcon fontSize="small" /></ListItemIcon>
              <ListItemText>PDF</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleExport('csv')}>
              <ListItemIcon><TextSnippetIcon fontSize="small" /></ListItemIcon>
              <ListItemText>CSV</ListItemText>
            </MenuItem>
          </Menu>
          {canEdit && (
            <Button variant="contained" startIcon={<FileUploadIcon />} onClick={() => setImportOpen(true)}>
              Import CSV
            </Button>
          )}
        </Stack>
      </Stack>

      <TextField
        size="small"
        placeholder="Search tickets (ticket #, buyer, operator, crop...)"
        value={searchText}
        onChange={(e) => {
          setSearchText(e.target.value);
          gridRef.current?.api?.setGridOption('quickFilterText', e.target.value);
        }}
        InputProps={{
          startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" color="action" /></InputAdornment>,
        }}
        sx={{ mb: 1.5, maxWidth: 450 }}
        fullWidth
      />

      {stats?.by_counterparty?.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
          {stats.by_counterparty.map(cp => {
            const commodities = cp.by_commodity || [];
            const isActive = activeCounterpartyId === cp.counterparty_id;

            if (isActive) {
              // Active buyer: show parent chip + commodity sub-chips
              return [
                <Chip
                  key={cp.counterparty_id}
                  label={`${cp.counterparty_name} ✓ (${cp.total_mt.toFixed(0)} MT)`}
                  size="small"
                  variant="filled"
                  color="primary"
                  onClick={() => {
                    setActiveCounterpartyId(null);
                    setActiveCommodityId(null);
                  }}
                  sx={{ cursor: 'pointer' }}
                />,
                ...commodities.map(c => (
                  <Chip
                    key={`${cp.counterparty_id}-${c.commodity_id}`}
                    label={`${c.commodity_name}: ${c.total_mt.toFixed(0)} MT`}
                    size="small"
                    variant={activeCommodityId === c.commodity_id ? 'filled' : 'outlined'}
                    color={activeCommodityId === c.commodity_id ? 'secondary' : 'default'}
                    onClick={() => {
                      setActiveCommodityId(activeCommodityId === c.commodity_id ? null : c.commodity_id);
                    }}
                    sx={{ cursor: 'pointer' }}
                  />
                )),
              ];
            }

            // Inactive buyer: show combined label
            const breakdown = commodities.length === 1
              ? `${commodities[0].total_mt.toFixed(0)} MT ${commodities[0].commodity_name}`
              : commodities.map(c => `${c.total_mt.toFixed(0)} MT ${c.commodity_name}`).join(' \u00b7 ')
                + ` (${cp.total_mt.toFixed(0)} MT total)`;
            return (
              <Chip
                key={cp.counterparty_id}
                label={`${cp.counterparty_name}: ${breakdown}`}
                size="small"
                variant="outlined"
                color="default"
                onClick={() => {
                  setActiveCounterpartyId(cp.counterparty_id);
                  setActiveCommodityId(null);
                }}
                sx={{ cursor: 'pointer' }}
              />
            );
          })}
        </Stack>
      )}

      <Box
        className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'}
        sx={{ height: 500, width: '100%' }}
      >
        <AgGridReact
          ref={gridRef}
          rowData={activeCounterpartyId
            ? tickets.filter(t =>
                t.counterparty_id === activeCounterpartyId &&
                (!activeCommodityId || t.commodity_id === activeCommodityId)
              )
            : tickets}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true, filter: true }}
          animateRows
          rowSelection="multiple"
          suppressRowClickSelection
          enableCellTextSelection
          ensureDomOrder
          getRowId={p => p.data?.id}
          onSelectionChanged={onSelectionChanged}
        />
      </Box>

      {/* Column Visibility Popover */}
      <Popover
        open={Boolean(colAnchor)}
        anchorEl={colAnchor}
        onClose={() => setColAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ p: 2, minWidth: 200 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Show/Hide Columns</Typography>
          <FormGroup>
            {toggleableColumns.map(c => (
              <FormControlLabel
                key={c.field}
                control={<Checkbox size="small" checked={!hiddenCols[c.field]} onChange={() => toggleCol(c.field)} />}
                label={<Typography variant="body2">{c.headerName}</Typography>}
                sx={{ ml: 0, mr: 0 }}
              />
            ))}
          </FormGroup>
        </Box>
      </Popover>

      <TicketImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        farmId={currentFarm?.id}
        onImported={fetchData}
      />

      <TicketEditDialog
        open={!!editTicket}
        onClose={() => setEditTicket(null)}
        farmId={currentFarm?.id}
        ticket={editTicket}
        onSaved={fetchData}
      />

      <ConfirmDialog {...dialogProps} />
      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack(s => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>{snack.message}</Alert>
      </Snackbar>

      {/* Unmatched Tickets Report Dialog */}
      <Dialog open={unmatchedReportOpen} onClose={() => setUnmatchedReportOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <span>Not Reconciled — Tickets by Contract</span>
            {unmatchedReport.length > 0 && (
              <Stack direction="row" spacing={1}>
                <Tooltip title="Copy to clipboard">
                  <IconButton size="small" onClick={copyUnmatchedReport}>
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={downloadUnmatchedCsv}>
                  CSV
                </Button>
              </Stack>
            )}
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {unmatchedReport.length === 0 ? (
            <Alert severity="success">All tickets are reconciled to settlements.</Alert>
          ) : (
            <>
              <Alert severity="info" sx={{ mb: 2 }}>
                {unmatchedTotal.tickets} ticket{unmatchedTotal.tickets !== 1 ? 's' : ''} ({unmatchedTotal.mt.toFixed(2)} Unload MT) not yet reconciled to a settlement.
              </Alert>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Contract #</TableCell>
                      <TableCell>Buyer</TableCell>
                      <TableCell>Crop</TableCell>
                      <TableCell align="right">Tickets</TableCell>
                      <TableCell align="right">Unload MT</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {unmatchedReport.map(g => (
                      <TableRow key={g.contract_number} hover>
                        <TableCell sx={{ fontWeight: 600 }}>{g.contract_number}</TableCell>
                        <TableCell>{g.buyer}</TableCell>
                        <TableCell>{g.crop}</TableCell>
                        <TableCell align="right">{g.tickets}</TableCell>
                        <TableCell align="right">{g.total_mt.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow sx={{ bgcolor: 'action.hover' }}>
                      <TableCell colSpan={3} sx={{ fontWeight: 700 }}>Total</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{unmatchedTotal.tickets}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{unmatchedTotal.mt.toFixed(2)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUnmatchedReportOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Full-size photo viewer */}
      <Dialog open={!!photoUrl} onClose={() => setPhotoUrl(null)} maxWidth="md">
        <DialogContent sx={{ p: 0, position: 'relative' }}>
          <IconButton
            onClick={() => setPhotoUrl(null)}
            sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'rgba(0,0,0,0.5)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' } }}
          >
            <CloseIcon />
          </IconButton>
          {photoUrl && (
            <img src={photoUrl} alt="Delivery ticket" style={{ maxWidth: '100%', maxHeight: '80vh', display: 'block' }} />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
