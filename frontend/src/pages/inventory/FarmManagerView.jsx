import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  Box, Typography, Stack, FormControl, InputLabel, Select, MenuItem,
  Button, LinearProgress, Alert, Snackbar, IconButton, Chip, Tooltip,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import UndoIcon from '@mui/icons-material/Undo';
import AddIcon from '@mui/icons-material/Add';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import { getGridColors } from '../../utils/gridColors';
import { fmt } from '../../utils/formatting';
import api from '../../services/api';
import NewPeriodDialog from '../../components/inventory/NewPeriodDialog';
import ExcelImportDialog from '../../components/inventory/ExcelImportDialog';

// Non-grain commodity codes (inputs, not marketable grain)
const NON_GRAIN_CODES = new Set(['FERT', 'SEED']);

function UndoRenderer({ data, context }) {
  if (!data || !context.dirtyBinIds.has(data.id)) return null;
  return (
    <IconButton size="small" onClick={() => context.onUndo(data.id)} title="Undo changes">
      <UndoIcon fontSize="small" />
    </IconButton>
  );
}

export default function FarmManagerView() {
  const { currentFarm, canEdit, isAdmin, isEnterprise } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const colors = useMemo(() => getGridColors(mode), [mode]);

  const [locations, setLocations] = useState([]);
  const [commodities, setCommodities] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [periods, setPeriods] = useState([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [rowData, setRowData] = useState([]);
  const [lastCounts, setLastCounts] = useState({});
  const [dirtyBinIds, setDirtyBinIds] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'info' });
  const [newPeriodOpen, setNewPeriodOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Fetch locations, commodities, periods on mount
  useEffect(() => {
    if (!currentFarm) return;
    const eq = isEnterprise ? '?enterprise=true' : '';
    Promise.all([
      api.get(`/api/farms/${currentFarm.id}/inventory/locations${eq}`),
      api.get(`/api/farms/${currentFarm.id}/inventory/commodities`),
      api.get(`/api/farms/${currentFarm.id}/inventory/count-periods`),
    ]).then(([locRes, comRes, perRes]) => {
      setLocations(locRes.data.locations || []);
      setCommodities(comRes.data.commodities || []);
      const p = perRes.data.periods || [];
      setPeriods(p);
      const openPeriod = p.find(pr => pr.status === 'open') || p[0];
      setSelectedPeriodId(openPeriod?.id || '');
    });
  }, [currentFarm, isEnterprise]);

  const period = useMemo(() => periods.find(p => p.id === selectedPeriodId) || null, [periods, selectedPeriodId]);
  const previousPeriod = useMemo(() => {
    if (!period) return null;
    const idx = periods.findIndex(p => p.id === period.id);
    return idx >= 0 && idx < periods.length - 1 ? periods[idx + 1] : null;
  }, [periods, period]);
  const periodIsEditable = period?.status !== 'closed';

  // Commodity lookups
  const commodityNameToId = useMemo(() => {
    const map = {};
    for (const c of commodities) map[c.name] = c.id;
    return map;
  }, [commodities]);

  const commodityNames = useMemo(() => ['', ...commodities.map(c => c.name)], [commodities]);

  // Commodity lookups by name
  const commodityByName = useMemo(() => {
    const map = {};
    for (const c of commodities) map[c.name] = { lbs_per_bu: c.lbs_per_bu || 0, code: c.code };
    return map;
  }, [commodities]);

  // Aggregate MT by commodity from current rowData, split grain vs other
  const aggregateSummary = useMemo(() => {
    const grainByCrop = {};
    const otherByCrop = {};
    let grainTotalKg = 0;
    let otherTotalKg = 0;
    for (const row of rowData) {
      if (!row.commodity_name || !row.bushels) continue;
      const info = commodityByName[row.commodity_name];
      if (!info || !info.lbs_per_bu) continue;
      const kg = row.bushels * info.lbs_per_bu * 0.45359237;
      if (NON_GRAIN_CODES.has(info.code)) {
        if (!otherByCrop[row.commodity_name]) otherByCrop[row.commodity_name] = 0;
        otherByCrop[row.commodity_name] += kg;
        otherTotalKg += kg;
      } else {
        if (!grainByCrop[row.commodity_name]) grainByCrop[row.commodity_name] = 0;
        grainByCrop[row.commodity_name] += kg;
        grainTotalKg += kg;
      }
    }
    const toItems = (map) => Object.entries(map)
      .map(([name, kg]) => ({ name, mt: kg / 1000 }))
      .sort((a, b) => b.mt - a.mt);
    return {
      grain: toItems(grainByCrop),
      grainTotalMt: grainTotalKg / 1000,
      other: toItems(otherByCrop),
      otherTotalMt: otherTotalKg / 1000,
    };
  }, [rowData, commodityByName]);

  // Fetch bins (all locations when selectedLocation is '')
  const fetchBins = useCallback(() => {
    if (!currentFarm) return;
    const params = new URLSearchParams();
    if (isEnterprise) params.set('enterprise', 'true');
    if (selectedLocation) params.set('location', selectedLocation);
    if (period) params.set('periodId', period.id);
    api.get(`/api/farms/${currentFarm.id}/inventory/bins?${params}`)
      .then(res => {
        const bins = res.data.bins || [];
        const rows = bins.map(b => ({
          id: b.id,
          location_id: b.location_id,
          location_name: b.location_name,
          bin_number: b.bin_number,
          bin_type: b.bin_type,
          capacity_bu: b.capacity_bu,
          commodity_id: b.commodity_id || null,
          commodity_name: b.commodity_name || '',
          bushels: b.bushels || 0,
          crop_year: b.crop_year || null,
        }));
        setRowData(rows);
        const snapshot = {};
        for (const r of rows) snapshot[r.id] = { ...r };
        setLastCounts(snapshot);
        setDirtyBinIds(new Set());
      });
  }, [currentFarm, selectedLocation, period, isEnterprise]);

  useEffect(() => { fetchBins(); }, [fetchBins]);

  // Cell edit handler
  const onCellValueChanged = useCallback((params) => {
    if (!params.data) return;
    const { data, colDef } = params;
    if (colDef.field === 'commodity_name') {
      data.commodity_id = commodityNameToId[data.commodity_name] || null;
    }
    setDirtyBinIds(prev => new Set(prev).add(data.id));
    setRowData(prev => [...prev]);
  }, [commodityNameToId]);

  // Undo — restore row to its initial loaded values
  const onUndo = useCallback((binId) => {
    const last = lastCounts[binId];
    if (!last) return;
    setRowData(prev => prev.map(row =>
      row.id === binId
        ? { ...row, commodity_id: last.commodity_id, commodity_name: last.commodity_name, bushels: last.bushels, crop_year: last.crop_year }
        : row
    ));
    setDirtyBinIds(prev => {
      const next = new Set(prev);
      next.delete(binId);
      return next;
    });
  }, [lastCounts]);

  // Progress
  const countedBins = rowData.filter(r => r.bushels > 0).length;
  const totalBins = rowData.length;
  const progress = totalBins > 0 ? (countedBins / totalBins) * 100 : 0;

  const editable = canEdit && periodIsEditable;

  // Column definitions
  const columnDefs = useMemo(() => [
    { field: 'location_name', headerName: 'Location', width: 140, filter: true },
    {
      field: 'bin_number', headerName: 'Bin #', width: 100, sort: 'asc',
      comparator: (a, b) => {
        const numA = parseInt(a, 10);
        const numB = parseInt(b, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return String(a).localeCompare(String(b));
      },
    },
    { field: 'bin_type', headerName: 'Type', width: 100 },
    {
      field: 'capacity_bu', headerName: 'Capacity (bu)', width: 130,
      valueFormatter: p => p.value ? p.value.toLocaleString() : '-',
    },
    {
      field: 'commodity_name', headerName: 'Commodity', width: 160,
      editable,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: commodityNames },
    },
    {
      field: 'bushels', headerName: 'Bushels', width: 120,
      editable,
      valueParser: p => parseFloat(p.newValue) || 0,
      valueFormatter: p => p.value ? p.value.toLocaleString() : '0',
      cellStyle: { backgroundColor: colors.actualCell },
    },
    {
      field: 'crop_year', headerName: 'Crop Year', width: 110,
      editable,
      valueParser: p => p.newValue ? parseInt(p.newValue) : null,
    },
    ...(editable ? [{
      headerName: '', width: 60,
      cellRenderer: UndoRenderer,
      sortable: false, filter: false, suppressNavigable: true,
    }] : []),
  ], [editable, commodityNames, colors]);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    suppressMovable: true,
  }), []);


  // Save — upserts counts and auto-approves submissions
  const handleSave = async () => {
    if (!currentFarm || !period) return;
    setSaving(true);
    try {
      // Create/update submissions for each unique location (auto-approved)
      const locationIds = [...new Set(rowData.map(r => r.location_id))];
      const submissions = await Promise.all(locationIds.map(locId =>
        api.post(`/api/farms/${currentFarm.id}/inventory/submissions`, {
          count_period_id: period.id,
          location_id: locId,
        })
      ));

      // Auto-approve all submissions
      await Promise.all(submissions.map(s => {
        if (s.data?.submission?.status !== 'approved') {
          return api.post(`/api/farms/${currentFarm.id}/inventory/submissions/${s.data.submission.id}/approve`);
        }
        return Promise.resolve();
      }));

      // Bulk upsert counts
      const countsArray = rowData.map(r => ({
        bin_id: r.id,
        commodity_id: r.commodity_id || null,
        bushels: parseFloat(r.bushels) || 0,
        crop_year: r.crop_year ? parseInt(r.crop_year) : null,
        notes: null,
      }));

      await api.post(`/api/farms/${currentFarm.id}/inventory/bin-counts/${period.id}`, { counts: countsArray });

      setSnack({ open: true, message: 'Count saved!', severity: 'success' });
      setDirtyBinIds(new Set());
      fetchBins();
    } catch (err) {
      setSnack({ open: true, message: err.response?.data?.error || 'Failed to save', severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // Lock/unlock period (admin only)
  const handleToggleLock = async () => {
    if (!currentFarm || !period) return;
    const newStatus = period.status === 'closed' ? 'open' : 'closed';
    try {
      await api.put(`/api/farms/${currentFarm.id}/inventory/count-periods/${period.id}`, { status: newStatus });
      setPeriods(prev => prev.map(p => p.id === period.id ? { ...p, status: newStatus } : p));
      setSnack({ open: true, message: newStatus === 'closed' ? 'Period locked.' : 'Period unlocked.', severity: 'success' });
    } catch (err) {
      setSnack({ open: true, message: err.response?.data?.error || 'Failed to update period', severity: 'error' });
    }
  };

  if (!canEdit) {
    return <Alert severity="info">Bin counting is only available to managers and admins.</Alert>;
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>Farm Manager - Bin Count</Typography>

      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Count Period</InputLabel>
          <Select
            value={selectedPeriodId}
            label="Count Period"
            onChange={e => setSelectedPeriodId(e.target.value)}
          >
            {periods.map(p => (
              <MenuItem key={p.id} value={p.id}>
                {new Date(p.period_date).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}
                {p.status === 'closed' ? ' 🔒' : ''}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {period && (
          <Chip
            icon={period.status === 'closed' ? <LockIcon /> : <LockOpenIcon />}
            label={period.status === 'closed' ? 'Locked' : 'Editable'}
            color={period.status === 'closed' ? 'default' : 'success'}
            size="small"
            variant="outlined"
          />
        )}

        {isAdmin && period && (
          <Tooltip title={period.status === 'closed' ? 'Unlock this period to allow edits' : 'Lock this period to prevent changes'}>
            <Button
              variant="outlined" size="small"
              startIcon={period.status === 'closed' ? <LockOpenIcon /> : <LockIcon />}
              onClick={handleToggleLock}
              color={period.status === 'closed' ? 'primary' : 'warning'}
            >
              {period.status === 'closed' ? 'Unlock' : 'Lock Period'}
            </Button>
          </Tooltip>
        )}

        <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={() => setNewPeriodOpen(true)}>
          New Period
        </Button>

        <Button variant="outlined" size="small" startIcon={<UploadFileIcon />} onClick={() => setImportOpen(true)}>
          Import
        </Button>

        {selectedPeriodId && (
          <Button
            variant="outlined"
            size="small"
            startIcon={<DownloadIcon />}
            onClick={async () => {
              try {
                const res = await api.get(
                  `/api/farms/${currentFarm.id}/inventory/bin-counts/${selectedPeriodId}/export`,
                  { responseType: 'blob' }
                );
                const url = URL.createObjectURL(res.data);
                const link = document.createElement('a');
                link.href = url;
                link.download = `bin-counts-${selectedPeriodId}.csv`;
                link.click();
                URL.revokeObjectURL(url);
              } catch {
                setSnack({ open: true, message: 'Export failed', severity: 'error' });
              }
            }}
          >
            Export CSV
          </Button>
        )}

        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Location</InputLabel>
          <Select value={selectedLocation} label="Location" onChange={e => setSelectedLocation(e.target.value)}>
            <MenuItem value="">All Locations</MenuItem>
            {locations.map(l => (
              <MenuItem key={l.id} value={l.id}>{l.name} ({l._count?.bins || 0} bins)</MenuItem>
            ))}
          </Select>
        </FormControl>

        <Box sx={{ flex: 1, maxWidth: 300 }}>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="body2">{countedBins} / {totalBins} bins counted</Typography>
            <Typography variant="body2">{progress.toFixed(0)}%</Typography>
          </Stack>
          <LinearProgress variant="determinate" value={progress} sx={{ height: 8, borderRadius: 4 }} />
        </Box>
      </Stack>

      {/* Aggregate MT summary for quick tie-out */}
      {aggregateSummary.grain.length > 0 && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: aggregateSummary.other.length > 0 ? 0.5 : 1.5, flexWrap: 'wrap', gap: 0.5 }}>
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, mr: 0.5 }}>
            Grain: {fmt(aggregateSummary.grainTotalMt, 1)} MT
          </Typography>
          {aggregateSummary.grain.map(item => (
            <Chip key={item.name} label={`${item.name}: ${fmt(item.mt, 1)} MT`} size="small" variant="outlined" />
          ))}
        </Stack>
      )}
      {aggregateSummary.other.length > 0 && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, flexWrap: 'wrap', gap: 0.5 }}>
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, mr: 0.5 }}>
            Other:  {fmt(aggregateSummary.otherTotalMt, 1)} MT
          </Typography>
          {aggregateSummary.other.map(item => (
            <Chip key={item.name} label={`${item.name}: ${fmt(item.mt, 1)} MT`} size="small" variant="outlined" color="default" />
          ))}
        </Stack>
      )}

      <Box className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'} sx={{ height: 600, width: '100%' }}>
        <AgGridReact
          ref={gridRef}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          getRowId={p => p.data?.id}
          context={{ onUndo, dirtyBinIds }}
          onCellValueChanged={onCellValueChanged}
          singleClickEdit
          enterNavigatesAfterEdit
          stopEditingWhenCellsLoseFocus
        />
      </Box>

      {periodIsEditable && (
        <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving || dirtyBinIds.size === 0}>
            Save Count
          </Button>
          {dirtyBinIds.size > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
              {dirtyBinIds.size} bin(s) modified
            </Typography>
          )}
        </Stack>
      )}
      {!periodIsEditable && period && (
        <Alert severity="info" sx={{ mt: 2 }}>
          This period is locked — no changes allowed.{isAdmin ? ' Use the Unlock button above to re-enable editing.' : ' Ask an admin to unlock if changes are needed.'}
        </Alert>
      )}

      {currentFarm && (
        <ExcelImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          farmId={currentFarm.id}
          onImportComplete={fetchBins}
        />
      )}

      {currentFarm && (
        <NewPeriodDialog
          open={newPeriodOpen}
          onClose={() => setNewPeriodOpen(false)}
          farmId={currentFarm.id}
          previousPeriod={periods[0] || null}
          onCreated={(newPeriod) => {
            setPeriods(prev => [newPeriod, ...prev]);
            setSelectedPeriodId(newPeriod.id);
            setSnack({ open: true, message: 'New count period created!', severity: 'success' });
          }}
        />
      )}

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack(s => ({ ...s, open: false }))}>
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
