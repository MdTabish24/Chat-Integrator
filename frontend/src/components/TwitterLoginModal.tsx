import React, { useState } from 'react';

interface TwitterLoginModalProps {
  onSubmit: (cookies: Record<string, string>) => Promise<void>;
  onCancel: () => void;
  isSubmitting: boolean;
}

const TwitterLoginModal: React.FC<TwitterLoginModalProps> = ({
  onSubmit,
  onCancel,
  isSubmitting,
}) => {
  const [authToken, setAuthToken] = useState('');
  const [ct0, setCt0] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(1);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!authToken.trim()) {
      setError('auth_token is required');
      return;
    }
    if (!ct0.trim()) {
      setError('ct0 is required');
      return;
    }

    try {
      await onSubmit({
        auth_token: authToken.trim(),
        ct0: ct0.trim(),
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

        {step === 1 ? (
          /* Step 1: Instructions */
          <div className="p-4 space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-medium text-blue-900 mb-2">Why cookies?</h3>
              <p className="text-sm text-blue-800">
                Twitter blocks automated logins from servers. We need your browser cookies to access your DMs securely.
              </p>
            </div>

            <h3 className="font-medium text-gray-900">How to get your cookies:</h3>
            
            <ol className="space-y-3 text-sm">
              <li className="flex items-start space-x-3">
                <span className="flex-shrink-0 w-6 h-6 bg-sky-500 text-white rounded-full flex items-center justify-center text-xs font-bold">1</span>
                <div>
                  <p className="font-medium">Open Twitter/X in your browser</p>
                  <p className="text-gray-500">Go to <a href="https://x.com" target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline">x.com</a> and make sure you're logged in</p>
                </div>
              </li>
              
              <li className="flex items-start space-x-3">
                <span className="flex-shrink-0 w-6 h-6 bg-sky-500 text-white rounded-full flex items-center justify-center text-xs font-bold">2</span>
                <div>
                  <p className="font-medium">Open Developer Tools</p>
                  <p className="text-gray-500">Press <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">F12</kbd> or right-click → "Inspect"</p>
                </div>
              </li>
              
              <li className="flex items-start space-x-3">
                <span className="flex-shrink-0 w-6 h-6 bg-sky-500 text-white rounded-full flex items-center justify-center text-xs font-bold">3</span>
                <div>
                  <p className="font-medium">Go to Application tab</p>
                  <p className="text-gray-500">Click "Application" tab → "Cookies" → "https://x.com"</p>
                </div>
              </li>
              
              <li className="flex items-start space-x-3">
                <span className="flex-shrink-0 w-6 h-6 bg-sky-500 text-white rounded-full flex items-center justify-center text-xs font-bold">4</span>
                <div>
                  <p className="font-medium">Copy these two cookies:</p>
                  <ul className="mt-1 space-y-1 text-gray-500">
                    <li>• <code className="bg-gray-100 px-1 rounded">auth_token</code> - Your login session</li>
                    <li>• <code className="bg-gray-100 px-1 rounded">ct0</code> - Security token</li>
                  </ul>
                </div>
              </li>
            </ol>

            <button
              onClick={() => setStep(2)}
              className="w-full py-2 bg-sky-500 text-white rounded-lg hover:bg-sky-600 transition-colors"
            >
              I have my cookies →
            </button>
          </div>
        ) : (
          /* Step 2: Cookie Input */
          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-sm text-sky-600 hover:text-sky-700 flex items-center"
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
                auth_token <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder="Paste your auth_token cookie value"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500 font-mono text-sm"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ct0 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={ct0}
                onChange={(e) => setCt0(e.target.value)}
                placeholder="Paste your ct0 cookie value"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500 font-mono text-sm"
                disabled={isSubmitting}
              />
            </div>

            {/* Security notice */}
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-600">
                🔒 Your cookies are encrypted and stored securely. They are only used to access your Twitter DMs.
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
                  <span>Connect Twitter</span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default TwitterLoginModal;
