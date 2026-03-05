import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Button, Stack, Chip, TextField, MenuItem,
  Dialog, DialogContent, IconButton,
} from '@mui/material';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import { getSocket } from '../../services/socket';
import TicketImportDialog from '../../components/inventory/TicketImportDialog';

export default function Tickets() {
  const { currentFarm, canEdit, isAdmin } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const [tickets, setTickets] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [settledFilter, setSettledFilter] = useState('');
  const [photoUrl, setPhotoUrl] = useState(null);
  const [selectedCount, setSelectedCount] = useState(0);

  // Listen for real-time mobile ticket uploads
  useEffect(() => {
    if (!currentFarm) return;
    const handler = (data) => {
      if (data?.ticket) {
        setTickets(prev => [data.ticket, ...prev]);
        setTotal(prev => prev + 1);
      }
    };
    const s = getSocket();
    s.on('ticket-created', handler);
    return () => s.off('ticket-created', handler);
  }, [currentFarm]);

  const fetchData = useCallback(() => {
    if (!currentFarm) return;
    const params = new URLSearchParams();
    if (settledFilter !== '') params.append('settled', settledFilter);
    params.append('limit', '500');

    Promise.all([
      api.get(`/api/farms/${currentFarm.id}/tickets?${params}`),
      api.get(`/api/farms/${currentFarm.id}/tickets/stats/summary`),
    ]).then(([tRes, sRes]) => {
      setTickets(tRes.data.tickets || []);
      setTotal(tRes.data.total || 0);
      setStats(sRes.data);
    });
  }, [currentFarm, settledFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDeleteSelected = async () => {
    const selectedRows = gridRef.current?.api?.getSelectedRows() || [];
    if (selectedRows.length === 0) return;
    if (!window.confirm(`Delete ${selectedRows.length} ticket${selectedRows.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;

    try {
      const ids = selectedRows.map(r => r.id);
      await api.delete(`/api/farms/${currentFarm.id}/tickets`, { data: { ids } });
      setSelectedCount(0);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete tickets');
    }
  };

  const onSelectionChanged = useCallback(() => {
    const count = gridRef.current?.api?.getSelectedRows()?.length || 0;
    setSelectedCount(count);
  }, []);

  const sourceChipColors = { mobile: 'info', traction_ag: 'default', manual: 'default' };
  const sourceLabels = { mobile: 'Mobile', traction_ag: 'Traction', manual: 'Manual' };

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
    { field: 'ticket_number', headerName: 'Ticket #', width: 100 },
    {
      field: 'delivery_date', headerName: 'Date', width: 95,
      valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString() : '',
    },
    { field: 'crop_year', headerName: 'Crop Yr', width: 75 },
    { field: 'commodity.name', headerName: 'Crop', width: 100 },
    {
      field: 'net_weight_mt', headerName: 'Net MT', width: 85,
      valueFormatter: p => p.value?.toFixed(2),
    },
    { field: 'location.name', headerName: 'Location', width: 100 },
    { field: 'bin_label', headerName: 'Bin/Bag', width: 100 },
    { field: 'buyer_name', headerName: 'Buyer', width: 120 },
    { field: 'contract_number', headerName: 'Contract #', width: 120 },
    {
      field: 'moisture_pct', headerName: 'Moist%', width: 70,
      valueFormatter: p => p.value != null ? (p.value * 100).toFixed(1) + '%' : '',
    },
    { field: 'grade', headerName: 'Grade', width: 70 },
    { field: 'operator_name', headerName: 'Operator', width: 110 },
    { field: 'destination', headerName: 'Destination', width: 110 },
    {
      field: 'source_system', headerName: 'Source', width: 85,
      cellRenderer: p => {
        const src = p.value || 'traction_ag';
        return <Chip label={sourceLabels[src] || src} size="small" color={sourceChipColors[src] || 'default'} variant="outlined" />;
      },
    },
    {
      field: 'settled', headerName: 'Settled', width: 75,
      cellRenderer: p => p.value
        ? <Chip label="Yes" size="small" color="success" />
        : <Chip label="No" size="small" color="default" variant="outlined" />,
    },
  ], []);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>Delivery Tickets</Typography>
          <Typography variant="body2" color="text.secondary">
            {total} tickets{stats ? ` | ${stats.settled} settled | ${stats.unsettled} unsettled` : ''}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          {selectedCount > 0 && isAdmin && (
            <Button
              variant="outlined"
              color="error"
              size="small"
              startIcon={<DeleteIcon />}
              onClick={handleDeleteSelected}
            >
              Delete {selectedCount} ticket{selectedCount !== 1 ? 's' : ''}
            </Button>
          )}
          <TextField
            select
            size="small"
            label="Filter"
            value={settledFilter}
            onChange={(e) => setSettledFilter(e.target.value)}
            sx={{ minWidth: 120 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="true">Settled</MenuItem>
            <MenuItem value="false">Unsettled</MenuItem>
          </TextField>
          {canEdit && (
            <Button variant="contained" startIcon={<FileUploadIcon />} onClick={() => setImportOpen(true)}>
              Import CSV
            </Button>
          )}
        </Stack>
      </Stack>

      {stats?.by_counterparty?.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap">
          {stats.by_counterparty.map(cp => (
            <Chip
              key={cp.counterparty_id}
              label={`${cp.counterparty_name}: ${cp.count} tickets (${cp.total_mt.toFixed(0)} MT)`}
              size="small"
              variant="outlined"
            />
          ))}
        </Stack>
      )}

      <Box
        className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'}
        sx={{ height: 500, width: '100%' }}
      >
        <AgGridReact
          ref={gridRef}
          rowData={tickets}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true, filter: true }}
          animateRows
          rowSelection="multiple"
          suppressRowClickSelection
          getRowId={p => p.data?.id}
          onSelectionChanged={onSelectionChanged}
        />
      </Box>

      <TicketImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        farmId={currentFarm?.id}
        onImported={fetchData}
      />

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
