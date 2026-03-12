import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Grid, Chip, Skeleton, Alert, Button, Divider, Menu, MenuItem,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import WarehouseIcon from '@mui/icons-material/Warehouse';
import InputIcon from '@mui/icons-material/Input';
import OutputIcon from '@mui/icons-material/Output';
import BlenderIcon from '@mui/icons-material/Blender';
import DescriptionIcon from '@mui/icons-material/Description';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import GavelIcon from '@mui/icons-material/Gavel';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
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

function fmtKg(kg) {
  if (kg == null) return '—';
  if (kg >= 1_000_000) return `${(kg / 1000).toLocaleString('en-CA', { maximumFractionDigits: 0 })} MT`;
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

  return (
    <Box>
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

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard icon={<WarehouseIcon />} label="Total Inventory" value={fmtKg(totalKg)} subtitle={`${data.bins?.length || 0} active bins`} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard icon={<InputIcon />} label="Total Inbound" value={fmtKg(data.ticket_stats?.total_inbound_kg)} subtitle={`${data.ticket_stats?.total_inbound_count || 0} loads`} color="success.main" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard icon={<OutputIcon />} label="Total Outbound" value={fmtKg(data.ticket_stats?.total_outbound_kg)} subtitle={`${data.ticket_stats?.total_outbound_count || 0} shipments`} color="warning.main" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard icon={<BlenderIcon />} label="Blend Events" value={data.recent_blends?.length || 0} subtitle="Recent blends" color="info.main" />
        </Grid>
      </Grid>

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
                    <TableCell align="right">C2</TableCell>
                    <TableCell align="right">Non-C2</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.bins?.map(bin => (
                    <TableRow key={bin.id}>
                      <TableCell><strong>{bin.name}</strong></TableCell>
                      <TableCell>
                        <Chip label={bin.current_product_label || bin.product_label || '—'} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell align="right">{fmtKg(bin.balance_kg)}</TableCell>
                      <TableCell align="right">{bin.c2_balance_kg ? fmtKg(bin.c2_balance_kg) : '—'}</TableCell>
                      <TableCell align="right">{bin.non_c2_balance_kg ? fmtKg(bin.non_c2_balance_kg) : '—'}</TableCell>
                    </TableRow>
                  ))}
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
                    <TableCell align="right">Total KG</TableCell>
                    <TableCell align="right">MT</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.totals_by_commodity?.map(row => (
                    <TableRow key={row.product}>
                      <TableCell>{row.product}</TableCell>
                      <TableCell align="right">{row.total_kg?.toLocaleString('en-CA')}</TableCell>
                      <TableCell align="right">{(row.total_kg / 1000).toFixed(1)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

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
                    <TableCell align="right">KG</TableCell>
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
                      <TableCell align="right">{(t.weight_kg || t.outbound_kg || 0).toLocaleString('en-CA')}</TableCell>
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
