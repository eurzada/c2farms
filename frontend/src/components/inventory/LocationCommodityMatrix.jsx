import { Card, CardContent, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import { fmt } from '../../utils/formatting';

export default function LocationCommodityMatrix({ data }) {
  if (!data || !data.rows || data.rows.length === 0) return null;

  const { commodities, rows, totals, grandTotal } = data;

  const cellSx = { py: 0.5, px: 1, fontSize: 13 };
  const headerSx = { ...cellSx, fontWeight: 700 };
  const totalRowSx = { ...cellSx, fontWeight: 700, borderTop: 2, borderColor: 'divider' };

  return (
    <Card>
      <CardContent sx={{ pb: 1 }}>
        <Typography variant="h6" gutterBottom>Inventory by Location</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={headerSx}>Location</TableCell>
                {commodities.map(c => (
                  <TableCell key={c} align="right" sx={headerSx}>{c}</TableCell>
                ))}
                <TableCell align="right" sx={headerSx}>Total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(row => (
                <TableRow key={row.location} hover>
                  <TableCell sx={cellSx}>{row.location}</TableCell>
                  {commodities.map(c => (
                    <TableCell key={c} align="right" sx={cellSx}>
                      {row.values[c] ? fmt(row.values[c]) : '—'}
                    </TableCell>
                  ))}
                  <TableCell align="right" sx={{ ...cellSx, fontWeight: 600 }}>{fmt(row.total)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell sx={totalRowSx}>Total</TableCell>
                {commodities.map(c => (
                  <TableCell key={c} align="right" sx={totalRowSx}>{fmt(totals[c])}</TableCell>
                ))}
                <TableCell align="right" sx={totalRowSx}>{fmt(grandTotal)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}
