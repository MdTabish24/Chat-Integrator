import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TelegramLoginWidget } from '../components/TelegramLoginWidget';
import api from '../config/api';

export const TelegramAuth = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const state = searchParams.get('state');
  const botUsername = searchParams.get('bot');
  const redirectUri = searchParams.get('redirect');

  useEffect(() => {
    if (!state || !botUsername) {
      setError('Invalid authorization request');
    }
  }, [state, botUsername]);

  const handleTelegramAuth = async (user: any) => {
    setLoading(true);
    setError('');

    try {
      // Send auth data to backend
      const response = await api.post(`/api/auth/callback/telegram`, {
        ...user,
        state,
      });

      if (response.data.success) {
        // Redirect to accounts page
        navigate('/accounts');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  if (error && !botUsername) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
          <div className="text-red-600 text-center">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
        <h2 className="text-2xl font-bold text-center mb-6">Connect Telegram</h2>
        
        <p className="text-gray-600 text-center mb-6">
          Click the button below to authorize your Telegram account. 
          This will allow you to receive and send messages from your dashboard.
        </p>

        {loading ? (
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2 text-gray-600">Connecting...</p>
          </div>
        ) : (
          <div className="flex justify-center">
            <TelegramLoginWidget
              botName={botUsername || ''}
              onAuth={handleTelegramAuth}
              buttonSize="large"
            />
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-600 text-sm">
            {error}
          </div>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/accounts')}
            className="text-blue-600 hover:underline text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
