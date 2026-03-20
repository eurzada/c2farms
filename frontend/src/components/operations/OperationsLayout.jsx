import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Tabs, Tab } from '@mui/material';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import WarehouseIcon from '@mui/icons-material/Warehouse';

const TABS = [
  { label: 'Metrics', path: '/operations/metrics', icon: <PrecisionManufacturingIcon /> },
  { label: 'Bin Inventory', path: '/operations/bins', icon: <WarehouseIcon /> },
];

export default function OperationsLayout({ children }) {
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
