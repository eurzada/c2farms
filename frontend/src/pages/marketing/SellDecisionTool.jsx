import { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, Stack, TextField, MenuItem, Button, Chip,
  Divider, InputAdornment,
} from '@mui/material';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';

const SIGNAL_COLORS = { positive: 'success', negative: 'error', neutral: 'default' };
const REC_COLORS = { 'STRONG SELL': 'error', 'MODERATE': 'warning', 'WEAK': 'default', 'HOLD': 'success' };

import { fmt, fmtDollar } from '../../utils/formatting';

export default function SellDecisionTool() {
  const { currentFarm, canEdit } = useFarm();
  const [commodities, setCommodities] = useState([]);
  const [counterparties, setCounterparties] = useState([]);

  const [form, setForm] = useState({
    commodity_id: '', quantity_mt: '', price_per_bu: '',
    hold_months: 3, expected_future_price_bu: '', counterparty_id: '',
  });
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentFarm) return;
    Promise.all([
      api.get(`/api/farms/${currentFarm.id}/marketing/prices`),
      api.get(`/api/farms/${currentFarm.id}/marketing/counterparties`),
    ]).then(([pRes, cpRes]) => {
      setCommodities(pRes.data.prices || []);
      setCounterparties(cpRes.data.counterparties || []);
    });
  }, [currentFarm]);

  // Auto-fill bid price when commodity changes
  const handleCommodityChange = (e) => {
    const id = e.target.value;
    setForm(f => ({ ...f, commodity_id: id }));
    const price = commodities.find(c => c.commodity_id === id);
    if (price?.bid_per_bu) {
      setForm(f => ({ ...f, price_per_bu: price.bid_per_bu.toString() }));
    }
  };

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const runAnalysis = async () => {
    if (!currentFarm || !form.commodity_id || !form.quantity_mt || !form.price_per_bu) return;
    setLoading(true);
    try {
      const res = await api.post(`/api/farms/${currentFarm.id}/marketing/sell-analysis`, {
        commodity_id: form.commodity_id,
        quantity_mt: parseFloat(form.quantity_mt),
        price_per_bu: parseFloat(form.price_per_bu),
        hold_months: parseInt(form.hold_months) || 0,
        expected_future_price_bu: form.expected_future_price_bu ? parseFloat(form.expected_future_price_bu) : null,
      });
      setAnalysis(res.data.analysis);
    } catch (err) {
      console.error('Analysis error:', err);
    } finally {
      setLoading(false);
    }
  };

  const a = analysis;

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 2 }}>Sell Decision Tool</Typography>

      <Stack direction="row" spacing={3}>
        {/* Left: Inputs */}
        <Paper variant="outlined" sx={{ p: 2.5, width: 380, flexShrink: 0 }}>
          <Typography variant="h6" gutterBottom>Deal Parameters</Typography>
          <Stack spacing={2}>
            <TextField select fullWidth label="Commodity" value={form.commodity_id} onChange={handleCommodityChange} size="small">
              {commodities.map(c => <MenuItem key={c.commodity_id} value={c.commodity_id}>{c.commodity_name}</MenuItem>)}
            </TextField>
            <TextField fullWidth label="Quantity (MT)" value={form.quantity_mt} onChange={set('quantity_mt')} type="number" size="small" />
            <TextField fullWidth label="Price" value={form.price_per_bu} onChange={set('price_per_bu')} type="number" size="small"
              InputProps={{ startAdornment: <InputAdornment position="start">$/bu</InputAdornment> }} />
            <TextField select fullWidth label="Buyer (optional)" value={form.counterparty_id} onChange={set('counterparty_id')} size="small">
              <MenuItem value="">—</MenuItem>
              {counterparties.map(cp => <MenuItem key={cp.id} value={cp.id}>{cp.name}</MenuItem>)}
            </TextField>

            <Divider />
            <Typography variant="subtitle2">Hold Scenario</Typography>
            <TextField fullWidth label="Hold Months" value={form.hold_months} onChange={set('hold_months')} type="number" size="small" />
            <TextField fullWidth label="Expected Future Price" value={form.expected_future_price_bu} onChange={set('expected_future_price_bu')} type="number" size="small"
              InputProps={{ startAdornment: <InputAdornment position="start">$/bu</InputAdornment> }} />

            <Button variant="contained" onClick={runAnalysis} fullWidth disabled={loading || !form.commodity_id || !form.quantity_mt || !form.price_per_bu}>
              {loading ? 'Analyzing...' : 'Run Analysis'}
            </Button>
          </Stack>
        </Paper>

        {/* Right: Results */}
        <Box sx={{ flex: 1 }}>
          {!a ? (
            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
              <Typography color="text.secondary">Enter deal parameters and click "Run Analysis"</Typography>
            </Paper>
          ) : (
            <Stack spacing={2}>
              {/* Recommendation banner */}
              <Paper sx={{ p: 2, textAlign: 'center', bgcolor: a.score >= 75 ? 'error.light' : a.score >= 55 ? 'warning.light' : a.score >= 40 ? 'grey.200' : 'success.light' }}>
                <Typography variant="h4" sx={{ fontWeight: 700 }}>{a.recommendation}</Typography>
                <Typography variant="body2">Score: {a.score}/100</Typography>
              </Paper>

              {/* Deal Summary */}
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Deal Summary</Typography>
                <Stack direction="row" spacing={2}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">Commodity</Typography>
                    <Typography variant="body1">{a.commodity.name}</Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">Quantity</Typography>
                    <Typography variant="body1">{fmt(a.quantity_mt, 0)} MT</Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">Price</Typography>
                    <Typography variant="body1">${fmt(a.price_per_bu)} /bu</Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">Deal Value</Typography>
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>{fmtDollar(a.deal_value)}</Typography>
                  </Box>
                </Stack>
              </Paper>

              {/* Margin Analysis */}
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Margin Analysis</Typography>
                <Stack direction="row" spacing={2}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">COP</Typography>
                    <Typography variant="body1">${fmt(a.cop_per_bu)} /bu</Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">Margin</Typography>
                    <Typography variant="body1" sx={{ color: a.margin_per_mt >= 0 ? 'success.main' : 'error.main', fontWeight: 600 }}>
                      {a.margin_pct.toFixed(0)}%
                    </Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">Target</Typography>
                    <Typography variant="body1">${fmt(a.target_per_bu)} /bu</Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">Target Met?</Typography>
                    <Chip label={a.target_met ? 'Yes' : 'No'} size="small" color={a.target_met ? 'success' : 'default'} />
                  </Box>
                </Stack>
              </Paper>

              {/* Carry Cost */}
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Hold vs Sell</Typography>
                <Stack direction="row" spacing={2}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">Hold Cost ({a.hold_months} mo)</Typography>
                    <Typography variant="body1" sx={{ color: 'error.main' }}>{fmtDollar(a.carry_cost_total)}</Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">Expected Gain</Typography>
                    <Typography variant="body1" sx={{ color: 'success.main' }}>{fmtDollar(a.expected_gain)}</Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">Net from Holding</Typography>
                    <Typography variant="body1" sx={{ color: a.net_gain_from_holding >= 0 ? 'success.main' : 'error.main', fontWeight: 600 }}>
                      {fmtDollar(a.net_gain_from_holding)}
                    </Typography>
                  </Box>
                </Stack>
              </Paper>

              {/* Signals */}
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Decision Signals</Typography>
                <Stack spacing={1}>
                  {(a.signals || []).map((s, i) => (
                    <Stack key={i} direction="row" spacing={1} alignItems="center">
                      <Chip label={s.signal.toUpperCase()} size="small" color={SIGNAL_COLORS[s.value] || 'default'} sx={{ minWidth: 90 }} />
                      <Typography variant="body2">{s.detail}</Typography>
                    </Stack>
                  ))}
                </Stack>
              </Paper>

              {/* Convert to Contract */}
              {canEdit && (
                <Button variant="contained" color="primary" fullWidth sx={{ mt: 1 }}
                  onClick={() => {
                    // Could open ContractFormDialog pre-filled — for now, navigate to contracts tab
                    window.location.href = '/marketing/contracts';
                  }}>
                  Convert to Contract
                </Button>
              )}
            </Stack>
          )}
        </Box>
      </Stack>
    </Box>
  );
}
