import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { Box, Alert } from '@mui/material';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import api from '../../services/api';
import { useThemeMode } from '../../contexts/ThemeContext';
import { useFarm } from '../../contexts/FarmContext';
import { useRealtime } from '../../hooks/useRealtime';
import { getGridColors } from '../../utils/gridColors';
import { FISCAL_MONTHS } from '../../utils/fiscalYear';
import { formatCurrency, formatNumber } from '../../utils/formatting';

export default function AccountingGrid({ farmId, fiscalYear, onSummaryLoaded }) {
  const [rowData, setRowData] = useState([]);
  const [months, setMonths] = useState(FISCAL_MONTHS);
  const [error, setError] = useState('');
  const gridRef = useRef();
  const { mode } = useThemeMode();
  const { canEdit } = useFarm();
  const colors = useMemo(() => getGridColors(mode), [mode]);

  const fetchData = useCallback(async () => {
    if (!farmId || !fiscalYear) return;
    try {
      const res = await api.get(`/api/farms/${farmId}/accounting/${fiscalYear}`);
      setRowData(res.data.rows || []);
      const newSummary = res.data.summary || {};
      if (res.data.months) setMonths(res.data.months);
      onSummaryLoaded?.(newSummary, res.data.months);
    } catch {
      setError('Failed to load accounting data');
    }
  }, [farmId, fiscalYear]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useRealtime(farmId, useCallback((data) => {
    if (data.fiscalYear !== fiscalYear) return;
    if (data.type === 'full_refresh') { fetchData(); return; }
    setRowData(prev => prev.map(row => {
      if (data.accountingData && data.accountingData[row.code] !== undefined) {
        return {
          ...row,
          months: { ...row.months, [data.month]: data.accountingData[row.code] },
        };
      }
      return row;
    }));
  }, [fiscalYear, fetchData]));

  const onCellValueChanged = useCallback(async (params) => {
    const { data, colDef } = params;
    const month = colDef.field?.replace('months.', '');
    if (!month || !months.includes(month)) return;

    const value = params.newValue;
    try {
      await api.patch(`/api/farms/${farmId}/accounting/${fiscalYear}/${month}`, {
        category_code: data.code,
        value: parseFloat(value) || 0,
      });
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update cell');
      fetchData();
    }
  }, [farmId, fiscalYear, fetchData, months]);

  const columnDefs = useMemo(() => {
    const isLevel0OrComputed = (params) => params.data?.level === 0 || params.data?.isComputed;

    const acctValueFormatter = (params) => {
      if (isLevel0OrComputed(params)) return formatCurrency(params.value, 0);
      return formatNumber(params.value, 0);
    };

    const cols = [
      {
        headerName: 'Category',
        field: 'display_name',
        pinned: 'left',
        width: 200,
        cellStyle: (params) => {
          if (params.data?.isComputed) {
            return { fontWeight: 'bold', borderTop: `2px solid ${colors.computedBorder}` };
          }
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
      {
        headerName: `FY${(fiscalYear || 2026) - 2}`,
        field: 'priorYear2',
        flex: 1,
        minWidth: 80,
        type: 'numericColumn',
        valueFormatter: (params) => {
          if (isLevel0OrComputed(params)) return formatCurrency(params.value, 0);
          return formatNumber(params.value, 0);
        },
        cellStyle: (params) => {
          const style = { backgroundColor: colors.priorYearBg, color: colors.priorYearText };
          if (isLevel0OrComputed(params)) {
            style.fontWeight = 'bold';
            style.borderTop = `2px solid ${colors.computedBorder}`;
          }
          return style;
        },
      },
      {
        headerName: `FY${(fiscalYear || 2026) - 1}`,
        field: 'priorYear',
        flex: 1,
        minWidth: 80,
        type: 'numericColumn',
        valueFormatter: (params) => {
          if (isLevel0OrComputed(params)) return formatCurrency(params.value, 0);
          return formatNumber(params.value, 0);
        },
        cellStyle: (params) => {
          const style = { backgroundColor: colors.priorYearBg, color: colors.priorYearText };
          if (isLevel0OrComputed(params)) {
            style.fontWeight = 'bold';
            style.borderTop = `2px solid ${colors.computedBorder}`;
          }
          return style;
        },
      },
    ];

    for (const month of months) {
      cols.push({
        headerName: month,
        field: `months.${month}`,
        flex: 1,
        minWidth: 80,
        type: 'numericColumn',
        editable: (params) => {
          if (!canEdit) return false;
          if (params.data?.isComputed) return false;
          const hasChildren = rowData.some(r => r.parent_code === params.data?.code);
          if (hasChildren) return false;
          return true;
        },
        valueGetter: (params) => params.data?.months?.[month] || 0,
        valueSetter: (params) => {
          if (!params.data.months) params.data.months = {};
          params.data.months[month] = parseFloat(params.newValue) || 0;
          return true;
        },
        valueFormatter: acctValueFormatter,
        tooltipValueGetter: (params) => {
          const c = params.data?.comments?.[month];
          if (!c) return null;
          if (c === 'Manual') return 'Manual entry';
          return c;
        },
        cellStyle: (params) => {
          const style = {};
          if (params.data?.isComputed) {
            style.fontWeight = 'bold';
            style.color = (params.value || 0) < 0 ? colors.negativeText : colors.positiveText;
            return style;
          }
          if (isLevel0OrComputed(params)) {
            style.fontWeight = 'bold';
            style.borderTop = `2px solid ${colors.computedBorder}`;
          }
          // Provenance styling: blue = module-driven, bold = manual override, normal = default/seeded
          const comment = params.data?.comments?.[month] || '';
          if (comment.startsWith('From ')) {
            style.color = colors.moduleDrivenText;
          } else if (comment === 'Manual') {
            style.fontWeight = '600';
          }
          return style;
        },
      });
    }

    // Year Total column (replaces Budget/Forecast/Variance/% Diff)
    cols.push({
      headerName: 'Year Total',
      field: 'total',
      flex: 1,
      minWidth: 85,
      type: 'numericColumn',
      valueFormatter: (params) => formatCurrency(params.value, 0),
      cellStyle: (params) => ({
        backgroundColor: colors.aggregateBg,
        fontWeight: 'bold',
        borderTop: isLevel0OrComputed(params) ? `2px solid ${colors.computedBorder}` : undefined,
      }),
    });

    return cols;
  }, [colors, months, fiscalYear, rowData, canEdit]);

  const gridTheme = mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>{error}</Alert>}
      <div className={gridTheme} style={{ height: 700, width: '100%' }}>
        <AgGridReact
          ref={gridRef}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ resizable: true, sortable: false, suppressMovable: true }}
          onCellValueChanged={onCellValueChanged}
          getRowId={(params) => params.data.code}
          animateRows={false}
          singleClickEdit={true}
          stopEditingWhenCellsLoseFocus={true}
          tooltipShowDelay={300}
        />
      </div>
    </Box>
  );
}
