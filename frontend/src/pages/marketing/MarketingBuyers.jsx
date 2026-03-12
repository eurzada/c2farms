import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Button, Stack, Chip, IconButton, Tooltip, Snackbar, Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import CounterpartyFormDialog from '../../components/marketing/CounterpartyFormDialog';

const TYPE_COLORS = { buyer: 'primary', broker: 'secondary', elevator: 'info', terminal: 'warning' };

import { fmt } from '../../utils/formatting';

export default function MarketingBuyers() {
  const { currentFarm, canEdit, isAdmin } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();

  const [counterparties, setCounterparties] = useState([]);
  const [dialog, setDialog] = useState({ open: false, initial: null });
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'info' });

  const fetchData = useCallback(() => {
    if (!currentFarm) return;
    api.get(`/api/farms/${currentFarm.id}/marketing/counterparties`)
      .then(res => setCounterparties(res.data.counterparties || []));
  }, [currentFarm]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async (id) => {
    try {
      await api.delete(`/api/farms/${currentFarm.id}/marketing/counterparties/${id}`);
      fetchData();
      setSnack({ open: true, message: 'Buyer deleted', severity: 'success' });
    } catch (err) {
      setSnack({ open: true, message: err.response?.data?.error || 'Failed to delete', severity: 'error' });
    }
  };

  const columnDefs = useMemo(() => [
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 140 },
    { field: 'short_code', headerName: 'Code', width: 56, maxWidth: 64 },
    {
      field: 'type', headerName: 'Type', width: 88,
      cellRenderer: p => <Chip label={p.value} size="small" color={TYPE_COLORS[p.value] || 'default'} variant="outlined" />,
    },
    { field: 'contact_name', headerName: 'Contact', width: 110 },
    { field: 'contact_email', headerName: 'Email', width: 140 },
    { field: 'contact_phone', headerName: 'Phone', width: 108 },
    { field: 'default_elevator_site', headerName: 'Default Elevator', width: 120 },
    { field: 'total_contracts', headerName: 'Contracts', width: 76 },
    { field: 'total_mt', headerName: 'Total MT', width: 88, valueFormatter: p => fmt(p.value) },
    { field: 'total_value', headerName: 'Total Value', width: 90, valueFormatter: p => p.value ? `$${(p.value / 1000).toFixed(0)}K` : '—' },
    { field: 'active_contracts', headerName: 'Active', width: 64 },
    {
      headerName: 'Actions', width: 88, sortable: false, filter: false,
      cellRenderer: p => {
        if (!canEdit) return null;
        return (
          <Stack direction="row" spacing={0}>
            <Tooltip title="Edit">
              <IconButton size="small" onClick={() => setDialog({ open: true, initial: p.data })}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {isAdmin && p.data.total_contracts === 0 && (
              <Tooltip title="Delete">
                <IconButton size="small" color="error" onClick={() => handleDelete(p.data.id)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        );
      },
    },
  ], [canEdit, isAdmin, currentFarm]);

  const defaultColDef = useMemo(() => ({ sortable: true, resizable: true, filter: true }), []);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>Buyers & Counterparties</Typography>
        {canEdit && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ open: true, initial: null })}>
            Add Buyer
          </Button>
        )}
      </Stack>

      <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 450, width: '100%', minWidth: 0 }}>
        <AgGridReact
          ref={gridRef}
          rowData={counterparties}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          getRowId={p => p.data?.id}
          onGridReady={({ api }) => api.sizeColumnsToFit()}
          onFirstDataRendered={({ api }) => api.sizeColumnsToFit()}
        />
      </Box>

      <CounterpartyFormDialog
        open={dialog.open}
        onClose={() => setDialog({ open: false, initial: null })}
        farmId={currentFarm?.id}
        initial={dialog.initial}
        onSaved={() => { fetchData(); setDialog({ open: false, initial: null }); }}
      />

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack(s => ({ ...s, open: false }))}>
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
