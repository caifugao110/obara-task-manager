import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';
import Leaderboard from './pages/Leaderboard';
import WorkHours from './pages/WorkHours';
import StatusTracking from './pages/StatusTracking';
import SystemSettings from './pages/SystemSettings';
import SystemLogs from './pages/SystemLogs';

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

  if (!authReady) {
    return null;
  }

  if (!isAuthenticated) {
    if (!allowGuest) {
      return <Navigate to="/login" replace />;
    }
    return <>{children}</>;
  }

  if (forcePasswordChange) {
    return <Navigate to="/change-password" replace />;
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

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!forcePasswordChange) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const AppRoutes = () => {
  const { isAuthenticated } = useAuth();
  const [allowGuestView, setAllowGuestView] = useState(true);

  useEffect(() => {
    axios.get('/api/system/settings')
      .then(res => setAllowGuestView(res.data.allowGuestView ?? true))
      .catch(() => {});
  }, []);

  const guestAllowed = allowGuestView;

  return (
    <Routes>
      <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to="/" replace />} />
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
          <ProtectedRoute superAdminOnly>
            <SystemSettings />
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
          <ProtectedRoute allowGuest={guestAllowed}>
            <Leaderboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/work-hours" 
        element={
          <ProtectedRoute allowGuest={guestAllowed}>
            <WorkHours />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/status-tracking" 
        element={
          <ProtectedRoute allowGuest={guestAllowed}>
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
      <Router basename={basename}>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}

export default App;
