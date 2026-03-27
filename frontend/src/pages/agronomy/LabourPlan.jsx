import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Typography, Paper, Stack, Chip, Button, TextField, IconButton,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Accordion, AccordionSummary, AccordionDetails, Snackbar, Alert,
  InputAdornment, Tooltip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import SyncIcon from '@mui/icons-material/Sync';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useFarm } from '../../contexts/FarmContext';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { formatCurrency } from '../../utils/formatting';
import api from '../../services/api';

function fmt(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function fmtDec(n) { return (n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const FISCAL_MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];

const TH_SX = { fontWeight: 'bold', bgcolor: 'action.hover', whiteSpace: 'nowrap', py: 0.75 };
const ZEBRA_SX = { '&:nth-of-type(odd)': { bgcolor: 'action.hover' } };

function KpiCard({ label, value, sub }) {
  return (
    <Paper sx={{ p: 2, textAlign: 'center', flex: 1, minWidth: 140 }}>
      <Typography variant="body2" color="text.secondary" gutterBottom>{label}</Typography>
      <Typography variant="h5" fontWeight="bold">{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

export default function LabourPlan() {
  const { currentFarm, canEdit } = useFarm();
  const { confirm, dialogProps } = useConfirmDialog();
  const [plan, setPlan] = useState(null);
  const [priorPlan, setPriorPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState(null);
  const [dirty, setDirty] = useState(false);
  const year = 2026;

  const load = useCallback(async () => {
    if (!currentFarm) return;
    setLoading(true);
    try {
      const [planRes, priorRes] = await Promise.all([
        api.get(`/api/farms/${currentFarm.id}/labour/plan?year=${year}`).catch(() => ({ data: null })),
        api.get(`/api/farms/${currentFarm.id}/labour/plan?year=${year - 1}`).catch(() => ({ data: null })),
      ]);
      setPlan(planRes.data);
      setPriorPlan(priorRes.data);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [currentFarm, year]);

  useEffect(() => { load(); }, [load]);

  const isEditable = canEdit && plan?.status === 'draft';

  // Build prior year lookup: { seasonName -> { roleName -> hours } }
  const priorLookup = useMemo(() => {
    if (!priorPlan) return null;
    const map = {};
    for (const s of priorPlan.seasons) {
      const roles = {};
      for (const r of s.roles) roles[r.name] = Number(r.hours) || 0;
      map[s.name] = roles;
    }
    return map;
  }, [priorPlan]);

  const priorWage = priorPlan ? Number(priorPlan.avg_wage) || 0 : 0;

  // ─── Computed KPIs ────────────────────────────────────────────────
  const { totalHours, totalCost, costPerAcre, hoursPerAcre, totalFuelCost } = useMemo(() => {
    if (!plan) return { totalHours: 0, totalCost: 0, costPerAcre: 0, hoursPerAcre: 0, totalFuelCost: 0 };
    const wage = Number(plan.avg_wage) || 0;
    const fuelRate = Number(plan.fuel_rate_per_acre) || 0;
    let hrs = 0;
    for (const s of plan.seasons) {
      for (const r of s.roles) hrs += Number(r.hours) || 0;
    }
    const cost = hrs * wage;
    const fuelCost = fuelRate * (plan.total_acres || 0);
    return {
      totalHours: hrs,
      totalCost: cost,
      costPerAcre: plan.total_acres ? cost / plan.total_acres : 0,
      hoursPerAcre: plan.total_acres ? hrs / plan.total_acres : 0,
      totalFuelCost: fuelCost,
    };
  }, [plan]);

  // ─── Create Plan ──────────────────────────────────────────────────
  const handleCreate = async () => {
    try {
      const res = await api.post(`/api/farms/${currentFarm.id}/labour/plan`, { fiscal_year: year });
      setPlan(res.data);
      setSnack({ severity: 'success', msg: 'Labour plan created with default seasons' });
    } catch (err) {
      setSnack({ severity: 'error', msg: extractErrorMessage(err, 'Failed to create plan') });
    }
  };

  // ─── Copy from Prior Year ─────────────────────────────────────────
  const handleCopyFromPrior = async () => {
    try {
      const res = await api.post(`/api/farms/${currentFarm.id}/labour/plan/copy-from-prior`, { fiscal_year: year });
      setPlan(res.data);
      setSnack({ severity: 'success', msg: `Copied labour plan from FY${year - 1}` });
    } catch (err) {
      setSnack({ severity: 'error', msg: extractErrorMessage(err, 'Failed to copy from prior year') });
    }
  };

  // ─── Save All ─────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/farms/${currentFarm.id}/labour/plan/${plan.id}`, {
        avg_wage: Number(plan.avg_wage),
        fuel_rate_per_acre: Number(plan.fuel_rate_per_acre) || 0,
        fuel_cost_per_litre: Number(plan.fuel_cost_per_litre) || 1,
        notes: plan.notes,
      });
      await api.put(`/api/farms/${currentFarm.id}/labour/plan/${plan.id}/seasons`, {
        seasons: plan.seasons.map(s => ({
          name: s.name,
          sort_order: s.sort_order,
          months: s.months,
          roles: s.roles.map(r => ({
            name: r.name,
            hours: Number(r.hours) || 0,
            sort_order: r.sort_order,
          })),
        })),
      });
      setDirty(false);
      setSnack({ severity: 'success', msg: 'Labour plan saved' });
      load();
    } catch (err) {
      setSnack({ severity: 'error', msg: extractErrorMessage(err, 'Failed to save') });
    } finally { setSaving(false); }
  };

  // ─── Push to Forecast ─────────────────────────────────────────────
  const handlePush = async () => {
    if (dirty) {
      setSnack({ severity: 'warning', msg: 'Please save changes before pushing to forecast' });
      return;
    }
    const ok = await confirm({
      title: 'Push to Forecast',
      message: `This will write labour cost (lpm_personnel) and${Number(plan.fuel_rate_per_acre) > 0 ? ` fuel cost at $${fmtDec(Number(plan.fuel_rate_per_acre))}/acre (lpm_fog)` : ' no fuel (rate not set)'} into the forecast for each month, allocated by hours. Continue?`,
      confirmText: 'Push',
    });
    if (!ok) return;
    try {
      const res = await api.post(`/api/farms/${currentFarm.id}/labour/plan/${plan.id}/push`);
      if (res.data.pushed) {
        setSnack({ severity: 'success', msg: `Pushed to forecast — updated: ${res.data.monthsUpdated.join(', ')}` });
      } else {
        setSnack({ severity: 'warning', msg: res.data.reason || 'Nothing pushed' });
      }
    } catch (err) {
      setSnack({ severity: 'error', msg: extractErrorMessage(err, 'Push failed') });
    }
  };

  // ─── Status Toggle ────────────────────────────────────────────────
  const handleToggleStatus = async () => {
    const newStatus = plan.status === 'draft' ? 'locked' : 'draft';
    const action = newStatus === 'locked' ? 'Lock' : 'Unlock';
    const ok = await confirm({
      title: `${action} Labour Plan`,
      message: newStatus === 'locked'
        ? 'Locking the plan will prevent further edits.'
        : 'Unlocking will return the plan to draft status for editing.',
      confirmText: action,
      confirmColor: newStatus === 'locked' ? 'primary' : 'warning',
    });
    if (!ok) return;
    try {
      const res = await api.patch(`/api/farms/${currentFarm.id}/labour/plan/${plan.id}`, { status: newStatus });
      setPlan(res.data);
      setSnack({ severity: 'success', msg: `Plan ${newStatus}` });
    } catch (err) {
      setSnack({ severity: 'error', msg: extractErrorMessage(err, 'Status update failed') });
    }
  };

  // ─── Local Edits (in memory until save) ───────────────────────────
  const updateRole = (seasonIdx, roleIdx, field, value) => {
    setPlan(prev => {
      const next = structuredClone(prev);
      next.seasons[seasonIdx].roles[roleIdx][field] = value;
      return next;
    });
    setDirty(true);
  };

  const addRole = (seasonIdx) => {
    setPlan(prev => {
      const next = structuredClone(prev);
      const roles = next.seasons[seasonIdx].roles;
      roles.push({ name: 'New Role', hours: 0, sort_order: roles.length + 1 });
      return next;
    });
    setDirty(true);
  };

  const deleteRole = (seasonIdx, roleIdx) => {
    setPlan(prev => {
      const next = structuredClone(prev);
      next.seasons[seasonIdx].roles.splice(roleIdx, 1);
      return next;
    });
    setDirty(true);
  };

  const addSeason = () => {
    setPlan(prev => {
      const next = structuredClone(prev);
      next.seasons.push({
        name: 'New Season',
        sort_order: next.seasons.length + 1,
        months: [],
        roles: [],
      });
      return next;
    });
    setDirty(true);
  };

  const deleteSeason = async (seasonIdx) => {
    const ok = await confirm({
      title: 'Delete Season',
      message: `Delete "${plan.seasons[seasonIdx].name}" and all its roles?`,
      confirmText: 'Delete',
      confirmColor: 'error',
    });
    if (!ok) return;
    setPlan(prev => {
      const next = structuredClone(prev);
      next.seasons.splice(seasonIdx, 1);
      return next;
    });
    setDirty(true);
  };

  const updateSeasonField = (seasonIdx, field, value) => {
    setPlan(prev => {
      const next = structuredClone(prev);
      next.seasons[seasonIdx][field] = value;
      return next;
    });
    setDirty(true);
  };

  const toggleMonth = (seasonIdx, month) => {
    setPlan(prev => {
      const next = structuredClone(prev);
      const months = next.seasons[seasonIdx].months;
      const idx = months.indexOf(month);
      if (idx >= 0) months.splice(idx, 1);
      else months.push(month);
      next.seasons[seasonIdx].months = FISCAL_MONTHS.filter(m => months.includes(m));
      return next;
    });
    setDirty(true);
  };

  const updatePlanField = (field, value) => {
    setPlan(prev => ({ ...prev, [field]: value }));
    setDirty(true);
  };

  // ─── Render ───────────────────────────────────────────────────────
  if (loading) return <Typography>Loading...</Typography>;

  if (!plan) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography variant="h5" gutterBottom>No Labour & Fuel Plan for FY{year}</Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Create a plan to budget labour hours and fuel costs by season.
        </Typography>
        {canEdit && (
          <Stack direction="row" spacing={2} justifyContent="center">
            <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreate}>
              Create Blank Plan
            </Button>
            {priorPlan && (
              <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={handleCopyFromPrior}>
                Copy from FY{year - 1}
              </Button>
            )}
          </Stack>
        )}
      </Box>
    );
  }

  const wage = Number(plan.avg_wage) || 0;
  const showPrior = !!priorLookup;
  const colCount = isEditable ? 4 : (showPrior ? 5 : 3);

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight="bold">Labour & Fuel — FY{year}</Typography>
        <Chip
          label={plan.status === 'draft' ? 'Draft' : 'Locked'}
          color={plan.status === 'draft' ? 'default' : 'primary'}
          size="small"
          icon={plan.status === 'locked' ? <LockIcon /> : <LockOpenIcon />}
        />
        {plan.total_acres > 0 && (
          <Chip label={`${fmt(plan.total_acres)} acres`} size="small" variant="outlined" />
        )}
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField
            label="Avg Wage"
            type="number"
            size="small"
            sx={{ width: 130 }}
            value={plan.avg_wage}
            onChange={e => updatePlanField('avg_wage', e.target.value)}
            disabled={!isEditable}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment>, endAdornment: <InputAdornment position="end">/hr</InputAdornment> }}
          />
          <TextField
            label="Fuel $/Acre"
            type="number"
            size="small"
            sx={{ width: 140 }}
            value={plan.fuel_rate_per_acre ?? 0}
            onChange={e => updatePlanField('fuel_rate_per_acre', e.target.value)}
            disabled={!isEditable}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment>, endAdornment: <InputAdornment position="end">/ac</InputAdornment> }}
          />
          <TextField
            label="Fuel $/L"
            type="number"
            size="small"
            sx={{ width: 120 }}
            value={plan.fuel_cost_per_litre ?? 1}
            onChange={e => updatePlanField('fuel_cost_per_litre', e.target.value)}
            disabled={!isEditable}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment>, endAdornment: <InputAdornment position="end">/L</InputAdornment> }}
          />
        </Box>
      </Box>

      {/* KPI Cards */}
      <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap' }}>
        <KpiCard label="Total Hours" value={fmt(totalHours)} sub={`${fmtDec(hoursPerAcre)} hrs/acre`} />
        <KpiCard label="Labour Cost" value={formatCurrency(totalCost)} sub={`@ $${fmtDec(wage)}/hr`} />
        <KpiCard label="Labour $/Acre" value={formatCurrency(costPerAcre)} />
        <KpiCard label="Fuel Cost" value={formatCurrency(totalFuelCost)} sub={totalFuelCost > 0 ? `$${fmtDec(Number(plan.fuel_rate_per_acre) || 0)}/acre` : 'Not set'} />
        <KpiCard label="Fuel $/Acre" value={Number(plan.fuel_rate_per_acre) > 0 ? `$${fmtDec(Number(plan.fuel_rate_per_acre))}` : '—'} />
      </Stack>

      {/* Seasons */}
      {plan.seasons.map((season, si) => {
        const seasonHours = season.roles.reduce((sum, r) => sum + (Number(r.hours) || 0), 0);
        const seasonCost = seasonHours * wage;
        const priorSeason = priorLookup?.[season.name];
        return (
          <Accordion key={si} defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%', pr: 2 }}>
                {isEditable ? (
                  <TextField
                    value={season.name}
                    onChange={e => updateSeasonField(si, 'name', e.target.value)}
                    size="small"
                    variant="standard"
                    sx={{ fontWeight: 'bold', '& input': { fontWeight: 'bold', fontSize: '1rem' } }}
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <Typography fontWeight="bold">{season.name}</Typography>
                )}
                <Typography variant="body2" color="text.secondary">
                  — {season.months.join(', ') || 'no months'}
                </Typography>
                <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'flex-end', gap: 1 }}>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="body2" fontWeight="bold">
                      Labour: {fmt(seasonHours)} hrs &nbsp; {formatCurrency(seasonCost)}
                    </Typography>
                    {totalFuelCost > 0 && totalHours > 0 && (
                      <Typography variant="body2" color="text.secondary" fontWeight="bold">
                        Fuel: {formatCurrency(totalFuelCost * (seasonHours / totalHours))} &nbsp; ({(seasonHours / totalHours * 100).toFixed(1)}%)
                      </Typography>
                    )}
                  </Box>
                  {isEditable && (
                    <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); deleteSeason(si); }}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </Box>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {/* Month chips */}
              {isEditable && (
                <Box sx={{ display: 'flex', gap: 0.5, mb: 2, flexWrap: 'wrap' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ mr: 1, alignSelf: 'center' }}>Months:</Typography>
                  {FISCAL_MONTHS.map(m => (
                    <Chip
                      key={m}
                      label={m}
                      size="small"
                      variant={season.months.includes(m) ? 'filled' : 'outlined'}
                      color={season.months.includes(m) ? 'primary' : 'default'}
                      onClick={() => toggleMonth(si, m)}
                    />
                  ))}
                </Box>
              )}

              <TableContainer sx={{ maxWidth: isEditable ? undefined : 700 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ ...TH_SX, width: isEditable ? undefined : 200 }}>Role</TableCell>
                      {showPrior && !isEditable && (
                        <>
                          <TableCell align="right" sx={{ ...TH_SX, width: 100, color: 'text.secondary' }}>FY{year - 1} Hrs</TableCell>
                          <TableCell align="right" sx={{ ...TH_SX, width: 110, color: 'text.secondary' }}>FY{year - 1} $</TableCell>
                        </>
                      )}
                      <TableCell align="right" sx={{ ...TH_SX, width: isEditable ? 140 : 100 }}>Hours</TableCell>
                      <TableCell align="right" sx={{ ...TH_SX, width: isEditable ? 140 : 110 }}>Cost ($)</TableCell>
                      {isEditable && <TableCell sx={{ width: 48 }} />}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {season.roles.map((role, ri) => {
                      const priorHours = priorSeason?.[role.name] || 0;
                      return (
                        <TableRow key={ri} hover sx={!isEditable ? ZEBRA_SX : undefined}>
                          <TableCell sx={{ py: isEditable ? undefined : 0.5 }}>
                            {isEditable ? (
                              <TextField
                                value={role.name}
                                onChange={e => updateRole(si, ri, 'name', e.target.value)}
                                size="small"
                                variant="standard"
                                fullWidth
                              />
                            ) : role.name}
                          </TableCell>
                          {showPrior && !isEditable && (
                            <>
                              <TableCell align="right" sx={{ color: 'text.secondary', py: 0.5 }}>
                                {priorHours ? fmt(priorHours) : '—'}
                              </TableCell>
                              <TableCell align="right" sx={{ color: 'text.secondary', py: 0.5 }}>
                                {priorHours ? formatCurrency(priorHours * priorWage) : '—'}
                              </TableCell>
                            </>
                          )}
                          <TableCell align="right" sx={{ py: isEditable ? undefined : 0.5 }}>
                            {isEditable ? (
                              <TextField
                                type="number"
                                value={role.hours}
                                onChange={e => updateRole(si, ri, 'hours', e.target.value)}
                                size="small"
                                variant="standard"
                                inputProps={{ style: { textAlign: 'right' } }}
                                sx={{ width: 100 }}
                              />
                            ) : fmt(Number(role.hours))}
                          </TableCell>
                          <TableCell align="right" sx={{ py: isEditable ? undefined : 0.5 }}>
                            {formatCurrency((Number(role.hours) || 0) * wage)}
                          </TableCell>
                          {isEditable && (
                            <TableCell>
                              <IconButton size="small" onClick={() => deleteRole(si, ri)}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                    {season.roles.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={colCount} sx={{ textAlign: 'center', color: 'text.secondary' }}>
                          No roles yet — add one below
                        </TableCell>
                      </TableRow>
                    )}
                    {/* Season total row */}
                    {!isEditable && season.roles.length > 0 && (
                      <TableRow sx={{ '& td': { fontWeight: 'bold', borderTop: 2, borderColor: 'divider', py: 0.5 } }}>
                        <TableCell>Total</TableCell>
                        {showPrior && (
                          <>
                            <TableCell align="right" sx={{ color: 'text.secondary' }}>
                              {fmt(Object.values(priorSeason || {}).reduce((a, b) => a + b, 0))}
                            </TableCell>
                            <TableCell align="right" sx={{ color: 'text.secondary' }}>
                              {formatCurrency(Object.values(priorSeason || {}).reduce((a, b) => a + b, 0) * priorWage)}
                            </TableCell>
                          </>
                        )}
                        <TableCell align="right">{fmt(seasonHours)}</TableCell>
                        <TableCell align="right">{formatCurrency(seasonCost)}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              {isEditable && (
                <Button size="small" startIcon={<AddIcon />} onClick={() => addRole(si)} sx={{ mt: 1 }}>
                  Add Role
                </Button>
              )}
            </AccordionDetails>
          </Accordion>
        );
      })}

      {/* Add Season + Action Buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          {isEditable && (
            <Button startIcon={<AddIcon />} onClick={addSeason}>
              Add Season
            </Button>
          )}
        </Box>

        {/* Totals + actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" fontWeight="bold">
            TOTAL: {fmt(totalHours)} hrs &nbsp;|&nbsp; Labour: {formatCurrency(totalCost)} &nbsp;|&nbsp; Fuel: {totalFuelCost > 0 ? formatCurrency(totalFuelCost) : '—'}
          </Typography>
          {isEditable && (
            <Button variant="contained" onClick={handleSave} disabled={saving || !dirty}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          )}
          {canEdit && plan.status === 'draft' && !dirty && (
            <Button variant="outlined" startIcon={<SyncIcon />} onClick={handlePush}>
              Push to Forecast
            </Button>
          )}
          {canEdit && (
            <Tooltip title={plan.status === 'draft' ? 'Lock plan' : 'Unlock plan'}>
              <Button
                variant="outlined"
                color={plan.status === 'draft' ? 'primary' : 'warning'}
                startIcon={plan.status === 'locked' ? <LockOpenIcon /> : <LockIcon />}
                onClick={handleToggleStatus}
                disabled={dirty}
              >
                {plan.status === 'draft' ? 'Lock' : 'Unlock'}
              </Button>
            </Tooltip>
          )}
        </Box>
      </Box>

      <ConfirmDialog {...dialogProps} />
      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)}>
        {snack && <Alert severity={snack.severity} onClose={() => setSnack(null)}>{snack.msg}</Alert>}
      </Snackbar>
    </Box>
  );
}
