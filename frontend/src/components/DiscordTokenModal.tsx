import React, { useState } from 'react';

interface DiscordTokenModalProps {
  onSubmit: (data: { token: string; platform_user_id: string; platform_username: string }) => Promise<void>;
  onCancel: () => void;
  isSubmitting: boolean;
}

const DiscordTokenModal: React.FC<DiscordTokenModalProps> = ({
  onSubmit,
  onCancel,
  isSubmitting,
}) => {
  const [token, setToken] = useState('');
  const [userId, setUserId] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(1);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token.trim()) {
      setError('Discord token is required');
      return;
    }
    if (!userId.trim()) {
      setError('Discord User ID is required');
      return;
    }
    if (!username.trim()) {
      setError('Discord Username is required');
      return;
    }

    try {
      await onSubmit({
        token: token.trim(),
        platform_user_id: userId.trim(),
        platform_username: username.trim(),
      });
    } catch (err: any) {
      setError(err.message || 'Failed to connect');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">🎮</span>
            <h2 className="text-lg font-semibold text-gray-900">Connect Discord</h2>
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

        {step === 1 ? (
          /* Step 1: Instructions */
          <div className="p-4 space-y-4">
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
              <h3 className="font-medium text-indigo-900 mb-2">Why a token?</h3>
              <p className="text-sm text-indigo-800">
                Discord requires a user token to access DMs. This allows us to read and send messages on your behalf.
              </p>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h3 className="font-medium text-amber-900 mb-2">⚠️ Important Security Note</h3>
              <p className="text-sm text-amber-800">
                Never share your Discord token with anyone. Your token provides full access to your account.
                Only use this feature if you understand the risks.
              </p>
            </div>

            <h3 className="font-medium text-gray-900">How to get your Discord token:</h3>
            
            <ol className="space-y-3 text-sm">
              <li className="flex items-start space-x-3">
                <span className="flex-shrink-0 w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</span>
                <div>
                  <p className="font-medium">Open Discord in your browser</p>
                  <p className="text-gray-500">Go to <a href="https://discord.com/app" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">discord.com/app</a> and log in</p>
                </div>
              </li>
              
              <li className="flex items-start space-x-3">
                <span className="flex-shrink-0 w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</span>
                <div>
                  <p className="font-medium">Open Developer Tools</p>
                  <p className="text-gray-500">Press <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">F12</kbd> or <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">Ctrl+Shift+I</kbd></p>
                </div>
              </li>
              
              <li className="flex items-start space-x-3">
                <span className="flex-shrink-0 w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-xs font-bold">3</span>
                <div>
                  <p className="font-medium">Go to Network tab</p>
                  <p className="text-gray-500">Click the "Network" tab, then filter by "XHR" or "Fetch"</p>
                </div>
              </li>
              
              <li className="flex items-start space-x-3">
                <span className="flex-shrink-0 w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-xs font-bold">4</span>
                <div>
                  <p className="font-medium">Find your token</p>
                  <p className="text-gray-500">Click any request, go to "Headers", find "Authorization" header</p>
                </div>
              </li>

              <li className="flex items-start space-x-3">
                <span className="flex-shrink-0 w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-xs font-bold">5</span>
                <div>
                  <p className="font-medium">Get your User ID</p>
                  <p className="text-gray-500">In Discord, enable Developer Mode (Settings → Advanced), then right-click your profile → "Copy User ID"</p>
                </div>
              </li>
            </ol>

            <button
              onClick={() => setStep(2)}
              className="w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              I have my token →
            </button>
          </div>
        ) : (
          /* Step 2: Token Input */
          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center"
            >
              ← Back to instructions
            </button>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Discord Token <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your Discord token"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                User ID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="e.g., 123456789012345678"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g., username#1234 or username"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                disabled={isSubmitting}
              />
            </div>

            {/* Security notice */}
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-600">
                🔒 Your token is encrypted and stored securely. It is only used to access your Discord DMs.
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
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
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
                  <span>Connect Discord</span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default DiscordTokenModal;
