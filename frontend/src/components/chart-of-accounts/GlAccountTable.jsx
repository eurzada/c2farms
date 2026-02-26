import { useState } from 'react';
import {
  Box, Paper, Table, TableHead, TableBody, TableRow, TableCell,
  Select, MenuItem, TextField, Button, Alert, IconButton,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import api from '../../services/api';

const fmtCurrency = (v) => {
  if (v == null) return '$0';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

export default function GlAccountTable({ glAccounts, categories, farmId, fiscalYear, onRefresh, canEdit }) {
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [addForm, setAddForm] = useState({ account_number: '', account_name: '', category_code: '' });
  const [deactivateTarget, setDeactivateTarget] = useState(null);

  // Leaf categories for mapping
  const parentIds = new Set(categories.filter(c => c.parent_id).map(c => c.parent_id));
  const leafCategories = categories.filter(c => !parentIds.has(c.id));

  const handleCategoryChange = (accountId, categoryCode) => {
    setEdits(prev => ({ ...prev, [accountId]: categoryCode }));
  };

  const handleSaveAll = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const assignments = Object.entries(edits).map(([accountId, categoryCode]) => {
        const gl = glAccounts.find(a => a.id === accountId);
        return { account_number: gl?.account_number, category_code: categoryCode };
      }).filter(a => a.account_number);

      if (assignments.length > 0) {
        await api.post(`/api/farms/${farmId}/gl-accounts/bulk-assign`, {
          assignments,
          fiscal_year: fiscalYear,
        });
      }
      setEdits({});
      setSuccess(fiscalYear ? `Saved. Accounting data recalculated for FY ${fiscalYear}.` : 'Saved.');
      onRefresh();
    } catch {
      setError('Failed to save assignments');
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    if (!addForm.account_number || !addForm.account_name) return;
    try {
      await api.post(`/api/farms/${farmId}/gl-accounts`, {
        accounts: [{
          account_number: addForm.account_number,
          account_name: addForm.account_name,
          category_code: addForm.category_code || undefined,
        }],
      });
      setAddForm({ account_number: '', account_name: '', category_code: '' });
      onRefresh();
    } catch {
      setError('Failed to add GL account');
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    try {
      await api.put(`/api/farms/${farmId}/gl-accounts/${deactivateTarget.id}`, {
        is_active: false,
        fiscal_year: fiscalYear,
      });
      setDeactivateTarget(null);
      setSuccess(`Deactivated "${deactivateTarget.account_name}". Accounting totals recalculated.`);
      onRefresh();
    } catch {
      setError('Failed to deactivate GL account');
      setDeactivateTarget(null);
    }
  };

  const dirtyCount = Object.keys(edits).length;

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {dirtyCount > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleSaveAll}
            disabled={saving}
          >
            Save {dirtyCount} Change{dirtyCount > 1 ? 's' : ''}
          </Button>
        </Box>
      )}

      <Paper>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Account #</TableCell>
              <TableCell>Account Name</TableCell>
              <TableCell>Category</TableCell>
              {fiscalYear && <TableCell align="right">YTD Total</TableCell>}
              <TableCell sx={{ width: 48 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {/* Add new row */}
            {canEdit && (
              <TableRow sx={{ '& td': { py: 0.5 } }}>
                <TableCell>
                  <TextField
                    size="small"
                    placeholder="Account #"
                    value={addForm.account_number}
                    onChange={e => setAddForm({ ...addForm, account_number: e.target.value })}
                    sx={{ width: 100 }}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    placeholder="Account Name"
                    value={addForm.account_name}
                    onChange={e => setAddForm({ ...addForm, account_name: e.target.value })}
                    sx={{ width: 200 }}
                  />
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Select
                      size="small"
                      value={addForm.category_code}
                      onChange={e => setAddForm({ ...addForm, category_code: e.target.value })}
                      displayEmpty
                      sx={{ minWidth: 160 }}
                    >
                      <MenuItem value="">Unmapped</MenuItem>
                      {leafCategories.map(c => (
                        <MenuItem key={c.code} value={c.code}>{c.display_name}</MenuItem>
                      ))}
                    </Select>
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={handleAdd}
                      disabled={!addForm.account_number || !addForm.account_name}
                    >
                      <SaveIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </TableCell>
                {fiscalYear && <TableCell />}
                <TableCell />
              </TableRow>
            )}

            {/* Existing accounts */}
            {glAccounts.map(gl => {
              const currentCategoryCode = edits[gl.id] ?? gl.category?.code ?? '';
              return (
                <TableRow key={gl.id} sx={{ '& td': { py: 0.5 } }}>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{gl.account_number}</TableCell>
                  <TableCell>{gl.account_name}</TableCell>
                  <TableCell>
                    <Select
                      size="small"
                      value={currentCategoryCode}
                      onChange={e => handleCategoryChange(gl.id, e.target.value)}
                      displayEmpty
                      disabled={!canEdit}
                      sx={{ minWidth: 160 }}
                    >
                      <MenuItem value="">Unmapped</MenuItem>
                      {leafCategories.map(c => (
                        <MenuItem key={c.code} value={c.code}>{c.display_name}</MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                  {fiscalYear && (
                    <TableCell align="right" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      {fmtCurrency(gl.ytd_total)}
                    </TableCell>
                  )}
                  <TableCell>
                    {canEdit && (
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => setDeactivateTarget(gl)}
                        title="Deactivate account"
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>

      {/* Deactivate confirmation dialog */}
      <Dialog open={!!deactivateTarget} onClose={() => setDeactivateTarget(null)}>
        <DialogTitle>Deactivate GL Account</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Deactivate "{deactivateTarget?.account_name}"? Its amounts will be excluded from accounting totals.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeactivateTarget(null)}>Cancel</Button>
          <Button onClick={handleDeactivate} color="error" variant="contained">
            Deactivate
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
