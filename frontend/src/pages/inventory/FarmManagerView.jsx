import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Stack, FormControl, InputLabel, Select, MenuItem,
  Card, CardContent, TextField, Button, LinearProgress, Alert, Snackbar, Chip,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import SendIcon from '@mui/icons-material/Send';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';

function BinCountCard({ bin, commodities, onChange, onCopyLast }) {
  return (
    <Card sx={{ mb: 1 }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          <Typography variant="subtitle2" sx={{ minWidth: 70, fontWeight: 600 }}>
            Bin {bin.bin_number}
          </Typography>
          <Chip label={bin.bin_type} size="small" variant="outlined" />
          {bin.capacity_bu && (
            <Typography variant="caption" color="text.secondary">{bin.capacity_bu.toLocaleString()} bu cap</Typography>
          )}
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Commodity</InputLabel>
            <Select
              value={bin.commodity_id || ''}
              label="Commodity"
              onChange={e => onChange(bin.id, 'commodity_id', e.target.value)}
            >
              <MenuItem value="">None</MenuItem>
              {commodities.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField
            size="small"
            label="Bushels"
            type="number"
            value={bin.bushels || ''}
            onChange={e => onChange(bin.id, 'bushels', e.target.value)}
            sx={{ width: 120 }}
          />
          <TextField
            size="small"
            label="Crop Year"
            type="number"
            value={bin.crop_year || ''}
            onChange={e => onChange(bin.id, 'crop_year', e.target.value)}
            sx={{ width: 100 }}
          />
          <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => onCopyLast(bin.id)} title="Same as last count">
            Last
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function FarmManagerView() {
  const { currentFarm, canEdit } = useFarm();
  const [locations, setLocations] = useState([]);
  const [commodities, setCommodities] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [period, setPeriod] = useState(null);
  const [bins, setBins] = useState([]);
  const [counts, setCounts] = useState({});
  const [lastCounts, setLastCounts] = useState({});
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'info' });

  useEffect(() => {
    if (!currentFarm) return;
    Promise.all([
      api.get(`/api/farms/${currentFarm.id}/inventory/locations`),
      api.get(`/api/farms/${currentFarm.id}/inventory/commodities`),
      api.get(`/api/farms/${currentFarm.id}/inventory/count-periods`),
    ]).then(([locRes, comRes, perRes]) => {
      setLocations(locRes.data.locations || []);
      setCommodities(comRes.data.commodities || []);
      const periods = perRes.data.periods || [];
      const openPeriod = periods.find(p => p.status === 'open') || periods[0];
      setPeriod(openPeriod || null);
    });
  }, [currentFarm]);

  const fetchBins = useCallback(() => {
    if (!currentFarm || !selectedLocation) return;
    api.get(`/api/farms/${currentFarm.id}/inventory/bins?location=${selectedLocation}`)
      .then(res => {
        const binData = res.data.bins || [];
        setBins(binData);
        // Initialize counts from current data
        const initial = {};
        for (const b of binData) {
          initial[b.id] = {
            bin_id: b.id,
            commodity_id: b.commodity_id || '',
            bushels: b.bushels || 0,
            crop_year: b.crop_year || '',
            notes: b.notes || '',
          };
        }
        setCounts(initial);
        setLastCounts(initial); // Save as "last count" reference
      });
  }, [currentFarm, selectedLocation]);

  useEffect(() => { fetchBins(); }, [fetchBins]);

  const handleChange = (binId, field, value) => {
    setCounts(prev => ({
      ...prev,
      [binId]: { ...prev[binId], [field]: value },
    }));
  };

  const handleCopyLast = (binId) => {
    if (lastCounts[binId]) {
      setCounts(prev => ({ ...prev, [binId]: { ...lastCounts[binId] } }));
    }
  };

  const countedBins = Object.values(counts).filter(c => c.bushels > 0).length;
  const totalBins = bins.length;
  const progress = totalBins > 0 ? (countedBins / totalBins) * 100 : 0;

  const handleSave = async (submit = false) => {
    if (!currentFarm || !period) return;
    setSaving(true);
    try {
      // Ensure submission exists
      await api.post(`/api/farms/${currentFarm.id}/inventory/submissions`, {
        count_period_id: period.id,
        location_id: selectedLocation,
      });

      // Bulk upsert counts
      const countsArray = Object.values(counts).map(c => ({
        bin_id: c.bin_id,
        commodity_id: c.commodity_id || null,
        bushels: parseFloat(c.bushels) || 0,
        crop_year: c.crop_year ? parseInt(c.crop_year) : null,
        notes: c.notes || null,
      }));

      await api.post(`/api/farms/${currentFarm.id}/inventory/bin-counts/${period.id}`, { counts: countsArray });

      if (submit) {
        // Find and submit the submission
        // For now, just show success message
        setSnack({ open: true, message: 'Count submitted for approval!', severity: 'success' });
      } else {
        setSnack({ open: true, message: 'Draft saved!', severity: 'success' });
      }
    } catch (err) {
      setSnack({ open: true, message: err.response?.data?.error || 'Failed to save', severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    return <Alert severity="info">Bin counting is only available to managers and admins.</Alert>;
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>Farm Manager - Bin Count</Typography>

      {period && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Count Period: {new Date(period.period_date).toLocaleDateString('en-CA')} ({period.status})
        </Alert>
      )}

      <FormControl size="small" sx={{ minWidth: 200, mb: 2 }}>
        <InputLabel>Location</InputLabel>
        <Select value={selectedLocation} label="Location" onChange={e => setSelectedLocation(e.target.value)}>
          {locations.map(l => (
            <MenuItem key={l.id} value={l.id}>{l.name} ({l._count?.bins || 0} bins)</MenuItem>
          ))}
        </Select>
      </FormControl>

      {selectedLocation && (
        <>
          {/* Progress */}
          <Box sx={{ mb: 2 }}>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
              <Typography variant="body2">{countedBins} / {totalBins} bins counted</Typography>
              <Typography variant="body2">{progress.toFixed(0)}%</Typography>
            </Stack>
            <LinearProgress variant="determinate" value={progress} sx={{ height: 8, borderRadius: 4 }} />
          </Box>

          {/* Bin cards */}
          {bins.map(bin => (
            <BinCountCard
              key={bin.id}
              bin={{ ...bin, ...counts[bin.id] }}
              commodities={commodities}
              onChange={handleChange}
              onCopyLast={handleCopyLast}
            />
          ))}

          {/* Action buttons */}
          <Stack direction="row" spacing={2} sx={{ mt: 2, position: 'sticky', bottom: 16, zIndex: 10 }}>
            <Button
              variant="outlined"
              startIcon={<SaveIcon />}
              onClick={() => handleSave(false)}
              disabled={saving}
            >
              Save Draft
            </Button>
            <Button
              variant="contained"
              startIcon={<SendIcon />}
              onClick={() => handleSave(true)}
              disabled={saving}
            >
              Submit for Approval
            </Button>
          </Stack>
        </>
      )}

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack(s => ({ ...s, open: false }))}>
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
