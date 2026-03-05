import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Button, Stack, LinearProgress, Chip,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';
import { useNavigate } from 'react-router-dom';
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

const STATUS_COLORS = {
  executed: 'primary',
  in_delivery: 'info',
  delivered: 'success',
  settled: 'default',
  cancelled: 'error',
};

export default function Contracts() {
  const { currentFarm } = useFarm();
  const { mode } = useThemeMode();
  const navigate = useNavigate();
  const gridRef = useRef();

  const [contracts, setContracts] = useState([]);
  const [available, setAvailable] = useState([]);

  const fetchData = useCallback(() => {
    if (!currentFarm) return;
    Promise.all([
      api.get(`/api/farms/${currentFarm.id}/marketing/contracts`),
      api.get(`/api/farms/${currentFarm.id}/contracts/available-to-sell`),
    ]).then(([cRes, aRes]) => {
      // Enrich contracts with delivery progress
      const enriched = (cRes.data.contracts || []).map(c => ({
        ...c,
        buyer_name: c.counterparty?.name || 'Unknown',
        commodity_name: c.commodity?.name || 'Unknown',
        hauled_mt: c.contracted_mt - c.remaining_mt,
        pct_complete: c.contracted_mt > 0
          ? ((c.contracted_mt - c.remaining_mt) / c.contracted_mt) * 100
          : 0,
      }));
      setContracts(enriched);
      setAvailable(aRes.data.available || []);
    });
  }, [currentFarm]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const columnDefs = useMemo(() => [
    { field: 'buyer_name', headerName: 'Buyer', width: 160, rowGroup: false },
    { field: 'commodity_name', headerName: 'Crop', width: 130 },
    { field: 'contract_number', headerName: 'Contract #', width: 140 },
    {
      field: 'contracted_mt', headerName: 'Contract MT', width: 120,
      valueFormatter: p => p.value?.toLocaleString(undefined, { maximumFractionDigits: 1 }),
    },
    {
      field: 'hauled_mt', headerName: 'Hauled MT', width: 120,
      valueFormatter: p => p.value?.toLocaleString(undefined, { maximumFractionDigits: 1 }),
    },
    {
      field: 'remaining_mt', headerName: 'Remaining MT', width: 120,
      valueFormatter: p => p.value?.toLocaleString(undefined, { maximumFractionDigits: 1 }),
    },
    { field: 'pct_complete', headerName: '% Complete', width: 150, cellRenderer: ProgressCell },
    {
      field: 'delivery_start', headerName: 'Delivery Start', width: 120,
      valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString() : '',
    },
    {
      field: 'delivery_end', headerName: 'Delivery End', width: 120,
      valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString() : '',
    },
    {
      field: 'status', headerName: 'Status', width: 110,
      cellRenderer: p => (
        <Chip label={p.value} size="small" color={STATUS_COLORS[p.value] || 'default'} />
      ),
    },
  ], []);

  // Summary stats
  const totalContracted = contracts.reduce((s, c) => s + (c.contracted_mt || 0), 0);
  const totalHauled = contracts.reduce((s, c) => s + (c.hauled_mt || 0), 0);
  const activeCount = contracts.filter(c => c.status === 'executed' || c.status === 'in_delivery').length;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>Contracts Overview</Typography>
          <Typography variant="body2" color="text.secondary">
            Read-only view from Grain Marketing. {activeCount} active contracts |{' '}
            {totalContracted.toLocaleString(undefined, { maximumFractionDigits: 0 })} MT contracted |{' '}
            {totalHauled.toLocaleString(undefined, { maximumFractionDigits: 0 })} MT hauled
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<OpenInNewIcon />} onClick={() => navigate('/marketing/contracts')}>
          Manage in Marketing
        </Button>
      </Stack>

      {/* Marketing Contracts Grid */}
      <Box
        className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'}
        sx={{ height: 400, width: '100%', mb: 3 }}
      >
        <AgGridReact
          ref={gridRef}
          rowData={contracts}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true, filter: true }}
          animateRows
          getRowId={p => p.data?.id}
        />
      </Box>

      {/* Available to Sell */}
      <AvailableToSellTable data={available} />
    </Box>
  );
}
