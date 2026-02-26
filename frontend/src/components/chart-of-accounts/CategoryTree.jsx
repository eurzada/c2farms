import { useState } from 'react';
import {
  Box, Paper, Table, TableHead, TableBody, TableRow, TableCell,
  IconButton, TextField, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, Select, MenuItem, FormControl, InputLabel, Alert,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import api from '../../services/api';

export default function CategoryTree({ categories, farmId, onRefresh, canEdit }) {
  const [editDialog, setEditDialog] = useState(null);
  const [addDialog, setAddDialog] = useState(false);
  const [form, setForm] = useState({ code: '', display_name: '', parent_code: '', category_type: 'INPUT' });
  const [error, setError] = useState('');

  // Build parent lookup
  const parentIds = new Set(categories.filter(c => c.parent_id).map(c => c.parent_id));
  const topLevel = categories.filter(c => !c.parent_id);

  const handleSave = async () => {
    try {
      setError('');
      if (editDialog) {
        await api.put(`/api/farms/${farmId}/categories/${editDialog.id}`, {
          display_name: form.display_name,
          sort_order: form.sort_order,
        });
      } else {
        await api.post(`/api/farms/${farmId}/categories`, {
          code: form.code,
          display_name: form.display_name,
          parent_code: form.parent_code || undefined,
          category_type: form.category_type,
          sort_order: form.sort_order || 0,
        });
      }
      setEditDialog(null);
      setAddDialog(false);
      onRefresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save category');
    }
  };

  const openEdit = (cat) => {
    setForm({ display_name: cat.display_name, sort_order: cat.sort_order });
    setEditDialog(cat);
  };

  const openAdd = () => {
    setForm({ code: '', display_name: '', parent_code: '', category_type: 'INPUT', sort_order: 0 });
    setAddDialog(true);
  };

  return (
    <Box>
      {canEdit && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
          <Button startIcon={<AddIcon />} variant="outlined" size="small" onClick={openAdd}>
            Add Category
          </Button>
        </Box>
      )}
      <Paper>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Category</TableCell>
              <TableCell>Code</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Level</TableCell>
              <TableCell>GL Accounts</TableCell>
              <TableCell width={60} />
            </TableRow>
          </TableHead>
          <TableBody>
            {categories.map(cat => {
              const indent = cat.level * 24;
              const isParent = parentIds.has(cat.id);
              return (
                <TableRow key={cat.id} sx={{ '& td': { py: 0.5 } }}>
                  <TableCell>
                    <Box sx={{ pl: `${indent}px`, fontWeight: isParent ? 'bold' : 'normal' }}>
                      {cat.display_name}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontFamily: 'monospace', fontSize: 12 }}>
                    {cat.code}
                  </TableCell>
                  <TableCell>{cat.category_type}</TableCell>
                  <TableCell>{cat.level}</TableCell>
                  <TableCell>
                    {/* Count of GL accounts mapped to this category would require enrichment */}
                    -
                  </TableCell>
                  <TableCell>
                    {canEdit && (
                      <IconButton size="small" onClick={() => openEdit(cat)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>

      {/* Edit / Add Dialog */}
      <Dialog open={!!editDialog || addDialog} onClose={() => { setEditDialog(null); setAddDialog(false); setError(''); }}>
        <DialogTitle>{editDialog ? 'Edit Category' : 'Add Category'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1, minWidth: 300 }}>
          {error && <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError('')}>{error}</Alert>}
          {!editDialog && (
            <TextField
              label="Code"
              value={form.code}
              onChange={e => setForm({ ...form, code: e.target.value })}
              size="small"
              sx={{ mt: 1 }}
            />
          )}
          <TextField
            label="Display Name"
            value={form.display_name}
            onChange={e => setForm({ ...form, display_name: e.target.value })}
            size="small"
            sx={{ mt: editDialog ? 1 : 0 }}
          />
          {!editDialog && (
            <>
              <FormControl size="small">
                <InputLabel>Parent</InputLabel>
                <Select
                  value={form.parent_code}
                  label="Parent"
                  onChange={e => setForm({ ...form, parent_code: e.target.value })}
                >
                  <MenuItem value="">None (top-level)</MenuItem>
                  {topLevel.map(c => (
                    <MenuItem key={c.code} value={c.code}>{c.display_name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small">
                <InputLabel>Type</InputLabel>
                <Select
                  value={form.category_type}
                  label="Type"
                  onChange={e => setForm({ ...form, category_type: e.target.value })}
                >
                  {['REVENUE', 'INPUT', 'LPM', 'LBF', 'INSURANCE'].map(t => (
                    <MenuItem key={t} value={t}>{t}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setEditDialog(null); setAddDialog(false); setError(''); }}>Cancel</Button>
          <Button variant="contained" onClick={handleSave}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
