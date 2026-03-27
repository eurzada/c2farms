import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Tabs, Tab } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import PeopleIcon from '@mui/icons-material/People';
import SendIcon from '@mui/icons-material/Send';
import { useFarm } from '../../contexts/FarmContext';

const TABS = [
  { label: 'Dashboard', path: '/logistics/dashboard', icon: <DashboardIcon /> },
  { label: 'Dispatch', path: '/logistics/dispatch', icon: <SendIcon /> },
  { label: 'Tickets', path: '/logistics/tickets', icon: <LocalShippingIcon /> },
  { label: 'Settlements', path: '/logistics/settlements', icon: <ReceiptLongIcon /> },
  { label: 'Settlement Recon', path: '/logistics/settlement-recon', icon: <AutoFixHighIcon />, roles: ['admin', 'manager'] },
  { label: 'Truckers', path: '/logistics/truckers', icon: <PeopleIcon />, roles: ['admin'] },
];

export default function LogisticsLayout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentRole } = useFarm();

  const visibleTabs = TABS.filter(t => !t.roles || t.roles.includes(currentRole));
  const currentTab = visibleTabs.findIndex(t => location.pathname.startsWith(t.path));

  return (
    <Box sx={{ width: '100%' }}>
      <Tabs
        value={currentTab >= 0 ? currentTab : 0}
        onChange={(_, idx) => navigate(visibleTabs[idx].path)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        {visibleTabs.map(tab => (
          <Tab key={tab.path} label={tab.label} icon={tab.icon} iconPosition="start" />
        ))}
      </Tabs>
      {children}
    </Box>
  );
}
