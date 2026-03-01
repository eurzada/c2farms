import { useState } from 'react';
import { Box, Typography, Tabs, Tab } from '@mui/material';
import UserFarmGrid from '../components/universalSettings/UserFarmGrid';
import BulkInvitePanel from '../components/universalSettings/BulkInvitePanel';
import PendingInvitesPanel from '../components/universalSettings/PendingInvitesPanel';

function TabPanel({ children, value, index }) {
  return value === index ? <Box sx={{ pt: 2 }}>{children}</Box> : null;
}

export default function UniversalSettings() {
  const [tab, setTab] = useState(0);

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>
        All Users &amp; Roles
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Manage user access across all your farms in one place.
      </Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab label="User Roles" />
        <Tab label="Bulk Invite" />
        <Tab label="Pending Invites" />
      </Tabs>

      <TabPanel value={tab} index={0}>
        <UserFarmGrid />
      </TabPanel>
      <TabPanel value={tab} index={1}>
        <BulkInvitePanel />
      </TabPanel>
      <TabPanel value={tab} index={2}>
        <PendingInvitesPanel />
      </TabPanel>
    </Box>
  );
}
