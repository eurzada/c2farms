import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Tabs, Tab } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn';
import DescriptionIcon from '@mui/icons-material/Description';
import PeopleIcon from '@mui/icons-material/People';

const TABS = [
  { label: 'Dashboard', path: '/marketing/dashboard', icon: <DashboardIcon /> },
  { label: 'Contracts', path: '/marketing/contracts', icon: <DescriptionIcon /> },
  { label: 'Buyers', path: '/marketing/buyers', icon: <PeopleIcon /> },
  { label: 'Valuation', path: '/marketing/valuation', icon: <MonetizationOnIcon /> },
];

export default function MarketingLayout({ children }) {
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
