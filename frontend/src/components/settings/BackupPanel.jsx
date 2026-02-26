import { useState } from 'react';
import { Box, Typography, Button, Alert } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import api from '../../services/api';
import { useFarm } from '../../contexts/FarmContext';

export default function BackupPanel() {
  const { currentFarm } = useFarm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleBackup = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post(`/api/farms/${currentFarm.id}/settings/backup`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `c2farms-backup-${currentFarm.name.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create backup');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Farm Data Backup</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Download a complete JSON backup of all farm data including assumptions, monthly budgets, frozen snapshots, categories, GL accounts, and actuals.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Button
        variant="contained"
        startIcon={<DownloadIcon />}
        onClick={handleBackup}
        disabled={loading}
      >
        {loading ? 'Generating...' : 'Download Backup'}
      </Button>
    </Box>
  );
}
