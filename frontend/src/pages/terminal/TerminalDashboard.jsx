import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Grid, Chip, Skeleton, Alert, Button, Divider, Menu, MenuItem,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, LinearProgress,
} from '@mui/material';
import WarehouseIcon from '@mui/icons-material/Warehouse';
import InputIcon from '@mui/icons-material/Input';
import OutputIcon from '@mui/icons-material/Output';
import SpeedIcon from '@mui/icons-material/Speed';
import DescriptionIcon from '@mui/icons-material/Description';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import GavelIcon from '@mui/icons-material/Gavel';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { formatCurrency } from '../../utils/formatting';

function StatCard({ icon, label, value, subtitle, color = 'primary.main' }) {
  return (
    <Paper sx={{ p: 2.5, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Box sx={{ color }}>{icon}</Box>
        <Typography variant="body2" color="text.secondary">{label}</Typography>
      </Box>
      <Typography variant="h4" fontWeight={700}>{value}</Typography>
      {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
    </Paper>
  );
}

function fmtMT(kg) {
  if (kg == null) return '—';
  const mt = kg / 1000;
  return `${mt.toLocaleString('en-CA', { maximumFractionDigits: 1 })} MT`;
}

function fmtKg(kg) {
  if (kg == null) return '—';
  if (kg >= 1_000_000) return fmtMT(kg);
  return `${kg.toLocaleString('en-CA', { maximumFractionDigits: 0 })} kg`;
}

export default function TerminalDashboard() {
  const { currentFarm } = useFarm();
  const [data, setData] = useState(null);
  const [contractSummary, setContractSummary] = useState(null);
  const [settlementSummary, setSettlementSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exportAnchor, setExportAnchor] = useState(null);

  const load = useCallback(async () => {
    if (!currentFarm?.id) return;
    try {
      setLoading(true);
      const [dashRes, ctRes, stRes] = await Promise.all([
        api.get(`/api/farms/${currentFarm.id}/terminal/dashboard`),
        api.get(`/api/farms/${currentFarm.id}/terminal/contracts/summary`).catch(() => ({ data: null })),
        api.get(`/api/farms/${currentFarm.id}/terminal/settlements/summary`).catch(() => ({ data: null })),
      ]);
      setData(dashRes.data);
      setContractSummary(ctRes.data);
      setSettlementSummary(stRes.data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load dashboard'));
    } finally {
      setLoading(false);
    }
  }, [currentFarm?.id]);

  const handleExport = async (reportType) => {
    setExportAnchor(null);
    const farmId = currentFarm?.id;
    if (!farmId) return;
    try {
      const res = await api.get(`/api/farms/${farmId}/terminal/reports/${reportType}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      const ext = reportType.endsWith('/pdf') ? 'pdf' : 'xlsx';
      a.download = `${reportType.replace(/\//g, '-')}.${ext}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to generate report'));
    }
  };

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <Box sx={{ p: 2 }}>
        <Grid container spacing={2}>
          {[1, 2, 3, 4].map(i => (
            <Grid item xs={12} sm={6} md={3} key={i}><Skeleton variant="rounded" height={120} /></Grid>
          ))}
        </Grid>
      </Box>
    );
  }

  if (error) return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;
  if (!data) return null;

  const totalKg = data.bins?.reduce((sum, b) => sum + (b.balance_kg || 0), 0) || 0;
  const totalCapacity = data.bins?.reduce((sum, b) => sum + (b.capacity_kg || 0), 0) || 1;
  const utilPct = Math.round((totalKg / totalCapacity) * 100);
  const inboundKg = data.ticket_stats?.total_inbound_kg || 0;
  const outboundKg = data.ticket_stats?.total_outbound_kg || 0;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={700}>Terminal Dashboard</Typography>
        <Box>
          <Button variant="outlined" startIcon={<FileDownloadIcon />} onClick={e => setExportAnchor(e.currentTarget)}>
            Export Reports
          </Button>
          <Menu anchorEl={exportAnchor} open={Boolean(exportAnchor)} onClose={() => setExportAnchor(null)}>
            <MenuItem onClick={() => handleExport('grain-balance/excel')}>
              <DescriptionIcon sx={{ mr: 1, fontSize: 18 }} /> Grain Balance (Excel)
            </MenuItem>
            <MenuItem onClick={() => handleExport('grain-balance/pdf')}>
              <DescriptionIcon sx={{ mr: 1, fontSize: 18 }} /> Grain Balance (PDF)
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => handleExport('shipping-history')}>
              <DescriptionIcon sx={{ mr: 1, fontSize: 18 }} /> Shipping History (Excel)
            </MenuItem>
            <MenuItem onClick={() => handleExport('quality-summary')}>
              <DescriptionIcon sx={{ mr: 1, fontSize: 18 }} /> Quality Summary (Excel)
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => handleExport('contract-fulfillment')}>
              <DescriptionIcon sx={{ mr: 1, fontSize: 18 }} /> Contract Fulfillment (Excel)
            </MenuItem>
          </Menu>
        </Box>
      </Box>

      {/* Top stat cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard icon={<WarehouseIcon />} label="Total Inventory" value={fmtMT(totalKg)} subtitle={`${data.bins?.length || 0} active bins`} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard icon={<InputIcon />} label="Inbound" value={fmtMT(inboundKg)} subtitle={`${data.ticket_stats?.total_inbound_count || 0} loads received`} color="success.main" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard icon={<OutputIcon />} label="Outbound" value={fmtMT(outboundKg)} subtitle={`${data.ticket_stats?.total_outbound_count || 0} shipments`} color="warning.main" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard icon={<SpeedIcon />} label="Utilization" value={`${utilPct}%`} subtitle={`${fmtMT(totalCapacity)} total capacity`} color={utilPct > 85 ? 'error.main' : utilPct > 60 ? 'warning.main' : 'info.main'} />
        </Grid>
      </Grid>

      {/* Grain Flow Strip */}
      <Paper sx={{ p: 2.5, mb: 3 }}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>Grain Flow</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
          <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', flex: 1, borderColor: 'success.main', borderWidth: 2 }}>
            <InputIcon sx={{ color: 'success.main', fontSize: 28, mb: 0.5 }} />
            <Typography variant="h6" fontWeight={700}>{fmtMT(inboundKg)}</Typography>
            <Typography variant="caption" color="text.secondary">Incoming</Typography>
          </Paper>
          <ArrowForwardIcon sx={{ color: 'text.disabled', fontSize: 28, flexShrink: 0 }} />
          <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', flex: 1.3, borderColor: 'primary.main', borderWidth: 2 }}>
            <WarehouseIcon sx={{ color: 'primary.main', fontSize: 28, mb: 0.5 }} />
            <Typography variant="h6" fontWeight={700}>{fmtMT(totalKg)}</Typography>
            <Typography variant="caption" color="text.secondary">Bins (WIP)</Typography>
            <LinearProgress
              variant="determinate"
              value={Math.min(utilPct, 100)}
              sx={{ mt: 1, height: 6, borderRadius: 3 }}
              color={utilPct > 85 ? 'error' : utilPct > 60 ? 'warning' : 'primary'}
            />
            <Typography variant="caption" color="text.secondary">{utilPct}% full</Typography>
          </Paper>
          <ArrowForwardIcon sx={{ color: 'text.disabled', fontSize: 28, flexShrink: 0 }} />
          <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', flex: 1, borderColor: 'warning.main', borderWidth: 2 }}>
            <OutputIcon sx={{ color: 'warning.main', fontSize: 28, mb: 0.5 }} />
            <Typography variant="h6" fontWeight={700}>{fmtMT(outboundKg)}</Typography>
            <Typography variant="caption" color="text.secondary">Outgoing</Typography>
          </Paper>
        </Box>
      </Paper>

      {/* Contracts & Settlements row */}
      {(contractSummary || settlementSummary) && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {contractSummary && (
            <>
              <Grid item xs={12} sm={6} md={3}>
                <StatCard icon={<GavelIcon />} label="Purchase Contracts" value={`${contractSummary.purchase.count}`} subtitle={`${contractSummary.purchase.total_remaining_mt.toFixed(0)} MT remaining`} color="primary.main" />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <StatCard icon={<GavelIcon />} label="Sale Contracts" value={`${contractSummary.sale.count}`} subtitle={`${contractSummary.sale.total_remaining_mt.toFixed(0)} MT remaining`} color="secondary.main" />
              </Grid>
            </>
          )}
          {settlementSummary && (
            <>
              <Grid item xs={12} sm={6} md={3}>
                <StatCard icon={<AccountBalanceIcon />} label="Transfer Settlements" value={formatCurrency(settlementSummary.by_type?.transfer?.total_amount || 0)} subtitle={`${settlementSummary.by_type?.transfer?.count || 0} total`} color="primary.main" />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <StatCard icon={<AccountBalanceIcon />} label="Transloading Invoices" value={formatCurrency(settlementSummary.by_type?.transloading?.total_amount || 0)} subtitle={`${settlementSummary.by_type?.transloading?.count || 0} total`} color="success.main" />
              </Grid>
            </>
          )}
        </Grid>
      )}

      {/* Bin Status + Commodity Breakdown */}
      <Grid container spacing={2}>
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Bin Status</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Bin</TableCell>
                    <TableCell>Product</TableCell>
                    <TableCell align="right">Balance</TableCell>
                    <TableCell align="right" sx={{ width: 100 }}>Capacity</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.bins?.map(bin => {
                    const pct = bin.capacity_kg ? Math.round((bin.balance_kg / bin.capacity_kg) * 100) : 0;
                    return (
                      <TableRow key={bin.id}>
                        <TableCell><strong>{bin.name}</strong></TableCell>
                        <TableCell>
                          <Chip label={bin.current_product_label || bin.product_label || '—'} size="small" variant="outlined" />
                        </TableCell>
                        <TableCell align="right">{fmtKg(bin.balance_kg)}</TableCell>
                        <TableCell align="right">
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <LinearProgress
                              variant="determinate"
                              value={Math.min(pct, 100)}
                              sx={{ flex: 1, height: 6, borderRadius: 3 }}
                              color={pct > 85 ? 'error' : pct > 60 ? 'warning' : 'primary'}
                            />
                            <Typography variant="caption" sx={{ minWidth: 32, textAlign: 'right' }}>{pct}%</Typography>
                          </Box>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Inventory by Commodity</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Commodity</TableCell>
                    <TableCell align="right">MT</TableCell>
                    <TableCell align="right">Share</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.totals_by_commodity?.map(row => {
                    const mt = row.total_kg / 1000;
                    const share = totalKg > 0 ? Math.round((row.total_kg / totalKg) * 100) : 0;
                    return (
                      <TableRow key={row.product}>
                        <TableCell>{row.product}</TableCell>
                        <TableCell align="right">{mt.toLocaleString('en-CA', { maximumFractionDigits: 1 })}</TableCell>
                        <TableCell align="right">
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <LinearProgress variant="determinate" value={share} sx={{ flex: 1, height: 6, borderRadius: 3 }} />
                            <Typography variant="caption" sx={{ minWidth: 32, textAlign: 'right' }}>{share}%</Typography>
                          </Box>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          {/* Recent Activity */}
          <Paper sx={{ p: 2, mt: 2 }}>
            <Typography variant="h6" gutterBottom>Recent Activity</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell>Ticket#</TableCell>
                    <TableCell>Dir</TableCell>
                    <TableCell>Grower/Buyer</TableCell>
                    <TableCell>Product</TableCell>
                    <TableCell align="right">MT</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.recent_tickets?.slice(0, 10).map(t => (
                    <TableRow key={t.id}>
                      <TableCell>{new Date(t.ticket_date).toLocaleDateString('en-CA')}</TableCell>
                      <TableCell>{t.ticket_number}</TableCell>
                      <TableCell>
                        <Chip
                          label={t.direction}
                          size="small"
                          color={t.direction === 'inbound' ? 'success' : 'warning'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>{t.grower_name || t.sold_to || '—'}</TableCell>
                      <TableCell>{t.product}</TableCell>
                      <TableCell align="right">{((t.weight_kg || t.outbound_kg || 0) / 1000).toFixed(1)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
