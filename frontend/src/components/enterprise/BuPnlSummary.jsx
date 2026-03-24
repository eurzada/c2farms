import { Box, Typography, Paper, useTheme } from '@mui/material';
import { fmtDollar, fmt } from '../../utils/formatting';

function colorVal(val) {
  if (val > 0) return 'success.main';
  if (val < 0) return 'error.main';
  return 'text.primary';
}

/**
 * BU-level P&L summary table with per-acre values and break-even.
 * Columns = one per BU + consolidated rollup on the right.
 */
export default function BuPnlSummary({ data }) {
  const theme = useTheme();
  if (!data?.buSummaries?.length) return null;

  const { buSummaries, consolidated } = data;
  const allCols = [...buSummaries, consolidated];

  const rows = [
    { label: 'Acres', field: 'acres', format: (v) => fmt(v, 0) },
    { label: 'Revenue', field: 'revenuePerAcre', format: (v) => fmtDollar(v, 0) },
    { label: 'Inputs', field: 'inputsPerAcre', format: (v) => fmtDollar(v, 0) },
    { label: 'Gross Margin', field: 'grossMarginPerAcre', format: (v) => fmtDollar(v, 0), bold: true, color: true },
    { type: 'spacer' },
    { label: 'Personnel', field: 'personnelPerAcre', format: (v) => fmtDollar(v, 0) },
    { label: 'Fuel', field: 'fuelPerAcre', format: (v) => fmtDollar(v, 0) },
    { label: 'Repairs', field: 'repairsPerAcre', format: (v) => fmtDollar(v, 0) },
    { label: 'Shop', field: 'shopPerAcre', format: (v) => fmtDollar(v, 0) },
    { label: 'Land & Finance', field: 'lbfPerAcre', format: (v) => fmtDollar(v, 0) },
    { label: 'Insurance', field: 'insurancePerAcre', format: (v) => fmtDollar(v, 0) },
    { type: 'spacer' },
    { label: 'Total Expense', field: 'totalExpensePerAcre', format: (v) => fmtDollar(v, 0), bold: true },
    { label: 'Net Margin', field: 'netMarginPerAcre', format: (v) => fmtDollar(v, 0), bold: true, color: true },
    { type: 'spacer' },
    { label: 'Break-Even $/ac', field: 'breakEvenPerAcre', format: (v) => fmtDollar(v, 0), bold: true, highlight: true },
  ];

  const isDark = theme.palette.mode === 'dark';
  const stripeBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
  const headerBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
  const highlightBg = isDark ? 'rgba(25,118,210,0.12)' : 'rgba(25,118,210,0.06)';
  const consolidatedBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)';

  const cellSx = {
    px: 2.5,
    py: 1.5,
    textAlign: 'right',
    fontSize: '0.9rem',
    whiteSpace: 'nowrap',
    borderBottom: '1px solid',
    borderColor: 'divider',
  };

  const labelSx = {
    ...cellSx,
    textAlign: 'left',
    fontWeight: 500,
    position: 'sticky',
    left: 0,
    bgcolor: 'background.paper',
    zIndex: 1,
  };

  let dataRowIdx = 0;

  return (
    <Paper elevation={0} sx={{ border: 1, borderColor: 'divider', overflow: 'hidden' }}>
      <Box sx={{ px: 2.5, py: 2 }}>
        <Typography variant="h6" fontWeight="bold">BU Financial Summary — Plan ($/acre)</Typography>
      </Box>
      <Box sx={{ overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              <Box component="th" sx={{ ...cellSx, textAlign: 'left', fontWeight: 700, fontSize: '0.85rem', bgcolor: headerBg, position: 'sticky', left: 0, zIndex: 2, letterSpacing: 0.3 }}>
                Category
              </Box>
              {buSummaries.map(bu => (
                <Box component="th" key={bu.farmId} sx={{ ...cellSx, fontWeight: 700, fontSize: '0.85rem', bgcolor: headerBg, letterSpacing: 0.3 }}>
                  {bu.name}
                </Box>
              ))}
              <Box component="th" sx={{ ...cellSx, fontWeight: 700, fontSize: '0.85rem', bgcolor: headerBg, borderLeft: '2px solid', borderLeftColor: 'divider', letterSpacing: 0.3 }}>
                Consolidated
              </Box>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              if (row.type === 'spacer') {
                return (
                  <tr key={`spacer-${i}`}>
                    <Box component="td" colSpan={allCols.length + 1} sx={{ p: 0.3, bgcolor: 'transparent' }} />
                  </tr>
                );
              }

              const isStripe = dataRowIdx % 2 === 1;
              dataRowIdx++;

              return (
                <tr key={row.field}>
                  <Box component="td" sx={{
                    ...labelSx,
                    fontWeight: row.bold ? 700 : 500,
                    fontSize: row.bold ? '0.95rem' : '0.9rem',
                    bgcolor: row.highlight ? highlightBg : isStripe ? stripeBg : 'background.paper',
                  }}>
                    {row.label}
                  </Box>
                  {allCols.map((col, ci) => {
                    const val = col[row.field];
                    const isConsolidated = ci === allCols.length - 1;
                    return (
                      <Box
                        component="td"
                        key={ci}
                        sx={{
                          ...cellSx,
                          fontWeight: row.bold ? 700 : 400,
                          fontSize: row.bold ? '0.95rem' : '0.9rem',
                          ...(row.color ? { color: colorVal(val) } : {}),
                          bgcolor: row.highlight
                            ? highlightBg
                            : isConsolidated
                              ? consolidatedBg
                              : isStripe ? stripeBg : 'transparent',
                          ...(isConsolidated ? { borderLeft: '2px solid', borderLeftColor: 'divider' } : {}),
                        }}
                      >
                        {row.format(val)}
                      </Box>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </Box>
      </Box>
    </Paper>
  );
}
