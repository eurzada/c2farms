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
  if (user) return <Navigate to="/assumptions" />;
  return <Login />;
}

function AdminRoute({ children }) {
  const { isAdmin } = useFarm();
  if (!isAdmin) return <Navigate to="/assumptions" />;
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
                      <Route path="/" element={<Navigate to="/assumptions" />} />
                      <Route path="/assumptions" element={<Assumptions />} />
                      <Route path="/per-unit" element={<PerUnit />} />
                      <Route path="/cost-forecast" element={<Accounting />} />
                      <Route path="/accounting" element={<Navigate to="/cost-forecast" />} />
                      <Route path="/operations" element={<OperationalData />} />
                      <Route path="/dashboard" element={<Dashboard />} />
                      <Route path="/chart-of-accounts" element={<ChartOfAccounts />} />
                      <Route path="/settings" element={<AdminRoute><Settings /></AdminRoute>} />
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
