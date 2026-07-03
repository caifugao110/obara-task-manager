import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';
import Leaderboard from './pages/Leaderboard';
import WorkHours from './pages/WorkHours';
import StatusTracking from './pages/StatusTracking';
import SystemSettings from './pages/SystemSettings';
import LoginLogs from './pages/LoginLogs';

const ProtectedRoute = ({
  children,
  adminOnly = false,
  superAdminOnly = false
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
}) => {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
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

const AppRoutes = () => {
  const { isAuthenticated } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to="/" replace />} />
      <Route path="/" element={<Dashboard />} />
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
          <ProtectedRoute superAdminOnly>
            <SystemSettings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/login-logs"
        element={
          <ProtectedRoute superAdminOnly>
            <LoginLogs />
          </ProtectedRoute>
        }
      />
      <Route path="/leaderboard" element={<Leaderboard />} />
      <Route path="/work-hours" element={<WorkHours />} />
      <Route path="/status-tracking" element={<StatusTracking />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const basename = process.env.NODE_ENV === 'production' ? '/obara-task-manager' : '';

function App() {
  return (
    <AuthProvider>
      <Router basename={basename}>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}

export default App;
