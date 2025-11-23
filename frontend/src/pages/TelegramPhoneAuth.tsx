import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../config/api';

export const TelegramPhoneAuth = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<'phone' | 'code' | 'password'>('phone');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await api.post('/api/telegram/auth/phone', { phoneNumber });
      setPhoneCodeHash(response.data.phoneCodeHash);
      setStep('code');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to send code');
    } finally {
      setLoading(false);
    }
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await api.post('/api/telegram/auth/verify', {
        phoneNumber,
        phoneCode,
        phoneCodeHash,
      });

      if (response.data.needPassword) {
        setStep('password');
      } else if (response.data.success) {
        navigate('/accounts?success=telegram');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await api.post('/api/telegram/auth/verify', {
        phoneNumber,
        phoneCode,
        phoneCodeHash,
        password,
      });

      if (response.data.success) {
        navigate('/accounts?success=telegram');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
        <h2 className="text-2xl font-bold text-center mb-6">Connect Telegram Account</h2>

        {step === 'phone' ? (
          <form onSubmit={handlePhoneSubmit}>
            <p className="text-gray-600 mb-4">
              Enter your phone number with country code (e.g., +1234567890)
            </p>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+1234567890"
              className="w-full px-4 py-2 border rounded-lg mb-4"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Sending...' : 'Send Code'}
            </button>
          </form>
        ) : step === 'code' ? (
          <form onSubmit={handleCodeSubmit}>
            <p className="text-gray-600 mb-4">
              Enter the verification code sent to {phoneNumber}
            </p>
            <input
              type="text"
              value={phoneCode}
              onChange={(e) => setPhoneCode(e.target.value)}
              placeholder="12345"
              className="w-full px-4 py-2 border rounded-lg mb-4"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Verify Code'}
            </button>
            <button
              type="button"
              onClick={() => setStep('phone')}
              className="w-full mt-2 text-blue-600 hover:underline"
            >
              Change Phone Number
            </button>
          </form>
        ) : (
          <form onSubmit={handlePasswordSubmit}>
            <p className="text-gray-600 mb-4">
              Your account has 2FA enabled. Enter your password:
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full px-4 py-2 border rounded-lg mb-4"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Submit Password'}
            </button>
          </form>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-600 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={() => navigate('/accounts')}
          className="w-full mt-4 text-gray-600 hover:underline text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
