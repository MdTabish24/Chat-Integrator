import React, { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { useElectron } from '../contexts/ElectronContext';
import Header from '../components/Header';
import type { AppSettings } from '../types';

const Settings: React.FC = () => {
  const { theme, toggleTheme, isDark } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { isElectron, appVersion, osPlatform, quitApp, getSettings, updateSetting, clearAllSessions } = useElectron();
  
  const [settings, setSettings] = useState<Partial<AppSettings>>({
    theme: 'dark',
    autoStart: false,
    minimizeToTray: true,
    notifications: {
      enabled: true,
      sound: true,
      showPreview: true,
    },
    syncInterval: 30,
    security: {
      passwordEnabled: false,
      lockOnMinimize: false,
      lockTimeout: 0,
    },
  });
  const [isLoading, setIsLoading] = useState(true);
  
  // Password modal state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordModalMode, setPasswordModalMode] = useState<'set' | 'change' | 'remove'>('set');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isPasswordSet, setIsPasswordSet] = useState(false);

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      if (!isElectron) {
        setIsLoading(false);
        return;
      }
      
      try {
        const savedSettings = await getSettings();
        if (savedSettings) {
          setSettings(prev => ({ ...prev, ...savedSettings }));
        }
        
        // Check if password is set
        const passwordSet = await window.electronAPI.security.isPasswordSet();
        setIsPasswordSet(passwordSet);
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadSettings();
  }, [isElectron, getSettings]);

  const handlePasswordAction = async () => {
    setPasswordError('');
    
    try {
      if (passwordModalMode === 'set') {
        if (newPassword.length < 4) {
          setPasswordError('Password must be at least 4 characters');
          return;
        }
        if (newPassword !== confirmPassword) {
          setPasswordError('Passwords do not match');
          return;
        }
        
        const result = await window.electronAPI.security.setPassword(newPassword);
        if (result.success) {
          setIsPasswordSet(true);
          setShowPasswordModal(false);
          resetPasswordFields();
          showSuccess('Password set successfully');
        } else {
          setPasswordError(result.error || 'Failed to set password');
        }
      } else if (passwordModalMode === 'change') {
        // Verify current password first
        const verifyResult = await window.electronAPI.security.verifyPassword(currentPassword);
        if (!verifyResult.success) {
          setPasswordError('Current password is incorrect');
          return;
        }
        
        if (newPassword.length < 4) {
          setPasswordError('New password must be at least 4 characters');
          return;
        }
        if (newPassword !== confirmPassword) {
          setPasswordError('New passwords do not match');
          return;
        }
        
        const result = await window.electronAPI.security.setPassword(newPassword);
        if (result.success) {
          setShowPasswordModal(false);
          resetPasswordFields();
          showSuccess('Password changed successfully');
        } else {
          setPasswordError(result.error || 'Failed to change password');
        }
      } else if (passwordModalMode === 'remove') {
        const result = await window.electronAPI.security.removePassword(currentPassword);
        if (result.success) {
          setIsPasswordSet(false);
          setShowPasswordModal(false);
          resetPasswordFields();
          showSuccess('Password removed');
        } else {
          setPasswordError(result.error || 'Incorrect password');
        }
      }
    } catch (error: any) {
      setPasswordError(error.message || 'An error occurred');
    }
  };

  const resetPasswordFields = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
  };

  const openPasswordModal = (mode: 'set' | 'change' | 'remove') => {
    setPasswordModalMode(mode);
    resetPasswordFields();
    setShowPasswordModal(true);
  };

  const handleLockApp = async () => {
    if (isPasswordSet) {
      await window.electronAPI.security.lock();
      showInfo('App locked');
    }
  };

  const handleSettingChange = async (key: string, value: any) => {
    try {
      // Update local state
      setSettings(prev => {
        if (key.includes('.')) {
          // Handle nested settings like notifications.enabled
          const [parent, child] = key.split('.');
          return {
            ...prev,
            [parent]: {
              ...(prev as any)[parent],
              [child]: value,
            },
          };
        }
        return { ...prev, [key]: value };
      });
      
      // Save to electron store
      if (isElectron) {
        await updateSetting(key, value);
      }
      
      showSuccess('Setting updated');
    } catch (error) {
      showError('Failed to update setting');
    }
  };

  const handleThemeChange = (newTheme: 'light' | 'dark') => {
    if ((newTheme === 'dark') !== isDark) {
      toggleTheme();
    }
    handleSettingChange('theme', newTheme);
  };

  const handleClearData = async () => {
    if (confirm('Are you sure you want to clear all local data? This will log you out of all platforms.')) {
      try {
        await clearAllSessions();
        showSuccess('All local data cleared');
      } catch (error) {
        showError('Failed to clear data');
      }
    }
  };

  const handleExportData = async () => {
    try {
      if (isElectron) {
        const data = await window.electronAPI.session.export();
        // Create download
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chat-orbitor-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showSuccess('Data exported successfully');
      }
    } catch (error) {
      showError('Failed to export data');
    }
  };

  const handleImportData = async () => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = async (event) => {
            try {
              const data = event.target?.result as string;
              if (isElectron) {
                const result = await window.electronAPI.session.import(data);
                if (result.success) {
                  showSuccess('Data imported successfully');
                } else {
                  showError(result.error || 'Failed to import data');
                }
              }
            } catch (err) {
              showError('Invalid backup file');
            }
          };
          reader.readAsText(file);
        }
      };
      input.click();
    } catch (error) {
      showError('Failed to import data');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col dashboard-bg">
        <Header totalUnread={0} />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col dashboard-bg">
      <Header totalUnread={0} />

      <div className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">Settings</h1>
            <p className="text-[var(--text-muted)] mt-1">
              Customize your Chat Orbitor experience
            </p>
          </div>

          {/* Appearance Section */}
          <section className="card-3d p-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <span>🎨</span> Appearance
            </h2>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-[var(--text-primary)]">Theme</p>
                  <p className="text-sm text-[var(--text-muted)]">Choose your preferred color scheme</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleThemeChange('light')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      !isDark ? 'bg-primary-500 text-white' : 'bg-[var(--bg-hover)] text-[var(--text-secondary)]'
                    }`}
                  >
                    ☀️ Light
                  </button>
                  <button
                    onClick={() => handleThemeChange('dark')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      isDark ? 'bg-primary-500 text-white' : 'bg-[var(--bg-hover)] text-[var(--text-secondary)]'
                    }`}
                  >
                    🌙 Dark
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Behavior Section */}
          <section className="card-3d p-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <span>⚙️</span> Behavior
            </h2>
            
            <div className="space-y-4">
              <ToggleSetting
                label="Start on boot"
                description="Automatically start Chat Orbitor when you log in"
                enabled={settings.autoStart || false}
                onChange={(enabled) => handleSettingChange('autoStart', enabled)}
              />
              
              <div className="border-t border-[var(--border-color)] my-4" />
              
              <ToggleSetting
                label="Minimize to tray"
                description="Keep running in system tray when closed"
                enabled={settings.minimizeToTray ?? true}
                onChange={(enabled) => handleSettingChange('minimizeToTray', enabled)}
              />
              
              <div className="border-t border-[var(--border-color)] my-4" />
              
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-[var(--text-primary)]">Sync interval</p>
                  <p className="text-sm text-[var(--text-muted)]">How often to check for new messages</p>
                </div>
                <select
                  value={settings.syncInterval || 30}
                  onChange={(e) => handleSettingChange('syncInterval', parseInt(e.target.value))}
                  className="input-professional w-32"
                >
                  <option value={15}>15 seconds</option>
                  <option value={30}>30 seconds</option>
                  <option value={60}>1 minute</option>
                  <option value={120}>2 minutes</option>
                  <option value={300}>5 minutes</option>
                </select>
              </div>
            </div>
          </section>

          {/* Notifications Section */}
          <section className="card-3d p-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <span>🔔</span> Notifications
            </h2>
            
            <div className="space-y-4">
              <ToggleSetting
                label="Desktop notifications"
                description="Show notifications for new messages"
                enabled={settings.notifications?.enabled ?? true}
                onChange={(enabled) => handleSettingChange('notifications.enabled', enabled)}
              />
              
              <div className="border-t border-[var(--border-color)] my-4" />
              
              <ToggleSetting
                label="Notification sound"
                description="Play a sound when receiving notifications"
                enabled={settings.notifications?.sound ?? true}
                onChange={(enabled) => handleSettingChange('notifications.sound', enabled)}
                disabled={!settings.notifications?.enabled}
              />
              
              <div className="border-t border-[var(--border-color)] my-4" />
              
              <ToggleSetting
                label="Show message preview"
                description="Display message content in notifications"
                enabled={settings.notifications?.showPreview ?? true}
                onChange={(enabled) => handleSettingChange('notifications.showPreview', enabled)}
                disabled={!settings.notifications?.enabled}
              />
            </div>
          </section>

          {/* Security Section */}
          <section className="card-3d p-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <span>🔒</span> Security
            </h2>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-[var(--text-primary)]">App Password</p>
                  <p className="text-sm text-[var(--text-muted)]">
                    {isPasswordSet ? 'Password protection is enabled' : 'Protect your app with a password'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isPasswordSet ? (
                    <>
                      <button
                        onClick={() => openPasswordModal('change')}
                        className="btn-secondary-3d btn-professional text-sm"
                      >
                        Change
                      </button>
                      <button
                        onClick={() => openPasswordModal('remove')}
                        className="btn-secondary-3d btn-professional text-sm text-red-500"
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => openPasswordModal('set')}
                      className="btn-primary-3d btn-professional text-sm"
                    >
                      Set Password
                    </button>
                  )}
                </div>
              </div>
              
              {isPasswordSet && (
                <>
                  <div className="border-t border-[var(--border-color)] my-4" />
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-[var(--text-primary)]">Lock App Now</p>
                      <p className="text-sm text-[var(--text-muted)]">Immediately lock the app</p>
                    </div>
                    <button
                      onClick={handleLockApp}
                      className="btn-secondary-3d btn-professional text-sm"
                    >
                      🔐 Lock
                    </button>
                  </div>
                  
                  <div className="border-t border-[var(--border-color)] my-4" />
                  
                  <ToggleSetting
                    label="Lock on minimize"
                    description="Automatically lock when minimized to tray"
                    enabled={settings.security?.lockOnMinimize ?? false}
                    onChange={(enabled) => handleSettingChange('security.lockOnMinimize', enabled)}
                  />
                </>
              )}
            </div>
          </section>

          {/* Data Section */}
          <section className="card-3d p-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <span>💾</span> Data
            </h2>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-[var(--text-primary)]">Export data</p>
                  <p className="text-sm text-[var(--text-muted)]">Download all your sessions and settings</p>
                </div>
                <button onClick={handleExportData} className="btn-secondary-3d btn-professional">
                  📤 Export
                </button>
              </div>
              
              <div className="border-t border-[var(--border-color)] my-4" />
              
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-[var(--text-primary)]">Import data</p>
                  <p className="text-sm text-[var(--text-muted)]">Restore from a backup file</p>
                </div>
                <button onClick={handleImportData} className="btn-secondary-3d btn-professional">
                  📥 Import
                </button>
              </div>
              
              <div className="border-t border-[var(--border-color)] my-4" />
              
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-[var(--text-primary)]">Clear all data</p>
                  <p className="text-sm text-[var(--text-muted)]">Remove all local data and log out of all platforms</p>
                </div>
                <button onClick={handleClearData} className="btn-secondary-3d btn-professional text-red-500 hover:text-red-600">
                  🗑️ Clear Data
                </button>
              </div>
            </div>
          </section>

          {/* About Section */}
          <section className="card-3d p-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <span>ℹ️</span> About
            </h2>
            
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">App Name</span>
                <span className="text-[var(--text-primary)] font-medium">Chat Orbitor</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Version</span>
                <span className="text-[var(--text-primary)] font-medium">{appVersion}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Platform</span>
                <span className="text-[var(--text-primary)] font-medium capitalize">{osPlatform || 'Unknown'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Electron</span>
                <span className="text-[var(--text-primary)] font-medium">{isElectron ? 'Yes' : 'No'}</span>
              </div>
            </div>
            
            <div className="mt-4 p-3 rounded-lg bg-primary-500/10 border border-primary-500/20">
              <p className="text-xs text-[var(--text-muted)]">
                💡 All API calls are made directly from your computer using your residential IP address. 
                Your credentials are stored securely on your device and never sent to any external server.
              </p>
            </div>
          </section>

          {/* Quit Button */}
          <div className="flex justify-center pt-4 pb-8">
            <button
              onClick={quitApp}
              className="btn-secondary-3d btn-professional text-red-500 hover:text-red-600"
            >
              ❌ Quit Chat Orbitor
            </button>
          </div>
        </div>
      </div>
      
      {/* Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowPasswordModal(false)}>
          <div className="card-3d p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <span>🔒</span>
              {passwordModalMode === 'set' && 'Set Password'}
              {passwordModalMode === 'change' && 'Change Password'}
              {passwordModalMode === 'remove' && 'Remove Password'}
            </h3>
            
            <div className="space-y-4">
              {(passwordModalMode === 'change' || passwordModalMode === 'remove') && (
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    Current Password
                  </label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="input-professional w-full"
                    autoFocus
                  />
                </div>
              )}
              
              {(passwordModalMode === 'set' || passwordModalMode === 'change') && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                      {passwordModalMode === 'change' ? 'New Password' : 'Password'}
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter password (min 4 characters)"
                      className="input-professional w-full"
                      autoFocus={passwordModalMode === 'set'}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                      Confirm Password
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm password"
                      className="input-professional w-full"
                    />
                  </div>
                </>
              )}
              
              {passwordError && (
                <p className="text-sm text-red-500">{passwordError}</p>
              )}
              
              {passwordModalMode === 'remove' && (
                <p className="text-sm text-[var(--text-muted)]">
                  Enter your current password to remove password protection.
                </p>
              )}
            </div>
            
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowPasswordModal(false); resetPasswordFields(); }}
                className="btn-secondary-3d btn-professional flex-1"
              >
                Cancel
              </button>
              <button
                onClick={handlePasswordAction}
                className={`btn-professional flex-1 ${passwordModalMode === 'remove' ? 'btn-secondary-3d text-red-500' : 'btn-primary-3d'}`}
              >
                {passwordModalMode === 'set' && 'Set Password'}
                {passwordModalMode === 'change' && 'Change Password'}
                {passwordModalMode === 'remove' && 'Remove Password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface ToggleSettingProps {
  label: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}

const ToggleSetting: React.FC<ToggleSettingProps> = ({ label, description, enabled, onChange, disabled }) => {
  return (
    <div className={`flex items-center justify-between ${disabled ? 'opacity-50' : ''}`}>
      <div>
        <p className="font-medium text-[var(--text-primary)]">{label}</p>
        <p className="text-sm text-[var(--text-muted)]">{description}</p>
      </div>
      <button
        onClick={() => !disabled && onChange(!enabled)}
        disabled={disabled}
        className={`relative w-12 h-6 rounded-full transition-colors ${
          enabled ? 'bg-primary-500' : 'bg-[var(--bg-hover)]'
        } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            enabled ? 'left-7' : 'left-1'
          }`}
        />
      </button>
    </div>
  );
};

export default Settings;
