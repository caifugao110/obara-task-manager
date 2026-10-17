import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SystemSettingsProvider } from './context/SystemSettingsContext';
import { sanitizeRedirect } from './utils/redirect';
import Login from './pages/Login';
// 主页面是首页（/），保持静态导入随主 chunk 同步加载；
// 若改为懒加载，首屏会多一次 chunk 往返并先显示加载占位，反而更慢。
import Dashboard from './pages/Dashboard';

const ChangePassword = lazy(() => import('./pages/ChangePassword'));
const Admin = lazy(() => import('./pages/Admin'));
const Leaderboard = lazy(() => import('./pages/Leaderboard'));
const WorkHours = lazy(() => import('./pages/WorkHours'));
const StatusTracking = lazy(() => import('./pages/StatusTracking'));
const SystemSettings = lazy(() => import('./pages/SystemSettings'));
const SystemLogs = lazy(() => import('./pages/SystemLogs'));
const DesignStandards = lazy(() => import('./pages/DesignStandards'));
const GunLedger = lazy(() => import('./pages/GunLedger'));

const PageFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#888' }}>
    加载中...
  </div>
);

const ProtectedRoute = ({
  children,
  adminOnly = false,
  superAdminOnly = false
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
}) => {
  const { isAuthenticated, user, forcePasswordChange, authReady } = useAuth();
  const location = useLocation();
  const currentPath = location.pathname + location.search + location.hash;

  if (!authReady) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(currentPath)}`} replace />;
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
    <Suspense fallback={<PageFallback />}>
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
          <ProtectedRoute>
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
    </Suspense>
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
