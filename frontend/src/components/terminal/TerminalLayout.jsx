import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Tabs, Tab } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import InputIcon from '@mui/icons-material/Input';
import OutputIcon from '@mui/icons-material/Output';
import WarehouseIcon from '@mui/icons-material/Warehouse';
import ArticleIcon from '@mui/icons-material/Article';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { useFarm } from '../../contexts/FarmContext';

// Operations (physical grain flow): Incoming → Bins (WIP) → Outgoing (Finished Goods)
const OPS_TABS = [
  { label: 'Dashboard', path: '/terminal/dashboard', icon: <DashboardIcon /> },
  { label: 'Incoming', path: '/terminal/incoming', icon: <InputIcon /> },
  { label: 'Bins', path: '/terminal/bins', icon: <WarehouseIcon /> },
  { label: 'Outgoing', path: '/terminal/outgoing', icon: <OutputIcon /> },
];

// Commercial (contracts & settlements) — visually separated with spacing
const COMMERCIAL_TABS = [
  { label: 'Contracts', path: '/terminal/contracts', icon: <ArticleIcon />, roles: ['admin', 'manager'] },
  { label: 'Settlements', path: '/terminal/settlements', icon: <ReceiptLongIcon />, roles: ['admin', 'manager'] },
];

export default function TerminalLayout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentRole } = useFarm();

  const opsTabs = OPS_TABS.filter(t => !t.roles || t.roles.includes(currentRole));
  const commercialTabs = COMMERCIAL_TABS.filter(t => !t.roles || t.roles.includes(currentRole));
  const allTabs = [...opsTabs, ...commercialTabs];
  const currentTab = allTabs.findIndex(t => location.pathname.startsWith(t.path));

  return (
    <Box sx={{ width: '100%' }}>
      <Tabs
        value={currentTab >= 0 ? currentTab : 0}
        onChange={(_, idx) => navigate(allTabs[idx].path)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        {allTabs.map((tab, i) => (
          <Tab
            key={tab.path}
            label={tab.label}
            icon={tab.icon}
            iconPosition="start"
            sx={i === opsTabs.length ? { ml: 3, borderLeft: 1, borderColor: 'divider', pl: 3 } : undefined}
          />
        ))}
      </Tabs>
      {children}
    </Box>
  );
}
