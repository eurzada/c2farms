import { useNavigate } from 'react-router-dom';
import { Box, Typography, Paper, Stack, Chip } from '@mui/material';
import GrassIcon from '@mui/icons-material/Grass';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import WarehouseIcon from '@mui/icons-material/Warehouse';
import SettingsIcon from '@mui/icons-material/Settings';
import DashboardIcon from '@mui/icons-material/Dashboard';
import GroupsIcon from '@mui/icons-material/Groups';
import VisibilityIcon from '@mui/icons-material/Visibility';
import StorageIcon from '@mui/icons-material/Storage';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import { useFarm } from '../contexts/FarmContext';

const FARM_MODULES = [
  {
    key: 'agronomy', label: 'Agronomy',
    description: 'Crop planning, input programs, nutrient management',
    path: '/agronomy', icon: GrassIcon, color: '#4caf50',
  },
  {
    key: 'agronomy', label: 'Labour Plan',
    description: 'Seasonal labour hours, roles, and cost budgeting',
    path: '/labour', icon: GroupsIcon, color: '#5c6bc0',
  },
  {
    key: 'forecast', label: 'Financial Forecast',
    description: 'Budgets, cost forecast, per-unit analysis',
    path: '/cost-forecast', icon: SettingsIcon, color: '#6d6e70',
  },
  {
    key: 'inventory', label: 'Bin Inventory',
    description: 'View bins, capacities, and current stock levels',
    path: '/inventory/bins', icon: WarehouseIcon, color: '#414042',
  },
];

const ENTERPRISE_MODULES = [
  // Row 1 — Agronomy
  {
    key: 'agronomy', label: 'Agronomy', row: 1,
    description: 'Crop planning, input programs, rollups',
    path: '/enterprise/agronomy', icon: GrassIcon, color: '#4caf50',
  },
  // Row 2 — Marketing, Logistics, Inventory (left to right)
  {
    key: 'marketing', label: 'Grain Marketing', row: 2,
    description: 'Contracts, pricing, cash flow, sell decisions',
    path: '/marketing', icon: TrendingUpIcon, color: '#008CB2',
  },
  {
    key: 'logistics', label: 'Logistics', row: 2,
    description: 'Tickets, settlements, trucker management',
    path: '/logistics', icon: LocalShippingIcon, color: '#006E8C',
  },
  {
    key: 'inventory', label: 'Inventory Management', row: 2,
    description: 'Bin inventory, contracts, reconciliation',
    path: '/inventory', icon: WarehouseIcon, color: '#414042',
  },
  // Row 3 — Rollups
  {
    key: 'forecast', label: 'Financial', row: 3,
    description: 'Consolidated budget across all farm units',
    path: '/enterprise/forecast', icon: DashboardIcon, color: '#6d6e70',
    readOnly: true,
  },
  {
    key: 'agronomy', label: 'Labour & Fuel', row: 3,
    description: 'Labour hours and fuel costs across all farm units',
    path: '/enterprise/labour', icon: GroupsIcon, color: '#5c6bc0',
    readOnly: true,
  },
];

const TERMINAL_MODULES = [
  {
    key: 'terminal', label: 'Dashboard',
    description: 'Terminal overview, bin status, recent activity',
    path: '/terminal/dashboard', icon: DashboardIcon, color: '#1565c0',
  },
  {
    key: 'terminal', label: 'Incoming',
    description: 'Receive inbound loads from growers',
    path: '/terminal/incoming', icon: WarehouseIcon, color: '#2e7d32',
  },
  {
    key: 'terminal', label: 'Outgoing',
    description: 'Ship outbound rail cars and truck loads',
    path: '/terminal/outgoing', icon: LocalShippingIcon, color: '#ef6c00',
  },
  {
    key: 'terminal', label: 'Bins',
    description: 'Bin ledger, running balances, ownership',
    path: '/terminal/bins', icon: StorageIcon, color: '#6d4c41',
  },
  {
    key: 'terminal', label: 'Blending',
    description: 'Blend events, ratio calculations, rail car loading',
    path: '/terminal/blending', icon: PrecisionManufacturingIcon, color: '#7b1fa2',
  },
];

function ModuleCard({ mod, onClick }) {
  const Icon = mod.icon;
  return (
    <Paper
      onClick={onClick}
      sx={{
        p: 3, cursor: 'pointer', textAlign: 'center',
        minWidth: 180, flex: '1 1 180px', maxWidth: 220,
        transition: 'all 0.2s', border: '2px solid transparent',
        '&:hover': { transform: 'translateY(-4px)', boxShadow: 4, borderColor: mod.color },
      }}
    >
      <Box
        sx={{
          width: 56, height: 56, borderRadius: '50%',
          bgcolor: mod.color + '18',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          mx: 'auto', mb: 1.5,
        }}
      >
        <Icon sx={{ fontSize: 28, color: mod.color }} />
      </Box>
      <Typography variant="subtitle1" fontWeight="bold">{mod.label}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {mod.description}
      </Typography>
      {mod.readOnly && (
        <Chip icon={<VisibilityIcon />} label="Read-Only" size="small" variant="outlined" sx={{ mt: 1 }} />
      )}
    </Paper>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const { currentFarm, hasModule, isEnterprise, isTerminal, farms, selectedId } = useFarm();
  const displayFarm = farms.find(f => f.id === selectedId);

  const moduleList = isTerminal ? TERMINAL_MODULES : isEnterprise ? ENTERPRISE_MODULES : FARM_MODULES;
  const available = moduleList.filter(m => hasModule(m.key));

  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: 'calc(100vh - 200px)', px: 2,
    }}>
      <img
        src="/logo.png" alt="C2 Farms"
        style={{ width: 80, height: 'auto', objectFit: 'contain', marginBottom: 8 }}
      />
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        C2 Farms
      </Typography>
      {displayFarm && (
        <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>
          {displayFarm.name}
        </Typography>
      )}
      {isEnterprise ? (
        <Chip label="Enterprise View" color="primary" variant="outlined" sx={{ mb: 3 }} />
      ) : (
        <Chip label="Farm Unit" variant="outlined" sx={{ mb: 3 }} />
      )}

      {isEnterprise ? (
        // Enterprise: explicit row grouping
        <Box sx={{ maxWidth: 900 }}>
          {[1, 2, 3].map(row => {
            const rowMods = available.filter(m => m.row === row);
            if (!rowMods.length) return null;
            return (
              <Stack key={row} direction="row" spacing={2} sx={{ justifyContent: 'center', mb: 2 }}>
                {rowMods.map(mod => (
                  <ModuleCard key={mod.path} mod={mod} onClick={() => navigate(mod.path)} />
                ))}
              </Stack>
            );
          })}
        </Box>
      ) : (
        <Stack
          direction="row" spacing={2}
          sx={{ flexWrap: 'wrap', justifyContent: 'center', gap: 2, maxWidth: 900 }}
        >
          {available.map(mod => (
            <ModuleCard key={mod.path} mod={mod} onClick={() => navigate(mod.path)} />
          ))}
        </Stack>
      )}
    </Box>
  );
}
