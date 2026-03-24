import { useMemo, useRef } from 'react';
import { Box, Alert } from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useThemeMode } from '../../contexts/ThemeContext';
import { getGridColors } from '../../utils/gridColors';
import { formatCurrency, formatNumber, formatPercent } from '../../utils/formatting';
import VarianceWaterfall from '../dashboard/VarianceWaterfall';

/**
 * Plan vs Actual variance view with detail grid and summary table.
 * @param {Object} props
 * @param {Object} props.data - Response from /variance/:year endpoint
 * @param {'accounting'|'per-acre'} [props.mode='accounting'] - Display mode
 */
export default function VarianceGrid({ data, mode = 'accounting' }) {
  const gridRef = useRef();
  const { mode: themeMode } = useThemeMode();
  const colors = useMemo(() => getGridColors(themeMode), [themeMode]);

  const isPerAcre = mode === 'per-acre';
  const divisor = isPerAcre && data?.totalAcres ? data.totalAcres : 1;
  const valueFmt = isPerAcre
    ? (p) => formatNumber(p.value, 2)
    : (p) => formatCurrency(p.value, 0);

  // Transform data for per-acre display
  const displayData = useMemo(() => {
    if (!data?.byCategory) return [];
    if (divisor === 1) return data.byCategory;
    return data.byCategory.map(row => ({
      ...row,
      planTotal: row.planTotal / divisor,
      actualTotal: row.actualTotal / divisor,
      variance: row.variance / divisor,
      // pctDiff stays the same (it's already a percentage)
    }));
  }, [data?.byCategory, divisor]);

  const displayWaterfall = useMemo(() => {
    if (!data?.waterfall) return [];
    if (divisor === 1) return data.waterfall;
    return data.waterfall.map(w => ({
      ...w,
      planTotal: w.planTotal / divisor,
      actualTotal: w.actualTotal / divisor,
      delta: w.delta / divisor,
    }));
  }, [data?.waterfall, divisor]);

  const columnDefs = useMemo(() => {
    const isParent = (params) => params.data?.level === 0 || params.data?.isComputed;

    return [
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
      {
        headerName: isPerAcre ? 'Plan $/ac' : 'Plan Total',
        field: 'planTotal',
        width: 130,
        type: 'numericColumn',
        valueFormatter: valueFmt,
        cellStyle: (params) => ({
          backgroundColor: 'rgba(25, 118, 210, 0.06)',
          fontWeight: isParent(params) ? 'bold' : 'normal',
          borderTop: isParent(params) ? `2px solid ${colors.computedBorder}` : undefined,
        }),
      },
      {
        headerName: isPerAcre ? 'Actual $/ac' : 'Actual Total',
        field: 'actualTotal',
        width: 130,
        type: 'numericColumn',
        valueFormatter: valueFmt,
        cellStyle: (params) => ({
          backgroundColor: 'rgba(239, 108, 0, 0.06)',
          fontWeight: isParent(params) ? 'bold' : 'normal',
          borderTop: isParent(params) ? `2px solid ${colors.computedBorder}` : undefined,
        }),
      },
      {
        headerName: isPerAcre ? 'Var $/ac' : 'Variance $',
        field: 'variance',
        width: 120,
        type: 'numericColumn',
        valueFormatter: valueFmt,
        cellStyle: (params) => {
          const v = params.value || 0;
          return {
            color: v > 0 ? colors.negativeText : v < 0 ? colors.positiveText : colors.mutedText,
            fontWeight: 'bold',
            borderTop: isParent(params) ? `2px solid ${colors.computedBorder}` : undefined,
          };
        },
      },
      {
        headerName: '% Diff',
        field: 'pctDiff',
        width: 90,
        type: 'numericColumn',
        valueFormatter: (p) => formatPercent(p.value),
        cellStyle: (params) => {
          const v = Math.abs(params.value || 0);
          return {
            color: v > 10 ? colors.negativeText : colors.mutedText,
            borderTop: isParent(params) ? `2px solid ${colors.computedBorder}` : undefined,
          };
        },
      },
    ];
  }, [colors, isPerAcre, valueFmt]);

  const defaultColDef = useMemo(() => ({
    resizable: true,
    sortable: false,
    suppressMovable: true,
    editable: false,
  }), []);

  if (!data) return null;

  const { hasActuals, planGrandTotal, actualGrandTotal } = data;
  const monthsWithActuals = Object.entries(hasActuals || {}).filter(([, v]) => v).length;

  const gridTheme = themeMode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

  return (
    <Box>
      {monthsWithActuals === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No QB actuals imported yet for this fiscal year. Import accounting data to see plan vs actual variance.
        </Alert>
      )}

      {/* Detail grid */}
      <div className={gridTheme} style={{ height: 500, width: '100%' }}>
        <AgGridReact
          ref={gridRef}
          rowData={displayData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={(params) => params.data.code}
          animateRows={false}
        />
      </div>

      {/* Summary table with inline bars (below grid) */}
      <Box sx={{ mt: 2 }}>
        <VarianceWaterfall
          waterfall={displayWaterfall}
          planGrandTotal={planGrandTotal / divisor}
          actualGrandTotal={actualGrandTotal / divisor}
          title={isPerAcre ? 'Plan vs Actual — Per Acre Summary' : 'Plan vs Actual — Expense Summary'}
          isPerAcre={isPerAcre}
        />
      </Box>
    </Box>
  );
}
