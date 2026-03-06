import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Paper, Select, MenuItem, IconButton, Chip, Alert,
  Checkbox, FormControlLabel, Stack,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import api from '../../services/api';
import { useFarm } from '../../contexts/FarmContext';
import { useAuth } from '../../contexts/AuthContext';
import InviteDialog from './InviteDialog';

const ROLE_COLORS = { admin: 'error', manager: 'warning', viewer: 'default' };
const DEFAULT_MODULES = ['forecast', 'inventory', 'marketing', 'logistics', 'agronomy', 'enterprise'];

export default function UserManagement() {
  const { currentFarm } = useFarm();
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [error, setError] = useState('');

  const farmId = currentFarm?.id;

  const fetchUsers = useCallback(async () => {
    if (!farmId) return;
    try {
      const { data } = await api.get(`/api/farms/${farmId}/settings/users`);
      setUsers(data.users);
      setInvites(data.invites);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load users');
    }
  }, [farmId]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleRoleChange = async (userId, newRole) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
    try {
      await api.patch(`/api/farms/${farmId}/settings/users/${userId}`, { role: newRole });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update role');
      fetchUsers(); // revert on error
    }
  };

  const handleModuleToggle = async (userId, module, currentModules) => {
    const modules = currentModules.includes(module)
      ? currentModules.filter(m => m !== module)
      : [...currentModules, module];
    // Optimistically update local state so user doesn't jump in the list
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, modules } : u));
    try {
      await api.patch(`/api/farms/${farmId}/settings/users/${userId}`, { modules });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update modules');
      fetchUsers(); // revert on error
    }
  };

  const handleRemoveUser = async (userId) => {
    if (!confirm('Remove this user from the farm?')) return;
    try {
      await api.delete(`/api/farms/${farmId}/settings/users/${userId}`);
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove user');
    }
  };

  const handleCancelInvite = async (inviteId) => {
    try {
      await api.delete(`/api/farms/${farmId}/settings/invites/${inviteId}`);
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to cancel invite');
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Team Members</Typography>
        <Button
          variant="contained"
          startIcon={<PersonAddIcon />}
          onClick={() => setInviteOpen(true)}
        >
          Invite User
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Modules</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map(u => (
              <TableRow key={u.id}>
                <TableCell>{u.name}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  <Select
                    size="small"
                    value={u.role}
                    onChange={(e) => handleRoleChange(u.id, e.target.value)}
                    disabled={u.id === user?.id && users.filter(x => x.role === 'admin').length <= 1}
                    sx={{ minWidth: 110 }}
                  >
                    <MenuItem value="admin">Admin</MenuItem>
                    <MenuItem value="manager">Manager</MenuItem>
                    <MenuItem value="viewer">Viewer</MenuItem>
                  </Select>
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0} flexWrap="wrap">
                    {['forecast', 'inventory', 'marketing', 'logistics', 'agronomy', 'enterprise'].map(mod => (
                      <FormControlLabel
                        key={mod}
                        control={
                          <Checkbox
                            size="small"
                            checked={(u.modules || DEFAULT_MODULES).includes(mod)}
                            onChange={() => handleModuleToggle(u.id, mod, u.modules || DEFAULT_MODULES)}
                          />
                        }
                        label={<Typography variant="caption" sx={{ textTransform: 'capitalize' }}>{mod}</Typography>}
                      />
                    ))}
                  </Stack>
                </TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleRemoveUser(u.id)}
                    disabled={u.id === user?.id}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {invites.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle1" gutterBottom>Pending Invites</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Email</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Expires</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {invites.map(inv => (
                  <TableRow key={inv.id}>
                    <TableCell>{inv.email}</TableCell>
                    <TableCell>
                      <Chip label={inv.role} size="small" color={ROLE_COLORS[inv.role] || 'default'} variant="outlined" />
                    </TableCell>
                    <TableCell>{new Date(inv.expires_at).toLocaleDateString()}</TableCell>
                    <TableCell align="right">
                      <IconButton size="small" color="error" onClick={() => handleCancelInvite(inv.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        farmId={farmId}
        onInvited={fetchUsers}
      />
    </Box>
  );
}
