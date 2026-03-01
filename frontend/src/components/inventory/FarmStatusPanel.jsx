import { Card, CardContent, Typography, Grid, Chip, Stack } from '@mui/material';

const statusConfig = {
  current: { color: 'success', label: 'Current' },
  warning: { color: 'warning', label: 'Due Soon' },
  overdue: { color: 'error', label: 'Overdue' },
  unknown: { color: 'default', label: 'No Data' },
};

export default function FarmStatusPanel({ statuses }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>Farm Count Status</Typography>
        <Grid container spacing={1}>
          {statuses.map(s => {
            const config = statusConfig[s.status] || statusConfig.unknown;
            return (
              <Grid item xs={6} key={s.location_id}>
                <Card variant="outlined" sx={{ p: 1.5 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="subtitle2">{s.location_name}</Typography>
                    <Chip label={config.label} color={config.color} size="small" />
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {s.bin_count} bins
                    {s.days_since_count != null && ` | ${s.days_since_count}d ago`}
                  </Typography>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      </CardContent>
    </Card>
  );
}
