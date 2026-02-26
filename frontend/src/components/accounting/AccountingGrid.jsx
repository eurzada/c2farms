import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { Box, Alert } from '@mui/material';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import api from '../../services/api';
import { useThemeMode } from '../../contexts/ThemeContext';
import { useFarm } from '../../contexts/FarmContext';
import { getGridColors } from '../../utils/gridColors';
import { FISCAL_MONTHS, isPastMonth } from '../../utils/fiscalYear';
import { formatCurrency, formatNumber, formatPercent } from '../../utils/formatting';

export default function AccountingGrid({ farmId, fiscalYear, onSummaryLoaded }) {
  const [rowData, setRowData] = useState([]);
  const [summary, setSummary] = useState({});
  const [totalAcres, setTotalAcres] = useState(0);
  const [months, setMonths] = useState(FISCAL_MONTHS);
  const [startMonth, setStartMonth] = useState('Nov');
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
      setSummary(newSummary);
      setTotalAcres(res.data.totalAcres || 0);
      if (res.data.months) setMonths(res.data.months);
      if (res.data.startMonth) setStartMonth(res.data.startMonth);
      onSummaryLoaded?.(newSummary, res.data.months);
    } catch {
      setError('Failed to load accounting data');
    }
  }, [farmId, fiscalYear]);

  useEffect(() => { fetchData(); }, [fetchData]);

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

  // Rows come from the API already including computed rows (_total_expense, _profit)
  const fullRowData = useMemo(() => {
    if (rowData.length === 0) return [];
    return rowData;
  }, [rowData]);

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
        width: 260,
        cellStyle: (params) => {
          if (params.data?.isComputed) {
            return { fontWeight: 'bold', borderTop: `2px solid ${colors.computedBorder}` };
          }
          const indent = (params.data?.level || 0) * 20;
          const bold = params.data?.level === 0;
          const style = {
            paddingLeft: `${indent + 8}px`,
            fontWeight: bold ? 'bold' : 'normal',
          };
          if (bold) {
            style.backgroundColor = colors.parentRow;
            style.borderTop = `2px solid ${colors.computedBorder}`;
          }
          return style;
        },
      },
      {
        headerName: 'Prior Year',
        field: 'priorYear',
        width: 110,
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
      const past = isPastMonth(fiscalYear, month, startMonth);
      cols.push({
        headerName: month,
        field: `months.${month}`,
        width: 110,
        type: 'numericColumn',
        editable: (params) => {
          if (!canEdit) return false;
          if (params.data?.isComputed) return false;
          // Only leaf categories (no children) are editable
          const hasChildren = rowData.some(r => r.parent_code === params.data?.code);
          if (hasChildren) return false;
          if (params.data?.actuals?.[month]) return false;
          return true;
        },
        valueGetter: (params) => params.data?.months?.[month] || 0,
        valueSetter: (params) => {
          if (!params.data.months) params.data.months = {};
          params.data.months[month] = parseFloat(params.newValue) || 0;
          return true;
        },
        valueFormatter: acctValueFormatter,
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
          if (past) {
            style.backgroundColor = colors.actualCell;
          }
          return style;
        },
      });
    }

    cols.push(
      {
        headerName: 'Budget',
        field: 'frozenBudgetTotal',
        width: 120,
        type: 'numericColumn',
        valueFormatter: (params) => formatCurrency(params.value, 0),
        cellStyle: (params) => ({
          backgroundColor: colors.aggregateBg,
          fontWeight: 'bold',
          borderTop: isLevel0OrComputed(params) ? `2px solid ${colors.computedBorder}` : undefined,
        }),
      },
      {
        headerName: 'Forecast',
        field: 'forecastTotal',
        width: 110,
        type: 'numericColumn',
        valueFormatter: (params) => formatCurrency(params.value, 0),
        cellStyle: (params) => ({
          backgroundColor: colors.forecastBg,
          fontWeight: 'bold',
          borderTop: isLevel0OrComputed(params) ? `2px solid ${colors.computedBorder}` : undefined,
        }),
      },
      {
        headerName: 'Variance',
        field: 'variance',
        width: 110,
        type: 'numericColumn',
        valueFormatter: (params) => formatCurrency(params.value, 0),
        cellStyle: (params) => ({
          color: (params.value || 0) < 0 ? colors.negativeText : colors.positiveText,
          fontWeight: 'bold',
          borderTop: isLevel0OrComputed(params) ? `2px solid ${colors.computedBorder}` : undefined,
        }),
      },
      {
        headerName: '% Diff',
        field: 'pctDiff',
        width: 80,
        type: 'numericColumn',
        valueFormatter: (p) => formatPercent(p.value),
        cellStyle: (params) => ({
          color: Math.abs(params.value || 0) > 10 ? colors.negativeText : colors.mutedText,
          borderTop: isLevel0OrComputed(params) ? `2px solid ${colors.computedBorder}` : undefined,
        }),
      },
    );

    return cols;
  }, [colors, months, startMonth, fiscalYear, rowData]);

  const gridTheme = mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>{error}</Alert>}
      <div className={gridTheme} style={{ height: 700, width: '100%' }}>
        <AgGridReact
          ref={gridRef}
          rowData={fullRowData}
          columnDefs={columnDefs}
          defaultColDef={{ resizable: true, sortable: false, suppressMovable: true }}
          onCellValueChanged={onCellValueChanged}
          getRowId={(params) => params.data.code}
          animateRows={false}
          singleClickEdit={true}
          stopEditingWhenCellsLoseFocus={true}
        />
      </div>
    </Box>
  );
}
