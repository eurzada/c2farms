import { Stack, Alert } from '@mui/material';

export default function AlertsPanel({ alerts }) {
  if (!alerts || alerts.length === 0) return null;
  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      {alerts.map((a, i) => (
        <Alert key={i} severity={a.severity}>{a.message}</Alert>
      ))}
    </Stack>
  );
}
