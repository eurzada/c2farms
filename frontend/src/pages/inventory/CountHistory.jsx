import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import RemoveIcon from '@mui/icons-material/Remove';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';

const fmt = (v) => v != null ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—';

// Muted palette derived from C2 Farms brand teal/charcoal
const COMMODITY_COLORS = [
  '#008CB2', // C2 teal
  '#006E8C', // C2 teal dark
  '#4DB8D4', // C2 teal light
  '#6d6e70', // C2 charcoal light
  '#414042', // C2 charcoal
  '#7BA7B8', // muted steel teal
  '#95B0A4', // sage
  '#A8B5C0', // slate
  '#8C9EA8', // dusty teal
  '#B0BEC5', // blue grey
  '#90A4AE', // blue grey mid
  '#78909C', // blue grey dark
];

function DeltaDisplay({ delta_mt, isFirst }) {
  if (isFirst || delta_mt == null) {
    return (
      <Typography variant="body2" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
        Baseline
      </Typography>
    );
  }

  const isPositive = delta_mt >= 0;
  const color = isPositive ? 'success.main' : 'error.main';
  const Icon = delta_mt > 0 ? ArrowUpwardIcon : delta_mt < 0 ? ArrowDownwardIcon : RemoveIcon;

  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <Icon sx={{ fontSize: 16, color }} />
      <Typography variant="body1" sx={{ fontWeight: 600, color }}>
        {delta_mt > 0 ? '+' : ''}{fmt(delta_mt)}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>MT</Typography>
    </Stack>
  );
}

function CommodityBar({ commodities, total_mt }) {
  if (!commodities || commodities.length === 0 || !total_mt) return null;

  return (
    <Box>
      {/* Stacked bar */}
      <Box sx={{ display: 'flex', height: 8, borderRadius: 1, overflow: 'hidden', mb: 1 }}>
        {commodities.map((c, i) => {
          const share = (c.mt / total_mt) * 100;
          if (share < 0.5) return null;
          return (
            <Tooltip key={c.name} title={`${c.name}: ${fmt(c.mt)} MT (${share.toFixed(1)}%)`} arrow>
              <Box
                sx={{
                  width: `${share}%`,
                  bgcolor: COMMODITY_COLORS[i % COMMODITY_COLORS.length],
                  transition: 'width 0.3s',
                }}
              />
            </Tooltip>
          );
        })}
      </Box>
      {/* Legend */}
      <Stack direction="row" flexWrap="wrap" gap={1.5}>
        {commodities.map((c, i) => {
          const share = total_mt > 0 ? (c.mt / total_mt) * 100 : 0;
          return (
            <Stack key={c.name} direction="row" alignItems="center" spacing={0.5}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: COMMODITY_COLORS[i % COMMODITY_COLORS.length],
                  flexShrink: 0,
                }}
              />
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {c.name}
              </Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.primary' }}>
                {fmt(c.mt)}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                ({share.toFixed(0)}%)
              </Typography>
            </Stack>
          );
        })}
      </Stack>
    </Box>
  );
}

function LocationBreakdown({ locations }) {
  if (!locations || locations.length === 0) return null;

  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600, py: 0.5, color: 'text.secondary', fontSize: '0.75rem' }}>Location</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600, py: 0.5, color: 'text.secondary', fontSize: '0.75rem' }}>MT</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600, py: 0.5, color: 'text.secondary', fontSize: '0.75rem' }}>Bins</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {locations.map((loc) => (
            <TableRow key={loc.name} sx={{ '&:last-child td': { borderBottom: 0 } }}>
              <TableCell sx={{ py: 0.5, fontSize: '0.8rem' }}>{loc.name}</TableCell>
              <TableCell align="right" sx={{ py: 0.5, fontWeight: 500, fontSize: '0.8rem' }}>
                {fmt(loc.mt)}
              </TableCell>
              <TableCell align="right" sx={{ py: 0.5, fontSize: '0.8rem', color: 'text.secondary' }}>{loc.bins}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function PeriodCard({ period, isFirst }) {
  const periodDate = new Date(period.period_date);
  const dateLabel = periodDate.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
  });

  return (
    <Card
      variant="outlined"
      sx={{
        borderLeft: 3,
        borderColor: period.status === 'open' ? 'primary.main' : 'grey.300',
      }}
    >
      <CardContent sx={{ p: { xs: 2, md: 2.5 }, '&:last-child': { pb: 2 } }}>
        {/* Header */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Stack direction="row" alignItems="baseline" spacing={1.5}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {dateLabel}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              CY {period.crop_year}
            </Typography>
          </Stack>
          {period.status === 'open' && (
            <Chip
              label="Open"
              size="small"
              variant="outlined"
              color="primary"
              sx={{ height: 22, fontSize: '0.7rem' }}
            />
          )}
        </Stack>

        {/* KPI Row */}
        <Stack
          direction="row"
          spacing={3}
          divider={<Box sx={{ borderLeft: 1, borderColor: 'divider' }} />}
          sx={{ mb: 2 }}
        >
          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Inventory</Typography>
            <Typography variant="body1" sx={{ fontWeight: 700, color: 'primary.main' }}>
              {fmt(period.total_mt)} <Typography component="span" variant="caption" sx={{ color: 'text.secondary', fontWeight: 400 }}>MT</Typography>
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Delta</Typography>
            <DeltaDisplay delta_mt={period.delta_mt} isFirst={isFirst} />
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Hauled</Typography>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              {period.hauled_mt != null ? fmt(period.hauled_mt) : '—'} <Typography component="span" variant="caption" sx={{ color: 'text.secondary', fontWeight: 400 }}>MT</Typography>
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Bins</Typography>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              {period.occupied_bins}<Typography component="span" sx={{ color: 'text.disabled' }}> / {period.bin_count}</Typography>
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Locations</Typography>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              {period.location_count}
            </Typography>
          </Box>
        </Stack>

        {/* Commodity bar + Location table side by side */}
        <Grid container spacing={2}>
          <Grid item xs={12} md={7}>
            <CommodityBar commodities={period.commodities} total_mt={period.total_mt} />
          </Grid>
          <Grid item xs={12} md={5}>
            <LocationBreakdown locations={period.locations} />
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}

export default function CountHistory() {
  const { currentFarm } = useFarm();
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentFarm) return;
    setLoading(true);
    api
      .get(`/api/farms/${currentFarm.id}/inventory/count-history`)
      .then((res) => {
        setPeriods(res.data.periods || []);
        setError('');
      })
      .catch(() => setError('Failed to load count history'))
      .finally(() => setLoading(false));
  }, [currentFarm]);

  if (loading) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;
  }

  if (periods.length === 0) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>Count History</Typography>
        <Alert severity="info">No count periods found.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>
        Count History
      </Typography>
      <Typography variant="body2" sx={{ mb: 3, color: 'text.secondary' }}>
        Timeline of inventory count periods showing position changes and delivery activity.
      </Typography>

      <Stack spacing={2}>
        {periods.map((period, idx) => (
          <PeriodCard
            key={period.id}
            period={period}
            isFirst={idx === periods.length - 1}
          />
        ))}
      </Stack>
    </Box>
  );
}
