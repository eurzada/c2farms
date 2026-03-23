import { useState, useEffect, useMemo } from 'react';
import {
  Box, Typography, Paper, Stack, Alert, Collapse,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';

/* ── formatting helpers ──────────────────────────────────────────────── */

function fmt(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function fmtDol(n) { return '$' + fmt(n); }

const TH = { fontWeight: 'bold', bgcolor: 'action.hover', whiteSpace: 'nowrap', fontSize: '0.78rem', py: 0.75, px: 1 };
const TD = { fontSize: '0.8rem', py: 0.5, px: 1 };

function shortName(name) { return (name || '').replace(/^C2\s*/i, ''); }

const CATEGORY_LABELS = { seed: 'Seed', fertilizer: 'Fertilizer', chemical: 'Chemistry' };

/* ── delta color helper ──────────────────────────────────────────────── */

function deltaColor(planned, booked) {
  const delta = booked - planned;
  if (planned === 0 && booked === 0) return 'text.disabled';
  if (delta >= 0) return 'success.main';
  if (delta > -0.10 * planned) return 'warning.main';
  return 'error.main';
}

function deltaBg(planned, booked) {
  const delta = booked - planned;
  if (planned === 0 && booked === 0) return undefined;
  if (delta >= 0) return 'rgba(46, 125, 50, 0.06)';
  if (delta > -0.10 * planned) return 'rgba(237, 108, 2, 0.06)';
  return 'rgba(211, 47, 47, 0.06)';
}

function coveragePct(planned, booked) {
  if (!planned) return booked > 0 ? '∞' : '—';
  return `${Math.round((booked / planned) * 100)}%`;
}

/* ── KPI card ────────────────────────────────────────────────────────── */

function KpiCard({ label, value, sub, color }) {
  return (
    <Paper sx={{ p: 2, textAlign: 'center', flex: 1 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="h6" fontWeight="bold" color={color}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

/* ── Category Detail (collapsible product table) ─────────────────────── */

function CategoryDetail({ category, products, farms }) {
  const [open, setOpen] = useState(false);
  const catProducts = useMemo(
    () => products.filter(p => p.category === category),
    [products, category]
  );

  if (catProducts.length === 0) return null;

  return (
    <Box sx={{ mb: 2 }}>
      <Box
        sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', mb: 0.5 }}
        onClick={() => setOpen(o => !o)}
      >
        <IconButton size="small">
          {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
        <Typography variant="subtitle2" fontWeight="bold">
          {CATEGORY_LABELS[category] || category} — {catProducts.length} product{catProducts.length !== 1 ? 's' : ''}
        </Typography>
      </Box>

      <Collapse in={open}>
        <TableContainer component={Paper} variant="outlined" sx={{ mb: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': TH }}>
                <TableCell>Product</TableCell>
                {farms.map(f => (
                  <TableCell key={f.id} align="right" colSpan={2}>{shortName(f.name)}</TableCell>
                ))}
                <TableCell align="right" colSpan={2} sx={{ borderLeft: 1, borderColor: 'divider' }}>Total</TableCell>
              </TableRow>
              <TableRow sx={{ '& th': { ...TH, fontSize: '0.7rem', py: 0.25 } }}>
                <TableCell />
                {farms.map(f => [
                  <TableCell key={`${f.id}-p`} align="right">Plan</TableCell>,
                  <TableCell key={`${f.id}-b`} align="right">Booked</TableCell>,
                ])}
                <TableCell align="right" sx={{ borderLeft: 1, borderColor: 'divider' }}>Plan</TableCell>
                <TableCell align="right">Booked</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {catProducts.map(p => (
                <TableRow key={p.name} hover>
                  <TableCell sx={{ ...TD, fontWeight: 500, whiteSpace: 'nowrap' }}>{p.name}</TableCell>
                  {farms.map(f => {
                    const d = p.byFarm[f.id];
                    const planned = d?.planned || 0;
                    const booked = d?.booked || 0;
                    return [
                      <TableCell key={`${f.id}-p`} align="right" sx={{ ...TD, color: planned > 0 ? 'text.primary' : 'text.disabled' }}>
                        {planned > 0 ? fmtDol(planned) : '—'}
                      </TableCell>,
                      <TableCell key={`${f.id}-b`} align="right" sx={{ ...TD, color: booked > 0 ? deltaColor(planned, booked) : 'text.disabled' }}>
                        {booked > 0 ? fmtDol(booked) : '—'}
                      </TableCell>,
                    ];
                  })}
                  <TableCell align="right" sx={{ ...TD, borderLeft: 1, borderColor: 'divider' }}>{fmtDol(p.totalPlanned)}</TableCell>
                  <TableCell align="right" sx={{ ...TD, fontWeight: 'bold', color: deltaColor(p.totalPlanned, p.totalBooked) }}>
                    {fmtDol(p.totalBooked)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Collapse>
    </Box>
  );
}

/* ── main component ──────────────────────────────────────────────────── */

export default function PlanVsBooked({ year }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get(`/api/agronomy/plan-vs-booked?year=${year}`)
      .then(res => setData(res.data))
      .catch(err => setError(extractErrorMessage(err, 'Failed to load plan vs booked data')))
      .finally(() => setLoading(false));
  }, [year]);

  if (loading) return <Typography>Loading...</Typography>;
  if (error) return <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>;
  if (!data || !data.farms?.length) {
    return <Alert severity="warning">No data available for crop year {year}.</Alert>;
  }

  const { farms, categories, products, grandTotalPlanned, grandTotalBooked } = data;
  const grandDelta = grandTotalBooked - grandTotalPlanned;

  return (
    <Box>
      {/* KPI Cards */}
      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <KpiCard label="Total Planned" value={fmtDol(grandTotalPlanned)} />
        <KpiCard label="Total Booked" value={fmtDol(grandTotalBooked)} />
        <KpiCard
          label="Delta"
          value={(grandDelta >= 0 ? '+' : '') + fmtDol(grandDelta)}
          color={deltaColor(grandTotalPlanned, grandTotalBooked)}
        />
        <KpiCard
          label="Coverage"
          value={coveragePct(grandTotalPlanned, grandTotalBooked)}
          sub={grandTotalPlanned > 0 ? `${fmtDol(Math.abs(grandDelta))} ${grandDelta >= 0 ? 'over' : 'under'}` : ''}
          color={deltaColor(grandTotalPlanned, grandTotalBooked)}
        />
      </Stack>

      {/* Category Summary Table */}
      <Typography variant="h6" fontWeight="bold" sx={{ mb: 1 }}>Coverage by Category & Location</Typography>
      <TableContainer component={Paper} sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': TH }}>
              <TableCell>Category</TableCell>
              {farms.map(f => (
                <TableCell key={f.id} align="center" colSpan={3}>{shortName(f.name)}</TableCell>
              ))}
              <TableCell align="center" colSpan={3} sx={{ borderLeft: 1, borderColor: 'divider' }}>Total</TableCell>
            </TableRow>
            <TableRow sx={{ '& th': { ...TH, fontSize: '0.7rem', py: 0.25 } }}>
              <TableCell />
              {farms.map(f => [
                <TableCell key={`${f.id}-p`} align="right">Plan</TableCell>,
                <TableCell key={`${f.id}-b`} align="right">Booked</TableCell>,
                <TableCell key={`${f.id}-d`} align="right">Delta</TableCell>,
              ])}
              <TableCell align="right" sx={{ borderLeft: 1, borderColor: 'divider' }}>Plan</TableCell>
              <TableCell align="right">Booked</TableCell>
              <TableCell align="right">Delta</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {categories.map(cat => (
              <TableRow key={cat.category} hover>
                <TableCell sx={{ ...TD, fontWeight: 'bold' }}>{CATEGORY_LABELS[cat.category]}</TableCell>
                {farms.map(f => {
                  const d = cat.byFarm[f.id] || { planned: 0, booked: 0 };
                  const delta = d.booked - d.planned;
                  return [
                    <TableCell key={`${f.id}-p`} align="right" sx={TD}>{fmtDol(d.planned)}</TableCell>,
                    <TableCell key={`${f.id}-b`} align="right" sx={TD}>{fmtDol(d.booked)}</TableCell>,
                    <TableCell key={`${f.id}-d`} align="right" sx={{
                      ...TD, fontWeight: 'bold',
                      color: deltaColor(d.planned, d.booked),
                      bgcolor: deltaBg(d.planned, d.booked),
                    }}>
                      {(delta >= 0 ? '+' : '') + fmtDol(delta)}
                    </TableCell>,
                  ];
                })}
                <TableCell align="right" sx={{ ...TD, fontWeight: 'bold', borderLeft: 1, borderColor: 'divider' }}>
                  {fmtDol(cat.totalPlanned)}
                </TableCell>
                <TableCell align="right" sx={{ ...TD, fontWeight: 'bold' }}>
                  {fmtDol(cat.totalBooked)}
                </TableCell>
                <TableCell align="right" sx={{
                  ...TD, fontWeight: 'bold',
                  color: deltaColor(cat.totalPlanned, cat.totalBooked),
                  bgcolor: deltaBg(cat.totalPlanned, cat.totalBooked),
                }}>
                  {((cat.totalBooked - cat.totalPlanned) >= 0 ? '+' : '') + fmtDol(cat.totalBooked - cat.totalPlanned)}
                </TableCell>
              </TableRow>
            ))}

            {/* Grand total row */}
            <TableRow sx={{ '& td': { ...TD, fontWeight: 'bold', borderTop: 2, borderColor: 'divider' } }}>
              <TableCell>TOTAL</TableCell>
              {farms.map(f => {
                const planned = categories.reduce((s, c) => s + (c.byFarm[f.id]?.planned || 0), 0);
                const booked = categories.reduce((s, c) => s + (c.byFarm[f.id]?.booked || 0), 0);
                const delta = booked - planned;
                return [
                  <TableCell key={`${f.id}-p`} align="right">{fmtDol(planned)}</TableCell>,
                  <TableCell key={`${f.id}-b`} align="right">{fmtDol(booked)}</TableCell>,
                  <TableCell key={`${f.id}-d`} align="right" sx={{
                    color: deltaColor(planned, booked),
                    bgcolor: deltaBg(planned, booked),
                  }}>
                    {(delta >= 0 ? '+' : '') + fmtDol(delta)}
                  </TableCell>,
                ];
              })}
              <TableCell align="right" sx={{ borderLeft: 1, borderColor: 'divider' }}>{fmtDol(grandTotalPlanned)}</TableCell>
              <TableCell align="right">{fmtDol(grandTotalBooked)}</TableCell>
              <TableCell align="right" sx={{
                color: deltaColor(grandTotalPlanned, grandTotalBooked),
                bgcolor: deltaBg(grandTotalPlanned, grandTotalBooked),
              }}>
                {(grandDelta >= 0 ? '+' : '') + fmtDol(grandDelta)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>

      {/* Product Detail (collapsible per category) */}
      <Typography variant="h6" fontWeight="bold" sx={{ mb: 1 }}>Product Detail</Typography>
      {['seed', 'fertilizer', 'chemical'].map(cat => (
        <CategoryDetail key={cat} category={cat} products={products} farms={farms} />
      ))}
    </Box>
  );
}
