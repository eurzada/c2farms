import { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, Alert, Chip, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';

function fmt(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function fmtDec(n) { return (n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function EnterpriseAgronomy() {
  const { farmUnits, fiscalYear } = useFarm();
  const [farmData, setFarmData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!farmUnits?.length) return;
    setLoading(true);

    const year = fiscalYear;
    Promise.all(
      farmUnits.map(farm =>
        api.get(`/api/farms/${farm.id}/agronomy/dashboard?year=${year}`)
          .then(res => ({ farm, data: res.data }))
          .catch(() => ({ farm, data: null }))
      )
    ).then(results => {
      setFarmData(results);
    }).finally(() => setLoading(false));
  }, [farmUnits, fiscalYear]);

  if (loading) return <Typography>Loading...</Typography>;

  const farmsWithPlans = farmData.filter(r => r.data?.farm);
  const farmsWithoutPlans = farmData.filter(r => !r.data?.farm);

  // Aggregate by crop across all farms
  const cropTotals = {};
  for (const { data } of farmsWithPlans) {
    for (const c of (data.crops || [])) {
      if (!cropTotals[c.crop]) {
        cropTotals[c.crop] = { crop: c.crop, acres: 0, total_cost: 0, revenue: 0, margin: 0, farm_count: 0 };
      }
      cropTotals[c.crop].acres += c.acres || 0;
      cropTotals[c.crop].total_cost += c.total_cost || 0;
      cropTotals[c.crop].revenue += c.revenue || 0;
      cropTotals[c.crop].margin += c.margin || 0;
      cropTotals[c.crop].farm_count += 1;
    }
  }
  const cropList = Object.values(cropTotals).sort((a, b) => b.acres - a.acres);

  const totals = {
    farms: farmsWithPlans.length,
    acres: farmsWithPlans.reduce((s, r) => s + (r.data.farm.acres || 0), 0),
    total_cost: farmsWithPlans.reduce((s, r) => s + (r.data.farm.total_cost || 0), 0),
    revenue: farmsWithPlans.reduce((s, r) => s + (r.data.farm.revenue || 0), 0),
    margin: farmsWithPlans.reduce((s, r) => s + (r.data.farm.margin || 0), 0),
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Typography variant="h5" fontWeight="bold">Enterprise Agronomy</Typography>
        <Chip icon={<VisibilityIcon />} label="Read-Only" size="small" variant="outlined" />
        <Chip label={`Crop Year ${fiscalYear}`} size="small" />
      </Box>

      <Alert severity="info" variant="outlined" sx={{ mb: 3 }}>
        Consolidated agronomy data across all farm units. To edit crop plans, switch to an individual farm unit.
      </Alert>

      {farmsWithPlans.length === 0 ? (
        <Alert severity="warning">
          No agronomy plans found for crop year {fiscalYear}. Create plans on individual farm units first.
        </Alert>
      ) : (
        <>
          {/* KPI Cards */}
          <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
            <Paper sx={{ p: 2, textAlign: 'center', flex: 1 }}>
              <Typography variant="body2" color="text.secondary">Farm Units</Typography>
              <Typography variant="h4" fontWeight="bold">{totals.farms}</Typography>
            </Paper>
            <Paper sx={{ p: 2, textAlign: 'center', flex: 1 }}>
              <Typography variant="body2" color="text.secondary">Total Acres</Typography>
              <Typography variant="h4" fontWeight="bold">{fmt(totals.acres)}</Typography>
            </Paper>
            <Paper sx={{ p: 2, textAlign: 'center', flex: 1 }}>
              <Typography variant="body2" color="text.secondary">Total Input Budget</Typography>
              <Typography variant="h4" fontWeight="bold">${fmt(totals.total_cost)}</Typography>
            </Paper>
            <Paper sx={{ p: 2, textAlign: 'center', flex: 1 }}>
              <Typography variant="body2" color="text.secondary">Projected Revenue</Typography>
              <Typography variant="h4" fontWeight="bold">${fmt(totals.revenue)}</Typography>
            </Paper>
          </Stack>

          {/* Crop Totals Across All Farms */}
          <Typography variant="h6" sx={{ mb: 1 }}>Crops Across All Locations</Typography>
          <TableContainer component={Paper} sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 'bold', bgcolor: 'grey.100' } }}>
                  <TableCell>Crop</TableCell>
                  <TableCell align="right">Locations</TableCell>
                  <TableCell align="right">Total Acres</TableCell>
                  <TableCell align="right">Input Budget</TableCell>
                  <TableCell align="right">Revenue</TableCell>
                  <TableCell align="right">Margin</TableCell>
                  <TableCell align="right">$/Acre</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {cropList.map(c => (
                  <TableRow key={c.crop} hover>
                    <TableCell>{c.crop}</TableCell>
                    <TableCell align="right">{c.farm_count}</TableCell>
                    <TableCell align="right">{fmt(c.acres)}</TableCell>
                    <TableCell align="right">${fmt(c.total_cost)}</TableCell>
                    <TableCell align="right">${fmt(c.revenue)}</TableCell>
                    <TableCell align="right" sx={{ color: c.margin >= 0 ? 'success.main' : 'error.main' }}>
                      ${fmt(c.margin)}
                    </TableCell>
                    <TableCell align="right">{c.acres ? fmtDec(c.total_cost / c.acres) : '—'}</TableCell>
                  </TableRow>
                ))}
                <TableRow sx={{ '& td': { fontWeight: 'bold', borderTop: 2, borderColor: 'divider' } }}>
                  <TableCell>TOTAL</TableCell>
                  <TableCell align="right">{totals.farms}</TableCell>
                  <TableCell align="right">{fmt(totals.acres)}</TableCell>
                  <TableCell align="right">${fmt(totals.total_cost)}</TableCell>
                  <TableCell align="right">${fmt(totals.revenue)}</TableCell>
                  <TableCell align="right" sx={{ color: totals.margin >= 0 ? 'success.main' : 'error.main' }}>
                    ${fmt(totals.margin)}
                  </TableCell>
                  <TableCell align="right">{totals.acres ? fmtDec(totals.total_cost / totals.acres) : '—'}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          {/* Per-Farm Breakdown */}
          <Typography variant="h6" sx={{ mb: 1 }}>Per Farm Unit</Typography>
          <TableContainer component={Paper} sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 'bold', bgcolor: 'grey.100' } }}>
                  <TableCell>Farm Unit</TableCell>
                  <TableCell align="right">Crops</TableCell>
                  <TableCell align="right">Acres</TableCell>
                  <TableCell align="right">Input Budget</TableCell>
                  <TableCell align="right">$/Acre</TableCell>
                  <TableCell align="right">Revenue</TableCell>
                  <TableCell align="right">Margin</TableCell>
                  <TableCell align="center">Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {farmsWithPlans.map(({ farm, data }) => (
                  <TableRow key={farm.id} hover>
                    <TableCell>{farm.name}</TableCell>
                    <TableCell align="right">{data.crops?.length || 0}</TableCell>
                    <TableCell align="right">{fmt(data.farm.acres)}</TableCell>
                    <TableCell align="right">${fmt(data.farm.total_cost)}</TableCell>
                    <TableCell align="right">{fmtDec(data.farm.cost_per_acre)}</TableCell>
                    <TableCell align="right">${fmt(data.farm.revenue)}</TableCell>
                    <TableCell align="right" sx={{ color: data.farm.margin >= 0 ? 'success.main' : 'error.main' }}>
                      ${fmt(data.farm.margin)}
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        label={data.plan_status?.toUpperCase() || 'DRAFT'}
                        size="small"
                        color={data.plan_status === 'approved' ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {farmsWithoutPlans.length > 0 && (
            <Alert severity="warning" variant="outlined">
              {farmsWithoutPlans.length} farm unit(s) have no agronomy plan for {fiscalYear}:{' '}
              {farmsWithoutPlans.map(r => r.farm.name).join(', ')}
            </Alert>
          )}
        </>
      )}
    </Box>
  );
}
