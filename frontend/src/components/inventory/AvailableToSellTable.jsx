import { Card, CardContent, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';

const signalColors = {
  green: '#4caf50',
  yellow: '#ff9800',
  red: '#f44336',
};

const signalIcons = {
  green: '\uD83D\uDFE2',
  yellow: '\uD83D\uDFE1',
  red: '\uD83D\uDD34',
};

export default function AvailableToSellTable({ data }) {
  if (!data || data.length === 0) return null;

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>Available to Sell</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Commodity</TableCell>
                <TableCell align="right">Total MT</TableCell>
                <TableCell align="right">Contracted MT</TableCell>
                <TableCell align="right">Available MT</TableCell>
                <TableCell align="right">% Committed</TableCell>
                <TableCell align="center">Signal</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.map(row => (
                <TableRow key={row.commodity_code} hover>
                  <TableCell>{row.commodity_name}</TableCell>
                  <TableCell align="right">{row.total_mt.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                  <TableCell align="right">{row.contracted_mt.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                  <TableCell align="right" sx={{ color: row.available_mt < 0 ? 'error.main' : 'inherit', fontWeight: row.available_mt < 0 ? 700 : 400 }}>
                    {row.available_mt.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </TableCell>
                  <TableCell align="right">{row.pct_committed.toFixed(1)}%</TableCell>
                  <TableCell align="center" sx={{ fontSize: '1.2rem' }}>{signalIcons[row.signal]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}
