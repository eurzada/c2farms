import { useState, useEffect } from 'react';
import { Box, TextField, Button, Alert, Chip, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import SaveIcon from '@mui/icons-material/Save';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import CropInputs from './CropInputs';
import BinInputs from './BinInputs';
import FreezeDialog from './FreezeDialog';
import UnfreezeDialog from './UnfreezeDialog';
import AddFarmDialog from './AddFarmDialog';
import DeleteFarmDialog from './DeleteFarmDialog';
import { validateAssumptions } from '../../utils/validation';
import { CALENDAR_MONTHS } from '../../utils/fiscalYear';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';

export default function AssumptionsForm({ farmId, fiscalYear }) {
  const { currentFarm, refreshFarms, canEdit, isAdmin } = useFarm();
  const [data, setData] = useState({
    fiscal_year: fiscalYear,
    start_month: 'Nov',
    total_acres: 0,
    crops: [],
    bins: [],
  });
  const [isFrozen, setIsFrozen] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [unfreezeOpen, setUnfreezeOpen] = useState(false);
  const [addFarmOpen, setAddFarmOpen] = useState(false);
  const [deleteFarmOpen, setDeleteFarmOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [farmName, setFarmName] = useState('');

  useEffect(() => {
    if (currentFarm) {
      setFarmName(currentFarm.name || '');
    }
  }, [currentFarm]);

  useEffect(() => {
    if (!farmId || !fiscalYear) return;
    setLoading(true);
    api.get(`/api/farms/${farmId}/assumptions/${fiscalYear}`)
      .then(res => {
        setData({
          fiscal_year: res.data.fiscal_year,
          start_month: res.data.start_month || 'Nov',
          total_acres: res.data.total_acres,
          crops: res.data.crops_json || [],
          bins: res.data.bins_json || [],
        });
        setIsFrozen(res.data.is_frozen);
      })
      .catch(() => {
        setData({ fiscal_year: fiscalYear, start_month: 'Nov', total_acres: 0, crops: [], bins: [] });
        setIsFrozen(false);
      })
      .finally(() => setLoading(false));
  }, [farmId, fiscalYear]);

  const handleSave = async () => {
    const errors = validateAssumptions(data);
    if (errors) {
      setError(Object.values(errors).join(', '));
      return;
    }

    try {
      setError('');
      await api.post(`/api/farms/${farmId}/assumptions`, data);
      setSuccess('Assumptions saved successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    }
  };

  const handleFreeze = async () => {
    try {
      await api.post(`/api/farms/${farmId}/assumptions/${fiscalYear}/freeze`);
      setIsFrozen(true);
      setFreezeOpen(false);
      setSuccess('Budget frozen successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to freeze budget');
    }
  };

  const handleUnfreeze = async () => {
    try {
      await api.post(`/api/farms/${farmId}/assumptions/${fiscalYear}/unfreeze`);
      setIsFrozen(false);
      setUnfreezeOpen(false);
      setSuccess('Budget unfrozen successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to unfreeze budget');
    }
  };

  const handleFarmNameSave = async () => {
    if (!farmName.trim() || farmName.trim() === currentFarm?.name) return;
    try {
      await api.patch(`/api/farms/${farmId}`, { name: farmName.trim() });
      await refreshFarms();
      setSuccess('Farm name updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update farm name');
      setFarmName(currentFarm?.name || '');
    }
  };

  if (loading) return null;

  const cropAcresSum = data.crops.reduce((sum, c) => sum + (c.acres || 0), 0);

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

      <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center' }}>
        <TextField
          label="Farm Name"
          value={farmName}
          onChange={(e) => setFarmName(e.target.value)}
          onBlur={handleFarmNameSave}
          onKeyDown={(e) => e.key === 'Enter' && handleFarmNameSave()}
          size="small"
          disabled={!isAdmin}
        />
        <TextField
          label="Fiscal Year"
          type="number"
          value={data.fiscal_year}
          disabled
          size="small"
        />
        <FormControl size="small" sx={{ minWidth: 120 }} disabled={isFrozen || !canEdit}>
          <InputLabel>Start Month</InputLabel>
          <Select
            value={data.start_month || 'Nov'}
            label="Start Month"
            onChange={(e) => setData({ ...data, start_month: e.target.value })}
          >
            {CALENDAR_MONTHS.map(m => (
              <MenuItem key={m} value={m}>{m}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          label="Total Acres"
          type="number"
          value={data.total_acres || ''}
          onChange={(e) => setData({ ...data, total_acres: parseFloat(e.target.value) || 0 })}
          disabled={isFrozen || !canEdit}
          size="small"
        />
        <Chip
          label={`Crop Acres: ${cropAcresSum} / ${data.total_acres}`}
          color={cropAcresSum > data.total_acres ? 'error' : 'default'}
          variant="outlined"
        />
        {isFrozen && (
          <Chip icon={<LockIcon />} label="Budget Frozen" color="warning" />
        )}
      </Box>

      <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
        <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={() => setAddFarmOpen(true)}>
          Add Farm
        </Button>
        {isAdmin && (
          <Button variant="outlined" size="small" color="error" startIcon={<DeleteIcon />} onClick={() => setDeleteFarmOpen(true)}>
            Delete Farm
          </Button>
        )}
      </Box>

      <CropInputs
        crops={data.crops}
        onChange={(crops) => setData({ ...data, crops })}
        disabled={isFrozen || !canEdit}
      />

      <Box sx={{ mt: 3 }}>
        <BinInputs
          bins={data.bins}
          onChange={(bins) => setData({ ...data, bins })}
          disabled={isFrozen || !canEdit}
        />
      </Box>

      <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
        {!isFrozen && canEdit && (
          <>
            <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave}>
              Save Assumptions
            </Button>
            <Button
              variant="outlined"
              color="warning"
              startIcon={<AcUnitIcon />}
              onClick={() => setFreezeOpen(true)}
            >
              Freeze Budget
            </Button>
          </>
        )}
        {isFrozen && isAdmin && (
          <Button
            variant="outlined"
            color="info"
            startIcon={<LockOpenIcon />}
            onClick={() => setUnfreezeOpen(true)}
          >
            Unfreeze Budget
          </Button>
        )}
      </Box>

      <FreezeDialog
        open={freezeOpen}
        onConfirm={handleFreeze}
        onCancel={() => setFreezeOpen(false)}
        fiscalYear={fiscalYear}
      />
      <UnfreezeDialog
        open={unfreezeOpen}
        onConfirm={handleUnfreeze}
        onCancel={() => setUnfreezeOpen(false)}
        fiscalYear={fiscalYear}
      />
      <AddFarmDialog
        open={addFarmOpen}
        onClose={() => setAddFarmOpen(false)}
        onSuccess={refreshFarms}
      />
      <DeleteFarmDialog
        open={deleteFarmOpen}
        onClose={() => setDeleteFarmOpen(false)}
        onSuccess={refreshFarms}
        farm={currentFarm}
      />
    </Box>
  );
}
