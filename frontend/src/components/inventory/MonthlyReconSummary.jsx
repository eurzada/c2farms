import { Card, CardContent, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableFooter, Chip, Tooltip, Alert } from '@mui/material';
import { fmt } from '../../utils/formatting';

const flagColors = {
  green: 'success',
  yellow: 'warning',
  red: 'error',
};

const getUsedSource = (row) => {
  const elevator = row.at_elevator_mt || 0;
  const traction = row.hauled_mt || 0;
  return elevator > 0 && elevator >= traction ? 'elevator' : 'traction';
};

export default function MonthlyReconSummary({ data }) {
  if (!data || !data.rows?.length) return null;

  const { period, rows, totals } = data;

  const getShippedMt = (row) => row.reconciled_mt || row.hauled_mt || 0;
  const getExpectedClosing = (row) => Math.round((row.opening_mt - getShippedMt(row)) * 100) / 100;

  const totalShippedMt = totals
    ? (totals.reconciled_mt || rows.reduce((s, r) => s + getShippedMt(r), 0))
    : 0;
  const totalExpectedClosing = totals
    ? Math.round((totals.opening_mt - totalShippedMt) * 100) / 100
    : 0;

  const withElevator = rows.filter(r => (r.at_elevator_mt || 0) > 0).length;

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

        {rows.length > 0 && (
          <Alert
            severity={withElevator === rows.length ? 'success' : withElevator > 0 ? 'info' : 'warning'}
            sx={{ mb: 2 }}
          >
            Elevator data for {withElevator}/{rows.length} commodities. <strong>Bold</strong> = source used in calc.
          </Alert>
        )}

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Commodity</TableCell>
                <TableCell align="right">Opening MT</TableCell>
                <Tooltip title="Hauled (Unload) weight from truck tickets — dirty grain before dockage" arrow>
                  <TableCell align="right">Traction MT</TableCell>
                </Tooltip>
                <Tooltip title="Elevator weight from settlement data — clean grain after dockage" arrow>
                  <TableCell align="right">Elevator MT</TableCell>
                </Tooltip>
                <Tooltip title="Elevator MT − Traction MT. Positive = normal (elevator ≥ traction). Negative = investigate." arrow>
                  <TableCell align="right">Diff</TableCell>
                </Tooltip>
                <TableCell align="right">Expected Closing</TableCell>
                <TableCell align="right">Actual Closing</TableCell>
                <TableCell align="right">Variance MT</TableCell>
                <TableCell align="right">Settled MT</TableCell>
                <TableCell align="right">Unsettled MT</TableCell>
                <TableCell align="center">Variance %</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(row => {
                const expectedClosing = getExpectedClosing(row);
                const used = getUsedSource(row);
                const hasElevator = (row.at_elevator_mt || 0) > 0;
                const diff = hasElevator ? (row.at_elevator_mt || 0) - (row.hauled_mt || 0) : null;
                return (
                  <TableRow key={row.commodity_code} hover>
                    <TableCell>{row.commodity}</TableCell>
                    <TableCell align="right">{fmt(row.opening_mt, 0)}</TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontWeight: used === 'traction' ? 700 : 400,
                        backgroundColor: used === 'traction' ? '#FFF3E0' : undefined,
                      }}
                    >
                      {fmt(row.hauled_mt || 0, 0)}
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontWeight: used === 'elevator' ? 700 : 400,
                        backgroundColor: hasElevator && used === 'elevator' ? '#E8F5E9' : undefined,
                      }}
                    >
                      {hasElevator ? fmt(row.at_elevator_mt, 0) : '—'}
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        color: diff != null ? (diff < 0 ? '#D32F2F' : '#2E7D32') : 'text.secondary',
                        fontWeight: diff != null && diff < 0 ? 700 : 400,
                      }}
                    >
                      {diff != null ? fmt(diff, 0) : '—'}
                    </TableCell>
                    <TableCell align="right">{fmt(expectedClosing, 0)}</TableCell>
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
                );
              })}
            </TableBody>
            {totals && (
              <TableFooter>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt(totals.opening_mt, 0)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt(totals.hauled_mt || 0, 0)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt(totals.at_elevator_mt || 0, 0)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, color: ((totals.at_elevator_mt || 0) - (totals.hauled_mt || 0)) < 0 ? '#D32F2F' : '#2E7D32' }}>
                    {(totals.at_elevator_mt || 0) > 0 ? fmt((totals.at_elevator_mt || 0) - (totals.hauled_mt || 0), 0) : '—'}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt(totalExpectedClosing, 0)}</TableCell>
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
