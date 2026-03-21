import {
  Paper, Typography, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Box, Alert,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { fmtDollar, fmtSigned } from '../../utils/formatting';

function VarianceIcon({ variance }) {
  if (variance <= 0) return <CheckCircleOutlineIcon sx={{ fontSize: 16, color: 'success.main', ml: 0.5 }} />;
  return <WarningAmberIcon sx={{ fontSize: 16, color: 'warning.main', ml: 0.5 }} />;
}

function ExpenseRow({ row, hasBudget, muted = false }) {
  const varianceColor = row.variance <= 0 ? 'success.main' : 'error.main';
  return (
    <TableRow sx={muted ? { opacity: 0.7 } : undefined}>
      <TableCell sx={{ py: 0.75 }}>{row.name}</TableCell>
      {hasBudget && (
        <TableCell align="right" sx={{ py: 0.75 }}>{fmtDollar(row.budget_per_acre, 0)}/ac</TableCell>
      )}
      <TableCell align="right" sx={{ py: 0.75 }}>{fmtDollar(row.actual_per_acre, 0)}/ac</TableCell>
      {hasBudget && (
        <TableCell align="right" sx={{ py: 0.75 }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', color: varianceColor }}>
            {fmtSigned(row.variance)}/ac
            <VarianceIcon variance={row.variance} />
          </Box>
        </TableCell>
      )}
    </TableRow>
  );
}

function TotalRow({ label, total, hasBudget, bold = false }) {
  const varianceColor = total.variance <= 0 ? 'success.main' : 'error.main';
  const fontWeight = bold ? 700 : 600;
  return (
    <TableRow>
      <TableCell sx={{ py: 0.75, fontWeight }}>{label}</TableCell>
      {hasBudget && (
        <TableCell align="right" sx={{ py: 0.75, fontWeight }}>{fmtDollar(total.budget_per_acre, 0)}/ac</TableCell>
      )}
      <TableCell align="right" sx={{ py: 0.75, fontWeight }}>{fmtDollar(total.actual_per_acre, 0)}/ac</TableCell>
      {hasBudget && (
        <TableCell align="right" sx={{ py: 0.75, fontWeight }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', color: varianceColor }}>
            {fmtSigned(total.variance)}/ac
            <VarianceIcon variance={total.variance} />
          </Box>
        </TableCell>
      )}
    </TableRow>
  );
}

export default function BudgetAdherence({ expenses }) {
  if (!expenses) return null;

  const hasBudget = expenses.has_frozen_budget;

  return (
    <Paper elevation={0} sx={{ border: 1, borderColor: 'divider' }}>
      <Box sx={{ p: 2, pb: 1 }}>
        <Typography variant="h6">Budget Adherence</Typography>
      </Box>

      {!hasBudget && (
        <Alert severity="info" sx={{ mx: 2, mb: 1 }}>
          Freeze budget to enable variance tracking
        </Alert>
      )}

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Controllable Costs</TableCell>
              {hasBudget && <TableCell align="right" sx={{ fontWeight: 600 }}>Budget</TableCell>}
              <TableCell align="right" sx={{ fontWeight: 600 }}>Actual</TableCell>
              {hasBudget && <TableCell align="right" sx={{ fontWeight: 600 }}>Variance</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {expenses.controllable.map(row => (
              <ExpenseRow key={row.code} row={row} hasBudget={hasBudget} />
            ))}
            <TotalRow label="Subtotal" total={expenses.controllable_total} hasBudget={hasBudget} />
          </TableBody>
        </Table>
      </TableContainer>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, color: 'text.secondary' }}>Other Costs</TableCell>
              {hasBudget && <TableCell align="right" />}
              <TableCell align="right" />
              {hasBudget && <TableCell align="right" />}
            </TableRow>
          </TableHead>
          <TableBody>
            {expenses.other.map(row => (
              <ExpenseRow key={row.code} row={row} hasBudget={hasBudget} muted />
            ))}
            <TotalRow label="Total Expense" total={expenses.grand_total} hasBudget={hasBudget} bold />
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
