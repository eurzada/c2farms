import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Tabs, Tab } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import InventoryIcon from '@mui/icons-material/Inventory2';
import DescriptionIcon from '@mui/icons-material/Description';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import CountertopsIcon from '@mui/icons-material/Countertops';
import { useFarm } from '../../contexts/FarmContext';

const TABS = [
  { label: 'Dashboard', path: '/inventory/dashboard', icon: <DashboardIcon /> },
  { label: 'Bin Inventory', path: '/inventory/bins', icon: <InventoryIcon /> },
  { label: 'Contracts', path: '/inventory/contracts', icon: <DescriptionIcon /> },
  { label: 'Reconciliation', path: '/inventory/recon', icon: <CompareArrowsIcon /> },
  { label: 'Bin Count', path: '/inventory/count', icon: <CountertopsIcon />, roles: ['admin', 'manager'] },
];

export default function InventoryLayout({ children }) {
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
