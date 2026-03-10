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
  LinearProgress,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import RemoveIcon from '@mui/icons-material/Remove';
import WarehouseIcon from '@mui/icons-material/Warehouse';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import GrainIcon from '@mui/icons-material/Grain';
import PlaceIcon from '@mui/icons-material/Place';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';

const fmt = (v) => v != null ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—';

function DeltaDisplay({ delta_mt, isFirst }) {
  if (isFirst || delta_mt == null) {
    return (
      <Chip
        label="Baseline"
        size="small"
        variant="outlined"
        sx={{ fontWeight: 600, color: 'text.secondary' }}
      />
    );
  }

  const isPositive = delta_mt >= 0;
  const color = isPositive ? 'success.main' : 'error.main';
  const Icon = delta_mt > 0 ? ArrowUpwardIcon : delta_mt < 0 ? ArrowDownwardIcon : RemoveIcon;

  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <Icon sx={{ fontSize: 18, color }} />
      <Typography variant="h6" sx={{ fontWeight: 700, color }}>
        {delta_mt > 0 ? '+' : ''}{fmt(delta_mt)}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>MT</Typography>
    </Stack>
  );
}

function KpiItem({ icon, label, value, unit = 'MT', color = 'text.primary' }) {
  return (
    <Stack alignItems="center" spacing={0.5} sx={{ minWidth: 100 }}>
      {icon}
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 700, color }}>
        {value}
      </Typography>
      {unit && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {unit}
        </Typography>
      )}
    </Stack>
  );
}

function CommodityBreakdown({ commodities, total_mt }) {
  if (!commodities || commodities.length === 0) return null;

  const colors = [
    '#1976d2', '#2e7d32', '#ed6c02', '#9c27b0', '#d32f2f',
    '#0288d1', '#558b2f', '#f57c00', '#7b1fa2', '#c62828',
    '#00838f', '#33691e',
  ];

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, color: 'text.secondary' }}>
        Commodity Breakdown
      </Typography>
      <Stack spacing={1}>
        {commodities.map((c, i) => {
          const share = total_mt > 0 ? (c.mt / total_mt) * 100 : 0;
          return (
            <Box key={c.name}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.25 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      bgcolor: colors[i % colors.length],
                    }}
                  />
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {c.name}
                  </Typography>
                </Stack>
                <Stack direction="row" alignItems="center" spacing={1.5}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {fmt(c.mt)} MT
                  </Typography>
                  <Chip
                    label={`${share.toFixed(1)}%`}
                    size="small"
                    sx={{
                      fontSize: '0.7rem',
                      height: 20,
                      bgcolor: colors[i % colors.length],
                      color: '#fff',
                      fontWeight: 600,
                    }}
                  />
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {c.bins} bin{c.bins !== 1 ? 's' : ''}
                  </Typography>
                </Stack>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={share}
                sx={{
                  height: 6,
                  borderRadius: 3,
                  bgcolor: 'grey.200',
                  '& .MuiLinearProgress-bar': {
                    bgcolor: colors[i % colors.length],
                    borderRadius: 3,
                  },
                }}
              />
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}

function LocationBreakdown({ locations }) {
  if (!locations || locations.length === 0) return null;

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, color: 'text.secondary' }}>
        By Location
      </Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, py: 0.5 }}>Location</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, py: 0.5 }}>MT</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, py: 0.5 }}>Bins</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {locations.map((loc) => (
              <TableRow key={loc.name} sx={{ '&:last-child td': { borderBottom: 0 } }}>
                <TableCell sx={{ py: 0.5 }}>{loc.name}</TableCell>
                <TableCell align="right" sx={{ py: 0.5, fontWeight: 500 }}>
                  {fmt(loc.mt)}
                </TableCell>
                <TableCell align="right" sx={{ py: 0.5 }}>{loc.bins}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

function PeriodCard({ period, isFirst }) {
  const periodDate = new Date(period.period_date);
  const dateLabel = periodDate.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <Card
      elevation={2}
      sx={{
        borderLeft: 4,
        borderColor: period.status === 'open' ? 'success.main' : 'grey.400',
        '&:hover': { boxShadow: 6 },
        transition: 'box-shadow 0.2s',
      }}
    >
      <CardContent sx={{ p: 3 }}>
        {/* Header */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2.5 }}>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Typography variant="h6" sx={{ fontWeight: 700, color: '#1565c0' }}>
              {dateLabel}
            </Typography>
            <Chip
              label={`Crop Year ${period.crop_year}`}
              size="small"
              variant="outlined"
              sx={{ fontWeight: 600 }}
            />
          </Stack>
          <Chip
            label={period.status === 'open' ? 'Open' : 'Closed'}
            size="small"
            sx={{
              fontWeight: 600,
              bgcolor: period.status === 'open' ? 'success.light' : 'grey.300',
              color: period.status === 'open' ? 'success.dark' : 'text.secondary',
            }}
          />
        </Stack>

        {/* KPI Row */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-around',
            flexWrap: 'wrap',
            gap: 2,
            mb: 3,
            p: 2,
            bgcolor: 'grey.50',
            borderRadius: 2,
          }}
        >
          <KpiItem
            icon={<WarehouseIcon sx={{ color: '#1565c0', fontSize: 22 }} />}
            label="Total Inventory"
            value={fmt(period.total_mt)}
            color="#1565c0"
          />
          <Box sx={{ borderLeft: 1, borderColor: 'divider' }} />
          <Stack alignItems="center" spacing={0.5} sx={{ minWidth: 100 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
              Delta
            </Typography>
            <DeltaDisplay delta_mt={period.delta_mt} isFirst={isFirst} />
          </Stack>
          <Box sx={{ borderLeft: 1, borderColor: 'divider' }} />
          <KpiItem
            icon={<LocalShippingIcon sx={{ color: '#ed6c02', fontSize: 22 }} />}
            label="Hauled"
            value={period.hauled_mt != null ? fmt(period.hauled_mt) : '—'}
            color="#ed6c02"
          />
          <Box sx={{ borderLeft: 1, borderColor: 'divider' }} />
          <KpiItem
            icon={<GrainIcon sx={{ color: '#2e7d32', fontSize: 22 }} />}
            label="Bins"
            value={`${period.occupied_bins} / ${period.bin_count}`}
            unit=""
          />
          <Box sx={{ borderLeft: 1, borderColor: 'divider' }} />
          <KpiItem
            icon={<PlaceIcon sx={{ color: '#9c27b0', fontSize: 22 }} />}
            label="Locations"
            value={period.location_count}
            unit=""
          />
        </Box>

        {/* Breakdowns */}
        <Grid container spacing={3}>
          <Grid item xs={12} md={7}>
            <CommodityBreakdown
              commodities={period.commodities}
              total_mt={period.total_mt}
            />
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
      <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700, color: '#1565c0' }}>
        Count History
      </Typography>
      <Typography variant="body2" sx={{ mb: 3, color: 'text.secondary' }}>
        Timeline of inventory count periods showing position changes and delivery activity.
      </Typography>

      <Stack spacing={3}>
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
