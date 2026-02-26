import { useState } from 'react';
import { Box, Typography, Tabs, Tab, Alert } from '@mui/material';
import { useFarm } from '../contexts/FarmContext';
import UserManagement from '../components/settings/UserManagement';
import BackupPanel from '../components/settings/BackupPanel';

function TabPanel({ children, value, index }) {
  return value === index ? <Box sx={{ pt: 2 }}>{children}</Box> : null;
}

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
        <Tab label="Users" />
        <Tab label="Backup" />
      </Tabs>

      <TabPanel value={tab} index={0}>
        <UserManagement />
      </TabPanel>
      <TabPanel value={tab} index={1}>
        <BackupPanel />
      </TabPanel>
    </Box>
  );
}
