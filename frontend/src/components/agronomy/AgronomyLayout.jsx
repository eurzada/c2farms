import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Tabs, Tab } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import GrassIcon from '@mui/icons-material/Grass';
import ScienceIcon from '@mui/icons-material/Science';
import InventoryIcon from '@mui/icons-material/Inventory';

const TABS = [
  { label: 'Dashboard', path: '/agronomy/dashboard', icon: <DashboardIcon /> },
  { label: 'Plan Setup', path: '/agronomy/plan', icon: <GrassIcon /> },
  { label: 'Crop Inputs', path: '/agronomy/inputs', icon: <ScienceIcon /> },
  { label: 'Products', path: '/agronomy/products', icon: <InventoryIcon /> },
];

export default function AgronomyLayout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();

  const currentTab = TABS.findIndex(t => location.pathname.startsWith(t.path));

  return (
    <Box sx={{ width: '100%' }}>
      <Tabs
        value={currentTab >= 0 ? currentTab : 0}
        onChange={(_, idx) => navigate(TABS[idx].path)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        {TABS.map(tab => (
          <Tab key={tab.path} label={tab.label} icon={tab.icon} iconPosition="start" />
        ))}
      </Tabs>
      {children}
    </Box>
  );
}
