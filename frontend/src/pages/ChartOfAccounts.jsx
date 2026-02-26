import { useState, useEffect, useCallback } from 'react';
import { Typography, Box, Button, Alert, Paper, Tabs, Tab } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useFarm } from '../contexts/FarmContext';
import api from '../services/api';
import CategoryTree from '../components/chart-of-accounts/CategoryTree';
import GlAccountTable from '../components/chart-of-accounts/GlAccountTable';

export default function ChartOfAccounts() {
  const { currentFarm, fiscalYear, canEdit } = useFarm();
  const [categories, setCategories] = useState([]);
  const [glAccounts, setGlAccounts] = useState([]);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(0);

  const fetchData = useCallback(async () => {
    if (!currentFarm?.id) return;
    try {
      const params = fiscalYear ? `?fiscal_year=${fiscalYear}` : '';
      const res = await api.get(`/api/farms/${currentFarm.id}/chart-of-accounts${params}`);
      setCategories(res.data.categories || []);
      setGlAccounts(res.data.glAccounts || []);
    } catch {
      setError('Failed to load chart of accounts');
    }
  }, [currentFarm?.id, fiscalYear]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleInit = async () => {
    try {
      await api.post(`/api/farms/${currentFarm.id}/chart-of-accounts/init`);
      await fetchData();
    } catch {
      setError('Failed to initialize chart of accounts');
    }
  };

  if (!currentFarm) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">No farm selected.</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5">Chart of Accounts</Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchData}>
            Refresh
          </Button>
          {categories.length === 0 && canEdit && (
            <Button variant="contained" onClick={handleInit}>
              Initialize from Template
            </Button>
          )}
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Paper sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tab label={`Categories (${categories.length})`} />
          <Tab label={`GL Accounts (${glAccounts.length})`} />
        </Tabs>
      </Paper>

      {tab === 0 && (
        <CategoryTree
          categories={categories}
          farmId={currentFarm.id}
          onRefresh={fetchData}
          canEdit={canEdit}
        />
      )}

      {tab === 1 && (
        <GlAccountTable
          glAccounts={glAccounts}
          categories={categories}
          farmId={currentFarm.id}
          fiscalYear={fiscalYear}
          onRefresh={fetchData}
          canEdit={canEdit}
        />
      )}
    </Box>
  );
}
