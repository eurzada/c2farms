import { useState, useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Stack, FormControl, InputLabel, Select, MenuItem,
  Card, CardContent, Alert, CircularProgress, Grid, Chip, ToggleButton, ToggleButtonGroup,
  Button,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import { getGridColors } from '../../utils/gridColors';
import api from '../../services/api';
import ElevatorTicketImportDialog from '../../components/inventory/ElevatorTicketImportDialog';

function FlagCell({ value }) {
  const icons = { ok: '\u2705', warning: '\u26A0\uFE0F', error: '\uD83D\uDD34' };
  return <span>{icons[value] || value}</span>;
}

const fmt = (v) => v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—';
const fmtInt = (v) => v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—';
const formatDate = (d) => new Date(d).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });

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
  const [viewMode, setViewMode] = useState('compare'); // 'compare' | 'waterfall'
  const [history, setHistory] = useState(null);
  const [elevatorImportOpen, setElevatorImportOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Fetch periods
  useEffect(() => {
    if (!currentFarm) return;
    api.get(`/api/farms/${currentFarm.id}/inventory/count-periods`)
      .then(res => {
        const p = res.data.periods || [];
        setPeriods(p);
        if (p.length >= 2) {
          setFromPeriod(p[1].id);
          setToPeriod(p[0].id);
        }
      });
  }, [currentFarm]);

  // Fetch comparison data
  useEffect(() => {
    if (!currentFarm || !fromPeriod || !toPeriod || viewMode !== 'compare') return;
    setLoading(true);
    api.get(`/api/farms/${currentFarm.id}/reconciliation/${fromPeriod}/${toPeriod}`)
      .then(res => { setData(res.data); setError(''); })
      .catch(() => setError('Failed to load reconciliation'))
      .finally(() => setLoading(false));
  }, [currentFarm, fromPeriod, toPeriod, viewMode, refreshKey]);

  // Fetch waterfall data (count history)
  useEffect(() => {
    if (!currentFarm || viewMode !== 'waterfall') return;
    setLoading(true);
    api.get(`/api/farms/${currentFarm.id}/inventory/count-history`)
      .then(res => { setHistory(res.data.periods || []); setError(''); })
      .catch(() => setError('Failed to load history'))
      .finally(() => setLoading(false));
  }, [currentFarm, viewMode]);

  // Determine which source is "used in calc" for a row
  const getUsedSource = (row) => {
    if (!row) return 'traction';
    const elevator = row.at_elevator_mt || 0;
    const traction = row.hauled_mt || 0;
    // Elevator used when it exists and >= traction (normal case)
    return elevator > 0 && elevator >= traction ? 'elevator' : 'traction';
  };

  // Settlement coverage stats
  const settlementCoverage = useMemo(() => {
    if (!data?.rows) return null;
    const total = data.rows.length;
    const withElevator = data.rows.filter(r => (r.at_elevator_mt || 0) > 0).length;
    return { withElevator, total };
  }, [data]);

  const columnDefs = useMemo(() => [
    { field: 'commodity', headerName: 'Commodity', width: 150 },
    { field: 'beginning_mt', headerName: 'Beginning MT', width: 140, valueFormatter: p => fmt(p.value) },
    { field: 'ending_mt', headerName: 'Ending MT', width: 130, valueFormatter: p => fmt(p.value) },
    {
      field: 'hauled_mt', headerName: 'Traction MT', width: 130,
      valueFormatter: p => fmt(p.value),
      cellStyle: p => {
        const used = getUsedSource(p.data);
        return {
          fontWeight: used === 'traction' ? 700 : 400,
          backgroundColor: used === 'traction' ? '#FFF3E0' : undefined,
        };
      },
    },
    {
      field: 'at_elevator_mt', headerName: 'Elevator MT', width: 130,
      valueFormatter: p => fmt(p.value || 0),
      cellStyle: p => {
        const used = getUsedSource(p.data);
        const hasElevator = (p.data?.at_elevator_mt || 0) > 0;
        return {
          fontWeight: used === 'elevator' ? 700 : 400,
          backgroundColor: hasElevator && used === 'elevator' ? '#E8F5E9' : undefined,
        };
      },
    },
    {
      headerName: 'Difference', width: 120,
      valueGetter: p => {
        const e = p.data?.at_elevator_mt || 0;
        const h = p.data?.hauled_mt || 0;
        return e > 0 ? e - h : null;
      },
      valueFormatter: p => p.value != null ? fmt(p.value) : '—',
      cellStyle: p => {
        if (p.value == null) return {};
        return {
          color: p.value < 0 ? '#D32F2F' : '#2E7D32',
          fontWeight: p.value < 0 ? 700 : 400,
        };
      },
    },
    {
      headerName: 'Source', width: 80,
      valueGetter: p => {
        const hasElevator = (p.data?.at_elevator_mt || 0) > 0;
        return hasElevator ? (getUsedSource(p.data) === 'elevator' ? 'E' : 'T!') : '—';
      },
      cellStyle: p => {
        if (p.value === 'T!') return { color: '#E65100', fontWeight: 700 };
        if (p.value === 'E') return { color: '#2E7D32' };
        return { color: '#9E9E9E' };
      },
      tooltipValueGetter: p => {
        const src = p.data?.elevator_source;
        if (p.value === 'E') return `Using Elevator data (${src === 'portal' ? 'portal import' : 'settlement PDF'}) for variance calc`;
        if (p.value === 'T!') return 'Elevator < Traction — using Traction. Investigate!';
        return 'No elevator data — using Traction';
      },
    },
    { field: 'variance_mt', headerName: 'Variance MT', width: 130, valueFormatter: p => fmt(p.value) },
    { field: 'variance_pct', headerName: 'Variance %', width: 120, valueFormatter: p => `${(p.value || 0).toFixed(1)}%` },
    { field: 'flag', headerName: 'Flag', width: 80, cellRenderer: FlagCell },
  ], []);

  const defaultColDef = useMemo(() => ({ sortable: true, resizable: true }), []);

  // Build waterfall commodity data — pivot: rows=commodities, columns=periods
  const waterfallData = useMemo(() => {
    if (!history || history.length === 0) return null;
    // history is newest-first, reverse for chronological
    const chronological = [...history].reverse();
    const allCommodities = new Set();
    for (const p of chronological) {
      for (const c of p.commodities) allCommodities.add(c.name);
    }
    const commodities = [...allCommodities].sort();

    const rows = commodities.map(name => {
      const row = { commodity: name };
      for (const p of chronological) {
        const key = new Date(p.period_date).toLocaleDateString('en-CA', { month: 'short', year: '2-digit' });
        const found = p.commodities.find(c => c.name === name);
        row[key] = found ? Math.round(found.mt * 10) / 10 : 0;
      }
      return row;
    });

    // Totals row
    const totals = { commodity: 'TOTAL' };
    for (const p of chronological) {
      const key = new Date(p.period_date).toLocaleDateString('en-CA', { month: 'short', year: '2-digit' });
      totals[key] = Math.round(p.total_mt * 10) / 10;
    }

    const periodKeys = chronological.map(p =>
      new Date(p.period_date).toLocaleDateString('en-CA', { month: 'short', year: '2-digit' })
    );

    return { rows, totals, periodKeys };
  }, [history]);

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>Reconciliation</Typography>
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          onChange={(_, v) => v && setViewMode(v)}
          size="small"
        >
          <ToggleButton value="compare">Period Compare</ToggleButton>
          <ToggleButton value="waterfall">All Periods</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* ─── Compare View ─── */}
      {viewMode === 'compare' && (
        <>
          <Stack direction="row" spacing={2} sx={{ mb: 3 }} alignItems="center">
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
            {toPeriod && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<UploadFileIcon />}
                onClick={() => setElevatorImportOpen(true)}
              >
                Import Elevator Tickets
              </Button>
            )}
          </Stack>

          {loading && <CircularProgress />}

          {data && (
            <>
              {/* Elevator data coverage banner */}
              {settlementCoverage && (
                <Alert
                  severity={settlementCoverage.withElevator === settlementCoverage.total ? 'success' :
                    settlementCoverage.withElevator > 0 ? 'info' : 'warning'}
                  sx={{ mb: 2 }}
                >
                  {data.summary?.elevator_source === 'portal'
                    ? <>Elevator data from <strong>portal import</strong> ({data.summary.elevator_ticket_count} tickets)</>
                    : data.summary?.elevator_source === 'settlement'
                      ? <>Elevator data from <strong>settlement PDFs</strong></>
                      : <>No elevator data imported</>
                  }
                  {' — '}available for {settlementCoverage.withElevator} of {settlementCoverage.total} commodities.
                  {settlementCoverage.withElevator < settlementCoverage.total &&
                    ` Missing commodities use Traction data for variance calc.`}
                  {' '}<strong>Bold</strong> = source used in variance calculation.
                </Alert>
              )}

              {/* Summary KPI cards */}
              <Grid container spacing={2} sx={{ mb: 3 }}>
                {[
                  { label: 'Beginning', value: `${fmtInt(data.summary.total_beginning_mt)} MT`, color: '#1565C0' },
                  { label: 'Ending', value: `${fmtInt(data.summary.total_ending_mt)} MT`, color: '#1565C0' },
                  { label: 'Traction (Hauled)', value: `${fmtInt(data.summary.total_hauled_mt)} MT`, color: '#E65100' },
                  { label: 'Elevator (Settled)', value: `${fmtInt(data.summary.total_at_elevator_mt)} MT`, color: '#6A1B9A' },
                  { label: 'Difference', value: `${fmtInt((data.summary.total_at_elevator_mt || 0) - (data.summary.total_hauled_mt || 0))} MT`,
                    color: ((data.summary.total_at_elevator_mt || 0) - (data.summary.total_hauled_mt || 0)) < 0 ? '#D32F2F' : '#2E7D32' },
                  { label: 'Variance', value: `${fmtInt(data.summary.total_variance_mt)} MT`,
                    color: Math.abs(data.summary.total_variance_mt) > data.summary.total_beginning_mt * 0.02 ? '#D32F2F' : '#2E7D32' },
                ].map(kpi => (
                  <Grid item xs={6} md key={kpi.label}>
                    <Card sx={{ textAlign: 'center' }}>
                      <CardContent sx={{ py: 1.5 }}>
                        <Typography variant="caption" color="text.secondary">{kpi.label}</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 700, color: kpi.color }}>{kpi.value}</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>

              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Variance = Beginning − Ending − Shipped. Uses elevator MT when available (≥ traction), otherwise traction MT.
                {' '}LGX inventory and internal transfers shown separately below (wash).
              </Typography>

              <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 400, width: '100%' }}>
                <AgGridReact
                  ref={gridRef}
                  rowData={data.rows}
                  columnDefs={columnDefs}
                  defaultColDef={defaultColDef}
                  animateRows
                  tooltipShowDelay={300}
                  getRowId={p => p.data?.commodity}
                />
              </Box>

              {/* LGX Wash Section */}
              {data.lgx && data.lgx.rows.length > 0 && (
                <Card sx={{ mt: 3 }}>
                  <CardContent>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                      LGX Terminal (Internal Wash)
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      Grain transferred to LGX is excluded from farm hauled totals above. These numbers should net to roughly zero.
                    </Typography>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #ddd' }}>
                          <th style={{ textAlign: 'left', padding: '6px 8px' }}>Commodity</th>
                          <th style={{ textAlign: 'right', padding: '6px 8px' }}>LGX Beginning MT</th>
                          <th style={{ textAlign: 'right', padding: '6px 8px' }}>LGX Ending MT</th>
                          <th style={{ textAlign: 'right', padding: '6px 8px' }}>Transferred In MT</th>
                          <th style={{ textAlign: 'right', padding: '6px 8px' }}>LGX Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.lgx.rows.map(r => {
                          const change = r.ending_mt - r.beginning_mt;
                          return (
                            <tr key={r.commodity} style={{ borderBottom: '1px solid #eee' }}>
                              <td style={{ padding: '6px 8px', fontWeight: 600 }}>{r.commodity}</td>
                              <td style={{ textAlign: 'right', padding: '6px 8px' }}>{fmt(r.beginning_mt)}</td>
                              <td style={{ textAlign: 'right', padding: '6px 8px' }}>{fmt(r.ending_mt)}</td>
                              <td style={{ textAlign: 'right', padding: '6px 8px' }}>{fmt(r.transferred_in_mt)}</td>
                              <td style={{ textAlign: 'right', padding: '6px 8px', color: change > 0 ? '#2E7D32' : change < 0 ? '#D32F2F' : undefined, fontWeight: 600 }}>
                                {change > 0 ? '+' : ''}{fmt(change)}
                              </td>
                            </tr>
                          );
                        })}
                        <tr style={{ borderTop: '2px solid #ddd', fontWeight: 700 }}>
                          <td style={{ padding: '6px 8px' }}>TOTAL</td>
                          <td style={{ textAlign: 'right', padding: '6px 8px' }}>{fmt(data.lgx.total_beginning_mt)}</td>
                          <td style={{ textAlign: 'right', padding: '6px 8px' }}>{fmt(data.lgx.total_ending_mt)}</td>
                          <td style={{ textAlign: 'right', padding: '6px 8px' }}>{fmt(data.lgx.total_transferred_in_mt)}</td>
                          <td style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700 }}>
                            {fmt(data.lgx.total_ending_mt - data.lgx.total_beginning_mt)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}

      {/* Elevator Ticket Import Dialog */}
      {toPeriod && (
        <ElevatorTicketImportDialog
          open={elevatorImportOpen}
          onClose={() => setElevatorImportOpen(false)}
          farmId={currentFarm?.id}
          countPeriodId={toPeriod}
          periodLabel={periods.find(p => p.id === toPeriod) ? formatDate(periods.find(p => p.id === toPeriod).period_date) : ''}
          onImported={() => setRefreshKey(k => k + 1)}
        />
      )}

      {/* ─── Waterfall View — All Periods Side by Side ─── */}
      {viewMode === 'waterfall' && (
        <>
          {loading && <CircularProgress />}

          {waterfallData && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Inventory levels (MT) across all count periods — track how each commodity changes over time.
              </Typography>

              <Card>
                <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                  <Box sx={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ backgroundColor: '#1565C0' }}>
                          <th style={{ padding: '8px 12px', textAlign: 'left', color: '#fff', fontWeight: 700, position: 'sticky', left: 0, backgroundColor: '#1565C0', zIndex: 1 }}>
                            Commodity
                          </th>
                          {waterfallData.periodKeys.map((key, i) => (
                            <th key={key} style={{ padding: '8px 12px', textAlign: 'right', color: '#fff', fontWeight: 700, whiteSpace: 'nowrap' }}>
                              {key}
                              {i > 0 && <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.8 }}>Δ from prev</div>}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {waterfallData.rows.map((row, ri) => (
                          <tr key={row.commodity} style={{ backgroundColor: ri % 2 === 0 ? '#fff' : '#F5F5F5' }}>
                            <td style={{ padding: '6px 12px', fontWeight: 600, position: 'sticky', left: 0, backgroundColor: ri % 2 === 0 ? '#fff' : '#F5F5F5', zIndex: 1 }}>
                              {row.commodity}
                            </td>
                            {waterfallData.periodKeys.map((key, pi) => {
                              const val = row[key] || 0;
                              const prevKey = pi > 0 ? waterfallData.periodKeys[pi - 1] : null;
                              const prevVal = prevKey ? (row[prevKey] || 0) : null;
                              const delta = prevVal !== null ? val - prevVal : null;
                              return (
                                <td key={key} style={{ padding: '6px 12px', textAlign: 'right' }}>
                                  <div>{fmt(val)}</div>
                                  {delta !== null && delta !== 0 && (
                                    <div style={{ fontSize: 11, color: delta < 0 ? '#D32F2F' : '#2E7D32', fontWeight: 600 }}>
                                      {delta > 0 ? '+' : ''}{fmt(delta)}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                        {/* Totals row */}
                        <tr style={{ backgroundColor: '#E8EAF6', fontWeight: 700 }}>
                          <td style={{ padding: '8px 12px', fontWeight: 700, position: 'sticky', left: 0, backgroundColor: '#E8EAF6', zIndex: 1 }}>
                            TOTAL
                          </td>
                          {waterfallData.periodKeys.map((key, pi) => {
                            const val = waterfallData.totals[key] || 0;
                            const prevKey = pi > 0 ? waterfallData.periodKeys[pi - 1] : null;
                            const prevVal = prevKey ? (waterfallData.totals[prevKey] || 0) : null;
                            const delta = prevVal !== null ? val - prevVal : null;
                            return (
                              <td key={key} style={{ padding: '8px 12px', textAlign: 'right' }}>
                                <div>{fmt(val)}</div>
                                {delta !== null && delta !== 0 && (
                                  <div style={{ fontSize: 11, color: delta < 0 ? '#D32F2F' : '#2E7D32' }}>
                                    {delta > 0 ? '+' : ''}{fmt(delta)}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      </tbody>
                    </table>
                  </Box>
                </CardContent>
              </Card>

              {/* Period-over-period hauling summary */}
              {history && history.length > 1 && (
                <Card sx={{ mt: 3 }}>
                  <CardContent>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Period-over-Period Summary</Typography>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #ddd' }}>
                          <th style={{ textAlign: 'left', padding: '4px 8px' }}>Period</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px' }}>Total MT</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px' }}>Change</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px' }}>Hauled</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px' }}>Implied Variance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...history].reverse().map((p, i, arr) => {
                          const prev = i > 0 ? arr[i - 1] : null;
                          const change = prev ? p.total_mt - prev.total_mt : null;
                          const impliedVar = prev ? (prev.total_mt - p.total_mt - p.hauled_mt) : null;
                          return (
                            <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                              <td style={{ padding: '4px 8px' }}>{formatDate(p.period_date)}</td>
                              <td style={{ textAlign: 'right', padding: '4px 8px' }}>{fmt(p.total_mt)}</td>
                              <td style={{ textAlign: 'right', padding: '4px 8px', color: change === null ? undefined : change < 0 ? '#D32F2F' : '#2E7D32', fontWeight: 600 }}>
                                {change !== null ? `${change > 0 ? '+' : ''}${fmt(change)}` : '—'}
                              </td>
                              <td style={{ textAlign: 'right', padding: '4px 8px' }}>{p.hauled_mt > 0 ? fmt(p.hauled_mt) : '—'}</td>
                              <td style={{ textAlign: 'right', padding: '4px 8px', color: impliedVar === null ? undefined : Math.abs(impliedVar) > 50 ? '#D32F2F' : '#2E7D32', fontWeight: 600 }}>
                                {impliedVar !== null ? fmt(impliedVar) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      Implied Variance = Previous MT − Current MT − Hauled. Should be near zero if all movement is accounted for.
                    </Typography>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </Box>
  );
}
