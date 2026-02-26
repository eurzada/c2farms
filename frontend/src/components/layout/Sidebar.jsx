import { useNavigate, useLocation } from 'react-router-dom';
import {
  Drawer, List, ListItemButton, ListItemIcon, ListItemText, Box, Divider,
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import TableChartIcon from '@mui/icons-material/TableChart';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ListAltIcon from '@mui/icons-material/ListAlt';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import { useFarm } from '../../contexts/FarmContext';

const NAV_ITEMS = [
  { label: '1. Yield & Assumptions', path: '/assumptions', icon: <SettingsIcon /> },
  { label: '2. Cost Forecast', path: '/cost-forecast', icon: <AccountBalanceIcon /> },
  { label: '3. Per-Unit', path: '/per-unit', icon: <TableChartIcon /> },
  { label: '4. Operations', path: '/operations', icon: <PrecisionManufacturingIcon /> },
  { label: '5. Dashboard', path: '/dashboard', icon: <DashboardIcon /> },
  { label: 'Chart of Accounts', path: '/chart-of-accounts', icon: <ListAltIcon /> },
];

export default function Sidebar({ width }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = useFarm();

  return (
    <Drawer
      variant="permanent"
      sx={{
        width,
        flexShrink: 0,
        '& .MuiDrawer-paper': { width, boxSizing: 'border-box', borderRight: (theme) => `1px solid ${theme.palette.divider}`, display: 'flex', flexDirection: 'column' },
      }}
    >
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <img
          src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='70' font-size='60'>🌾</text></svg>"
          alt="logo"
          style={{ width: 48, height: 48 }}
        />
      </Box>
      <Divider />
      <List sx={{ flexGrow: 1 }}>
        {NAV_ITEMS.map(item => (
          <ListItemButton
            key={item.path}
            selected={location.pathname === item.path}
            onClick={() => navigate(item.path)}
            sx={{
              mx: 1,
              borderRadius: 2,
              mb: 0.5,
              '&.Mui-selected': { bgcolor: 'primary.light', color: 'white' },
              '&.Mui-selected:hover': { bgcolor: 'primary.main' },
            }}
          >
            <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14 }} />
          </ListItemButton>
        ))}
      </List>
      {isAdmin && (
        <>
          <Divider />
          <List>
            <ListItemButton
              selected={location.pathname === '/settings'}
              onClick={() => navigate('/settings')}
              sx={{
                mx: 1,
                borderRadius: 2,
                mb: 0.5,
                '&.Mui-selected': { bgcolor: 'primary.light', color: 'white' },
                '&.Mui-selected:hover': { bgcolor: 'primary.main' },
              }}
            >
              <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}><AdminPanelSettingsIcon /></ListItemIcon>
              <ListItemText primary="Settings" primaryTypographyProps={{ fontSize: 14 }} />
            </ListItemButton>
          </List>
        </>
      )}
    </Drawer>
  );
}
