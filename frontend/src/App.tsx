import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SystemSettingsProvider } from './context/SystemSettingsContext';
import { sanitizeRedirect } from './utils/redirect';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';
import Leaderboard from './pages/Leaderboard';
import WorkHours from './pages/WorkHours';
import StatusTracking from './pages/StatusTracking';
import SystemSettings from './pages/SystemSettings';
import SystemLogs from './pages/SystemLogs';
import DesignStandards from './pages/DesignStandards';
import GunLedger from './pages/GunLedger';

const ProtectedRoute = ({
  children,
  adminOnly = false,
  superAdminOnly = false,
  allowGuest = false
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  allowGuest?: boolean;
}) => {
  const { isAuthenticated, user, forcePasswordChange, authReady } = useAuth();
  const location = useLocation();
  const currentPath = location.pathname + location.search + location.hash;

  if (!authReady) {
    return null;
  }

  if (!isAuthenticated) {
    if (!allowGuest) {
      return <Navigate to={`/login?redirect=${encodeURIComponent(currentPath)}`} replace />;
    }
    return <>{children}</>;
  }

  if (forcePasswordChange) {
    return <Navigate to={`/change-password?redirect=${encodeURIComponent(currentPath)}`} replace />;
  }

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const isSuperAdmin = user?.role === 'superadmin';

  if (superAdminOnly && !isSuperAdmin) {
    return <Navigate to="/" replace />;
  }

  if (adminOnly && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const ChangePasswordRoute = ({
  children
}: {
  children: React.ReactNode;
}) => {
  const { isAuthenticated, forcePasswordChange } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    const currentPath = location.pathname + location.search + location.hash;
    return <Navigate to={`/login?redirect=${encodeURIComponent(currentPath)}`} replace />;
  }

  if (!forcePasswordChange) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const LoginRoute = () => {
  const { isAuthenticated } = useAuth();
  const [searchParams] = useSearchParams();

  if (!isAuthenticated) {
    return <Login />;
  }

  return <Navigate to={sanitizeRedirect(searchParams.get('redirect'))} replace />;
};

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route 
        path="/change-password" 
        element={
          <ChangePasswordRoute>
            <ChangePassword />
          </ChangePasswordRoute>
        } 
      />
      <Route 
        path="/" 
        element={
          <ProtectedRoute allowGuest>
            <Dashboard />
          </ProtectedRoute>
        } 
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute adminOnly>
            <Admin />
          </ProtectedRoute>
        }
      />
      <Route
        path="/system-settings"
        element={
          <ProtectedRoute>
            <SystemSettings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/design-standards"
        element={
          <ProtectedRoute>
            <DesignStandards />
          </ProtectedRoute>
        }
      />
      <Route
        path="/gun-ledger"
        element={
          <ProtectedRoute>
            <GunLedger />
          </ProtectedRoute>
        }
      />
      <Route
        path="/system-logs"
        element={
          <ProtectedRoute superAdminOnly>
            <SystemLogs />
          </ProtectedRoute>
        }
      />
      <Route 
        path="/leaderboard" 
        element={
          <ProtectedRoute>
            <Leaderboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/work-hours" 
        element={
          <ProtectedRoute>
            <WorkHours />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/status-tracking" 
        element={
          <ProtectedRoute>
            <StatusTracking />
          </ProtectedRoute>
        } 
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const basename = process.env.NODE_ENV === 'production' ? '/obara-task-manager' : '';

function App() {
  return (
    <AuthProvider>
      <SystemSettingsProvider>
        <Router basename={basename}>
          <AppRoutes />
        </Router>
      </SystemSettingsProvider>
    </AuthProvider>
  );
}

export default App;
