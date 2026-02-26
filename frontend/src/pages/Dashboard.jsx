import { useState, useEffect } from 'react';
import { Typography, Box, Grid, Paper, Alert } from '@mui/material';
import KPICard from '../components/dashboard/KPICard';
import CropYieldCard from '../components/dashboard/CropYieldCard';
import BudgetVsForecastChart from '../components/dashboard/BudgetVsForecastChart';
import { useFarm } from '../contexts/FarmContext';
import api from '../services/api';

export default function Dashboard() {
  const { currentFarm, fiscalYear } = useFarm();
  const [kpis, setKpis] = useState([]);
  const [chartData, setChartData] = useState(null);
  const [cropYields, setCropYields] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentFarm?.id || !fiscalYear) return;
    api.get(`/api/farms/${currentFarm.id}/dashboard/${fiscalYear}`)
      .then(res => {
        setKpis(res.data.kpis || []);
        setChartData(res.data.chartData || null);
        setCropYields(res.data.cropYields || []);
      })
      .catch(() => setError('Failed to load dashboard data'));
  }, [currentFarm?.id, fiscalYear]);

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
        Section 5: KPI Dashboard - FY{fiscalYear}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {kpis.map((kpi, i) => (
          <Grid item xs={12} sm={6} md={4} lg={2} key={i}>
            <KPICard kpi={kpi} />
          </Grid>
        ))}
      </Grid>

      {cropYields.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Crop Yields vs Target</Typography>
          <Grid container spacing={2}>
            {cropYields.map((crop, i) => (
              <Grid item xs={12} sm={6} md={4} key={i}>
                <CropYieldCard crop={crop} />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      <Paper sx={{ p: 3 }}>
        <BudgetVsForecastChart chartData={chartData} />
      </Paper>
    </Box>
  );
}
