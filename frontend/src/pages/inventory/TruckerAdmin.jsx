import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, Stack, TextField, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Paper, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, Chip,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';

export default function TruckerAdmin() {
  const { currentFarm, isAdmin } = useFarm();
  const [truckers, setTruckers] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', password: '' });
  const [error, setError] = useState('');

  const fetchTruckers = useCallback(async () => {
    if (!currentFarm) return;
    try {
      const { data } = await api.get(`/api/farms/${currentFarm.id}/truckers`);
      setTruckers(data.truckers || []);
    } catch (err) {
      console.error('Failed to load truckers:', err);
    }
  }, [currentFarm]);

  useEffect(() => { fetchTruckers(); }, [fetchTruckers]);

  const handleAdd = async () => {
    setError('');
    if (!form.email || !form.name || !form.password) {
      setError('All fields are required');
      return;
    }
    try {
      await api.post(`/api/farms/${currentFarm.id}/truckers`, form);
      setAddOpen(false);
      setForm({ email: '', name: '', password: '' });
      fetchTruckers();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add trucker');
    }
  };

  const handleRemove = async (userId, name) => {
    if (!confirm(`Remove ${name} from this farm?`)) return;
    try {
      await api.delete(`/api/farms/${currentFarm.id}/truckers/${userId}`);
      fetchTruckers();
    } catch (err) {
      console.error('Failed to remove trucker:', err);
    }
  };

  if (!isAdmin) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Admin access required.</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>Trucker Accounts</Typography>
          <Typography variant="body2" color="text.secondary">
            Manage mobile app access for truckers
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => setAddOpen(true)}>
          Add Trucker
        </Button>
      </Stack>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell align="right">Tickets</TableCell>
              <TableCell>Last Active</TableCell>
              <TableCell width={60} />
            </TableRow>
          </TableHead>
          <TableBody>
            {truckers.map(t => (
              <TableRow key={t.id}>
                <TableCell>{t.name}</TableCell>
                <TableCell>{t.email}</TableCell>
                <TableCell>
                  <Chip label={t.role} size="small" color={t.role === 'admin' ? 'primary' : 'default'} />
                </TableCell>
                <TableCell align="right">{t.ticket_count}</TableCell>
                <TableCell>
                  {t.last_active ? new Date(t.last_active).toLocaleDateString() : '—'}
                </TableCell>
                <TableCell>
                  {t.role !== 'admin' && (
                    <IconButton size="small" color="error" onClick={() => handleRemove(t.id, t.name)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {truckers.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No users found. Add a trucker to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Add Trucker Dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Trucker</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              fullWidth
            />
            <TextField
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              fullWidth
            />
            <TextField
              label="Temporary Password"
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              helperText="Give this to the trucker for first login"
              fullWidth
            />
            {error && <Typography color="error" variant="body2">{error}</Typography>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAdd}>Add</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
