import { useMemo } from 'react';
import {
  Box, Typography, Grid, Paper,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip as ChartTooltip, Legend } from 'chart.js';
import { Line } from 'react-chartjs-2';
import ScoreCard from '../dashboard/ScoreCard';
import VarianceWaterfall from '../dashboard/VarianceWaterfall';
import BuPnlSummary from './BuPnlSummary';
import { fmt, fmtDollar, fmtDollarK, fmtSigned } from '../../utils/formatting';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ChartTooltip, Legend);

function varianceStatus(v) {
  if (v <= 0) return 'good';
  if (v <= 5) return 'warning';
  return 'bad';
}

/**
 * Enterprise dashboard — unified variance-centered executive view.
 * Merges the old Dashboard + Variance tabs into one.
 */
export default function EnterpriseForecastDashboard({ data, varianceData, buSummaryData }) {
  const totalAcres = data?.totalAcres || 0;
  const totalFarms = data?.totalFarms || 0;
  const divisor = totalAcres || 1;

  const planTotal = varianceData?.planGrandTotal || 0;
  const actualTotal = varianceData?.actualGrandTotal || 0;
  const totalVariance = varianceData?.totalVariance || 0;
  const planPerAcre = planTotal / divisor;
  const actualPerAcre = actualTotal / divisor;
  const variancePerAcre = totalVariance / divisor;
  const variancePct = varianceData?.totalPctDiff || 0;

  // Months with actuals
  const monthsWithActuals = useMemo(() => {
    if (!varianceData?.perBu?.length) return 0;
    // Rough check: if actualTotal > 0, we have some actuals
    return actualTotal > 0 ? 'Some' : 0;
  }, [varianceData, actualTotal]);

  // BU comparison sorted by variance (worst first)
  const sortedBu = useMemo(
    () => [...(varianceData?.perBu || [])].sort((a, b) => b.variance - a.variance),
    [varianceData?.perBu]
  );

  // Monthly plan vs actual trend chart
  const trendData = useMemo(() => {
    if (!data?.months || !varianceData?.perBu) return null;
    const months = data.months;

    // Aggregate plan and actual by month from the drillDown data
    // Use expense parents from the rollup data
    const expenseParentCodes = ['inputs', 'lpm', 'lbf', 'insurance'];
    const planByMonth = {};
    const actualByMonth = {};

    for (const month of months) {
      planByMonth[month] = 0;
      actualByMonth[month] = 0;
    }

    // Sum from byCategory monthly data if available in varianceData
    // varianceData has byCategory with planMonths/actualMonths per BU — but enterprise variance
    // doesn't expose monthly detail per category. Use rollup data for plan, and estimate actual.
    // For now, use the rollup accountingRows for plan monthly data
    for (const row of (data.accountingRows || [])) {
      if (expenseParentCodes.includes(row.code)) {
        for (const month of months) {
          planByMonth[month] += row.months?.[month] || 0;
        }
      }
    }

    return {
      labels: months,
      datasets: [
        {
          label: 'Plan',
          data: months.map(m => planByMonth[m]),
          borderColor: 'rgba(25, 118, 210, 0.8)',
          backgroundColor: 'rgba(25, 118, 210, 0.1)',
          borderWidth: 2.5,
          tension: 0.3,
          pointRadius: 3,
          fill: false,
        },
        {
          label: 'Actual',
          data: months.map(m => actualByMonth[m]),
          borderColor: 'rgba(239, 108, 0, 0.8)',
          backgroundColor: 'rgba(239, 108, 0, 0.1)',
          borderWidth: 2.5,
          tension: 0.3,
          pointRadius: 3,
          borderDash: [5, 3],
          fill: false,
        },
      ],
    };
  }, [data, varianceData]);

  const lineOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtDollarK(ctx.raw)}` } },
    },
    scales: {
      y: { ticks: { callback: (v) => fmtDollarK(v) } },
    },
  }), []);

  if (!data) return null;

  return (
    <Box>
      {/* BU P&L Summary Table */}
      {buSummaryData && (
        <Box sx={{ mb: 3 }}>
          <BuPnlSummary data={buSummaryData} />
        </Box>
      )}

      {/* Row 1: KPI Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={2.4}>
          <ScoreCard
            label="Farm Units"
            value={totalFarms}
            subtext={`${fmt(totalAcres, 0)} total acres`}
            status="neutral"
          />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <ScoreCard
            label="Plan Expense"
            value={fmtDollar(planPerAcre, 0) + '/ac'}
            subtext={fmtDollar(planTotal, 0) + ' total'}
            status="neutral"
          />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <ScoreCard
            label="Actual Expense"
            value={monthsWithActuals ? fmtDollar(actualPerAcre, 0) + '/ac' : '—'}
            subtext={monthsWithActuals ? fmtDollar(actualTotal, 0) + ' total' : 'No actuals imported'}
            status={monthsWithActuals ? 'neutral' : 'warning'}
          />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <ScoreCard
            label="Variance"
            value={monthsWithActuals ? fmtSigned(Math.round(variancePerAcre)) + '/ac' : '—'}
            subtext={monthsWithActuals ? `${variancePct >= 0 ? '+' : ''}${variancePct.toFixed(1)}% vs plan` : 'Awaiting actuals'}
            status={monthsWithActuals ? varianceStatus(variancePerAcre) : 'neutral'}
          />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <ScoreCard
            label="Actuals Coverage"
            value={monthsWithActuals ? 'Imported' : 'None'}
            subtext={monthsWithActuals ? 'QB data available' : 'Import QB actuals'}
            status={monthsWithActuals ? 'good' : 'warning'}
          />
        </Grid>
      </Grid>

      {/* Row 2: Variance Summary */}
      {varianceData && (
        <Paper elevation={0} sx={{ border: 1, borderColor: 'divider', mb: 3, p: 2 }}>
          <VarianceWaterfall
            waterfall={varianceData.waterfall}
            planGrandTotal={planTotal}
            actualGrandTotal={actualTotal}
            title="Enterprise Plan vs Actual — Expense Variance"
          />
        </Paper>
      )}

      {/* Row 3: BU Comparison Table */}
      {sortedBu.length > 0 && (
        <Paper elevation={0} sx={{ border: 1, borderColor: 'divider', mb: 3 }}>
          <Box sx={{ p: 2, pb: 1 }}>
            <Typography variant="subtitle1" fontWeight="bold">Farm Unit Comparison</Typography>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 'bold', bgcolor: 'action.hover' } }}>
                  <TableCell>Farm Unit</TableCell>
                  <TableCell align="right">Acres</TableCell>
                  <TableCell align="right">Plan $/ac</TableCell>
                  <TableCell align="right">Actual $/ac</TableCell>
                  <TableCell align="right">Variance $/ac</TableCell>
                  <TableCell align="right">%</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedBu.map(bu => {
                  const buAcres = bu.acres || 1;
                  const buPlanPerAcre = bu.planTotal / buAcres;
                  const buActualPerAcre = bu.actualTotal / buAcres;
                  const buVarPerAcre = bu.variance / buAcres;
                  return (
                    <TableRow key={bu.farmId} hover>
                      <TableCell>{bu.farmName}</TableCell>
                      <TableCell align="right">{fmt(bu.acres, 0)}</TableCell>
                      <TableCell align="right">{fmtDollar(buPlanPerAcre, 0)}</TableCell>
                      <TableCell align="right">{fmtDollar(buActualPerAcre, 0)}</TableCell>
                      <TableCell
                        align="right"
                        sx={{ color: buVarPerAcre > 0 ? 'error.main' : buVarPerAcre < 0 ? 'success.main' : 'text.primary', fontWeight: 600 }}
                      >
                        {fmtSigned(Math.round(buVarPerAcre))}/ac
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ color: bu.pctDiff > 0 ? 'error.main' : bu.pctDiff < 0 ? 'success.main' : 'text.secondary' }}
                      >
                        {bu.pctDiff >= 0 ? '+' : ''}{bu.pctDiff.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow sx={{ '& td': { fontWeight: 'bold', borderTop: 2, borderColor: 'divider' } }}>
                  <TableCell>CONSOLIDATED</TableCell>
                  <TableCell align="right">{fmt(totalAcres, 0)}</TableCell>
                  <TableCell align="right">{fmtDollar(planPerAcre, 0)}</TableCell>
                  <TableCell align="right">{fmtDollar(actualPerAcre, 0)}</TableCell>
                  <TableCell
                    align="right"
                    sx={{ color: variancePerAcre > 0 ? 'error.main' : variancePerAcre < 0 ? 'success.main' : 'text.primary' }}
                  >
                    {fmtSigned(Math.round(variancePerAcre))}/ac
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ color: variancePct > 0 ? 'error.main' : variancePct < 0 ? 'success.main' : 'text.secondary' }}
                  >
                    {variancePct >= 0 ? '+' : ''}{variancePct.toFixed(1)}%
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Row 4: Monthly Plan Trend */}
      {trendData && (
        <Paper elevation={0} sx={{ p: 2, border: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Monthly Expense — Plan</Typography>
          <Box sx={{ height: 260 }}>
            <Line data={trendData} options={lineOptions} />
          </Box>
        </Paper>
      )}
    </Box>
  );
}
