import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Button, Stack, Chip, TextField, MenuItem,
} from '@mui/material';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { useNavigate } from 'react-router-dom';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import SettlementUploadDialog from '../../components/inventory/SettlementUploadDialog';

const STATUS_COLORS = {
  pending: 'warning',
  reconciled: 'info',
  disputed: 'error',
  approved: 'success',
};

export default function Settlements() {
  const { currentFarm, canEdit } = useFarm();
  const { mode } = useThemeMode();
  const navigate = useNavigate();
  const gridRef = useRef();

  const [settlements, setSettlements] = useState([]);
  const [total, setTotal] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchData = useCallback(() => {
    if (!currentFarm) return;
    const params = new URLSearchParams();
    if (statusFilter) params.append('status', statusFilter);
    api.get(`/api/farms/${currentFarm.id}/settlements?${params}`).then(res => {
      setSettlements(res.data.settlements || []);
      setTotal(res.data.total || 0);
    });
  }, [currentFarm, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

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
      valueFormatter: p => p.value ? `$${p.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '',
    },
    { field: '_count.lines', headerName: 'Lines', width: 70 },
    {
      field: 'status', headerName: 'Status', width: 110,
      cellRenderer: p => (
        <Chip label={p.value} size="small" color={STATUS_COLORS[p.value] || 'default'} />
      ),
    },
    {
      headerName: '', width: 120, sortable: false, filter: false,
      cellRenderer: p => (
        <Button
          size="small"
          startIcon={<AutoFixHighIcon />}
          onClick={() => navigate(`/inventory/settlement-recon?id=${p.data.id}`)}
        >
          Reconcile
        </Button>
      ),
    },
  ], [navigate]);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>Settlements</Typography>
          <Typography variant="body2" color="text.secondary">
            {total} settlement{total !== 1 ? 's' : ''}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <TextField
            select
            size="small"
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            sx={{ minWidth: 120 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="pending">Pending</MenuItem>
            <MenuItem value="reconciled">Reconciled</MenuItem>
            <MenuItem value="disputed">Disputed</MenuItem>
            <MenuItem value="approved">Approved</MenuItem>
          </TextField>
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
          getRowId={p => p.data?.id}
        />
      </Box>

      <SettlementUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        farmId={currentFarm?.id}
        onUploaded={fetchData}
      />
    </Box>
  );
}
