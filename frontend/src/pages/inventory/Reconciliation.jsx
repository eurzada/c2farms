import { useState, useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { Box, Typography, Stack, FormControl, InputLabel, Select, MenuItem, Card, CardContent, Alert, CircularProgress } from '@mui/material';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import { getGridColors } from '../../utils/gridColors';
import api from '../../services/api';

function FlagCell({ value }) {
  const icons = { ok: '\u2705', warning: '\u26A0\uFE0F', error: '\uD83D\uDD34' };
  return <span>{icons[value] || value}</span>;
}

export default function Reconciliation() {
  const { currentFarm } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const colors = useMemo(() => getGridColors(mode), [mode]);

  const [periods, setPeriods] = useState([]);
  const [fromPeriod, setFromPeriod] = useState('');
  const [toPeriod, setToPeriod] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentFarm) return;
    api.get(`/api/farms/${currentFarm.id}/inventory/count-periods`)
      .then(res => {
        const p = res.data.periods || [];
        setPeriods(p);
        if (p.length >= 2) {
          setFromPeriod(p[1].id); // second most recent
          setToPeriod(p[0].id);   // most recent
        }
      });
  }, [currentFarm]);

  useEffect(() => {
    if (!currentFarm || !fromPeriod || !toPeriod) return;
    setLoading(true);
    api.get(`/api/farms/${currentFarm.id}/reconciliation/${fromPeriod}/${toPeriod}`)
      .then(res => { setData(res.data); setError(''); })
      .catch(() => setError('Failed to load reconciliation'))
      .finally(() => setLoading(false));
  }, [currentFarm, fromPeriod, toPeriod]);

  const columnDefs = useMemo(() => [
    { field: 'commodity', headerName: 'Commodity', flex: 1, minWidth: 150 },
    { field: 'beginning_mt', headerName: 'Beginning MT', width: 140, valueFormatter: p => p.value?.toLocaleString(undefined, { maximumFractionDigits: 1 }) },
    { field: 'ending_mt', headerName: 'Ending MT', width: 130, valueFormatter: p => p.value?.toLocaleString(undefined, { maximumFractionDigits: 1 }) },
    { field: 'hauled_mt', headerName: 'Hauled MT', width: 130, valueFormatter: p => p.value?.toLocaleString(undefined, { maximumFractionDigits: 1 }) },
    { field: 'variance_mt', headerName: 'Variance MT', width: 130, valueFormatter: p => p.value?.toLocaleString(undefined, { maximumFractionDigits: 1 }) },
    { field: 'variance_pct', headerName: 'Variance %', width: 120, valueFormatter: p => `${(p.value || 0).toFixed(1)}%` },
    { field: 'flag', headerName: 'Flag', width: 80, cellRenderer: FlagCell },
  ], []);

  const defaultColDef = useMemo(() => ({ sortable: true, resizable: true }), []);

  const formatDate = (d) => new Date(d).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>Reconciliation</Typography>

      {/* Period selectors */}
      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>From Period</InputLabel>
          <Select value={fromPeriod} label="From Period" onChange={e => setFromPeriod(e.target.value)}>
            {periods.map(p => <MenuItem key={p.id} value={p.id}>{formatDate(p.period_date)}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>To Period</InputLabel>
          <Select value={toPeriod} label="To Period" onChange={e => setToPeriod(e.target.value)}>
            {periods.map(p => <MenuItem key={p.id} value={p.id}>{formatDate(p.period_date)}</MenuItem>)}
          </Select>
        </FormControl>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <CircularProgress />}

      {data && (
        <>
          {/* Summary stats */}
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Stack direction="row" spacing={4}>
                <Typography variant="body2"><strong>Total Beginning:</strong> {data.summary.total_beginning_mt.toLocaleString(undefined, { maximumFractionDigits: 0 })} MT</Typography>
                <Typography variant="body2"><strong>Total Ending:</strong> {data.summary.total_ending_mt.toLocaleString(undefined, { maximumFractionDigits: 0 })} MT</Typography>
                <Typography variant="body2"><strong>Total Hauled:</strong> {data.summary.total_hauled_mt.toLocaleString(undefined, { maximumFractionDigits: 0 })} MT</Typography>
                <Typography variant="body2"><strong>Total Variance:</strong> {data.summary.total_variance_mt.toLocaleString(undefined, { maximumFractionDigits: 0 })} MT</Typography>
              </Stack>
            </CardContent>
          </Card>

          {/* Variance table */}
          <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 400, width: '100%' }}>
            <AgGridReact
              ref={gridRef}
              rowData={data.rows}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              animateRows
              getRowId={p => p.data?.commodity}
            />
          </Box>
        </>
      )}
    </Box>
  );
}
