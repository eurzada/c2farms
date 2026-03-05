import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { FarmProvider, useFarm } from './contexts/FarmContext';
import AppLayout from './components/layout/AppLayout';
import Login from './pages/Login';
import Home from './pages/Home';
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
import AgronomyLayout from './components/agronomy/AgronomyLayout';
import AgronomyDashboard from './pages/agronomy/AgronomyDashboard';
import PlanSetup from './pages/agronomy/PlanSetup';
import CropInputPlan from './pages/agronomy/CropInputPlan';
import EnterpriseForecast from './pages/enterprise/EnterpriseForecast';
import EnterpriseAgronomy from './pages/enterprise/EnterpriseAgronomy';
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
  return <Navigate to="/home" />;
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

function EnterpriseRoute({ children }) {
  const { isEnterprise } = useFarm();
  if (!isEnterprise) return <SmartRedirect />;
  return children;
}

function FarmUnitRoute({ module, children }) {
  const { isEnterprise, hasModule } = useFarm();
  if (isEnterprise) return <SmartRedirect />;
  if (module && !hasModule(module)) return <SmartRedirect />;
  return children;
}

function InventoryRedirect() {
  const { isEnterprise } = useFarm();
  return <Navigate to={isEnterprise ? '/inventory/dashboard' : '/inventory/bins'} />;
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
                      <Route path="/home" element={<Home />} />
                      {/* Farm Unit routes (per-location, data entry) */}
                      <Route path="/assumptions" element={<FarmUnitRoute module="forecast"><Assumptions /></FarmUnitRoute>} />
                      <Route path="/per-unit" element={<FarmUnitRoute module="forecast"><PerUnit /></FarmUnitRoute>} />
                      <Route path="/cost-forecast" element={<FarmUnitRoute module="forecast"><Accounting /></FarmUnitRoute>} />
                      <Route path="/accounting" element={<Navigate to="/cost-forecast" />} />
                      <Route path="/operations" element={<FarmUnitRoute module="forecast"><OperationalData /></FarmUnitRoute>} />
                      <Route path="/dashboard" element={<FarmUnitRoute module="forecast"><Dashboard /></FarmUnitRoute>} />
                      <Route path="/chart-of-accounts" element={<FarmUnitRoute module="forecast"><ChartOfAccounts /></FarmUnitRoute>} />
                      <Route path="/settings" element={<AdminRoute><Settings /></AdminRoute>} />
                      <Route path="/universal-settings" element={<AnyFarmAdminRoute><UniversalSettings /></AnyFarmAdminRoute>} />

                      {/* Agronomy — Farm Unit only */}
                      <Route path="/agronomy" element={<FarmUnitRoute module="agronomy"><Navigate to="/agronomy/dashboard" /></FarmUnitRoute>} />
                      <Route path="/agronomy/dashboard" element={<FarmUnitRoute module="agronomy"><AgronomyLayout><AgronomyDashboard /></AgronomyLayout></FarmUnitRoute>} />
                      <Route path="/agronomy/plan" element={<FarmUnitRoute module="agronomy"><AgronomyLayout><PlanSetup /></AgronomyLayout></FarmUnitRoute>} />
                      <Route path="/agronomy/inputs" element={<FarmUnitRoute module="agronomy"><AgronomyLayout><CropInputPlan /></AgronomyLayout></FarmUnitRoute>} />

                      {/* Inventory — both modes, but different scope */}
                      <Route path="/inventory" element={<ModuleRoute module="inventory"><InventoryRedirect /></ModuleRoute>} />
                      <Route path="/inventory/dashboard" element={<EnterpriseRoute><InventoryLayout><InventoryDashboard /></InventoryLayout></EnterpriseRoute>} />
                      <Route path="/inventory/bins" element={<ModuleRoute module="inventory"><InventoryLayout><BinInventory /></InventoryLayout></ModuleRoute>} />
                      <Route path="/inventory/contracts" element={<EnterpriseRoute><InventoryLayout><Contracts /></InventoryLayout></EnterpriseRoute>} />
                      <Route path="/inventory/recon" element={<EnterpriseRoute><InventoryLayout><Reconciliation /></InventoryLayout></EnterpriseRoute>} />
                      <Route path="/inventory/count" element={<ModuleRoute module="inventory"><InventoryLayout><FarmManagerView /></InventoryLayout></ModuleRoute>} />

                      {/* Enterprise-only modules */}
                      <Route path="/logistics" element={<EnterpriseRoute><Navigate to="/logistics/tickets" /></EnterpriseRoute>} />
                      <Route path="/logistics/tickets" element={<EnterpriseRoute><LogisticsLayout><Tickets /></LogisticsLayout></EnterpriseRoute>} />
                      <Route path="/logistics/settlements" element={<EnterpriseRoute><LogisticsLayout><Settlements /></LogisticsLayout></EnterpriseRoute>} />
                      <Route path="/logistics/settlement-recon" element={<EnterpriseRoute><LogisticsLayout><SettlementReconciliation /></LogisticsLayout></EnterpriseRoute>} />
                      <Route path="/logistics/truckers" element={<EnterpriseRoute><LogisticsLayout><TruckerAdmin /></LogisticsLayout></EnterpriseRoute>} />
                      <Route path="/marketing" element={<EnterpriseRoute><Navigate to="/marketing/dashboard" /></EnterpriseRoute>} />
                      <Route path="/marketing/dashboard" element={<EnterpriseRoute><MarketingLayout><MarketingDashboard /></MarketingLayout></EnterpriseRoute>} />
                      <Route path="/marketing/contracts" element={<EnterpriseRoute><MarketingLayout><MarketingContracts /></MarketingLayout></EnterpriseRoute>} />
                      <Route path="/marketing/prices" element={<EnterpriseRoute><MarketingLayout><MarketingPrices /></MarketingLayout></EnterpriseRoute>} />
                      <Route path="/marketing/cash-flow" element={<EnterpriseRoute><MarketingLayout><MarketingCashFlow /></MarketingLayout></EnterpriseRoute>} />
                      <Route path="/marketing/sell-tool" element={<EnterpriseRoute><MarketingLayout><SellDecisionTool /></MarketingLayout></EnterpriseRoute>} />
                      <Route path="/marketing/buyers" element={<EnterpriseRoute><MarketingLayout><MarketingBuyers /></MarketingLayout></EnterpriseRoute>} />

                      {/* Enterprise rollup pages (read-only) */}
                      <Route path="/enterprise/forecast" element={<EnterpriseRoute><EnterpriseForecast /></EnterpriseRoute>} />
                      <Route path="/enterprise/agronomy" element={<EnterpriseRoute><EnterpriseAgronomy /></EnterpriseRoute>} />
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
