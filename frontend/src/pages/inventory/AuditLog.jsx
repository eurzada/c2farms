import { useState, useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { Box, Stack, FormControl, InputLabel, Select, MenuItem, Typography } from '@mui/material';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useFarm } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import { getGridColors } from '../../utils/gridColors';
import api from '../../services/api';

const ENTITY_TYPES = ['', 'BinCount', 'Contract', 'Delivery', 'CountSubmission', 'CountPeriod', 'InventoryBin', 'Commodity'];

function ChangesCell({ value }) {
  if (!value) return null;
  if (typeof value !== 'object') return String(value);
  const entries = Object.entries(value);
  return (
    <Box sx={{ fontSize: '0.8rem', lineHeight: 1.4 }}>
      {entries.map(([field, val]) => {
        if (val && typeof val === 'object' && 'old' in val) {
          return <div key={field}><strong>{field}:</strong> {JSON.stringify(val.old)} → {JSON.stringify(val.new)}</div>;
        }
        return <div key={field}><strong>{field}:</strong> {JSON.stringify(val)}</div>;
      })}
    </Box>
  );
}

function ActionCell({ value }) {
  const colorMap = { create: '#4caf50', update: '#2196f3', delete: '#f44336' };
  return <span style={{ color: colorMap[value] || 'inherit', fontWeight: 600 }}>{value}</span>;
}

export default function AuditLog() {
  const { currentFarm, isAdmin } = useFarm();
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const colors = useMemo(() => getGridColors(mode), [mode]);

  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 50;

  useEffect(() => {
    if (!currentFarm) return;
    const params = new URLSearchParams();
    if (entityType) params.set('entityType', entityType);
    params.set('limit', String(pageSize));
    params.set('offset', String(page * pageSize));
    api.get(`/api/farms/${currentFarm.id}/inventory/audit-log?${params}`)
      .then(res => {
        setEntries(res.data.entries || []);
        setTotal(res.data.total || 0);
      });
  }, [currentFarm, entityType, page]);

  const columnDefs = useMemo(() => [
    {
      field: 'created_at', headerName: 'Timestamp', width: 180,
      valueFormatter: ({ value }) => value ? new Date(value).toLocaleString() : '',
      sort: 'desc',
    },
    { field: 'user.name', headerName: 'User', width: 140, valueGetter: ({ data }) => data?.user?.name || '' },
    { field: 'entity_type', headerName: 'Entity Type', width: 140 },
    { field: 'entity_id', headerName: 'Entity ID', width: 120, cellStyle: { fontSize: '0.75rem' } },
    { field: 'action', headerName: 'Action', width: 100, cellRenderer: ActionCell },
    {
      field: 'changes', headerName: 'Changes', flex: 1, autoHeight: true, wrapText: true,
      cellRenderer: ChangesCell,
    },
  ], []);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
  }), []);

  if (!isAdmin) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6" color="text.secondary">Admin access required to view the audit log.</Typography>
      </Box>
    );
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h5">Inventory Audit Log</Typography>
        <Stack direction="row" spacing={2} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Entity Type</InputLabel>
            <Select value={entityType} label="Entity Type" onChange={e => { setEntityType(e.target.value); setPage(0); }}>
              <MenuItem value="">All</MenuItem>
              {ENTITY_TYPES.filter(Boolean).map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </Select>
          </FormControl>
          <Typography variant="body2" color="text.secondary">
            {total} entries {totalPages > 1 && `· Page ${page + 1} of ${totalPages}`}
          </Typography>
        </Stack>
      </Stack>

      <Box
        className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'}
        sx={{
          height: 600,
          '--ag-background-color': colors.background,
          '--ag-header-background-color': colors.headerBg,
          '--ag-odd-row-background-color': colors.oddRow,
          '--ag-row-hover-color': colors.hoverRow,
        }}
      >
        <AgGridReact
          ref={gridRef}
          rowData={entries}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={params => params.data.id}
          suppressCellFocus
        />
      </Box>

      {totalPages > 1 && (
        <Stack direction="row" spacing={1} justifyContent="center" sx={{ mt: 2 }}>
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>
          <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
        </Stack>
      )}
    </Box>
  );
}
