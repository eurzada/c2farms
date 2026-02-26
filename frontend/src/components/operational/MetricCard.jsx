import { useState } from 'react';
import {
  Card, CardContent, Typography, Box, LinearProgress, IconButton,
  Collapse, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Tooltip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import PeopleIcon from '@mui/icons-material/People';
import BuildIcon from '@mui/icons-material/Build';
import LocalGasStationIcon from '@mui/icons-material/LocalGasStation';

const ICONS = {
  labour_hours: PeopleIcon,
  equipment_hours: BuildIcon,
  fuel_litres: LocalGasStationIcon,
};

function fmt(val) {
  if (val == null || val === 0) return '-';
  return val.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export default function MetricCard({ metric, data, months, canEdit, onSave }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(null); // { month, field }
  const [editValue, setEditValue] = useState('');

  const Icon = ICONS[metric.key] || BuildIcon;

  // Compute season totals
  let totalBudget = 0;
  let totalActual = 0;
  for (const m of months) {
    totalBudget += data[m]?.budget_value || 0;
    totalActual += data[m]?.actual_value || 0;
  }
  const variance = totalBudget - totalActual;
  const pct = totalBudget > 0 ? Math.min((totalActual / totalBudget) * 100, 100) : 0;

  // Determine current calendar month name
  const now = new Date();
  const calMonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const currentMonthName = calMonthNames[now.getMonth()];
  const currentInFiscal = months.includes(currentMonthName) ? currentMonthName : null;
  const curData = currentInFiscal ? (data[currentInFiscal] || {}) : {};

  const varianceColor = variance >= 0 ? 'success.main' : 'error.main';
  const progressColor = totalBudget > 0 && totalActual > totalBudget ? 'error' : 'primary';

  function handleStartEdit(month, field, currentVal) {
    if (!canEdit) return;
    setEditing({ month, field });
    setEditValue(currentVal || '');
  }

  function handleSave() {
    if (!editing) return;
    const numVal = parseFloat(editValue) || 0;
    onSave(metric.key, editing.month, editing.field, numVal);
    setEditing(null);
    setEditValue('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') { setEditing(null); setEditValue(''); }
  }

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flexGrow: 1 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Icon sx={{ mr: 1, color: 'primary.main', fontSize: 28 }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {metric.label}
          </Typography>
        </Box>

        {/* Season Totals */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="body2" color="text.secondary">Budget</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {fmt(totalBudget)} {metric.unit}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="body2" color="text.secondary">Actual</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {fmt(totalActual)} {metric.unit}
          </Typography>
        </Box>

        {/* Progress bar */}
        <Box sx={{ my: 1.5 }}>
          <LinearProgress
            variant="determinate"
            value={pct}
            color={progressColor}
            sx={{ height: 8, borderRadius: 4 }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', textAlign: 'right' }}>
            {pct.toFixed(0)}% of budget
          </Typography>
        </Box>

        {/* Variance */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="body2" color="text.secondary">Variance</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, color: varianceColor }}>
            {variance >= 0 ? '+' : ''}{fmt(variance)} {metric.unit}
            {variance >= 0 ? ' (under)' : ' (over)'}
          </Typography>
        </Box>

        {/* Current month highlight */}
        {currentInFiscal && (
          <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1, mb: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              Current Month: {currentInFiscal}
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
              <Typography variant="body2">
                Budget: {fmt(curData.budget_value)} | Actual: {fmt(curData.actual_value)}
              </Typography>
            </Box>
          </Box>
        )}

        {/* Expand toggle */}
        <Box sx={{ textAlign: 'center' }}>
          <Tooltip title={expanded ? 'Hide monthly detail' : 'Show monthly detail'}>
            <IconButton size="small" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Tooltip>
        </Box>

        {/* Monthly detail */}
        <Collapse in={expanded}>
          <TableContainer sx={{ mt: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, py: 0.5 }}>Month</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, py: 0.5 }}>Budget</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, py: 0.5 }}>Actual</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, py: 0.5 }}>Var</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {months.map(m => {
                  const md = data[m] || {};
                  const bv = md.budget_value || 0;
                  const av = md.actual_value || 0;
                  const v = bv - av;
                  const isEditing = editing?.month === m;

                  return (
                    <TableRow key={m} sx={m === currentInFiscal ? { bgcolor: 'action.selected' } : {}}>
                      <TableCell sx={{ py: 0.5 }}>{m}</TableCell>
                      <TableCell align="right" sx={{ py: 0.5, cursor: canEdit ? 'pointer' : 'default' }}>
                        {isEditing && editing.field === 'budget_value' ? (
                          <TextField
                            size="small"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={handleSave}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            sx={{ width: 80 }}
                            inputProps={{ style: { textAlign: 'right', padding: '2px 4px', fontSize: '0.8rem' } }}
                          />
                        ) : (
                          <span onClick={() => handleStartEdit(m, 'budget_value', bv)}>
                            {fmt(bv)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ py: 0.5, cursor: canEdit ? 'pointer' : 'default' }}>
                        {isEditing && editing.field === 'actual_value' ? (
                          <TextField
                            size="small"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={handleSave}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            sx={{ width: 80 }}
                            inputProps={{ style: { textAlign: 'right', padding: '2px 4px', fontSize: '0.8rem' } }}
                          />
                        ) : (
                          <span onClick={() => handleStartEdit(m, 'actual_value', av)}>
                            {fmt(av)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ py: 0.5, color: v >= 0 ? 'success.main' : 'error.main', fontWeight: 600 }}
                      >
                        {bv === 0 && av === 0 ? '-' : fmt(v)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Collapse>
      </CardContent>
    </Card>
  );
}
