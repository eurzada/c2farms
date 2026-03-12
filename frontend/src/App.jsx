import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { FarmProvider, useFarm } from './contexts/FarmContext';
import AppLayout from './components/layout/AppLayout';
import Login from './pages/Login';
import Home from './pages/Home';
import PerUnit from './pages/PerUnit';
import Accounting from './pages/Accounting';
import Dashboard from './pages/Dashboard';
import OperationalData from './pages/OperationalData';
import ChartOfAccounts from './pages/ChartOfAccounts';
import Settings from './pages/Settings';
import UniversalSettings from './pages/UniversalSettings';
import ErrorBoundary from './components/shared/ErrorBoundary';
import { Typography, Box, CircularProgress } from '@mui/material';

const InventoryLayout = lazy(() => import('./components/inventory/InventoryLayout'));
const InventoryDashboard = lazy(() => import('./pages/inventory/InventoryDashboard'));
const BinInventory = lazy(() => import('./pages/inventory/BinInventory'));
const Contracts = lazy(() => import('./pages/inventory/Contracts'));
const Reconciliation = lazy(() => import('./pages/inventory/Reconciliation'));
const FarmManagerView = lazy(() => import('./pages/inventory/FarmManagerView'));
const CountHistory = lazy(() => import('./pages/inventory/CountHistory'));
const LogisticsLayout = lazy(() => import('./components/logistics/LogisticsLayout'));
const Tickets = lazy(() => import('./pages/logistics/Tickets'));
const Settlements = lazy(() => import('./pages/logistics/Settlements'));
const SettlementReconciliation = lazy(() => import('./pages/logistics/SettlementReconciliation'));
const TruckerAdmin = lazy(() => import('./pages/logistics/TruckerAdmin'));
const MarketingLayout = lazy(() => import('./components/marketing/MarketingLayout'));
const MarketingDashboard = lazy(() => import('./pages/marketing/MarketingDashboard'));
const MarketingContracts = lazy(() => import('./pages/marketing/MarketingContracts'));
const MarketingPrices = lazy(() => import('./pages/marketing/MarketingPrices'));
const MarketingCashFlow = lazy(() => import('./pages/marketing/MarketingCashFlow'));
const SellDecisionTool = lazy(() => import('./pages/marketing/SellDecisionTool'));
const MarketingBuyers = lazy(() => import('./pages/marketing/MarketingBuyers'));
const AgronomyLayout = lazy(() => import('./components/agronomy/AgronomyLayout'));
const AgronomyDashboard = lazy(() => import('./pages/agronomy/AgronomyDashboard'));
const PlanSetup = lazy(() => import('./pages/agronomy/PlanSetup'));
const CropInputPlan = lazy(() => import('./pages/agronomy/CropInputPlan'));
const LabourPlan = lazy(() => import('./pages/agronomy/LabourPlan'));
const EnterpriseForecast = lazy(() => import('./pages/enterprise/EnterpriseForecast'));
const EnterpriseAgronomy = lazy(() => import('./pages/enterprise/EnterpriseAgronomy'));
const EnterpriseAgroPlan = lazy(() => import('./pages/enterprise/EnterpriseAgroPlan'));
const EnterpriseLabour = lazy(() => import('./pages/enterprise/EnterpriseLabour'));
const TerminalLayout = lazy(() => import('./components/terminal/TerminalLayout'));
const TerminalDashboard = lazy(() => import('./pages/terminal/TerminalDashboard'));
const TerminalIncoming = lazy(() => import('./pages/terminal/TerminalIncoming'));
const TerminalOutgoing = lazy(() => import('./pages/terminal/TerminalOutgoing'));
const TerminalBins = lazy(() => import('./pages/terminal/TerminalBins'));
const TerminalContracts = lazy(() => import('./pages/terminal/TerminalContracts'));
const TerminalSettlements = lazy(() => import('./pages/terminal/TerminalSettlements'));

function LazyFallback() {
  return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}><CircularProgress /></Box>;
}

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

function TerminalRoute({ children }) {
  const { isTerminal, hasModule, currentFarm } = useFarm();
  if (!currentFarm) return null;
  if (!isTerminal || !hasModule('terminal')) return <SmartRedirect />;
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
                    <Suspense fallback={<LazyFallback />}>
                    <Routes>
                      <Route path="/" element={<SmartRedirect />} />
                      <Route path="/home" element={<Home />} />
                      {/* Farm Unit routes (per-location, data entry) */}
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
                      <Route path="/labour" element={<FarmUnitRoute module="agronomy"><LabourPlan /></FarmUnitRoute>} />

                      {/* Inventory — both modes, but different scope */}
                      <Route path="/inventory" element={<ModuleRoute module="inventory"><InventoryRedirect /></ModuleRoute>} />
                      <Route path="/inventory/dashboard" element={<EnterpriseRoute><InventoryLayout><InventoryDashboard /></InventoryLayout></EnterpriseRoute>} />
                      <Route path="/inventory/bins" element={<ModuleRoute module="inventory"><InventoryLayout><BinInventory /></InventoryLayout></ModuleRoute>} />
                      <Route path="/inventory/contracts" element={<EnterpriseRoute><InventoryLayout><Contracts /></InventoryLayout></EnterpriseRoute>} />
                      <Route path="/inventory/recon" element={<EnterpriseRoute><InventoryLayout><Reconciliation /></InventoryLayout></EnterpriseRoute>} />
                      <Route path="/inventory/count" element={<ModuleRoute module="inventory"><InventoryLayout><FarmManagerView /></InventoryLayout></ModuleRoute>} />
                      <Route path="/inventory/history" element={<EnterpriseRoute><InventoryLayout><CountHistory /></InventoryLayout></EnterpriseRoute>} />

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

                      {/* Terminal Operations (LGX) */}
                      <Route path="/terminal" element={<TerminalRoute><Navigate to="/terminal/dashboard" /></TerminalRoute>} />
                      <Route path="/terminal/dashboard" element={<TerminalRoute><TerminalLayout><TerminalDashboard /></TerminalLayout></TerminalRoute>} />
                      <Route path="/terminal/incoming" element={<TerminalRoute><TerminalLayout><TerminalIncoming /></TerminalLayout></TerminalRoute>} />
                      <Route path="/terminal/outgoing" element={<TerminalRoute><TerminalLayout><TerminalOutgoing /></TerminalLayout></TerminalRoute>} />
                      <Route path="/terminal/bins" element={<TerminalRoute><TerminalLayout><TerminalBins /></TerminalLayout></TerminalRoute>} />
                      <Route path="/terminal/contracts" element={<TerminalRoute><TerminalLayout><TerminalContracts /></TerminalLayout></TerminalRoute>} />
                      <Route path="/terminal/settlements" element={<TerminalRoute><TerminalLayout><TerminalSettlements /></TerminalLayout></TerminalRoute>} />

                      {/* Enterprise rollup pages (read-only) */}
                      <Route path="/enterprise/forecast" element={<EnterpriseRoute><EnterpriseForecast /></EnterpriseRoute>} />
                      <Route path="/enterprise/agronomy" element={<EnterpriseRoute><EnterpriseAgronomy /></EnterpriseRoute>} />
                      <Route path="/enterprise/agro-plan" element={<EnterpriseRoute><EnterpriseAgroPlan /></EnterpriseRoute>} />
                      <Route path="/enterprise/labour" element={<EnterpriseRoute><EnterpriseLabour /></EnterpriseRoute>} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                    </Suspense>
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
