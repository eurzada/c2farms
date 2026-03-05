import { AppBar, Toolbar, Typography, Button, Select, MenuItem, Box, IconButton, Chip, ListSubheader, Divider } from '@mui/material';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import BusinessIcon from '@mui/icons-material/Business';
import { useAuth } from '../../contexts/AuthContext';
import { useFarm, ENTERPRISE_ID } from '../../contexts/FarmContext';
import { useThemeMode } from '../../contexts/ThemeContext';

const ROLE_COLORS = {
  admin: 'error',
  manager: 'warning',
  viewer: 'default',
};

export default function Header() {
  const { user, logout } = useAuth();
  const { selectedId, farms, setCurrentFarm, fiscalYear, setFiscalYear, currentRole, isEnterprise } = useFarm();
  const { mode, toggleMode } = useThemeMode();

  return (
    <AppBar position="static" color="default" elevation={1} sx={{ bgcolor: 'background.paper' }}>
      <Toolbar>
        <Typography variant="h6" sx={{ flexGrow: 1, color: 'primary.main', fontWeight: 700 }}>
          C2 Farms
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {farms.length > 0 && (
            <Select
              size="small"
              value={selectedId || ''}
              onChange={(e) => {
                const farm = farms.find(f => f.id === e.target.value);
                if (farm) setCurrentFarm(farm);
              }}
              renderValue={(val) => {
                const f = farms.find(f => f.id === val);
                return f?.name || '';
              }}
            >
              {farms.filter(f => f.id === ENTERPRISE_ID).map(f => (
                <MenuItem key={f.id} value={f.id} sx={{ fontWeight: 'bold' }}>
                  <BusinessIcon sx={{ fontSize: 18, mr: 1, color: 'primary.main' }} />
                  {f.name}
                </MenuItem>
              ))}
              <Divider />
              <ListSubheader sx={{ lineHeight: '32px', fontSize: 12 }}>Farm Units</ListSubheader>
              {farms.filter(f => f.id !== ENTERPRISE_ID).map(f => (
                <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>
              ))}
            </Select>
          )}

          <Select
            size="small"
            value={fiscalYear}
            onChange={(e) => setFiscalYear(e.target.value)}
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
              <MenuItem key={y} value={y}>FY {y}</MenuItem>
            ))}
          </Select>

          <IconButton onClick={toggleMode} size="small">
            {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
          </IconButton>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {user?.name}
            </Typography>
            <Chip label={currentRole} size="small" color={ROLE_COLORS[currentRole] || 'default'} variant="outlined" />
          </Box>

          <Button size="small" onClick={logout}>Logout</Button>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
