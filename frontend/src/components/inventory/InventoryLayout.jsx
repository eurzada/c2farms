import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Tabs, Tab } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import InventoryIcon from '@mui/icons-material/Inventory2';
import DescriptionIcon from '@mui/icons-material/Description';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import CountertopsIcon from '@mui/icons-material/Countertops';
import TimelineIcon from '@mui/icons-material/Timeline';
import GradingIcon from '@mui/icons-material/Grade';
import { useFarm } from '../../contexts/FarmContext';

const TABS = [
  { label: 'Dashboard', path: '/inventory/dashboard', icon: <DashboardIcon />, enterprise: true },
  { label: 'Bin Inventory', path: '/inventory/bins', icon: <InventoryIcon /> },
  { label: 'Grading', path: '/inventory/grading', icon: <GradingIcon />, enterprise: true },
  { label: 'Count History', path: '/inventory/history', icon: <TimelineIcon />, enterprise: true },
  { label: 'Contracts', path: '/inventory/contracts', icon: <DescriptionIcon />, enterprise: true },
  { label: 'Reconciliation', path: '/inventory/recon', icon: <CompareArrowsIcon />, enterprise: true },
  { label: 'Bin Count', path: '/inventory/count', icon: <CountertopsIcon />, roles: ['admin', 'manager'] },
];

export default function InventoryLayout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentRole, isEnterprise } = useFarm();

  const visibleTabs = TABS.filter(t => {
    if (t.roles && !t.roles.includes(currentRole)) return false;
    // In farm-unit mode, hide enterprise-only tabs
    if (!isEnterprise && t.enterprise) return false;
    return true;
  });

  // If only one tab visible (farm-unit with just Bins), skip the tab bar
  if (visibleTabs.length <= 1) {
    return <Box sx={{ width: '100%' }}>{children}</Box>;
  }

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
