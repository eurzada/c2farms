import { useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { Box } from '@mui/material';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useThemeMode } from '../../contexts/ThemeContext';
import { getGridColors } from '../../utils/gridColors';
import { formatNumber, formatCurrency } from '../../utils/formatting';

/**
 * Read-only ag-Grid for consolidated forecast data.
 */
export default function EnterpriseForecastGrid({ rows, months, mode, fiscalYear, onRowClick }) {
  const gridRef = useRef();
  const { mode: themeMode } = useThemeMode();
  const colors = useMemo(() => getGridColors(themeMode), [themeMode]);

  const onGridReady = useCallback((params) => {
    params.api.sizeColumnsToFit();
  }, []);

  const columnDefs = useMemo(() => {
    const valueFmt = mode === 'per-unit'
      ? (p) => formatNumber(p.value)
      : (p) => formatCurrency(p.value, 0);
    const isLevel0OrComputed = (params) => params.data?.level === 0 || params.data?.isComputed;

    const priorYearStyle = (params) => {
      const style = { backgroundColor: colors.priorYearBg, color: colors.priorYearText };
      if (isLevel0OrComputed(params)) {
        style.fontWeight = 'bold';
        style.borderTop = `2px solid ${colors.computedBorder}`;
      }
      return style;
    };

    const cols = [
      {
        headerName: 'Category',
        field: 'display_name',
        pinned: 'left',
        minWidth: 180,
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
        minWidth: 75,
        type: 'numericColumn',
        valueFormatter: valueFmt,
        cellStyle: priorYearStyle,
      },
      {
        headerName: `FY${(fiscalYear || 2026) - 1}`,
        field: 'priorYear',
        flex: 1,
        minWidth: 75,
        type: 'numericColumn',
        valueFormatter: valueFmt,
        cellStyle: priorYearStyle,
      },
    ];

    for (const month of months) {
      cols.push({
        headerName: month,
        field: `months.${month}`,
        flex: 1,
        minWidth: 70,
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

    cols.push({
      headerName: 'Total',
      field: 'forecastTotal',
      flex: 1,
      minWidth: 80,
      type: 'numericColumn',
      valueFormatter: valueFmt,
      cellStyle: (params) => ({
        backgroundColor: colors.aggregateBg,
        fontWeight: 'bold',
        borderTop: isLevel0OrComputed(params) ? `2px solid ${colors.computedBorder}` : undefined,
      }),
    });

    return cols;
  }, [months, colors, mode, fiscalYear]);

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
          onGridReady={onGridReady}
          onRowClicked={onRowClick ? (e) => onRowClick(e.data) : undefined}
          rowStyle={{ cursor: onRowClick ? 'pointer' : 'default' }}
        />
      </div>
    </Box>
  );
}
