import { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import { ElectronProvider } from './contexts/ElectronContext';
import CursorTrail from './components/CursorTrail';
import LockScreen from './components/LockScreen';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Settings from './pages/Settings';

function AppContent() {
  const [isLocked, setIsLocked] = useState(false);
  const [isCheckingLock, setIsCheckingLock] = useState(true);

  useEffect(() => {
    // Check if app is locked on startup
    const checkLockStatus = async () => {
      if (window.electronAPI) {
        try {
          const locked = await window.electronAPI.security.isLocked();
          const passwordSet = await window.electronAPI.security.isPasswordSet();
          // Lock on startup if password is set
          setIsLocked(locked || passwordSet);
        } catch (error) {
          console.error('Failed to check lock status:', error);
        }
      }
      setIsCheckingLock(false);
    };

    checkLockStatus();

    // Listen for lock/unlock events from main process
    const handleLocked = () => setIsLocked(true);
    const handleUnlocked = () => setIsLocked(false);

    window.addEventListener('app-locked', handleLocked);
    window.addEventListener('app-unlocked', handleUnlocked);

    return () => {
      window.removeEventListener('app-locked', handleLocked);
      window.removeEventListener('app-unlocked', handleUnlocked);
    };
  }, []);

  const handleUnlock = () => {
    setIsLocked(false);
  };

  if (isCheckingLock) {
    return (
      <div className="min-h-screen flex items-center justify-center dashboard-bg">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isLocked) {
    return <LockScreen onUnlock={handleUnlock} />;
  }

  return (
    <>
      <CursorTrail />
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  );
}

function App() {
  return (
    <Router>
      <ThemeProvider>
        <ElectronProvider>
          <ToastProvider>
            <AppContent />
          </ToastProvider>
        </ElectronProvider>
      </ThemeProvider>
    </Router>
  );
}

export default App;
