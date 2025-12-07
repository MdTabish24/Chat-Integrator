import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ThemeProvider } from './contexts/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import CursorTrail from './components/CursorTrail';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Settings from './pages/Settings';
import OAuthCallback from './pages/OAuthCallback';
import { TelegramAuth } from './pages/TelegramAuth';
import { TelegramPhoneAuth } from './pages/TelegramPhoneAuth';

function App() {
  return (
    <Router>
      <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <CursorTrail />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/accounts"
              element={
                <ProtectedRoute>
                  <Accounts />
                </ProtectedRoute>
              }
            />
            <Route path="/connect" element={<OAuthCallback />} />
            <Route
              path="/auth/telegram"
              element={
                <ProtectedRoute>
                  <TelegramAuth />
                </ProtectedRoute>
              }
            />
            <Route
              path="/auth/telegram-phone"
              element={
                <ProtectedRoute>
                  <TelegramPhoneAuth />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <Settings />
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
      </ThemeProvider>
    </Router>
  );
}

export default App;
