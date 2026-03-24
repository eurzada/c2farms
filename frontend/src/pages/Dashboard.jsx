import { useState, useEffect } from 'react';
import { Typography, Box, Grid, Alert, CircularProgress, Paper } from '@mui/material';
import ScoreCard from '../components/dashboard/ScoreCard';
import VarianceWaterfall from '../components/dashboard/VarianceWaterfall';
import CropSnapshot from '../components/dashboard/CropSnapshot';
import { useFarm } from '../contexts/FarmContext';
import { fmtDollar, fmt, fmtSigned } from '../utils/formatting';
import { extractErrorMessage } from '../utils/errorHelpers';
import api from '../services/api';

function varianceStatus(v) {
  if (v <= 0) return 'good';
  if (v <= 5) return 'warning';
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
    api.get(`/api/farms/${currentFarm.id}/dashboard/v3/${fiscalYear}`)
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

  if (error) return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;
  if (!data) return null;

  const monthsWithActuals = Object.values(data.hasActuals || {}).filter(Boolean).length;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Financial Dashboard — FY{fiscalYear}
      </Typography>

      {/* Row 1: KPI Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={3}>
          <ScoreCard
            label="Total Acres"
            value={`${fmt(data.totalAcres, 0)} ac`}
            subtext={`${data.cropCount} crop${data.cropCount !== 1 ? 's' : ''}${data.agroPlanStatus ? ` — ${data.agroPlanStatus}` : ''}`}
            status="neutral"
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <ScoreCard
            label="Plan Expense/Acre"
            value={fmtDollar(data.planPerAcre, 0)}
            subtext={`${fmtDollar(data.planTotal, 0)} total`}
            status="neutral"
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <ScoreCard
            label="Actual Expense/Acre"
            value={monthsWithActuals > 0 ? fmtDollar(data.actualPerAcre, 0) : '—'}
            subtext={monthsWithActuals > 0 ? `${monthsWithActuals}/12 months imported` : 'No actuals imported'}
            status={monthsWithActuals > 0 ? 'neutral' : 'warning'}
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <ScoreCard
            label="Variance/Acre"
            value={monthsWithActuals > 0 ? `${fmtSigned(data.variancePerAcre)}/ac` : '—'}
            subtext={monthsWithActuals > 0 ? `${data.variancePct >= 0 ? '+' : ''}${data.variancePct?.toFixed(1)}% vs plan` : 'Awaiting actuals'}
            status={monthsWithActuals > 0 ? varianceStatus(data.variancePerAcre) : 'neutral'}
          />
        </Grid>
      </Grid>

      {/* Row 2: Variance Summary */}
      <Paper elevation={0} sx={{ border: 1, borderColor: 'divider', mb: 3 }}>
        <Box sx={{ p: 2 }}>
          <VarianceWaterfall
            waterfall={data.waterfall}
            planGrandTotal={data.planTotal}
            actualGrandTotal={data.actualTotal}
            title="Plan vs Actual — Expense Variance"
          />
        </Box>
      </Paper>

      {/* Row 3: Input Plan + Crop Plan side by side */}
      <Grid container spacing={2}>
        <Grid item xs={12} md={5}>
          <Paper elevation={0} sx={{ p: 2, border: 1, borderColor: 'divider', height: '100%' }}>
            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Input Plan Breakdown</Typography>
            {data.inputBreakdown?.length > 0 ? (
              <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& td, & th': { p: 1, textAlign: 'right', borderBottom: '1px solid', borderColor: 'divider' }, '& td:first-of-type, & th:first-of-type': { textAlign: 'left' } }}>
                <thead>
                  <tr><th>Category</th><th>Total</th><th>$/Acre</th></tr>
                </thead>
                <tbody>
                  {data.inputBreakdown.map(inp => (
                    <tr key={inp.code}>
                      <td>{inp.name}</td>
                      <td>{fmtDollar(inp.planTotal, 0)}</td>
                      <td>{fmtDollar(inp.planPerAcre, 2)}</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 'bold', borderTop: '2px solid' }}>
                    <td>Total Inputs</td>
                    <td>{fmtDollar(data.inputBreakdown.reduce((s, i) => s + i.planTotal, 0), 0)}</td>
                    <td>{fmtDollar(data.inputBreakdown.reduce((s, i) => s + i.planPerAcre, 0), 2)}</td>
                  </tr>
                </tbody>
              </Box>
            ) : (
              <Typography color="text.secondary" variant="body2">No agronomy plan data</Typography>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12} md={7}>
          <CropSnapshot cropPlan={{ crops: data.cropPlan, status: data.agroPlanStatus }} />
        </Grid>
      </Grid>

      {/* Row 4: Labour & Fuel */}
      {(data.labour || data.fuel) && (
        <Grid container spacing={2} sx={{ mt: 1 }}>
          {data.labour && (
            <Grid item xs={12} md={6}>
              <Paper elevation={0} sx={{ p: 2, border: 1, borderColor: 'divider', height: '100%' }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Labour Plan vs Actual</Typography>
                <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& td, & th': { p: 1, textAlign: 'right', borderBottom: '1px solid', borderColor: 'divider' }, '& td:first-of-type, & th:first-of-type': { textAlign: 'left' } }}>
                  <thead>
                    <tr><th>Metric</th><th>Plan</th><th>Actual</th><th>Variance</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Total Cost</td>
                      <td>{fmtDollar(data.labour.planCost, 0)}</td>
                      <td>{data.labour.actualCost > 0 ? fmtDollar(data.labour.actualCost, 0) : '—'}</td>
                      <td style={{ color: data.labour.actualCost > 0 ? (data.labour.actualCost - data.labour.planCost > 0 ? '#d32f2f' : '#2e7d32') : 'inherit', fontWeight: 600 }}>
                        {data.labour.actualCost > 0 ? fmtSigned(Math.round(data.labour.actualCost - data.labour.planCost)) : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td>Cost/Acre</td>
                      <td>{fmtDollar(data.labour.planCostPerAcre, 2)}</td>
                      <td>{data.labour.actualCostPerAcre > 0 ? fmtDollar(data.labour.actualCostPerAcre, 2) : '—'}</td>
                      <td style={{ color: data.labour.actualCostPerAcre > 0 ? (data.labour.actualCostPerAcre - data.labour.planCostPerAcre > 0 ? '#d32f2f' : '#2e7d32') : 'inherit', fontWeight: 600 }}>
                        {data.labour.actualCostPerAcre > 0 ? fmtSigned(Math.round(data.labour.actualCostPerAcre - data.labour.planCostPerAcre)) + '/ac' : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td>Total Hours</td>
                      <td>{fmt(data.labour.totalHours, 0)}</td>
                      <td colSpan={2} style={{ color: '#666' }}>—</td>
                    </tr>
                    <tr>
                      <td>Avg Wage</td>
                      <td>{fmtDollar(data.labour.avgWage, 2)}/hr</td>
                      <td colSpan={2} style={{ color: '#666' }}>—</td>
                    </tr>
                  </tbody>
                </Box>
                {data.labour.seasons?.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>Hours by Season</Typography>
                    <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& td, & th': { p: 0.75, textAlign: 'right', borderBottom: '1px solid', borderColor: 'divider', fontSize: '0.8rem' }, '& td:first-of-type, & th:first-of-type': { textAlign: 'left' } }}>
                      <thead>
                        <tr><th>Season</th><th>Hours</th><th>Labour Cost</th>{data.fuel ? <th>Fuel Cost</th> : null}</tr>
                      </thead>
                      <tbody>
                        {data.labour.seasons.map(s => (
                          <tr key={s.name}>
                            <td>{s.name}</td>
                            <td>{fmt(s.hours, 0)}</td>
                            <td>{fmtDollar(s.cost, 0)}</td>
                            {data.fuel ? <td>{s.fuel_cost ? fmtDollar(s.fuel_cost, 0) : '—'}</td> : null}
                          </tr>
                        ))}
                      </tbody>
                    </Box>
                  </Box>
                )}
              </Paper>
            </Grid>
          )}
          {data.fuel && (
            <Grid item xs={12} md={6}>
              <Paper elevation={0} sx={{ p: 2, border: 1, borderColor: 'divider', height: '100%' }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Fuel Plan vs Actual</Typography>
                <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& td, & th': { p: 1, textAlign: 'right', borderBottom: '1px solid', borderColor: 'divider' }, '& td:first-of-type, & th:first-of-type': { textAlign: 'left' } }}>
                  <thead>
                    <tr><th>Metric</th><th>Plan</th><th>Actual</th><th>Variance</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Total Cost</td>
                      <td>{fmtDollar(data.fuel.planCost, 0)}</td>
                      <td>{data.fuel.actualCost > 0 ? fmtDollar(data.fuel.actualCost, 0) : '—'}</td>
                      <td style={{ color: data.fuel.actualCost > 0 ? (data.fuel.actualCost - data.fuel.planCost > 0 ? '#d32f2f' : '#2e7d32') : 'inherit', fontWeight: 600 }}>
                        {data.fuel.actualCost > 0 ? fmtSigned(Math.round(data.fuel.actualCost - data.fuel.planCost)) : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td>Cost/Acre</td>
                      <td>{fmtDollar(data.fuel.planCostPerAcre, 2)}</td>
                      <td>{data.fuel.actualCostPerAcre > 0 ? fmtDollar(data.fuel.actualCostPerAcre, 2) : '—'}</td>
                      <td style={{ color: data.fuel.actualCostPerAcre > 0 ? (data.fuel.actualCostPerAcre - data.fuel.planCostPerAcre > 0 ? '#d32f2f' : '#2e7d32') : 'inherit', fontWeight: 600 }}>
                        {data.fuel.actualCostPerAcre > 0 ? fmtSigned(Math.round(data.fuel.actualCostPerAcre - data.fuel.planCostPerAcre)) + '/ac' : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td>Total Litres</td>
                      <td>{fmt(data.fuel.totalLitres, 0)} L</td>
                      <td colSpan={2} style={{ color: '#666' }}>—</td>
                    </tr>
                    <tr>
                      <td>Litres/Acre</td>
                      <td>{fmt(data.fuel.litresPerAcre, 1)} L/ac</td>
                      <td colSpan={2} style={{ color: '#666' }}>—</td>
                    </tr>
                    <tr>
                      <td>Cost/Litre</td>
                      <td>{fmtDollar(data.fuel.fuelCostPerLitre, 2)}/L</td>
                      <td colSpan={2} style={{ color: '#666' }}>—</td>
                    </tr>
                  </tbody>
                </Box>
              </Paper>
            </Grid>
          )}
        </Grid>
      )}
    </Box>
  );
}
