import { useState, useEffect } from 'react';
import {
  Box, TextField, Button, Typography, Alert, Paper,
  FormControl, Select, MenuItem, Checkbox, FormControlLabel,
  Table, TableBody, TableCell, TableHead, TableRow, CircularProgress,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import api from '../../services/api';

export default function BulkInvitePanel() {
  const [email, setEmail] = useState('');
  const [farms, setFarms] = useState([]);
  const [adminFarmIds, setAdminFarmIds] = useState([]);
  const [assignments, setAssignments] = useState({}); // { farmId: { checked, role } }
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/admin/users-grid').then(res => {
      setFarms(res.data.farms);
      setAdminFarmIds(res.data.adminFarmIds);
      const init = {};
      for (const f of res.data.farms) {
        init[f.id] = { checked: false, role: 'viewer' };
      }
      setAssignments(init);
    }).catch(err => {
      setError(err.response?.data?.error || 'Failed to load farms');
    }).finally(() => setLoading(false));
  }, []);

  const toggleFarm = (farmId) => {
    setAssignments(prev => ({
      ...prev,
      [farmId]: { ...prev[farmId], checked: !prev[farmId].checked },
    }));
  };

  const setRole = (farmId, role) => {
    setAssignments(prev => ({
      ...prev,
      [farmId]: { ...prev[farmId], role },
    }));
  };

  const handleSubmit = async () => {
    if (!email.trim()) {
      setError('Email is required');
      return;
    }

    const selected = Object.entries(assignments)
      .filter(([, v]) => v.checked)
      .map(([farmId, v]) => ({ farmId, role: v.role }));

    if (selected.length === 0) {
      setError('Select at least one farm');
      return;
    }

    setSubmitting(true);
    setError('');
    setResult(null);

    try {
      const res = await api.post('/api/admin/bulk-invite', { email: email.trim(), assignments: selected });
      setResult(res.data);
      setEmail('');
      // Reset checkboxes
      setAssignments(prev => {
        const reset = { ...prev };
        for (const key of Object.keys(reset)) reset[key] = { ...reset[key], checked: false };
        return reset;
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send invites');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>;

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Invite a user to multiple farms at once. If the user already has an account, they will be added directly. Otherwise, a pending invite will be created.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {result && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setResult(null)}>
          {result.message} &mdash; {result.results.map(r => `${r.farmId.slice(0, 8)}: ${r.status}`).join(', ')}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <TextField
          label="Email address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          size="small"
          fullWidth
          sx={{ mb: 2 }}
        />

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" />
              <TableCell>Farm</TableCell>
              <TableCell>Role</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {farms.map(farm => {
              const isAdmin = adminFarmIds.includes(farm.id);
              const a = assignments[farm.id] || { checked: false, role: 'viewer' };
              return (
                <TableRow key={farm.id}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={a.checked}
                      disabled={!isAdmin}
                      onChange={() => toggleFarm(farm.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{farm.name}</Typography>
                  </TableCell>
                  <TableCell>
                    <FormControl size="small" sx={{ minWidth: 110 }}>
                      <Select
                        value={a.role}
                        disabled={!isAdmin || !a.checked}
                        onChange={(e) => setRole(farm.id, e.target.value)}
                      >
                        <MenuItem value="viewer">Viewer</MenuItem>
                        <MenuItem value="manager">Manager</MenuItem>
                        <MenuItem value="admin">Admin</MenuItem>
                      </Select>
                    </FormControl>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>

      <Button
        variant="contained"
        startIcon={<SendIcon />}
        onClick={handleSubmit}
        disabled={submitting}
      >
        {submitting ? 'Sending...' : 'Send Invites'}
      </Button>
    </Box>
  );
}
