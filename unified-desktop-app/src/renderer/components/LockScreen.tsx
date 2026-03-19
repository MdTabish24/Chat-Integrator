import React, { useState, useEffect, useRef } from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface LockScreenProps {
  onUnlock: () => void;
}

const LockScreen: React.FC<LockScreenProps> = ({ onUnlock }) => {
  const { isDark } = useTheme();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || isVerifying) return;

    setIsVerifying(true);
    setError('');

    try {
      const result = await window.electronAPI.security.unlock(password);
      if (result.success) {
        onUnlock();
      } else {
        setError(result.error || 'Incorrect password');
        setPassword('');
        inputRef.current?.focus();
      }
    } catch (err: any) {
      setError('Failed to verify password');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center dashboard-bg">
      <div className="card-3d p-8 w-full max-w-sm mx-4 text-center">
        {/* Lock Icon */}
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary-500/20 flex items-center justify-center">
          <svg className="w-10 h-10 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>

        {/* Title */}
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">
          Chat Orbitor is Locked
        </h2>
        <p className="text-sm text-[var(--text-muted)] mb-6">
          Enter your password to unlock
        </p>

        {/* Password Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="input-professional w-full text-center"
              disabled={isVerifying}
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm text-red-500 animate-shake">{error}</p>
          )}

          <button
            type="submit"
            disabled={!password.trim() || isVerifying}
            className="btn-primary-3d btn-professional w-full disabled:opacity-50"
          >
            {isVerifying ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Verifying...
              </div>
            ) : (
              '🔓 Unlock'
            )}
          </button>
        </form>

        {/* Footer */}
        <p className="text-xs text-[var(--text-muted)] mt-6">
          Your data is protected with password encryption
        </p>
      </div>
    </div>
  );
};

export default LockScreen;
