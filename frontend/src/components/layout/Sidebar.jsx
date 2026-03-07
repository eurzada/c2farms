import { useNavigate, useLocation } from 'react-router-dom';
import {
  Drawer, List, ListItemButton, ListItemIcon, ListItemText, Box, Divider,
  Typography,
} from '@mui/material';
import TableChartIcon from '@mui/icons-material/TableChart';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ListAltIcon from '@mui/icons-material/ListAlt';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import WarehouseIcon from '@mui/icons-material/Warehouse';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import GrassIcon from '@mui/icons-material/Grass';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import GroupsIcon from '@mui/icons-material/Groups';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import SupervisorAccountIcon from '@mui/icons-material/SupervisorAccount';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useFarm } from '../../contexts/FarmContext';

// Farm Unit nav items (per-location data entry)
const FARM_UNIT_ITEMS = [
  { section: 'Agronomy' },
  { label: 'Crop Plan', path: '/agronomy', icon: <GrassIcon />, module: 'agronomy' },
  { label: 'Labour Plan', path: '/labour', icon: <GroupsIcon />, module: 'agronomy' },
  { section: 'Forecast' },
  { label: 'Cost Forecast', path: '/cost-forecast', icon: <AccountBalanceIcon />, module: 'forecast' },
  { label: 'Per-Unit', path: '/per-unit', icon: <TableChartIcon />, module: 'forecast' },
  { label: 'Operations', path: '/operations', icon: <PrecisionManufacturingIcon />, module: 'forecast' },
  { label: 'Dashboard', path: '/dashboard', icon: <DashboardIcon />, module: 'forecast' },
  { label: 'Chart of Accounts', path: '/chart-of-accounts', icon: <ListAltIcon />, module: 'forecast', adminOnly: true },
  { section: 'Operations' },
  { label: 'Bin Inventory', path: '/inventory/bins', icon: <WarehouseIcon />, module: 'inventory' },
];

// Enterprise nav items
const ENTERPRISE_ITEMS = [
  { section: 'Agronomy' },
  { label: 'Agronomy Rollup', path: '/enterprise/agronomy', icon: <GrassIcon />, module: 'agronomy', readOnly: true },
  { label: 'Agronomic Costs $', path: '/enterprise/agro-plan', icon: <AgricultureIcon />, module: 'agronomy', readOnly: true },
  { label: 'Labour Rollup', path: '/enterprise/labour', icon: <GroupsIcon />, module: 'agronomy', readOnly: true },
  { section: 'Data Entry' },
  { label: 'Grain Marketing', path: '/marketing', icon: <TrendingUpIcon />, module: 'marketing' },
  { label: 'Logistics', path: '/logistics', icon: <LocalShippingIcon />, module: 'logistics' },
  { label: 'Inventory', path: '/inventory', icon: <WarehouseIcon />, module: 'inventory' },
  { section: 'Forecast' },
  { label: 'Forecast Rollup', path: '/enterprise/forecast', icon: <DashboardIcon />, module: 'forecast', readOnly: true },
];

function SectionHeader({ label }) {
  return (
    <Typography
      variant="overline"
      sx={{ px: 2, pt: 1.5, pb: 0.5, display: 'block', color: 'text.disabled', fontSize: 10, letterSpacing: 1.2 }}
    >
      {label}
    </Typography>
  );
}

export default function Sidebar({ width }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, farms, hasModule, isEnterprise } = useFarm();
  const isAnyFarmAdmin = farms.some(f => f.role === 'admin');

  const items = isEnterprise ? ENTERPRISE_ITEMS : FARM_UNIT_ITEMS;
  const visibleItems = items.filter(item => {
    if (item.section) return true;
    if (item.module && !hasModule(item.module)) return false;
    if (item.adminOnly && !isAdmin) return false;
    return true;
  });

  const isSelected = (path) => {
    if (location.pathname === path) return true;
    // Prefix matching for module roots
    const prefixes = ['/inventory', '/marketing', '/logistics', '/agronomy', '/enterprise', '/labour'];
    for (const p of prefixes) {
      if (path === p && location.pathname.startsWith(p + '/')) return true;
      if (path.startsWith(p + '/') && location.pathname.startsWith(p + '/') && path === location.pathname) return true;
    }
    return false;
  };

  return (
    <Drawer
      variant="permanent"
      sx={{
        width,
        flexShrink: 0,
        '& .MuiDrawer-paper': { width, boxSizing: 'border-box', borderRight: (theme) => `1px solid ${theme.palette.divider}`, display: 'flex', flexDirection: 'column' },
      }}
    >
      <Box sx={{ p: 2, textAlign: 'center', cursor: 'pointer', bgcolor: 'secondary.dark', borderRadius: 0 }} onClick={() => navigate('/home')}>
        <img
          src="/logo.png"
          alt="C2 Farms"
          style={{ width: 150, height: 'auto', objectFit: 'contain' }}
        />
      </Box>
      <Divider />
      <List sx={{ flexGrow: 1 }}>
        {visibleItems.map((item, idx) =>
          item.section ? (
            <SectionHeader key={`s-${idx}`} label={item.section} />
          ) : (
            <ListItemButton
              key={item.path}
              selected={isSelected(item.path)}
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
              {item.readOnly && (
                <VisibilityIcon sx={{ fontSize: 14, color: 'text.disabled', ml: 0.5 }} />
              )}
            </ListItemButton>
          )
        )}
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
                  mx: 1, borderRadius: 2, mb: 0.5,
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
                  mx: 1, borderRadius: 2, mb: 0.5,
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
