import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { FarmProvider, useFarm } from './contexts/FarmContext';
import AppLayout from './components/layout/AppLayout';
import Login from './pages/Login';
import Assumptions from './pages/Assumptions';
import PerUnit from './pages/PerUnit';
import Accounting from './pages/Accounting';
import Dashboard from './pages/Dashboard';
import OperationalData from './pages/OperationalData';
import ChartOfAccounts from './pages/ChartOfAccounts';
import Settings from './pages/Settings';
import UniversalSettings from './pages/UniversalSettings';
import InventoryLayout from './components/inventory/InventoryLayout';
import InventoryDashboard from './pages/inventory/InventoryDashboard';
import BinInventory from './pages/inventory/BinInventory';
import Contracts from './pages/inventory/Contracts';
import Reconciliation from './pages/inventory/Reconciliation';
import FarmManagerView from './pages/inventory/FarmManagerView';
import LogisticsLayout from './components/logistics/LogisticsLayout';
import Tickets from './pages/logistics/Tickets';
import Settlements from './pages/logistics/Settlements';
import SettlementReconciliation from './pages/logistics/SettlementReconciliation';
import TruckerAdmin from './pages/logistics/TruckerAdmin';
import MarketingLayout from './components/marketing/MarketingLayout';
import MarketingDashboard from './pages/marketing/MarketingDashboard';
import MarketingContracts from './pages/marketing/MarketingContracts';
import MarketingPrices from './pages/marketing/MarketingPrices';
import MarketingCashFlow from './pages/marketing/MarketingCashFlow';
import SellDecisionTool from './pages/marketing/SellDecisionTool';
import MarketingBuyers from './pages/marketing/MarketingBuyers';
import ErrorBoundary from './components/shared/ErrorBoundary';
import { Typography, Box } from '@mui/material';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" />;
  return children;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <SmartRedirect />;
  return <Login />;
}

function SmartRedirect() {
  const { hasModule } = useFarm();
  if (hasModule('forecast')) return <Navigate to="/assumptions" />;
  if (hasModule('marketing')) return <Navigate to="/marketing" />;
  if (hasModule('logistics')) return <Navigate to="/logistics" />;
  if (hasModule('inventory')) return <Navigate to="/inventory" />;
  return <Navigate to="/assumptions" />;
}

function AdminRoute({ children }) {
  const { isAdmin } = useFarm();
  if (!isAdmin) return <SmartRedirect />;
  return children;
}

function AnyFarmAdminRoute({ children }) {
  const { farms } = useFarm();
  const isAnyAdmin = farms.some(f => f.role === 'admin');
  if (!isAnyAdmin) return <SmartRedirect />;
  return children;
}

function ModuleRoute({ module, children }) {
  const { hasModule } = useFarm();
  if (!hasModule(module)) return <SmartRedirect />;
  return children;
}

function NotFound() {
  return (
    <Box sx={{ p: 4, textAlign: 'center' }}>
      <Typography variant="h4" gutterBottom>Page Not Found</Typography>
      <Typography color="text.secondary">The page you're looking for doesn't exist.</Typography>
    </Box>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <FarmProvider>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <Routes>
                      <Route path="/" element={<SmartRedirect />} />
                      <Route path="/assumptions" element={<ModuleRoute module="forecast"><Assumptions /></ModuleRoute>} />
                      <Route path="/per-unit" element={<ModuleRoute module="forecast"><PerUnit /></ModuleRoute>} />
                      <Route path="/cost-forecast" element={<ModuleRoute module="forecast"><Accounting /></ModuleRoute>} />
                      <Route path="/accounting" element={<Navigate to="/cost-forecast" />} />
                      <Route path="/operations" element={<ModuleRoute module="forecast"><OperationalData /></ModuleRoute>} />
                      <Route path="/dashboard" element={<ModuleRoute module="forecast"><Dashboard /></ModuleRoute>} />
                      <Route path="/chart-of-accounts" element={<ModuleRoute module="forecast"><ChartOfAccounts /></ModuleRoute>} />
                      <Route path="/settings" element={<AdminRoute><Settings /></AdminRoute>} />
                      <Route path="/universal-settings" element={<AnyFarmAdminRoute><UniversalSettings /></AnyFarmAdminRoute>} />
                      <Route path="/inventory" element={<ModuleRoute module="inventory"><Navigate to="/inventory/dashboard" /></ModuleRoute>} />
                      <Route path="/inventory/dashboard" element={<ModuleRoute module="inventory"><InventoryLayout><InventoryDashboard /></InventoryLayout></ModuleRoute>} />
                      <Route path="/inventory/bins" element={<ModuleRoute module="inventory"><InventoryLayout><BinInventory /></InventoryLayout></ModuleRoute>} />
                      <Route path="/inventory/contracts" element={<ModuleRoute module="inventory"><InventoryLayout><Contracts /></InventoryLayout></ModuleRoute>} />
                      <Route path="/inventory/recon" element={<ModuleRoute module="inventory"><InventoryLayout><Reconciliation /></InventoryLayout></ModuleRoute>} />
                      <Route path="/inventory/count" element={<ModuleRoute module="inventory"><InventoryLayout><FarmManagerView /></InventoryLayout></ModuleRoute>} />
                      <Route path="/logistics" element={<ModuleRoute module="logistics"><Navigate to="/logistics/tickets" /></ModuleRoute>} />
                      <Route path="/logistics/tickets" element={<ModuleRoute module="logistics"><LogisticsLayout><Tickets /></LogisticsLayout></ModuleRoute>} />
                      <Route path="/logistics/settlements" element={<ModuleRoute module="logistics"><LogisticsLayout><Settlements /></LogisticsLayout></ModuleRoute>} />
                      <Route path="/logistics/settlement-recon" element={<ModuleRoute module="logistics"><LogisticsLayout><SettlementReconciliation /></LogisticsLayout></ModuleRoute>} />
                      <Route path="/logistics/truckers" element={<ModuleRoute module="logistics"><LogisticsLayout><TruckerAdmin /></LogisticsLayout></ModuleRoute>} />
                      <Route path="/marketing" element={<ModuleRoute module="marketing"><Navigate to="/marketing/dashboard" /></ModuleRoute>} />
                      <Route path="/marketing/dashboard" element={<ModuleRoute module="marketing"><MarketingLayout><MarketingDashboard /></MarketingLayout></ModuleRoute>} />
                      <Route path="/marketing/contracts" element={<ModuleRoute module="marketing"><MarketingLayout><MarketingContracts /></MarketingLayout></ModuleRoute>} />
                      <Route path="/marketing/prices" element={<ModuleRoute module="marketing"><MarketingLayout><MarketingPrices /></MarketingLayout></ModuleRoute>} />
                      <Route path="/marketing/cash-flow" element={<ModuleRoute module="marketing"><MarketingLayout><MarketingCashFlow /></MarketingLayout></ModuleRoute>} />
                      <Route path="/marketing/sell-tool" element={<ModuleRoute module="marketing"><MarketingLayout><SellDecisionTool /></MarketingLayout></ModuleRoute>} />
                      <Route path="/marketing/buyers" element={<ModuleRoute module="marketing"><MarketingLayout><MarketingBuyers /></MarketingLayout></ModuleRoute>} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </FarmProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
