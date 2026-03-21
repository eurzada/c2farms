import { useState, useEffect } from 'react';
import { Typography, Box, Grid, Alert, CircularProgress } from '@mui/material';
import ScoreCard from '../components/dashboard/ScoreCard';
import BudgetAdherence from '../components/dashboard/BudgetAdherence';
import CropSnapshot from '../components/dashboard/CropSnapshot';
import { useFarm } from '../contexts/FarmContext';
import { fmtDollar, fmt } from '../utils/formatting';
import { extractErrorMessage } from '../utils/errorHelpers';
import api from '../services/api';

function countStatusLabel(status, daysAgo) {
  if (!status) return { value: 'No Data', subtext: 'No count submissions', status: 'neutral' };
  const sub = `Last count: ${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`;
  if (status === 'current') return { value: 'Current', subtext: sub, status: 'good' };
  if (status === 'warning') return { value: 'Aging', subtext: sub, status: 'warning' };
  return { value: 'Overdue', subtext: sub, status: 'bad' };
}

function adherenceStatus(pct) {
  if (pct === null) return 'neutral';
  if (pct >= 95) return 'good';
  if (pct >= 85) return 'warning';
  return 'bad';
}

function costControlStatus(actual, budget) {
  if (!budget) return 'neutral';
  const diff = actual - budget;
  if (diff <= 0) return 'good';
  if (diff <= 5) return 'warning';
  return 'bad';
}

export default function Dashboard() {
  const { currentFarm, fiscalYear } = useFarm();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentFarm?.id || !fiscalYear) return;
    setLoading(true);
    setError('');
    api.get(`/api/farms/${currentFarm.id}/dashboard/v2/${fiscalYear}`)
      .then(res => setData(res.data))
      .catch(err => setError(extractErrorMessage(err, 'Failed to load dashboard')))
      .finally(() => setLoading(false));
  }, [currentFarm?.id, fiscalYear]);

  if (!currentFarm) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">No farm selected.</Typography>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;
  }

  if (!data) return null;

  const { scorecard, expenses, cropPlan } = data;

  const countInfo = countStatusLabel(scorecard.count_status, scorecard.last_count_days_ago);

  const inputAdherenceValue = scorecard.input_adherence_pct !== null
    ? `${scorecard.input_adherence_pct}%`
    : '—';
  const inputSubtext = scorecard.input_adherence_pct !== null
    ? `${fmtDollar(scorecard.input_actual_per_acre, 0)}/ac of ${fmtDollar(scorecard.input_budget_per_acre, 0)}/ac plan`
    : 'No agro plan';

  const costDiff = scorecard.controllable_per_acre - scorecard.controllable_budget_per_acre;
  const costSubtext = scorecard.controllable_budget_per_acre
    ? `vs Budget: ${costDiff <= 0 ? '' : '+'}$${Math.abs(costDiff)}/ac ${costDiff <= 0 ? '✓' : '⚠'}`
    : 'No frozen budget';

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Farm Scorecard — FY{fiscalYear}
      </Typography>

      {/* Section 1: Scorecard Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={3}>
          <ScoreCard
            label="Total Acres"
            value={`${fmt(scorecard.total_acres, 0)} ac`}
            subtext={`${scorecard.crop_count} crop${scorecard.crop_count !== 1 ? 's' : ''}${scorecard.agro_plan_status ? ` — Plan: ${scorecard.agro_plan_status.charAt(0).toUpperCase() + scorecard.agro_plan_status.slice(1)}` : ''}`}
            status="neutral"
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <ScoreCard
            label="Input Adherence"
            value={inputAdherenceValue}
            subtext={inputSubtext}
            status={adherenceStatus(scorecard.input_adherence_pct)}
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <ScoreCard
            label="Cost Control"
            value={`${fmtDollar(scorecard.controllable_per_acre, 0)}/ac`}
            subtext={costSubtext}
            status={costControlStatus(scorecard.controllable_per_acre, scorecard.controllable_budget_per_acre)}
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <ScoreCard
            label="Inventory Freshness"
            value={countInfo.value}
            subtext={countInfo.subtext}
            status={countInfo.status}
          />
        </Grid>
      </Grid>

      {/* Section 2: Budget Adherence */}
      <Box sx={{ mb: 3 }}>
        <BudgetAdherence expenses={expenses} />
      </Box>

      {/* Section 3: Crop Plan Snapshot */}
      <CropSnapshot cropPlan={cropPlan} />
    </Box>
  );
}
