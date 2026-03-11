import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Tabs, Tab } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import InputIcon from '@mui/icons-material/Input';
import OutputIcon from '@mui/icons-material/Output';
import WarehouseIcon from '@mui/icons-material/Warehouse';
import BlenderIcon from '@mui/icons-material/Blender';
import ArticleIcon from '@mui/icons-material/Article';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { useFarm } from '../../contexts/FarmContext';

const TABS = [
  { label: 'Dashboard', path: '/terminal/dashboard', icon: <DashboardIcon /> },
  { label: 'Incoming', path: '/terminal/incoming', icon: <InputIcon /> },
  { label: 'Outgoing', path: '/terminal/outgoing', icon: <OutputIcon /> },
  { label: 'Bins', path: '/terminal/bins', icon: <WarehouseIcon /> },
  { label: 'Blending', path: '/terminal/blending', icon: <BlenderIcon /> },
  { label: 'Contracts', path: '/terminal/contracts', icon: <ArticleIcon />, roles: ['admin', 'manager'] },
  { label: 'Settlements', path: '/terminal/settlements', icon: <ReceiptLongIcon />, roles: ['admin', 'manager'] },
];

export default function TerminalLayout({ children }) {
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
