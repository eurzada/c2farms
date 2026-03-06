import { useState } from 'react';
import { Box, Typography, Tabs, Tab, Alert } from '@mui/material';
import { useFarm } from '../contexts/FarmContext';
import BackupPanel from '../components/settings/BackupPanel';
import TabPanel from '../components/shared/TabPanel';

export default function Settings() {
  const { currentFarm, isAdmin } = useFarm();
  const [tab, setTab] = useState(0);

  if (!currentFarm) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">Please select a farm first.</Alert>
      </Box>
    );
  }

  if (!isAdmin) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Admin access required to view settings.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>
        Settings — {currentFarm.name}
      </Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab label="Backup" />
      </Tabs>

      <TabPanel value={tab} index={0}>
        <BackupPanel />
      </TabPanel>
    </Box>
  );
}
