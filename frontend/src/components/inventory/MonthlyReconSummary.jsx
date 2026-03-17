import { Card, CardContent, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableFooter, Chip } from '@mui/material';
import { fmt } from '../../utils/formatting';

const flagColors = {
  green: 'success',
  yellow: 'warning',
  red: 'error',
};

export default function MonthlyReconSummary({ data }) {
  if (!data || !data.rows?.length) return null;

  const { period, rows, totals } = data;

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Monthly Reconciliation Summary
          {period && (
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
              ({period})
            </Typography>
          )}
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Commodity</TableCell>
                <TableCell align="right">Opening MT</TableCell>
                <TableCell align="right">Hauled MT</TableCell>
                <TableCell align="right">Expected Closing</TableCell>
                <TableCell align="right">Actual Closing</TableCell>
                <TableCell align="right">Variance MT</TableCell>
                <TableCell align="right">Settled MT</TableCell>
                <TableCell align="right">Unsettled MT</TableCell>
                <TableCell align="center">Variance %</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(row => (
                <TableRow key={row.commodity_code} hover>
                  <TableCell>{row.commodity}</TableCell>
                  <TableCell align="right">{fmt(row.opening_mt, 0)}</TableCell>
                  <TableCell align="right">{fmt(row.hauled_mt, 0)}</TableCell>
                  <TableCell align="right">{fmt(row.expected_closing_mt, 0)}</TableCell>
                  <TableCell align="right">{fmt(row.actual_closing_mt, 0)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{fmt(row.variance_mt, 0)}</TableCell>
                  <TableCell align="right">{fmt(row.settled_mt, 0)}</TableCell>
                  <TableCell align="right" sx={{ color: row.unsettled_mt > 0 ? 'warning.main' : 'inherit' }}>
                    {fmt(row.unsettled_mt, 0)}
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      label={`${row.variance_pct.toFixed(1)}%`}
                      size="small"
                      color={flagColors[row.flag] || 'default'}
                      variant={row.flag === 'green' ? 'outlined' : 'filled'}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {totals && (
              <TableFooter>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt(totals.opening_mt, 0)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt(totals.hauled_mt, 0)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt(totals.expected_closing_mt, 0)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt(totals.actual_closing_mt, 0)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt(totals.variance_mt, 0)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt(totals.settled_mt, 0)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt(totals.unsettled_mt, 0)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}
