import { useMemo } from 'react';
import {
  Box, Typography, Grid, Paper, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip as ChartTooltip, Legend } from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import ScoreCard from '../dashboard/ScoreCard';
import { fmt, fmtDollar, fmtDollarK, fmtSigned } from '../../utils/formatting';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ChartTooltip, Legend);

const BU_COLORS = ['#2e7d32', '#1565c0', '#ef6c00', '#6a1b9a', '#c62828', '#00838f', '#4e342e'];

function varianceStatus(v) {
  if (v <= 0) return 'good';
  if (v <= 5) return 'warning';
  return 'bad';
}

/**
 * Executive dashboard tab for enterprise forecast rollup.
 */
export default function EnterpriseForecastDashboard({ data }) {
  const dashboard = data?.dashboard;
  const farms = data?.farms;
  const totalAcres = data?.totalAcres || 0;
  const frozenCount = data?.frozenCount || 0;
  const totalFarms = data?.totalFarms || 0;
  const months = useMemo(() => data?.months || [], [data?.months]);
  const drillDown = data?.drillDown;

  const variancePerAcre = (dashboard?.expensePerAcre || 0) - (dashboard?.budgetPerAcre || 0);

  // Budget vs Forecast bar chart data
  const barData = useMemo(() => ({
    labels: (dashboard?.categoryBreakdown || []).map(c => c.name.replace('LPM - Labour Power Machinery', 'LPM').replace('LBF - Land Building Finance', 'LBF')),
    datasets: [
      {
        label: 'Budget',
        data: (dashboard?.categoryBreakdown || []).map(c => c.budgetTotal),
        backgroundColor: 'rgba(25, 118, 210, 0.7)',
      },
      {
        label: 'Forecast',
        data: (dashboard?.categoryBreakdown || []).map(c => c.forecastTotal),
        backgroundColor: 'rgba(239, 108, 0, 0.7)',
      },
    ],
  }), [dashboard?.categoryBreakdown]);

  const barOptions = useMemo(() => ({
    responsive: true,
    plugins: {
      legend: { position: 'top' },
      tooltip: {
        callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtDollarK(ctx.raw)}` },
      },
    },
    scales: {
      y: {
        ticks: { callback: (v) => fmtDollarK(v) },
      },
    },
  }), []);

  // Monthly expense trend line chart
  const lineData = useMemo(() => {
    const expenseParentCodes = ['inputs', 'lpm', 'lbf', 'insurance'];
    const buSummary = dashboard?.perBuSummary || [];
    const buLines = buSummary.map((bu, i) => {
      const buDrill = drillDown || {};
      const monthlyTotals = months.map(month => {
        let total = 0;
        for (const code of expenseParentCodes) {
          const buEntry = buDrill[code]?.find(d => d.farmId === bu.farmId);
          if (buEntry) total += buEntry.months?.[month] || 0;
        }
        return total;
      });

      return {
        label: bu.name,
        data: monthlyTotals,
        borderColor: BU_COLORS[i % BU_COLORS.length],
        backgroundColor: BU_COLORS[i % BU_COLORS.length],
        borderWidth: 1.5,
        tension: 0.3,
        pointRadius: 2,
      };
    });

    // Consolidated line
    const consolidatedMonthly = months.map((_month, mi) =>
      buLines.reduce((sum, line) => sum + line.data[mi], 0)
    );

    return {
      labels: months,
      datasets: [
        ...buLines,
        {
          label: 'Consolidated',
          data: consolidatedMonthly,
          borderColor: '#000',
          backgroundColor: '#000',
          borderWidth: 3,
          tension: 0.3,
          pointRadius: 3,
          borderDash: [],
        },
      ],
    };
  }, [months, dashboard?.perBuSummary, drillDown]);

  const lineOptions = useMemo(() => ({
    responsive: true,
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12 } },
      tooltip: {
        callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtDollarK(ctx.raw)}` },
      },
    },
    scales: {
      y: { ticks: { callback: (v) => fmtDollarK(v) } },
    },
  }), []);

  // Sort BU summary by variance descending (worst first)
  const sortedBuSummary = useMemo(
    () => [...(dashboard?.perBuSummary || [])].sort((a, b) => b.variance - a.variance),
    [dashboard?.perBuSummary]
  );

  if (!data) return null;

  return (
    <Box>
      {/* KPI Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={2}>
          <ScoreCard
            label="Farm Units"
            value={totalFarms}
            subtext={`${fmt(totalAcres, 0)} total acres`}
            status="neutral"
          />
        </Grid>
        <Grid item xs={6} md={2}>
          <ScoreCard
            label="Total Acres"
            value={`${fmt(totalAcres, 0)}`}
            subtext={`${farms.length} locations`}
            status="neutral"
          />
        </Grid>
        <Grid item xs={6} md={2}>
          <ScoreCard
            label="Budgets Frozen"
            value={`${frozenCount} / ${totalFarms}`}
            subtext={frozenCount === totalFarms ? 'All frozen' : `${totalFarms - frozenCount} still in draft`}
            status={frozenCount === totalFarms ? 'good' : 'warning'}
          />
        </Grid>
        <Grid item xs={6} md={2}>
          <ScoreCard
            label="Expense/Acre"
            value={`${fmtDollar(dashboard.expensePerAcre, 0)}`}
            subtext="Forecast"
            status="neutral"
          />
        </Grid>
        <Grid item xs={6} md={2}>
          <ScoreCard
            label="Budget/Acre"
            value={`${fmtDollar(dashboard.budgetPerAcre, 0)}`}
            subtext={dashboard.anyFrozen ? 'Frozen budget' : 'No frozen budget'}
            status="neutral"
          />
        </Grid>
        <Grid item xs={6} md={2}>
          <ScoreCard
            label="Variance/Acre"
            value={`${fmtSigned(Math.round(variancePerAcre))}/ac`}
            subtext={`${fmtDollarK(dashboard.totalExpenseVariance)} total`}
            status={varianceStatus(variancePerAcre)}
          />
        </Grid>
      </Grid>

      {/* Charts Row */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <Paper elevation={0} sx={{ p: 2, border: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Budget vs Forecast by Category</Typography>
            <Bar data={barData} options={barOptions} />
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper elevation={0} sx={{ p: 2, border: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Monthly Expense Trend</Typography>
            <Line data={lineData} options={lineOptions} />
          </Paper>
        </Grid>
      </Grid>

      {/* Per-BU Summary Table */}
      <Paper elevation={0} sx={{ border: 1, borderColor: 'divider' }}>
        <Box sx={{ p: 2, pb: 1 }}>
          <Typography variant="subtitle1" fontWeight="bold">Farm Unit Comparison</Typography>
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 'bold', bgcolor: 'action.hover' } }}>
                <TableCell>Farm Unit</TableCell>
                <TableCell align="right">Acres</TableCell>
                <TableCell align="right">Expense/Acre</TableCell>
                <TableCell align="right">Budget/Acre</TableCell>
                <TableCell align="right">Variance/Acre</TableCell>
                <TableCell align="center">Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedBuSummary.map((bu) => (
                <TableRow key={bu.farmId} hover>
                  <TableCell>{bu.name}</TableCell>
                  <TableCell align="right">{fmt(bu.acres, 0)}</TableCell>
                  <TableCell align="right">{fmtDollar(bu.expensePerAcre, 0)}</TableCell>
                  <TableCell align="right">{fmtDollar(bu.budgetPerAcre, 0)}</TableCell>
                  <TableCell
                    align="right"
                    sx={{ color: bu.variance > 0 ? 'error.main' : bu.variance < 0 ? 'success.main' : 'text.primary' }}
                  >
                    {fmtSigned(Math.round(bu.variance))}/ac
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      label={bu.isFrozen ? 'Frozen' : 'Draft'}
                      size="small"
                      color={bu.isFrozen ? 'warning' : 'default'}
                      variant="outlined"
                    />
                  </TableCell>
                </TableRow>
              ))}
              <TableRow sx={{ '& td': { fontWeight: 'bold', borderTop: 2, borderColor: 'divider' } }}>
                <TableCell>CONSOLIDATED</TableCell>
                <TableCell align="right">{fmt(totalAcres, 0)}</TableCell>
                <TableCell align="right">{fmtDollar(dashboard.expensePerAcre, 0)}</TableCell>
                <TableCell align="right">{fmtDollar(dashboard.budgetPerAcre, 0)}</TableCell>
                <TableCell
                  align="right"
                  sx={{ color: variancePerAcre > 0 ? 'error.main' : variancePerAcre < 0 ? 'success.main' : 'text.primary' }}
                >
                  {fmtSigned(Math.round(variancePerAcre))}/ac
                </TableCell>
                <TableCell align="center">
                  {frozenCount === totalFarms
                    ? <Chip label="All Frozen" size="small" color="success" />
                    : <Chip label={`${frozenCount}/${totalFarms}`} size="small" variant="outlined" />}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}
