import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Typography, Button, Chip, Alert, Paper, Stack,
  Select, MenuItem, FormControl, InputLabel, IconButton,
  Snackbar, Tooltip, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, InputAdornment,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { useFarm } from '../../contexts/FarmContext';
import WorkOrderImportDialog from '../../components/agronomy/WorkOrderImportDialog';

function fmt(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function fmtDec(n, d = 2) { return '$' + (n || 0).toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function fmtK(n) { return n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : fmtDec(n); }
function fmtVol(n) { return n != null ? (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 1 }) : '—'; }

const TH = { fontWeight: 'bold', bgcolor: 'action.hover', whiteSpace: 'nowrap', fontSize: '0.78rem', py: 0.75, px: 1 };
const TD = { fontSize: '0.8rem', py: 0.5, px: 1 };
const TOTAL_ROW = { fontWeight: 'bold', borderTop: 2, borderColor: 'divider' };

const TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'seed', label: 'Seed' },
  { value: 'fertilizer', label: 'Fertilizer' },
  { value: 'chemical', label: 'Chemical' },
];

const LOCATION_OPTIONS = [{ value: '', label: 'All Locations' }];

export default function ProductLibrary({ year: externalYear }) {
  const { fiscalYear } = useFarm();
  const year = externalYear || fiscalYear;
  const [typeFilter, setTypeFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [matrix, setMatrix] = useState({ products: [], farms: [], totals: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/agronomy/wo-matrix?year=${year}`);
      setMatrix(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Error loading procurement data'));
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const locationOptions = useMemo(() => [
    { value: '', label: 'All Locations' },
    ...matrix.farms.map(f => ({ value: f.id, label: f.name })),
  ], [matrix.farms]);

  const filtered = useMemo(() => {
    let prods = matrix.products;
    if (typeFilter) prods = prods.filter(p => p.type === typeFilter);
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      prods = prods.filter(p => p.product_name.toLowerCase().includes(q));
    }
    if (locationFilter) {
      prods = prods.filter(p => p.by_farm[locationFilter]?.pkgs > 0);
    }
    return prods;
  }, [matrix.products, typeFilter, searchFilter, locationFilter]);

  const filteredTotals = useMemo(() => ({
    pkgs: filtered.reduce((s, p) => s + (locationFilter ? (p.by_farm[locationFilter]?.pkgs || 0) : p.total_pkgs), 0),
    cost: filtered.reduce((s, p) => s + (locationFilter ? (p.by_farm[locationFilter]?.cost || 0) : p.total_cost), 0),
    products: filtered.length,
  }), [filtered, locationFilter]);

  return (
    <Box>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        {!externalYear && (
          <Typography variant="body2" color="text.secondary">Year {year}</Typography>
        )}
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Type</InputLabel>
          <Select value={typeFilter} label="Type" onChange={e => setTypeFilter(e.target.value)}>
            {TYPE_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Location</InputLabel>
          <Select value={locationFilter} label="Location" onChange={e => setLocationFilter(e.target.value)}>
            {locationOptions.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </Select>
        </FormControl>
        <TextField
          size="small"
          placeholder="Search product..."
          value={searchFilter}
          onChange={e => setSearchFilter(e.target.value)}
          sx={{ minWidth: 180 }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        />
        <Box sx={{ flexGrow: 1 }} />
        <Tooltip title="Refresh">
          <IconButton onClick={load}><RefreshIcon /></IconButton>
        </Tooltip>
        <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => setImportOpen(true)}>
          Import Work Orders
        </Button>
      </Box>

      {/* KPI cards */}
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        {[
          { label: 'Products', value: filteredTotals.products },
          { label: 'Total Packages', value: fmt(filteredTotals.pkgs) },
          { label: 'Total Cost', value: fmtK(filteredTotals.cost) },
          { label: 'WO Lines', value: fmt(matrix.totals.total_lines || 0) },
        ].map(kpi => (
          <Paper key={kpi.label} sx={{ p: 1.5, textAlign: 'center', flex: 1 }}>
            <Typography variant="body2" color="text.secondary">{kpi.label}</Typography>
            <Typography variant="h6" fontWeight="bold">{kpi.value}</Typography>
          </Paper>
        ))}
      </Stack>

      {/* Matrix table */}
      {filtered.length === 0 && !loading ? (
        <Alert severity="info">
          {matrix.products.length === 0
            ? 'No work order data. Import a Synergy Work Order file to populate.'
            : 'No products match the current filters.'}
        </Alert>
      ) : (
        <TableContainer component={Paper} sx={{ maxHeight: 'calc(100vh - 380px)' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow sx={{ '& th': TH }}>
                <TableCell>Product</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Pkg Type</TableCell>
                <TableCell align="right">Pkg Vol</TableCell>
                <TableCell align="right">$/Pkg</TableCell>
                <TableCell align="right">$/Unit</TableCell>
                {!locationFilter && matrix.farms.map(f => (
                  <TableCell key={f.id} align="right">{f.name}</TableCell>
                ))}
                <TableCell align="right" sx={{ borderLeft: 1, borderColor: 'divider' }}>Total Pkgs</TableCell>
                <TableCell align="right">Total Cost</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map(p => {
                const pkgs = locationFilter
                  ? (p.by_farm[locationFilter]?.pkgs || 0)
                  : p.total_pkgs;
                const cost = locationFilter
                  ? (p.by_farm[locationFilter]?.cost || 0)
                  : p.total_cost;
                return (
                  <TableRow key={p.product_name} hover>
                    <TableCell sx={{ ...TD, fontWeight: 500, whiteSpace: 'nowrap', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <Tooltip title={p.product_name}><span>{p.product_name}</span></Tooltip>
                    </TableCell>
                    <TableCell sx={TD}>
                      <Chip
                        label={p.type}
                        size="small"
                        color={{ seed: 'success', fertilizer: 'info', chemical: 'warning' }[p.type] || 'default'}
                        variant="outlined"
                        sx={{ fontSize: '0.7rem' }}
                      />
                    </TableCell>
                    <TableCell sx={{ ...TD, color: 'text.secondary' }}>{p.packaging_unit || '—'}</TableCell>
                    <TableCell align="right" sx={{ ...TD, color: 'text.secondary' }}>{fmtVol(p.packaging_volume)}</TableCell>
                    <TableCell align="right" sx={TD}>{p.unit_price > 0 ? fmtDec(p.unit_price) : '—'}</TableCell>
                    <TableCell align="right" sx={{ ...TD, fontWeight: 500, color: p.cost_per_unit > 0 ? 'success.main' : 'text.disabled' }}>
                      {p.cost_per_unit > 0 ? fmtDec(p.cost_per_unit, 4) : '—'}
                    </TableCell>
                    {!locationFilter && matrix.farms.map(f => {
                      const farmData = p.by_farm[f.id];
                      return (
                        <TableCell key={f.id} align="right" sx={{ ...TD, color: farmData?.pkgs > 0 ? 'text.primary' : 'text.disabled' }}>
                          {farmData?.pkgs > 0 ? fmt(farmData.pkgs) : '—'}
                        </TableCell>
                      );
                    })}
                    <TableCell align="right" sx={{ ...TD, fontWeight: 'bold', borderLeft: 1, borderColor: 'divider' }}>
                      {fmt(pkgs)}
                    </TableCell>
                    <TableCell align="right" sx={{ ...TD, fontWeight: 'bold' }}>
                      {fmtK(cost)}
                    </TableCell>
                  </TableRow>
                );
              })}

              {/* Totals row */}
              <TableRow sx={{ '& td': { ...TD, ...TOTAL_ROW } }}>
                <TableCell colSpan={6}>TOTAL</TableCell>
                {!locationFilter && matrix.farms.map(f => {
                  const farmTotal = filtered.reduce((s, p) => s + (p.by_farm[f.id]?.pkgs || 0), 0);
                  return <TableCell key={f.id} align="right">{fmt(farmTotal)}</TableCell>;
                })}
                <TableCell align="right" sx={{ borderLeft: 1, borderColor: 'divider' }}>{fmt(filteredTotals.pkgs)}</TableCell>
                <TableCell align="right">{fmtK(filteredTotals.cost)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <WorkOrderImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        year={year}
        onImported={load}
      />

      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
      </Snackbar>
    </Box>
  );
}
