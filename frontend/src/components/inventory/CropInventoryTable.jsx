import { Card, CardContent, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';

export default function CropInventoryTable({ crops }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>Inventory by Crop</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Commodity</TableCell>
                <TableCell align="right">Metric Tonnes</TableCell>
                <TableCell align="right">Active Bins</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {crops.map(c => (
                <TableRow key={c.code} hover>
                  <TableCell>{c.commodity}</TableCell>
                  <TableCell align="right">{c.total_mt.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                  <TableCell align="right">{c.bin_count}</TableCell>
                </TableRow>
              ))}
              <TableRow sx={{ '& td': { fontWeight: 700, borderTop: 2, borderColor: 'divider' } }}>
                <TableCell>Total</TableCell>
                <TableCell align="right">
                  {crops.reduce((s, c) => s + c.total_mt, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </TableCell>
                <TableCell align="right">
                  {crops.reduce((s, c) => s + c.bin_count, 0)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}
