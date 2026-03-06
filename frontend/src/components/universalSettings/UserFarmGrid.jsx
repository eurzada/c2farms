import { useState, useEffect, useCallback } from 'react';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Select, MenuItem, Typography, Alert, CircularProgress, Box, Chip, Stack,
} from '@mui/material';
import api from '../../services/api';

const ROLE_OPTIONS = [
  { value: '', label: 'No access' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
];

const ROLE_COLORS = {
  admin: 'error',
  manager: 'warning',
  viewer: 'info',
};

const ALL_MODULES = ['forecast', 'inventory', 'marketing', 'logistics', 'agronomy', 'enterprise'];

export default function UserFarmGrid() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(null);

  const fetchGrid = useCallback(async () => {
    try {
      const res = await api.get('/api/admin/users-grid');
      setData(res.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchGrid(); }, [fetchGrid]);

  const handleRoleChange = async (userId, farmId, currentRole, newRole) => {
    const key = `${userId}-${farmId}`;
    setSaving(key);
    try {
      if (!currentRole && newRole) {
        await api.post(`/api/admin/users/${userId}/farms/${farmId}`, { role: newRole });
      } else if (currentRole && !newRole) {
        await api.delete(`/api/admin/users/${userId}/farms/${farmId}`);
      } else {
        await api.patch(`/api/admin/users/${userId}/farms/${farmId}/role`, { role: newRole });
      }
      await fetchGrid();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update role');
    } finally {
      setSaving(null);
    }
  };

  const handleModuleToggle = async (userId, currentModules, mod) => {
    const modules = currentModules.includes(mod)
      ? currentModules.filter(m => m !== mod)
      : [...currentModules, mod];
    // Optimistic update
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        users: prev.users.map(u => u.id === userId ? { ...u, modules } : u),
      };
    });
    try {
      await api.patch(`/api/admin/users/${userId}/modules`, { modules });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update modules');
      fetchGrid();
    }
  };

  if (loading) return <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>;
  if (error) return <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>;
  if (!data) return null;

  const { users, farms, roleMatrix, adminFarmIds } = data;

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 'bold', minWidth: 160, position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 3 }}>
              User
            </TableCell>
            {farms.map(farm => (
              <TableCell key={farm.id} align="center" sx={{ fontWeight: 'bold', minWidth: 130 }}>
                <Typography variant="body2" fontWeight="bold" noWrap>{farm.name}</Typography>
                {!adminFarmIds.includes(farm.id) && (
                  <Chip label="read-only" size="small" variant="outlined" sx={{ mt: 0.5, fontSize: 10 }} />
                )}
              </TableCell>
            ))}
            <TableCell sx={{ fontWeight: 'bold', minWidth: 200 }}>Modules</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {users.map(user => {
            const userModules = user.modules || ALL_MODULES;
            return (
              <TableRow key={user.id} hover>
                <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1 }}>
                  <Typography variant="body2" fontWeight="medium">{user.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{user.email}</Typography>
                </TableCell>
                {farms.map(farm => {
                  const currentRole = roleMatrix[user.id]?.[farm.id] || '';
                  const isAdminFarm = adminFarmIds.includes(farm.id);
                  const isSaving = saving === `${user.id}-${farm.id}`;

                  return (
                    <TableCell key={farm.id} align="center">
                      {isSaving ? (
                        <CircularProgress size={20} />
                      ) : (
                        <Select
                          size="small"
                          value={currentRole}
                          disabled={!isAdminFarm}
                          onChange={(e) => handleRoleChange(user.id, farm.id, currentRole, e.target.value)}
                          sx={{ minWidth: 110, fontSize: 13 }}
                          displayEmpty
                          renderValue={(val) => {
                            if (!val) return <Typography variant="body2" color="text.disabled">No access</Typography>;
                            return <Chip label={val} size="small" color={ROLE_COLORS[val] || 'default'} />;
                          }}
                        >
                          {ROLE_OPTIONS.map(opt => (
                            <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                          ))}
                        </Select>
                      )}
                    </TableCell>
                  );
                })}
                <TableCell>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap">
                    {ALL_MODULES.map(mod => {
                      const active = userModules.includes(mod);
                      return (
                        <Chip
                          key={mod}
                          label={mod}
                          size="small"
                          variant={active ? 'filled' : 'outlined'}
                          color={active ? 'primary' : 'default'}
                          onClick={() => handleModuleToggle(user.id, userModules, mod)}
                          sx={{
                            fontSize: 11,
                            height: 22,
                            textTransform: 'capitalize',
                            cursor: 'pointer',
                            opacity: active ? 1 : 0.4,
                            mb: 0.5,
                          }}
                        />
                      );
                    })}
                  </Stack>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
