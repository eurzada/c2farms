import { useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { Box } from '@mui/material';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useThemeMode } from '../../contexts/ThemeContext';
import { getGridColors } from '../../utils/gridColors';
import { formatNumber, formatCurrency, formatPercent } from '../../utils/formatting';

/**
 * Read-only ag-Grid for consolidated forecast data.
 * @param {Object} props
 * @param {Array} props.rows - Row data (same shape as financial.js response)
 * @param {Array} props.months - Fiscal months array ['Nov',..,'Oct']
 * @param {'per-unit'|'accounting'} props.mode - Display mode
 * @param {Function} [props.onRowClick] - Called with row data on click
 */
export default function EnterpriseForecastGrid({ rows, months, mode, onRowClick }) {
  const gridRef = useRef();
  const { mode: themeMode } = useThemeMode();
  const colors = useMemo(() => getGridColors(themeMode), [themeMode]);

  const columnDefs = useMemo(() => {
    const valueFmt = mode === 'per-unit'
      ? (p) => formatNumber(p.value)
      : (p) => formatCurrency(p.value, 0);
    const isLevel0OrComputed = (params) => params.data?.level === 0 || params.data?.isComputed;

    const cols = [
      {
        headerName: 'Category',
        field: 'display_name',
        pinned: 'left',
        width: 220,
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
        headerName: 'Prior Year',
        field: 'priorYear',
        width: 100,
        type: 'numericColumn',
        valueFormatter: valueFmt,
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
        width: 90,
        type: 'numericColumn',
        valueGetter: (params) => params.data?.months?.[month] || 0,
        valueFormatter: valueFmt,
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
          return style;
        },
      });
    }

    cols.push(
      {
        headerName: 'Forecast',
        field: 'forecastTotal',
        width: 110,
        type: 'numericColumn',
        valueFormatter: valueFmt,
        cellStyle: (params) => ({
          backgroundColor: colors.aggregateBg,
          fontWeight: 'bold',
          borderTop: isLevel0OrComputed(params) ? `2px solid ${colors.computedBorder}` : undefined,
        }),
      },
      {
        headerName: 'Budget',
        field: 'frozenBudgetTotal',
        width: 110,
        type: 'numericColumn',
        valueFormatter: valueFmt,
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
        valueFormatter: valueFmt,
        cellStyle: (params) => ({
          color: (params.value || 0) < 0 ? colors.negativeText : (params.value || 0) > 0 ? colors.negativeText : colors.positiveText,
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
  }, [months, colors, mode]);

  const defaultColDef = useMemo(() => ({
    resizable: true,
    sortable: false,
    suppressMovable: true,
    editable: false,
  }), []);

  const gridTheme = themeMode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

  return (
    <Box>
      <div className={gridTheme} style={{ height: 600, width: '100%' }}>
        <AgGridReact
          ref={gridRef}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={(params) => params.data.code}
          animateRows={false}
          onRowClicked={onRowClick ? (e) => onRowClick(e.data) : undefined}
          rowStyle={{ cursor: onRowClick ? 'pointer' : 'default' }}
        />
      </div>
    </Box>
  );
}
