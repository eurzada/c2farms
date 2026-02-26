import { useState, useEffect, useCallback } from 'react';
import { Typography, Box, Grid, Alert } from '@mui/material';
import MetricCard from '../components/operational/MetricCard';
import { OPERATIONAL_METRICS } from '../utils/operationalMetrics';
import { generateFiscalMonths } from '../utils/fiscalYear';
import { useFarm } from '../contexts/FarmContext';
import api from '../services/api';

export default function OperationalData() {
  const { currentFarm, fiscalYear, canEdit } = useFarm();
  const [data, setData] = useState({}); // { metric_key: { month: { budget_value, actual_value } } }
  const [error, setError] = useState('');
  const [months, setMonths] = useState(generateFiscalMonths('Nov'));

  const fetchData = useCallback(async () => {
    if (!currentFarm?.id || !fiscalYear) return;
    try {
      // Fetch assumption for start_month
      const assRes = await api.get(`/api/farms/${currentFarm.id}/assumptions/${fiscalYear}`);
      const startMonth = assRes.data?.start_month || 'Nov';
      setMonths(generateFiscalMonths(startMonth));

      const res = await api.get(`/api/farms/${currentFarm.id}/operational-data/${fiscalYear}`);
      setData(res.data || {});
      setError('');
    } catch {
      setError('Failed to load operational data');
    }
  }, [currentFarm?.id, fiscalYear]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = useCallback(async (metricKey, month, field, value) => {
    if (!currentFarm?.id || !fiscalYear) return;

    // Optimistic update
    setData(prev => ({
      ...prev,
      [metricKey]: {
        ...prev[metricKey],
        [month]: {
          ...(prev[metricKey]?.[month] || { budget_value: 0, actual_value: 0 }),
          [field]: value,
        },
      },
    }));

    try {
      await api.put(`/api/farms/${currentFarm.id}/operational-data/${fiscalYear}`, [
        { metric: metricKey, month, [field]: value },
      ]);
    } catch {
      setError('Failed to save. Please try again.');
      fetchData(); // Revert on failure
    }
  }, [currentFarm?.id, fiscalYear, fetchData]);

  if (!currentFarm) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">No farm selected.</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Section 4: Operational Data - FY{fiscalYear}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Grid container spacing={3}>
        {OPERATIONAL_METRICS.map(metric => (
          <Grid item xs={12} md={4} key={metric.key}>
            <MetricCard
              metric={metric}
              data={data[metric.key] || {}}
              months={months}
              canEdit={canEdit}
              onSave={handleSave}
            />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
