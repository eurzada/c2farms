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
import WarehouseIcon from '@mui/icons-material/Warehouse';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import SupervisorAccountIcon from '@mui/icons-material/SupervisorAccount';
import { useFarm } from '../../contexts/FarmContext';

const NAV_ITEMS = [
  { label: 'Yield & Assumptions', path: '/assumptions', icon: <SettingsIcon />, module: 'forecast' },
  { label: 'Cost Forecast', path: '/cost-forecast', icon: <AccountBalanceIcon />, module: 'forecast' },
  { label: 'Per-Unit', path: '/per-unit', icon: <TableChartIcon />, module: 'forecast' },
  { label: 'Operations', path: '/operations', icon: <PrecisionManufacturingIcon />, module: 'forecast' },
  { label: 'Dashboard', path: '/dashboard', icon: <DashboardIcon />, module: 'forecast' },
  { label: 'Grain Marketing', path: '/marketing', icon: <TrendingUpIcon />, module: 'marketing' },
  { label: 'Logistics', path: '/logistics', icon: <LocalShippingIcon />, module: 'logistics' },
  { label: 'Inventory Management', path: '/inventory', icon: <WarehouseIcon />, module: 'inventory' },
  { label: 'Chart of Accounts', path: '/chart-of-accounts', icon: <ListAltIcon />, module: 'forecast' },
];

export default function Sidebar({ width }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, farms, hasModule } = useFarm();
  const isAnyFarmAdmin = farms.some(f => f.role === 'admin');

  const visibleItems = NAV_ITEMS.filter(item => !item.module || hasModule(item.module));

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
        {visibleItems.map(item => (
          <ListItemButton
            key={item.path}
            selected={location.pathname === item.path || (item.path === '/inventory' && location.pathname.startsWith('/inventory')) || (item.path === '/marketing' && location.pathname.startsWith('/marketing')) || (item.path === '/logistics' && location.pathname.startsWith('/logistics'))}
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
      {(isAdmin || isAnyFarmAdmin) && (
        <>
          <Divider />
          <List>
            {isAdmin && (
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
            )}
            {isAnyFarmAdmin && (
              <ListItemButton
                selected={location.pathname === '/universal-settings'}
                onClick={() => navigate('/universal-settings')}
                sx={{
                  mx: 1,
                  borderRadius: 2,
                  mb: 0.5,
                  '&.Mui-selected': { bgcolor: 'primary.light', color: 'white' },
                  '&.Mui-selected:hover': { bgcolor: 'primary.main' },
                }}
              >
                <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}><SupervisorAccountIcon /></ListItemIcon>
                <ListItemText primary="All Users" primaryTypographyProps={{ fontSize: 14 }} />
              </ListItemButton>
            )}
          </List>
        </>
      )}
    </Drawer>
  );
}
