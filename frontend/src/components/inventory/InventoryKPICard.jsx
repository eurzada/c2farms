import { Card, CardContent, Typography, Box } from '@mui/material';
import { fmtDollar } from '../../utils/formatting';

export default function InventoryKPICard({ label, value, unit, color }) {
  let formatted;
  if (unit === 'MT') {
    formatted = `${(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} MT`;
  } else if (unit === '$') {
    formatted = fmtDollar(value || 0, 0);
  } else {
    formatted = (value || 0).toLocaleString();
  }

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ textAlign: 'center', p: 2 }}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          {label}
        </Typography>
        <Box sx={{ py: 1 }}>
          <Typography variant="h4" sx={{ color, fontWeight: 700 }}>
            {formatted}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}
