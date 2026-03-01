import { useState, useEffect } from 'react';
import { Box, Typography, Grid, Card, CardContent, Alert, CircularProgress } from '@mui/material';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';
import InventoryKPICard from '../../components/inventory/InventoryKPICard';
import CropInventoryTable from '../../components/inventory/CropInventoryTable';
import FarmStatusPanel from '../../components/inventory/FarmStatusPanel';
import AlertsPanel from '../../components/inventory/AlertsPanel';
import DrawdownChart from '../../components/inventory/DrawdownChart';

export default function InventoryDashboard() {
  const { currentFarm } = useFarm();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentFarm) return;
    setLoading(true);
    api.get(`/api/farms/${currentFarm.id}/inventory/dashboard`)
      .then(res => { setData(res.data); setError(''); })
      .catch(() => setError('Failed to load dashboard data'))
      .finally(() => setLoading(false));
  }, [currentFarm]);

  if (loading) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>;
  if (error) return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;
  if (!data) return null;

  const { kpi, cropInventory, farmStatus, alerts, drawdown } = data;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3, fontWeight: 600 }}>Grain Control Centre</Typography>

      {/* KPI Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <InventoryKPICard label="Total Inventory" value={kpi.total_mt} unit="MT" color="primary.main" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <InventoryKPICard label="Committed" value={kpi.committed_mt} unit="MT" color="warning.main" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <InventoryKPICard label="Available" value={kpi.available_mt} unit="MT" color="success.main" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <InventoryKPICard label="Active Contracts" value={kpi.active_contracts} unit="" color="info.main" />
        </Grid>
      </Grid>

      {/* Alerts */}
      {alerts.length > 0 && <AlertsPanel alerts={alerts} />}

      <Grid container spacing={3}>
        {/* Crop Inventory Table */}
        <Grid item xs={12} md={7}>
          <CropInventoryTable crops={cropInventory} />
        </Grid>

        {/* Farm Status Panel */}
        <Grid item xs={12} md={5}>
          <FarmStatusPanel statuses={farmStatus} />
        </Grid>

        {/* Drawdown Chart */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Monthly Inventory Drawdown</Typography>
              <DrawdownChart data={drawdown} />
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
