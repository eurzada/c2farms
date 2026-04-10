import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Button, Chip, Alert, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  LinearProgress, Collapse,
  List, ListItem, ListItemText,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PriceCheckIcon from '@mui/icons-material/PriceCheck';
import { useFarm } from '../../contexts/FarmContext';
import ImportDialog from '../../components/agronomy/ImportDialog';
import CwoImportDialog from '../../components/agronomy/CwoImportDialog';
import WorkOrderImportDialog from '../../components/agronomy/WorkOrderImportDialog';
import AgronomyExportButtons from '../../components/agronomy/AgronomyExportButtons';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';

function fmt(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function fmtDec(n, d = 2) { return (n || 0).toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function fmtPct(n) { return ((n || 0) * 100).toFixed(1) + '%'; }

function KpiCard({ title, value, prefix = '$' }) {
  return (
    <Paper sx={{ p: 2, textAlign: 'center', flex: 1, minWidth: 160 }}>
      <Typography variant="body2" color="text.secondary" gutterBottom>{title}</Typography>
      <Typography variant="h5" fontWeight="bold">{prefix}{fmt(value)}</Typography>
    </Paper>
  );
}

export default function AgronomyDashboard() {
  const { currentFarm, fiscalYear: year } = useFarm();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [cwoOpen, setCwoOpen] = useState(false);
  const [woOpen, setWoOpen] = useState(false);
  const [costCoverage, setCostCoverage] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [applyingPricing, setApplyingPricing] = useState(false);
  const [pricingResult, setPricingResult] = useState(null);

  const load = useCallback(async () => {
    if (!currentFarm) return;
    setLoading(true);
    try {
      const [dashRes, coverageRes, snapRes] = await Promise.all([
        api.get(`/api/farms/${currentFarm.id}/agronomy/dashboard?year=${year}`),
        api.get(`/api/farms/${currentFarm.id}/agronomy/cost-coverage?year=${year}`),
        api.get(`/api/agronomy/snapshots?year=${year}`),
      ]);
      setData(dashRes.data);
      setCostCoverage(coverageRes.data);
      setSnapshots(snapRes.data);
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  }, [currentFarm, year]);

  useEffect(() => { load(); }, [load]);

  const handleApplyPricing = async () => {
    setApplyingPricing(true);
    setPricingResult(null);
    try {
      const res = await api.post(`/api/farms/${currentFarm.id}/agronomy/apply-pricing`, { crop_year: year });
      setPricingResult(res.data);
      load();
    } catch (err) {
      console.error('Apply pricing error:', err);
    } finally {
      setApplyingPricing(false);
    }
  };

  if (loading) return <Typography>Loading...</Typography>;
  if (!data || !data.farm) {
    return (
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
          <Box>
            <Typography variant="h5" fontWeight="bold">Agronomy Dashboard</Typography>
            <Typography variant="caption" color="text.secondary">Crop Year {year}</Typography>
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          <Button variant="outlined" size="small" startIcon={<UploadFileIcon />} onClick={() => setImportOpen(true)}>
            Import Plans
          </Button>
          <Button variant="outlined" size="small" startIcon={<AgricultureIcon />} onClick={() => setCwoOpen(true)}>
            Import CWO
          </Button>
          <Button variant="outlined" size="small" startIcon={<UploadFileIcon />} onClick={() => setWoOpen(true)}>
            Import Work Orders
          </Button>
        </Box>
        <Alert severity="info">
          No agronomy plan found for crop year {year}. Go to Plan Setup to create one, or import plans from Excel/CSV.
        </Alert>
        <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} year={year} onImported={load} />
        <CwoImportDialog open={cwoOpen} onClose={() => setCwoOpen(false)} year={year} onImported={load} />
        <WorkOrderImportDialog open={woOpen} onClose={() => setWoOpen(false)} year={year} onImported={load} />
      </Box>
    );
  }

  const { farm, crops } = data;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight="bold">Agronomy Dashboard</Typography>
          <Typography variant="caption" color="text.secondary">Crop Year {year}</Typography>
        </Box>
        <Chip label={data.plan_status?.toUpperCase()} color={data.plan_status === 'approved' ? 'success' : data.plan_status === 'draft' ? 'default' : 'warning'} size="small" />
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="outlined" size="small" startIcon={<UploadFileIcon />} onClick={() => setImportOpen(true)}>
          Import Plans
        </Button>
        <Button variant="outlined" size="small" startIcon={<AgricultureIcon />} onClick={() => setCwoOpen(true)}>
          Import CWO
        </Button>
        <Button variant="outlined" size="small" startIcon={<UploadFileIcon />} onClick={() => setWoOpen(true)}>
          Import Work Orders
        </Button>
        <AgronomyExportButtons farmId={currentFarm.id} year={year} />
      </Box>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} year={year} onImported={load} />
      <CwoImportDialog open={cwoOpen} onClose={() => setCwoOpen(false)} year={year} onImported={load} />
      <WorkOrderImportDialog open={woOpen} onClose={() => setWoOpen(false)} year={year} onImported={load} />

      {/* KPI Cards */}
      <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap' }}>
        <KpiCard title="Total Acres" value={farm.acres} prefix="" />
        <KpiCard title="Total Input Budget" value={farm.total_cost} />
        <KpiCard title="Projected Revenue" value={farm.revenue} />
        <KpiCard title="Projected Margin" value={farm.margin} />
      </Stack>

      {/* Cost by Crop */}
      <Typography variant="h6" sx={{ mb: 1 }}>Cost by Crop</Typography>
      <TableContainer component={Paper} sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 'bold', bgcolor: 'action.hover' } }}>
              <TableCell>Crop</TableCell>
              <TableCell align="right">Acres</TableCell>
              <TableCell align="right">Seed $/ac</TableCell>
              <TableCell align="right">Fert $/ac</TableCell>
              <TableCell align="right">Chem $/ac</TableCell>
              <TableCell align="right">Total $/ac</TableCell>
              <TableCell align="right">Total Input $</TableCell>
              <TableCell align="right">Revenue $</TableCell>
              <TableCell align="right">Margin $</TableCell>
              <TableCell align="right">Margin %</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {crops.map(c => (
              <TableRow key={c.crop} hover>
                <TableCell>{c.crop}</TableCell>
                <TableCell align="right">{fmt(c.acres)}</TableCell>
                <TableCell align="right">{fmtDec(c.seed_per_acre)}</TableCell>
                <TableCell align="right">{fmtDec(c.fert_per_acre)}</TableCell>
                <TableCell align="right">{fmtDec(c.chem_per_acre)}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>{fmtDec(c.total_per_acre)}</TableCell>
                <TableCell align="right">${fmt(c.total_cost)}</TableCell>
                <TableCell align="right">${fmt(c.revenue)}</TableCell>
                <TableCell align="right" sx={{ color: c.margin >= 0 ? 'success.main' : 'error.main' }}>${fmt(c.margin)}</TableCell>
                <TableCell align="right">{c.revenue ? fmtPct(c.margin / c.revenue) : '—'}</TableCell>
              </TableRow>
            ))}
            <TableRow sx={{ '& td': { fontWeight: 'bold', borderTop: 2, borderColor: 'divider' } }}>
              <TableCell>TOTAL</TableCell>
              <TableCell align="right">{fmt(farm.acres)}</TableCell>
              <TableCell align="right">{fmtDec(farm.acres ? farm.seed_total / farm.acres : 0)}</TableCell>
              <TableCell align="right">{fmtDec(farm.acres ? farm.fert_total / farm.acres : 0)}</TableCell>
              <TableCell align="right">{fmtDec(farm.acres ? farm.chem_total / farm.acres : 0)}</TableCell>
              <TableCell align="right">{fmtDec(farm.cost_per_acre)}</TableCell>
              <TableCell align="right">${fmt(farm.total_cost)}</TableCell>
              <TableCell align="right">${fmt(farm.revenue)}</TableCell>
              <TableCell align="right" sx={{ color: farm.margin >= 0 ? 'success.main' : 'error.main' }}>${fmt(farm.margin)}</TableCell>
              <TableCell align="right">{fmtPct(farm.margin_pct)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>

      {/* Gross Margin Summary */}
      <Typography variant="h6" sx={{ mb: 1 }}>Gross Margin Summary</Typography>
      <TableContainer component={Paper} sx={{ mb: 3, maxWidth: 480 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 'bold', bgcolor: 'action.hover' } }}>
              <TableCell>Line Item</TableCell>
              <TableCell align="right">$/Acre</TableCell>
              <TableCell align="right">Total</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell sx={{ color: 'success.main', fontWeight: 500 }}>Revenue</TableCell>
              <TableCell align="right" sx={{ color: 'success.main' }}>${fmtDec(farm.acres ? farm.revenue / farm.acres : 0)}</TableCell>
              <TableCell align="right" sx={{ color: 'success.main' }}>${fmt(farm.revenue)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ pl: 3 }}>Less: Seed</TableCell>
              <TableCell align="right">({fmtDec(farm.acres ? farm.seed_total / farm.acres : 0)})</TableCell>
              <TableCell align="right">({fmt(farm.seed_total)})</TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ pl: 3 }}>Less: Fertilizer</TableCell>
              <TableCell align="right">({fmtDec(farm.acres ? farm.fert_total / farm.acres : 0)})</TableCell>
              <TableCell align="right">({fmt(farm.fert_total)})</TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ pl: 3 }}>Less: Chemical</TableCell>
              <TableCell align="right">({fmtDec(farm.acres ? farm.chem_total / farm.acres : 0)})</TableCell>
              <TableCell align="right">({fmt(farm.chem_total)})</TableCell>
            </TableRow>
            <TableRow sx={{ '& td': { fontWeight: 'bold', borderTop: 1, borderColor: 'divider' } }}>
              <TableCell>Total Inputs</TableCell>
              <TableCell align="right">${fmtDec(farm.cost_per_acre)}</TableCell>
              <TableCell align="right">${fmt(farm.total_cost)}</TableCell>
            </TableRow>
            <TableRow sx={{ '& td': { fontWeight: 'bold', borderTop: 2, borderColor: 'divider' } }}>
              <TableCell>Gross Margin</TableCell>
              <TableCell align="right" sx={{ color: farm.margin >= 0 ? 'success.main' : 'error.main' }}>
                ${fmtDec(farm.margin_per_acre)}
              </TableCell>
              <TableCell align="right" sx={{ color: farm.margin >= 0 ? 'success.main' : 'error.main' }}>
                ${fmt(farm.margin)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold' }}>Margin %</TableCell>
              <TableCell />
              <TableCell align="right" sx={{ fontWeight: 'bold', color: farm.margin >= 0 ? 'success.main' : 'error.main' }}>
                {fmtPct(farm.margin_pct)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>

      {/* Cost Coverage & Pricing */}
      {costCoverage && costCoverage.total > 0 && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
            <Typography variant="h6">Pricing Coverage</Typography>
            <Chip
              label={`${costCoverage.priced} of ${costCoverage.total} products have pricing`}
              color={costCoverage.coverage_pct === 100 ? 'success' : 'warning'}
              size="small"
            />
            <Box sx={{ flexGrow: 1 }} />
            <Button
              variant="outlined"
              size="small"
              startIcon={<PriceCheckIcon />}
              onClick={handleApplyPricing}
              disabled={applyingPricing || costCoverage.coverage_pct === 100}
            >
              {applyingPricing ? 'Applying...' : 'Apply Pricing from Library'}
            </Button>
          </Box>
          <LinearProgress
            variant="determinate"
            value={costCoverage.coverage_pct}
            sx={{ height: 8, borderRadius: 4 }}
            color={costCoverage.coverage_pct === 100 ? 'success' : 'warning'}
          />
          {pricingResult && (
            <Alert severity="success" sx={{ mt: 1 }} onClose={() => setPricingResult(null)}>
              Updated {pricingResult.updated} inputs with pricing ({pricingResult.skipped} already priced)
            </Alert>
          )}
        </Paper>
      )}

      {/* Import Snapshots */}
      {snapshots.length > 0 && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Box
            sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
            onClick={() => setSnapshotsOpen(!snapshotsOpen)}
          >
            <Typography variant="h6">Import History</Typography>
            <Chip label={`${snapshots.length} imports`} size="small" sx={{ ml: 1 }} />
            <Box sx={{ flexGrow: 1 }} />
            <ExpandMoreIcon sx={{ transform: snapshotsOpen ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
          </Box>
          <Collapse in={snapshotsOpen}>
            <List dense>
              {snapshots.map(s => (
                <ListItem key={s.id}>
                  <ListItemText
                    primary={s.label}
                    secondary={`${new Date(s.created_at).toLocaleDateString()} — ${s.row_count} rows — ${s.source}`}
                  />
                </ListItem>
              ))}
            </List>
          </Collapse>
        </Paper>
      )}

      {/* Budget Guardrails */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>Budget Guardrails</Typography>
        <Typography variant="body2" color="text.secondary">
          Farm managers may NOT exceed the input budget in pursuit of yield targets.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Farm managers may NOT cut inputs below plan to save costs at the expense of yield targets.
        </Typography>
        <Box sx={{ mt: 1 }}>
          <Chip label="Pre-Season" size="small" variant="outlined" sx={{ mr: 1 }} />
          <Typography variant="caption" color="text.secondary">
            Budget vs Actual tracking will activate when Cropwise actuals are imported.
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
}
