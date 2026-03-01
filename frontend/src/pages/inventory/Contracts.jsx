import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Button, Stack, LinearProgress, Snackbar, Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import { getGridColors } from '../../utils/gridColors';
import api from '../../services/api';
import ContractFormDialog from '../../components/inventory/ContractFormDialog';
import DeliveryFormDialog from '../../components/inventory/DeliveryFormDialog';
import AvailableToSellTable from '../../components/inventory/AvailableToSellTable';

function ProgressCell({ value }) {
  const pct = value || 0;
  const color = pct >= 100 ? 'success' : pct >= 75 ? 'warning' : 'primary';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', py: 0.5 }}>
      <LinearProgress variant="determinate" value={Math.min(pct, 100)} color={color} sx={{ flex: 1, height: 8, borderRadius: 4 }} />
      <Typography variant="caption" sx={{ minWidth: 40 }}>{pct.toFixed(0)}%</Typography>
    </Box>
  );
}

export default function Contracts() {
  const { currentFarm, canEdit } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const colors = useMemo(() => getGridColors(mode), [mode]);

  const [contracts, setContracts] = useState([]);
  const [available, setAvailable] = useState([]);
  const [contractDialogOpen, setContractDialogOpen] = useState(false);
  const [deliveryDialog, setDeliveryDialog] = useState({ open: false, contract: null });
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'info' });

  const fetchData = useCallback(() => {
    if (!currentFarm) return;
    Promise.all([
      api.get(`/api/farms/${currentFarm.id}/contracts`),
      api.get(`/api/farms/${currentFarm.id}/contracts/available-to-sell`),
    ]).then(([cRes, aRes]) => {
      setContracts(cRes.data.contracts || []);
      setAvailable(aRes.data.available || []);
    });
  }, [currentFarm]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const columnDefs = useMemo(() => [
    { field: 'buyer', headerName: 'Buyer', flex: 1, minWidth: 180 },
    { field: 'commodity.name', headerName: 'Crop', width: 150 },
    { field: 'contracted_mt', headerName: 'Contract MT', width: 130, valueFormatter: p => p.value?.toLocaleString(undefined, { maximumFractionDigits: 1 }) },
    { field: 'hauled_mt', headerName: 'Hauled MT', width: 130, valueFormatter: p => p.value?.toLocaleString(undefined, { maximumFractionDigits: 1 }) },
    { field: 'pct_complete', headerName: '% Complete', width: 160, cellRenderer: ProgressCell },
    { field: 'status', headerName: 'Status', width: 100 },
    {
      headerName: '', width: 60, sortable: false, filter: false,
      cellRenderer: p => canEdit ? (
        <Button size="small" onClick={() => setDeliveryDialog({ open: true, contract: p.data })} sx={{ minWidth: 0 }}>
          <LocalShippingIcon fontSize="small" />
        </Button>
      ) : null,
    },
  ], [canEdit]);

  const defaultColDef = useMemo(() => ({ sortable: true, resizable: true, filter: true }), []);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>Contracts & Delivery</Typography>
        {canEdit && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setContractDialogOpen(true)}>
            Add Contract
          </Button>
        )}
      </Stack>

      {/* Active Contracts Grid */}
      <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 350, width: '100%', mb: 3 }}>
        <AgGridReact
          ref={gridRef}
          rowData={contracts}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          getRowId={p => p.data?.id}
        />
      </Box>

      {/* Available to Sell */}
      <AvailableToSellTable data={available} />

      {/* Dialogs */}
      <ContractFormDialog
        open={contractDialogOpen}
        onClose={() => setContractDialogOpen(false)}
        farmId={currentFarm?.id}
        onSaved={(warning) => {
          fetchData();
          setContractDialogOpen(false);
          if (warning) setSnack({ open: true, message: warning, severity: 'warning' });
        }}
      />

      <DeliveryFormDialog
        open={deliveryDialog.open}
        contract={deliveryDialog.contract}
        onClose={() => setDeliveryDialog({ open: false, contract: null })}
        farmId={currentFarm?.id}
        onSaved={() => { fetchData(); setDeliveryDialog({ open: false, contract: null }); }}
      />

      <Snackbar open={snack.open} autoHideDuration={6000} onClose={() => setSnack(s => ({ ...s, open: false }))}>
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
