import {
  Dialog, DialogTitle, DialogContent, IconButton,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Typography, Box, Chip,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { fmtDollar, fmt } from '../../utils/formatting';

/**
 * Dialog showing per-BU breakdown for a selected category row.
 * @param {Object} props
 * @param {boolean} props.open
 * @param {Function} props.onClose
 * @param {string} props.categoryName - Display name of the selected category
 * @param {Array} props.buData - Array of { farmName, acres, forecastTotal, budgetTotal }
 * @param {'per-unit'|'accounting'} props.mode
 * @param {number} props.totalAcres - Enterprise total acres
 */
export default function BuDrillDown({ open, onClose, categoryName, buData, mode, totalAcres }) {
  if (!buData) return null;

  const isPerUnit = mode === 'per-unit';
  const fmtVal = isPerUnit ? (v) => fmt(v, 2) : (v) => fmtDollar(v, 0);

  // Totals
  const totalForecast = buData.reduce((s, bu) => s + bu.forecastTotal, 0);
  const totalBudget = buData.reduce((s, bu) => s + bu.budgetTotal, 0);
  const totalVariance = totalForecast - totalBudget;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>{categoryName}</Typography>
        <Chip label={isPerUnit ? '$/acre' : 'Total $'} size="small" variant="outlined" />
        <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 'bold', bgcolor: 'action.hover' } }}>
                <TableCell>Farm Unit</TableCell>
                <TableCell align="right">Acres</TableCell>
                <TableCell align="right">Forecast</TableCell>
                <TableCell align="right">Budget</TableCell>
                <TableCell align="right">Variance</TableCell>
                <TableCell align="right">% of Total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {buData.map((bu) => {
                const variance = bu.forecastTotal - bu.budgetTotal;
                const pctOfTotal = totalForecast !== 0 ? (bu.forecastTotal / totalForecast) * 100 : 0;
                const displayForecast = isPerUnit && bu.acres ? bu.forecastTotal / bu.acres : bu.forecastTotal;
                const displayBudget = isPerUnit && bu.acres ? bu.budgetTotal / bu.acres : bu.budgetTotal;
                const displayVariance = isPerUnit && bu.acres ? variance / bu.acres : variance;

                return (
                  <TableRow key={bu.farmId} hover>
                    <TableCell>{bu.farmName}</TableCell>
                    <TableCell align="right">{fmt(bu.acres, 0)}</TableCell>
                    <TableCell align="right">{fmtVal(displayForecast)}</TableCell>
                    <TableCell align="right">{fmtVal(displayBudget)}</TableCell>
                    <TableCell
                      align="right"
                      sx={{ color: displayVariance > 0 ? 'error.main' : displayVariance < 0 ? 'success.main' : 'text.primary' }}
                    >
                      {fmtVal(displayVariance)}
                    </TableCell>
                    <TableCell align="right">{pctOfTotal.toFixed(1)}%</TableCell>
                  </TableRow>
                );
              })}
              <TableRow sx={{ '& td': { fontWeight: 'bold', borderTop: 2, borderColor: 'divider' } }}>
                <TableCell>CONSOLIDATED</TableCell>
                <TableCell align="right">{fmt(totalAcres, 0)}</TableCell>
                <TableCell align="right">
                  {fmtVal(isPerUnit ? totalForecast / (totalAcres || 1) : totalForecast)}
                </TableCell>
                <TableCell align="right">
                  {fmtVal(isPerUnit ? totalBudget / (totalAcres || 1) : totalBudget)}
                </TableCell>
                <TableCell
                  align="right"
                  sx={{ color: totalVariance > 0 ? 'error.main' : totalVariance < 0 ? 'success.main' : 'text.primary' }}
                >
                  {fmtVal(isPerUnit ? totalVariance / (totalAcres || 1) : totalVariance)}
                </TableCell>
                <TableCell align="right">100%</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>

        {/* Contribution bar */}
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary" gutterBottom>Contribution by Farm Unit</Typography>
          <Box sx={{ display: 'flex', height: 24, borderRadius: 1, overflow: 'hidden', mt: 0.5 }}>
            {buData.map((bu, i) => {
              const pct = totalForecast !== 0 ? (bu.forecastTotal / totalForecast) * 100 : 0;
              if (pct < 0.5) return null;
              const hue = (i * 47 + 180) % 360; // spread colors
              return (
                <Box
                  key={bu.farmId}
                  title={`${bu.farmName}: ${pct.toFixed(1)}%`}
                  sx={{
                    width: `${pct}%`,
                    bgcolor: `hsl(${hue}, 55%, 50%)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {pct > 8 && (
                    <Typography variant="caption" sx={{ color: '#fff', fontSize: 10, whiteSpace: 'nowrap' }}>
                      {bu.farmName}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
