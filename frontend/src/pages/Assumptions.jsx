import { useState, useEffect } from 'react';
import {
  Typography, Paper, Box, TextField, Button, Alert, FormControl,
  InputLabel, Select, MenuItem,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import AddFarmDialog from '../components/assumptions/AddFarmDialog';
import DeleteFarmDialog from '../components/assumptions/DeleteFarmDialog';
import { validateAssumptions } from '../utils/validation';
import { CALENDAR_MONTHS } from '../utils/fiscalYear';
import { useFarm } from '../contexts/FarmContext';
import api from '../services/api';

export default function Assumptions() {
  const { currentFarm, fiscalYear, refreshFarms, canEdit, isAdmin } = useFarm();
  const [data, setData] = useState({
    fiscal_year: fiscalYear,
    start_month: 'Nov',
    total_acres: 0,
    crops: [],
    bins: [],
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [addFarmOpen, setAddFarmOpen] = useState(false);
  const [deleteFarmOpen, setDeleteFarmOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [farmName, setFarmName] = useState('');

  useEffect(() => {
    if (currentFarm) setFarmName(currentFarm.name || '');
  }, [currentFarm]);

  useEffect(() => {
    if (!currentFarm?.id || !fiscalYear) return;
    setLoading(true);
    api.get(`/api/farms/${currentFarm.id}/assumptions/${fiscalYear}`)
      .then(res => {
        if (res.data) {
          setData({
            fiscal_year: res.data.fiscal_year,
            start_month: res.data.start_month || 'Nov',
            total_acres: res.data.total_acres,
            crops: res.data.crops_json || [],
            bins: res.data.bins_json || [],
          });
        } else {
          setData({ fiscal_year: fiscalYear, start_month: 'Nov', total_acres: 0, crops: [], bins: [] });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentFarm, fiscalYear]);

  const handleSave = async () => {
    const errors = validateAssumptions(data);
    if (errors) { setError(Object.values(errors).join(', ')); return; }
    try {
      setError('');
      await api.post(`/api/farms/${currentFarm.id}/assumptions`, data);
      setSuccess('Settings saved');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    }
  };

  const handleFarmNameSave = async () => {
    if (!farmName.trim() || farmName.trim() === currentFarm?.name) return;
    try {
      await api.patch(`/api/farms/${currentFarm.id}`, { name: farmName.trim() });
      await refreshFarms();
      setSuccess('Farm name updated'); setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update'); setFarmName(currentFarm?.name || '');
    }
  };

  if (!currentFarm) {
    return <Box sx={{ p: 3 }}><Typography color="text.secondary">No farm selected.</Typography></Box>;
  }
  if (loading) return null;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>Farm Settings</Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Farm & Fiscal Year</Typography>
        <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField label="Farm Name" value={farmName} onChange={e => setFarmName(e.target.value)}
            onBlur={handleFarmNameSave} onKeyDown={e => e.key === 'Enter' && handleFarmNameSave()}
            size="small" disabled={!isAdmin} />
          <TextField label="Fiscal Year" type="number" value={data.fiscal_year} disabled size="small" />
          <FormControl size="small" sx={{ minWidth: 120 }} disabled={!canEdit}>
            <InputLabel>Start Month</InputLabel>
            <Select value={data.start_month || 'Nov'} label="Start Month"
              onChange={e => setData({ ...data, start_month: e.target.value })}>
              {CALENDAR_MONTHS.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label="Total Acres" type="number" value={data.total_acres || ''}
            onChange={e => setData({ ...data, total_acres: parseFloat(e.target.value) || 0 })}
            disabled={!canEdit} size="small" />
        </Box>

        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={() => setAddFarmOpen(true)}>Add Farm</Button>
          {isAdmin && (
            <Button variant="outlined" size="small" color="error" startIcon={<DeleteIcon />}
              onClick={() => setDeleteFarmOpen(true)}>Delete Farm</Button>
          )}
        </Box>

        {canEdit && (
          <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave}>Save Settings</Button>
        )}
      </Paper>

      <AddFarmDialog open={addFarmOpen} onClose={() => setAddFarmOpen(false)} onSuccess={refreshFarms} />
      <DeleteFarmDialog open={deleteFarmOpen} onClose={() => setDeleteFarmOpen(false)} onSuccess={refreshFarms} farm={currentFarm} />
    </Box>
  );
}
