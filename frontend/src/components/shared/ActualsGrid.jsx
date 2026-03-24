import { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Alert, CircularProgress } from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useThemeMode } from '../../contexts/ThemeContext';
import { getGridColors } from '../../utils/gridColors';
import { formatCurrency, formatNumber } from '../../utils/formatting';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';

/**
 * Read-only grid showing QB actuals (Book 2: Actual P&L).
 * @param {'per-unit'|'accounting'} props.mode
 */
export default function ActualsGrid({ mode = 'accounting' }) {
  const { currentFarm, fiscalYear } = useFarm();
  const farmId = currentFarm?.id;
  const gridRef = useRef();
  const { mode: themeMode } = useThemeMode();
  const colors = useMemo(() => getGridColors(themeMode), [themeMode]);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!farmId || !fiscalYear) return;
    setLoading(true);
    api.get(`/api/farms/${farmId}/actuals/${fiscalYear}`)
      .then(res => setData(res.data))
      .catch(err => setError(extractErrorMessage(err, 'Failed to load actuals')))
      .finally(() => setLoading(false));
  }, [farmId, fiscalYear]);

  const valueFmt = useMemo(() => mode === 'per-unit'
    ? (p) => formatNumber(p.value)
    : (p) => formatCurrency(p.value, 0),
  [mode]);

  const columnDefs = useMemo(() => {
    if (!data?.months) return [];
    const isParent = (params) => params.data?.level === 0;

    const cols = [
      {
        headerName: 'Category',
        field: 'display_name',
        pinned: 'left',
        width: 220,
        cellStyle: (params) => {
          const indent = (params.data?.level || 0) * 20;
          const bold = params.data?.level === 0;
          const style = { paddingLeft: `${indent + 8}px`, fontWeight: bold ? 'bold' : 'normal' };
          if (bold) {
            style.backgroundColor = colors.parentRow;
            style.borderTop = `2px solid ${colors.computedBorder}`;
          }
          return style;
        },
      },
    ];

    for (const month of data.months) {
      cols.push({
        headerName: month,
        field: `months.${month}`,
        width: 95,
        type: 'numericColumn',
        valueGetter: (params) => {
          const val = params.data?.months?.[month] || 0;
          if (mode === 'per-unit' && data.totalAcres > 0) return val / data.totalAcres;
          return val;
        },
        valueFormatter: valueFmt,
        cellStyle: (params) => ({
          backgroundColor: 'rgba(239, 108, 0, 0.04)',
          fontWeight: isParent(params) ? 'bold' : 'normal',
          borderTop: isParent(params) ? `2px solid ${colors.computedBorder}` : undefined,
        }),
      });
    }

    cols.push({
      headerName: 'Total',
      field: 'total',
      width: 120,
      type: 'numericColumn',
      valueGetter: (params) => {
        const val = params.data?.total || 0;
        if (mode === 'per-unit' && data.totalAcres > 0) return val / data.totalAcres;
        return val;
      },
      valueFormatter: valueFmt,
      cellStyle: (params) => ({
        backgroundColor: colors.aggregateBg,
        fontWeight: 'bold',
        borderTop: isParent(params) ? `2px solid ${colors.computedBorder}` : undefined,
      }),
    });

    return cols;
  }, [data, colors, mode, valueFmt]);

  const defaultColDef = useMemo(() => ({
    resizable: true,
    sortable: false,
    suppressMovable: true,
    editable: false,
  }), []);

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (!data?.rows?.length) {
    return (
      <Alert severity="info">
        No QB actuals imported for FY {fiscalYear}. Import accounting data from QuickBooks to see actual expenses here.
      </Alert>
    );
  }

  const gridTheme = themeMode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

  return (
    <Box>
      <div className={gridTheme} style={{ height: 600, width: '100%' }}>
        <AgGridReact
          ref={gridRef}
          rowData={data.rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={(params) => params.data.code}
          animateRows={false}
        />
      </div>
    </Box>
  );
}
