import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  Stack,
  Alert,
  CircularProgress,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Menu,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import TableChartIcon from '@mui/icons-material/TableChart';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import TextSnippetIcon from '@mui/icons-material/TextSnippet';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { AgGridReact } from 'ag-grid-react';
import { useThemeMode } from '../../contexts/ThemeContext';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

const fmt = (v) => v != null ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—';

// ─── Matrix View ──────────────────────────────────────────────────────

function formatPeriodLabel(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', timeZone: 'UTC' });
}

function MatrixView({ farmId }) {
  const { mode } = useThemeMode();
  const [matrixData, setMatrixData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fromPeriod, setFromPeriod] = useState('');
  const [toPeriod, setToPeriod] = useState('');
  const [availablePeriods, setAvailablePeriods] = useState([]);
  const [exportAnchor, setExportAnchor] = useState(null);
  const [snack, setSnack] = useState('');

  const handleExport = async (format) => {
    setExportAnchor(null);
    try {
      const params = new URLSearchParams();
      if (fromPeriod) params.set('from_period', fromPeriod);
      if (toPeriod) params.set('to_period', toPeriod);
      const ext = { excel: 'xlsx', pdf: 'pdf', csv: 'csv' }[format];
      const res = await api.get(`/api/farms/${farmId}/inventory/count-history/export/${format}`, {
        params, responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `count-history-${new Date().toISOString().slice(0, 10)}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setSnack(extractErrorMessage(err, 'Export failed'));
    }
  };

  // Fetch available periods for selector
  useEffect(() => {
    if (!farmId) return;
    api.get(`/api/farms/${farmId}/inventory/count-periods`)
      .then(res => {
        const sorted = (res.data.periods || []).sort(
          (a, b) => new Date(a.period_date) - new Date(b.period_date)
        );
        setAvailablePeriods(sorted);
      })
      .catch(() => {});
  }, [farmId]);

  // Fetch matrix data
  useEffect(() => {
    if (!farmId) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (fromPeriod) params.set('from_period', fromPeriod);
    if (toPeriod) params.set('to_period', toPeriod);
    const qs = params.toString() ? `?${params}` : '';
    api.get(`/api/farms/${farmId}/inventory/count-history/matrix${qs}`)
      .then(res => {
        setMatrixData(res.data);
        setError('');
      })
      .catch(() => setError('Failed to load matrix data'))
      .finally(() => setLoading(false));
  }, [farmId, fromPeriod, toPeriod]);

  // Build period date list sorted oldest-first
  const periodDates = useMemo(() => {
    if (!matrixData?.periods) return [];
    return matrixData.periods
      .map(p => new Date(p.period_date).toISOString().slice(0, 10))
      .sort();
  }, [matrixData]);

  // Build column defs
  const columnDefs = useMemo(() => {
    const cols = [
      {
        headerName: 'Location',
        field: 'location',
        pinned: 'left',
        width: 140,
        sortable: true,
        filter: true,
        rowSpan: (params) => {
          // Not using row spanning — keep simple
          return 1;
        },
      },
      {
        headerName: 'Commodity',
        field: 'commodity',
        pinned: 'left',
        width: 130,
        sortable: true,
        filter: true,
      },
    ];

    for (const pd of periodDates) {
      cols.push({
        headerName: formatPeriodLabel(pd),
        field: `period_${pd}`,
        width: 120,
        type: 'numericColumn',
        valueFormatter: (params) => {
          if (params.value == null) return '—';
          return Number(params.value).toLocaleString(undefined, { maximumFractionDigits: 1 });
        },
        cellStyle: (params) => {
          if (params.node?.rowPinned) return { fontWeight: 700 };
          const delta = params.data?.[`delta_${pd}`];
          if (delta == null || delta === 0) return null;
          if (delta > 0) return { backgroundColor: 'rgba(46, 125, 50, 0.08)' };
          return { backgroundColor: 'rgba(211, 47, 47, 0.08)' };
        },
        tooltipValueGetter: (params) => {
          const delta = params.data?.[`delta_${pd}`];
          if (delta == null) return null;
          const sign = delta > 0 ? '+' : '';
          return `Delta: ${sign}${Number(delta).toLocaleString(undefined, { maximumFractionDigits: 1 })} MT`;
        },
      });
    }

    return cols;
  }, [periodDates]);

  // Build row data
  const rowData = useMemo(() => {
    if (!matrixData?.matrix) return [];
    return matrixData.matrix.map(row => {
      const r = {
        location: row.location,
        commodity: row.commodity,
        commodity_code: row.commodity_code,
      };
      for (const pd of periodDates) {
        const val = row.periods[pd];
        r[`period_${pd}`] = val != null ? Math.round(val * 10) / 10 : null;
        const delta = row.deltas?.[pd];
        r[`delta_${pd}`] = delta != null ? delta : null;
      }
      return r;
    });
  }, [matrixData, periodDates]);

  // Pinned bottom row — totals
  const pinnedBottomRowData = useMemo(() => {
    if (!rowData.length || !periodDates.length) return [];
    const totals = { location: 'Total', commodity: '' };
    for (const pd of periodDates) {
      let sum = 0;
      for (const row of rowData) {
        sum += row[`period_${pd}`] || 0;
      }
      totals[`period_${pd}`] = Math.round(sum * 10) / 10;
    }
    return [totals];
  }, [rowData, periodDates]);

  const defaultColDef = useMemo(() => ({
    resizable: true,
    suppressMovable: true,
  }), []);

  const onGridReady = useCallback((params) => {
    params.api.sizeColumnsToFit();
  }, []);

  if (loading) {
    return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>;
  }

  if (error) {
    return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;
  }

  if (!matrixData?.matrix?.length) {
    return <Alert severity="info" sx={{ m: 2 }}>No count data found for the selected period range.</Alert>;
  }

  const gridTheme = mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

  return (
    <Box>
      {/* Period range selector */}
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>From Period</InputLabel>
          <Select
            value={fromPeriod}
            label="From Period"
            onChange={e => setFromPeriod(e.target.value)}
          >
            <MenuItem value="">All</MenuItem>
            {availablePeriods.map(p => {
              const d = new Date(p.period_date).toISOString().slice(0, 10);
              return <MenuItem key={p.id} value={d}>{formatPeriodLabel(d)}</MenuItem>;
            })}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>To Period</InputLabel>
          <Select
            value={toPeriod}
            label="To Period"
            onChange={e => setToPeriod(e.target.value)}
          >
            <MenuItem value="">All</MenuItem>
            {availablePeriods.map(p => {
              const d = new Date(p.period_date).toISOString().slice(0, 10);
              return <MenuItem key={p.id} value={d}>{formatPeriodLabel(d)}</MenuItem>;
            })}
          </Select>
        </FormControl>
        <Typography variant="body2" sx={{ color: 'text.secondary', alignSelf: 'center', flex: 1 }}>
          {matrixData.matrix.length} rows across {periodDates.length} period{periodDates.length !== 1 ? 's' : ''}
        </Typography>
        <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={e => setExportAnchor(e.currentTarget)}>
          Export
        </Button>
        <Menu anchorEl={exportAnchor} open={Boolean(exportAnchor)} onClose={() => setExportAnchor(null)}>
          <MenuItem onClick={() => handleExport('excel')}><TableChartIcon fontSize="small" sx={{ mr: 1 }} />Excel</MenuItem>
          <MenuItem onClick={() => handleExport('pdf')}><PictureAsPdfIcon fontSize="small" sx={{ mr: 1 }} />PDF</MenuItem>
          <MenuItem onClick={() => handleExport('csv')}><TextSnippetIcon fontSize="small" sx={{ mr: 1 }} />CSV</MenuItem>
        </Menu>
      </Stack>

      {/* ag-Grid */}
      <Box className={gridTheme} sx={{ height: Math.min(600, 56 + rowData.length * 42 + 42), width: '100%' }}>
        <AgGridReact
          columnDefs={columnDefs}
          rowData={rowData}
          defaultColDef={defaultColDef}
          pinnedBottomRowData={pinnedBottomRowData}
          tooltipShowDelay={300}
          onGridReady={onGridReady}
          suppressCellFocus
          domLayout="normal"
        />
      </Box>
    </Box>
  );
}

// ─── Main Component ───────────────────────────────────────────────────

export default function CountHistory() {
  const { currentFarm } = useFarm();

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>
        Count History
      </Typography>
      <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
        Inventory count periods — location by commodity matrix with month-over-month deltas.
      </Typography>

      <MatrixView farmId={currentFarm?.id} />
    </Box>
  );
}
