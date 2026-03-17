import { Box, Typography, Paper, Divider } from '@mui/material';
import { fmtDollar } from '../../utils/formatting';

export default function RealizationPanel({ realization, buyerName, contractNumber, deductions = [] }) {
  if (!realization) return null;

  const r = realization;

  return (
    <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom>
        Contract Realization{buyerName ? ` — ${buyerName}` : ''}{contractNumber ? ` #${contractNumber}` : ''}
      </Typography>
      <Divider sx={{ mb: 1 }} />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography>{buyerName || 'Buyer'} Net:</Typography>
        <Typography fontWeight={600}>{fmtDollar(r.buyer_net)}</Typography>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography>LGX Transfer Net (COGS):</Typography>
        <Typography>{fmtDollar(r.transfer_net)}</Typography>
      </Box>
      <Divider sx={{ my: 1 }} />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography fontWeight={700}>LGX Blending Margin:</Typography>
        <Typography fontWeight={700} color={r.margin > 0 ? 'success.main' : 'error.main'}>
          {fmtDollar(r.margin)}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="body2" color="text.secondary">Margin per MT:</Typography>
        <Typography variant="body2">{fmtDollar(r.margin_per_mt)}/MT</Typography>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="body2" color="text.secondary">Margin %:</Typography>
        <Typography variant="body2">{r.margin_pct}%</Typography>
      </Box>

      {deductions.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="body2" color="text.secondary" gutterBottom>Buyer Deductions:</Typography>
          {deductions.map((d, i) => (
            <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', pl: 2 }}>
              <Typography variant="body2">{d.name}</Typography>
              <Typography variant="body2" color="error">{fmtDollar(d.amount)}</Typography>
            </Box>
          ))}
        </>
      )}
    </Paper>
  );
}
