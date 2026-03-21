import { Paper, Typography } from '@mui/material';

const statusColors = {
  good: 'success.main',
  warning: 'warning.main',
  bad: 'error.main',
  neutral: 'text.secondary',
};

export default function ScoreCard({ label, value, subtext, status = 'neutral' }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2.5,
        height: '100%',
        border: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
        {value}
      </Typography>
      {subtext && (
        <Typography variant="caption" sx={{ color: statusColors[status] || statusColors.neutral }}>
          {subtext}
        </Typography>
      )}
    </Paper>
  );
}
