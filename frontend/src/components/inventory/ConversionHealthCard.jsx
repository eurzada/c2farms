import {
  Card, CardContent, Typography, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, Box,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

export default function ConversionHealthCard({ data }) {
  if (!data) return null;
  const { items, ok_count, warning_count } = data;

  const allOk = warning_count === 0;

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Typography variant="h6">Conversion Factors (lbs/bu)</Typography>
          {allOk ? (
            <Chip icon={<CheckCircleOutlineIcon />} label={`${ok_count} OK`} color="success" size="small" />
          ) : (
            <Chip icon={<WarningAmberIcon />} label={`${warning_count} mismatch`} color="error" size="small" />
          )}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          System values vs Canadian standards (AFSC/CGC)
        </Typography>
        <TableContainer sx={{ maxHeight: 280 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Commodity</TableCell>
                <TableCell align="right">System</TableCell>
                <TableCell align="right">Standard</TableCell>
                <TableCell align="center">Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map(row => (
                <TableRow
                  key={row.id}
                  sx={row.status === 'mismatch' ? { bgcolor: 'error.50' } : undefined}
                >
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: row.status === 'mismatch' ? 700 : 400 }}>
                      {row.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">{row.code}</Typography>
                  </TableCell>
                  <TableCell align="right">{row.lbs_per_bu}</TableCell>
                  <TableCell align="right">{row.standard_lbs ?? '—'}</TableCell>
                  <TableCell align="center">
                    {row.status === 'ok' && <Chip label="OK" size="small" color="success" variant="outlined" />}
                    {row.status === 'mismatch' && <Chip label="Mismatch" size="small" color="error" />}
                    {row.status === 'no_standard' && <Chip label="N/A" size="small" variant="outlined" />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}
