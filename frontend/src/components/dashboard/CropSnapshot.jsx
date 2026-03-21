import {
  Paper, Typography, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Box, Alert,
} from '@mui/material';
import { fmtDollar, fmt } from '../../utils/formatting';

export default function CropSnapshot({ cropPlan }) {
  if (!cropPlan || cropPlan.status === null) {
    return (
      <Paper elevation={0} sx={{ border: 1, borderColor: 'divider', p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>Crop Plan</Typography>
        <Alert severity="info">No crop plan for this year</Alert>
      </Paper>
    );
  }

  const totalAcres = cropPlan.crops.reduce((s, c) => s + c.acres, 0);
  const totalInputCost = cropPlan.crops.reduce((s, c) => s + c.acres * c.input_per_acre, 0);
  const avgInputPerAcre = totalAcres > 0 ? totalInputCost / totalAcres : 0;

  return (
    <Paper elevation={0} sx={{ border: 1, borderColor: 'divider' }}>
      <Box sx={{ p: 2, pb: 1 }}>
        <Typography variant="h6">Crop Plan</Typography>
      </Box>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Crop</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Acres</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Input $/ac</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>% of Farm</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {cropPlan.crops.map(c => (
              <TableRow key={c.crop}>
                <TableCell sx={{ py: 0.75 }}>{c.crop}</TableCell>
                <TableCell align="right" sx={{ py: 0.75 }}>{fmt(c.acres, 0)}</TableCell>
                <TableCell align="right" sx={{ py: 0.75 }}>{fmtDollar(c.input_per_acre, 0)}</TableCell>
                <TableCell align="right" sx={{ py: 0.75 }}>{c.pct_of_farm}%</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell sx={{ py: 0.75, fontWeight: 700 }}>Total</TableCell>
              <TableCell align="right" sx={{ py: 0.75, fontWeight: 700 }}>{fmt(totalAcres, 0)}</TableCell>
              <TableCell align="right" sx={{ py: 0.75, fontWeight: 700 }}>{fmtDollar(avgInputPerAcre, 0)}</TableCell>
              <TableCell align="right" sx={{ py: 0.75, fontWeight: 700 }}>100%</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
