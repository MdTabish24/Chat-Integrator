import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const OAuthCallback: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    handleCallback();
  }, []);

  const handleCallback = async () => {
    try {
      // Get query parameters from backend redirect
      const success = searchParams.get('success');
      const error = searchParams.get('error');
      const platform = searchParams.get('platform');
      const errorMessage = searchParams.get('message');

      // Check for OAuth errors
      if (error) {
        setStatus('error');
        setMessage(
          errorMessage || 
          `Failed to connect ${platform || 'account'}. ${error === 'callback_failed' ? 'Please try again.' : ''}`
        );
        return;
      }

      // Check for success
      if (success === 'true' && platform) {
        setStatus('success');
        setMessage(`Successfully connected your ${platform} account!`);

        // Redirect to accounts page after 2 seconds
        setTimeout(() => {
          navigate('/accounts');
        }, 2000);
        return;
      }

      // If neither success nor error, something went wrong
      setStatus('error');
      setMessage('Invalid callback response. Please try again.');
    } catch (err: any) {
      setStatus('error');
      setMessage('Failed to complete OAuth connection. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        {status === 'loading' && (
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Connecting your account...
            </h2>
            <p className="text-gray-600">Please wait while we complete the connection.</p>
          </div>
        )}

        {status === 'success' && (
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Success!</h2>
            <p className="text-gray-600 mb-4">{message}</p>
            <p className="text-sm text-gray-500">Redirecting to accounts page...</p>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Connection Failed</h2>
            <p className="text-gray-600 mb-6">{message}</p>
            <button
              onClick={() => navigate('/accounts')}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition-colors"
            >
              Back to Accounts
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default OAuthCallback;
