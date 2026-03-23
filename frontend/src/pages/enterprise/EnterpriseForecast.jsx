import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Alert, Chip, Tabs, Tab, CircularProgress,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DashboardIcon from '@mui/icons-material/Dashboard';
import TableChartIcon from '@mui/icons-material/TableChart';
import PercentIcon from '@mui/icons-material/Percent';
import TabPanel from '../../components/shared/TabPanel';
import EnterpriseForecastGrid from '../../components/enterprise/EnterpriseForecastGrid';
import EnterpriseForecastDashboard from '../../components/enterprise/EnterpriseForecastDashboard';
import BuDrillDown from '../../components/enterprise/BuDrillDown';
import { useFarm } from '../../contexts/FarmContext';
import { extractErrorMessage } from '../../utils/errorHelpers';
import api from '../../services/api';

export default function EnterpriseForecast() {
  const { fiscalYear } = useFarm();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(0);

  // Drill-down state
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillCategory, setDrillCategory] = useState(null);
  const [drillMode, setDrillMode] = useState('accounting');

  useEffect(() => {
    if (!fiscalYear) return;
    setLoading(true);
    setError('');
    api.get(`/api/enterprise/forecast-rollup/${fiscalYear}`)
      .then(res => setData(res.data))
      .catch(err => setError(extractErrorMessage(err, 'Failed to load consolidated forecast')))
      .finally(() => setLoading(false));
  }, [fiscalYear]);

  const handleRowClick = useCallback((mode) => (rowData) => {
    if (!rowData || !data?.drillDown?.[rowData.code]) return;
    setDrillCategory(rowData);
    setDrillMode(mode);
    setDrillOpen(true);
  }, [data]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography variant="h5" fontWeight="bold">Enterprise Forecast</Typography>
        <Chip icon={<VisibilityIcon />} label="Read-Only" size="small" variant="outlined" />
        <Chip label={`FY ${fiscalYear}`} size="small" />
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
        Consolidated view across all farm units. To edit forecast data, switch to an individual farm unit.
      </Alert>

      {!data || data.totalFarms === 0 ? (
        <Alert severity="warning">
          No forecast data found for FY {fiscalYear}. Set up forecast assumptions on individual farm units first.
        </Alert>
      ) : (
        <>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab icon={<DashboardIcon />} iconPosition="start" label="Dashboard" />
              <Tab icon={<TableChartIcon />} iconPosition="start" label="Cost Forecast" />
              <Tab icon={<PercentIcon />} iconPosition="start" label="Per-Unit ($/acre)" />
            </Tabs>
          </Box>

          <TabPanel value={tab} index={0}>
            <EnterpriseForecastDashboard data={data} />
          </TabPanel>

          <TabPanel value={tab} index={1}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              Total $ — Sum of all {data.totalFarms} farm units ({data.totalAcres?.toLocaleString('en-CA')} acres)
            </Typography>
            <EnterpriseForecastGrid
              rows={data.accountingRows}
              months={data.months}
              mode="accounting"
              onRowClick={handleRowClick('accounting')}
            />
          </TabPanel>

          <TabPanel value={tab} index={2}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              $/acre — Weighted average across all farm units
            </Typography>
            <EnterpriseForecastGrid
              rows={data.perUnitRows}
              months={data.months}
              mode="per-unit"
              onRowClick={handleRowClick('per-unit')}
            />
          </TabPanel>

          {/* Drill-down dialog */}
          <BuDrillDown
            open={drillOpen}
            onClose={() => setDrillOpen(false)}
            categoryName={drillCategory?.display_name || ''}
            buData={drillCategory ? data.drillDown[drillCategory.code] : null}
            mode={drillMode}
            totalAcres={data.totalAcres}
          />
        </>
      )}
    </Box>
  );
}
