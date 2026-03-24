import { Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper } from '@mui/material';
import { fmtDollar, fmtDollarK, formatNumber } from '../../utils/formatting';

/**
 * Variance summary table with inline colored bars.
 * Shows Plan vs Actual per category with visual bar indicators.
 */
export default function VarianceWaterfall({ waterfall, planGrandTotal, actualGrandTotal, title, isPerAcre = false }) {
  if (!waterfall?.length) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography color="text.secondary">No variance data available</Typography>
      </Box>
    );
  }

  const totalVar = actualGrandTotal - planGrandTotal;
  const totalPct = planGrandTotal !== 0 ? ((totalVar / Math.abs(planGrandTotal)) * 100).toFixed(1) : '0.0';
  const maxAbsDelta = Math.max(...waterfall.map(w => Math.abs(w.delta)), 1);

  // Format helpers based on mode
  const fmtVal = isPerAcre ? (v) => '$' + formatNumber(v, 2) : (v) => fmtDollar(v, 0);
  const fmtTotal = isPerAcre ? (v) => '$' + formatNumber(v, 2) : (v) => fmtDollar(v, 0);
  const fmtDelta = isPerAcre
    ? (v) => (v >= 0 ? '+$' : '-$') + formatNumber(Math.abs(v), 2)
    : (v) => { const sign = v >= 0 ? '+' : '-'; return `${sign}${fmtDollar(Math.abs(v), 0)}`; };

  return (
    <Box>
      {title && <Typography variant="subtitle1" fontWeight="bold" gutterBottom>{title}</Typography>}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 'bold', bgcolor: 'action.hover' } }}>
              <TableCell>Category</TableCell>
              <TableCell align="right">Plan</TableCell>
              <TableCell align="right">Actual</TableCell>
              <TableCell align="right">Variance</TableCell>
              <TableCell sx={{ width: 200 }}>Bar</TableCell>
              <TableCell align="right">%</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {waterfall.map((w) => {
              const pct = w.planTotal !== 0 ? ((w.delta / Math.abs(w.planTotal)) * 100) : 0;
              const barWidth = Math.min(Math.abs(w.delta) / maxAbsDelta * 100, 100);
              const isOver = w.delta > 0;
              const shortName = w.name
                .replace('LPM - Labour Power Machinery', 'LPM')
                .replace('LBF - Land Building Finance', 'LBF');

              return (
                <TableRow key={w.code} hover>
                  <TableCell>{shortName}</TableCell>
                  <TableCell align="right">{fmtVal(w.planTotal)}</TableCell>
                  <TableCell align="right">{fmtVal(w.actualTotal)}</TableCell>
                  <TableCell
                    align="right"
                    sx={{ color: isOver ? 'error.main' : w.delta < 0 ? 'success.main' : 'text.primary', fontWeight: 600 }}
                  >
                    {fmtDelta(w.delta)}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', height: 16 }}>
                      {/* Left side (under plan / favorable) */}
                      <Box sx={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                        {!isOver && w.delta !== 0 && (
                          <Box sx={{
                            width: `${barWidth}%`,
                            height: 14,
                            bgcolor: 'success.main',
                            borderRadius: '2px 0 0 2px',
                            opacity: 0.7,
                          }} />
                        )}
                      </Box>
                      {/* Center line */}
                      <Box sx={{ width: 2, height: 18, bgcolor: 'divider', flexShrink: 0 }} />
                      {/* Right side (over plan / unfavorable) */}
                      <Box sx={{ flex: 1 }}>
                        {isOver && (
                          <Box sx={{
                            width: `${barWidth}%`,
                            height: 14,
                            bgcolor: 'error.main',
                            borderRadius: '0 2px 2px 0',
                            opacity: 0.7,
                          }} />
                        )}
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ color: isOver ? 'error.main' : w.delta < 0 ? 'success.main' : 'text.secondary' }}
                  >
                    {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                  </TableCell>
                </TableRow>
              );
            })}

            {/* Total row */}
            <TableRow sx={{ '& td': { fontWeight: 'bold', borderTop: 2, borderColor: 'divider' } }}>
              <TableCell>TOTAL</TableCell>
              <TableCell align="right">{fmtTotal(planGrandTotal)}</TableCell>
              <TableCell align="right">{fmtTotal(actualGrandTotal)}</TableCell>
              <TableCell
                align="right"
                sx={{ color: totalVar > 0 ? 'error.main' : totalVar < 0 ? 'success.main' : 'text.primary' }}
              >
                {fmtDelta(totalVar)}
              </TableCell>
              <TableCell />
              <TableCell
                align="right"
                sx={{ color: totalVar > 0 ? 'error.main' : totalVar < 0 ? 'success.main' : 'text.secondary' }}
              >
                {totalPct >= 0 ? '+' : ''}{totalPct}%
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
