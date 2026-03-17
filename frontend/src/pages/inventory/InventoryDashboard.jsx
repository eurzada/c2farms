import { useState, useEffect } from 'react';
import { Box, Typography, Grid, Card, CardContent, Alert, CircularProgress } from '@mui/material';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';
import InventoryKPICard from '../../components/inventory/InventoryKPICard';
import CropInventoryTable from '../../components/inventory/CropInventoryTable';
import FarmStatusPanel from '../../components/inventory/FarmStatusPanel';
import AlertsPanel from '../../components/inventory/AlertsPanel';
import DrawdownChart from '../../components/inventory/DrawdownChart';
import LocationCommodityMatrix from '../../components/inventory/LocationCommodityMatrix';
import ConversionHealthCard from '../../components/inventory/ConversionHealthCard';
import MonthlyReconSummary from '../../components/inventory/MonthlyReconSummary';
import AvailableToSellTable from '../../components/inventory/AvailableToSellTable';

export default function InventoryDashboard() {
  const { currentFarm, isEnterprise } = useFarm();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentFarm) return;
    setLoading(true);

    // In BU mode, pass the farm name so backend can map to inventory location
    const params = {};
    if (!isEnterprise && currentFarm.name) {
      params.bu_farm_name = currentFarm.name;
    }

    api.get(`/api/farms/${currentFarm.id}/inventory/dashboard`, { params })
      .then(res => { setData(res.data); setError(''); })
      .catch(() => setError('Failed to load dashboard data'))
      .finally(() => setLoading(false));
  }, [currentFarm, isEnterprise]);

  if (loading) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>;
  if (error) return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;
  if (!data) return null;

  const { kpi, cropInventory, farmStatus, alerts, drawdown, locationCommodityMatrix, conversionHealth, monthlyRecon, available_to_sell, latest_period } = data;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3, fontWeight: 600 }}>
        {isEnterprise ? 'Inventory Management' : `${currentFarm.name} Inventory`}
      </Typography>

      {/* Location × Commodity Matrix — top of page, enterprise only */}
      {isEnterprise && locationCommodityMatrix && (
        <Box sx={{ mb: 3 }}>
          <LocationCommodityMatrix data={locationCommodityMatrix} asAtDate={latest_period?.period_date} />
        </Box>
      )}

      {/* KPI Cards — 6 cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={2}>
          <InventoryKPICard label="Total Inventory" value={kpi.total_mt} unit="MT" color="primary.main" />
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <InventoryKPICard label="Committed" value={kpi.committed_mt} unit="MT" color="warning.main" />
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <InventoryKPICard label="Available to Sell" value={kpi.available_mt} unit="MT" color="success.main" />
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <InventoryKPICard label="Hauled This Month" value={kpi.hauled_this_month_mt} unit="MT" color="info.main" />
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <InventoryKPICard label="Settled This Month" value={kpi.settled_this_month_amount} unit="$" color="secondary.main" />
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <InventoryKPICard
            label="Pending Settlements"
            value={kpi.pending_settlements_count}
            unit=""
            color={kpi.pending_settlements_count > 0 ? 'warning.main' : 'text.secondary'}
          />
        </Grid>
      </Grid>

      {/* Alerts */}
      {alerts.length > 0 && <AlertsPanel alerts={alerts} />}

      <Grid container spacing={3}>
        {/* Monthly Reconciliation Summary — enterprise only */}
        {isEnterprise && monthlyRecon && (
          <Grid item xs={12}>
            <MonthlyReconSummary data={monthlyRecon} />
          </Grid>
        )}

        {/* Available-to-Sell Table */}
        {available_to_sell?.length > 0 && (
          <Grid item xs={12}>
            <AvailableToSellTable data={available_to_sell} />
          </Grid>
        )}

        {/* Crop Inventory + Farm Status side by side */}
        <Grid item xs={12} md={7}>
          <CropInventoryTable crops={cropInventory} />
        </Grid>
        <Grid item xs={12} md={5}>
          <FarmStatusPanel statuses={farmStatus} />
          {conversionHealth && (
            <Box sx={{ mt: 3 }}>
              <ConversionHealthCard data={conversionHealth} />
            </Box>
          )}
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
