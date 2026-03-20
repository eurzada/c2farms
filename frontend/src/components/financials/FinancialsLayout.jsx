import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Tabs, Tab } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import TableChartIcon from '@mui/icons-material/TableChart';
import ListAltIcon from '@mui/icons-material/ListAlt';
import { useFarm } from '../../contexts/FarmContext';

const TABS = [
  { label: 'Dashboard', path: '/financials/dashboard', icon: <DashboardIcon /> },
  { label: 'Cost Forecast', path: '/financials/cost-forecast', icon: <AccountBalanceIcon /> },
  { label: 'Per-Unit', path: '/financials/per-unit', icon: <TableChartIcon /> },
  { label: 'Chart of Accounts', path: '/financials/chart-of-accounts', icon: <ListAltIcon />, roles: ['admin'] },
];

export default function FinancialsLayout({ children }) {
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
