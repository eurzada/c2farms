import { useState, useEffect, useCallback } from 'react';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, IconButton, Typography, Alert, CircularProgress, Box, Chip,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../../services/api';

export default function PendingInvitesPanel() {
  const [invites, setInvites] = useState([]);
  const [farms, setFarms] = useState([]);
  const [adminFarmIds, setAdminFarmIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get('/api/admin/users-grid');
      setInvites(res.data.invites);
      setFarms(res.data.farms);
      setAdminFarmIds(res.data.adminFarmIds);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load invites');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCancel = async (inviteId) => {
    try {
      await api.delete(`/api/admin/invites/${inviteId}`);
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to cancel invite');
    }
  };

  const getFarmName = (farmId) => {
    const farm = farms.find(f => f.id === farmId);
    return farm ? farm.name : farmId.slice(0, 8);
  };

  if (loading) return <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>;
  if (error) return <Alert severity="error">{error}</Alert>;

  if (invites.length === 0) {
    return (
      <Alert severity="info">No pending invites across any farms.</Alert>
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 'bold' }}>Email</TableCell>
            <TableCell sx={{ fontWeight: 'bold' }}>Farm</TableCell>
            <TableCell sx={{ fontWeight: 'bold' }}>Role</TableCell>
            <TableCell sx={{ fontWeight: 'bold' }}>Created</TableCell>
            <TableCell sx={{ fontWeight: 'bold' }}>Expires</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {invites.map(invite => {
            const canCancel = adminFarmIds.includes(invite.farm_id);
            return (
              <TableRow key={invite.id} hover>
                <TableCell>
                  <Typography variant="body2">{invite.email}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{getFarmName(invite.farm_id)}</Typography>
                </TableCell>
                <TableCell>
                  <Chip label={invite.role} size="small" color="info" />
                </TableCell>
                <TableCell>
                  <Typography variant="caption">
                    {new Date(invite.created_at).toLocaleDateString()}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="caption">
                    {new Date(invite.expires_at).toLocaleDateString()}
                  </Typography>
                </TableCell>
                <TableCell>
                  <IconButton
                    size="small"
                    color="error"
                    disabled={!canCancel}
                    onClick={() => handleCancel(invite.id)}
                    title={canCancel ? 'Cancel invite' : 'Not admin on this farm'}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
