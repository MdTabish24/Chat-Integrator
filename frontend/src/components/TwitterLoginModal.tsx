import React, { useState } from 'react';

interface TwitterLoginModalProps {
  onSubmit: (credentials: { username: string; password: string; email?: string }) => Promise<void>;
  onCancel: () => void;
  isSubmitting: boolean;
}

const TwitterLoginModal: React.FC<TwitterLoginModalProps> = ({
  onSubmit,
  onCancel,
  isSubmitting,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim()) {
      setError('Username is required');
      return;
    }
    if (!password) {
      setError('Password is required');
      return;
    }

    try {
      await onSubmit({
        username: username.trim().replace('@', ''),
        password,
        email: email.trim() || undefined,
      });
    } catch (err: any) {
      setError(err.message || 'Login failed');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">🐦</span>
            <h2 className="text-lg font-semibold text-gray-900">Connect Twitter/X</h2>
          </div>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600"
            disabled={isSubmitting}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <p className="text-sm text-gray-600">
            Enter your Twitter/X credentials to connect your account.
          </p>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="@username"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              disabled={isSubmitting}
              autoComplete="username"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              disabled={isSubmitting}
              autoComplete="current-password"
            />
          </div>

          {/* Advanced options */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-sky-600 hover:text-sky-700"
            >
              {showAdvanced ? '▼' : '▶'} Advanced options
            </button>
            
            {showAdvanced && (
              <div className="mt-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email (optional)
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="For verification if required"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                  disabled={isSubmitting}
                  autoComplete="email"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Twitter may ask for email verification during login
                </p>
              </div>
            )}
          </div>

          {/* Security notice */}
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-600">
              🔒 Your credentials are used only to authenticate with Twitter and are not stored.
              We store only the session cookies needed to access your messages.
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-sky-500 text-white rounded-lg hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Connecting...</span>
                </>
              ) : (
                <span>Connect</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TwitterLoginModal;
