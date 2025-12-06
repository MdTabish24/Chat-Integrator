import React, { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../config/api';

interface WhatsAppQRModalProps {
  onSuccess: () => void;
  onCancel: () => void;
}

type ConnectionStatus = 'idle' | 'loading' | 'pending_qr_scan' | 'connected' | 'timeout' | 'error';

const WhatsAppQRModal: React.FC<WhatsAppQRModalProps> = ({ onSuccess, onCancel }) => {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState<number>(120);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Start QR session
  const startQRSession = useCallback(async () => {
    setStatus('loading');
    setError(null);
    setQrCode(null);
    setSessionId(null);

    try {
      const response = await apiClient.post('/api/platforms/whatsapp/qr');
      const data = response.data;

      if (data.success && data.qr_code) {
        setQrCode(data.qr_code);
        setSessionId(data.session_id);
        setExpiresIn(data.expires_in || 120);
        setStatus('pending_qr_scan');
      } else {
        throw new Error(data.error?.message || 'Failed to generate QR code');
      }
    } catch (err: any) {
      console.error('[WhatsApp QR] Failed to start session:', err);
      setError(err.response?.data?.error?.message || err.message || 'Failed to generate QR code');
      setStatus('error');
    }
  }, []);

  // Poll for session status
  const pollSessionStatus = useCallback(async () => {
    if (!sessionId) return;

    try {
      const response = await apiClient.get(`/api/platforms/whatsapp/status/${sessionId}`);
      const data = response.data;

      if (data.status === 'connected') {
        setStatus('connected');
        // Clear polling
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        // Notify parent of success after a brief delay
        setTimeout(() => {
          onSuccess();
        }, 1500);
      } else if (data.status === 'timeout') {
        setStatus('timeout');
        setError('QR code expired. Please refresh to try again.');
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      }
    } catch (err: any) {
      console.error('[WhatsApp QR] Status poll error:', err);
    }
  }, [sessionId, onSuccess]);


  // Refresh QR code
  const refreshQRCode = useCallback(async () => {
    if (!sessionId) {
      // Start a new session if no session exists
      await startQRSession();
      return;
    }

    setStatus('loading');
    setError(null);

    try {
      const response = await apiClient.get(`/api/platforms/whatsapp/qr/${sessionId}`);
      const data = response.data;

      if (data.qr_code) {
        setQrCode(data.qr_code);
        setExpiresIn(120);
        setStatus('pending_qr_scan');
      } else if (data.status === 'connected') {
        setStatus('connected');
        setTimeout(() => {
          onSuccess();
        }, 1500);
      } else {
        // Session expired, start new one
        await startQRSession();
      }
    } catch (err: any) {
      console.error('[WhatsApp QR] Failed to refresh QR:', err);
      // Try starting a new session
      await startQRSession();
    }
  }, [sessionId, startQRSession, onSuccess]);

  // Start session on mount
  useEffect(() => {
    startQRSession();

    return () => {
      // Cleanup intervals on unmount
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, [startQRSession]);

  // Start polling when we have a session
  useEffect(() => {
    if (sessionId && status === 'pending_qr_scan') {
      // Poll every 3 seconds
      pollIntervalRef.current = setInterval(pollSessionStatus, 3000);

      // Countdown timer
      countdownIntervalRef.current = setInterval(() => {
        setExpiresIn(prev => {
          if (prev <= 1) {
            setStatus('timeout');
            setError('QR code expired. Please refresh to try again.');
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            if (countdownIntervalRef.current) {
              clearInterval(countdownIntervalRef.current);
              countdownIntervalRef.current = null;
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
      };
    }
  }, [sessionId, status, pollSessionStatus]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        {/* Header */}
        <div className="flex items-center mb-6">
          <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center text-2xl mr-4">
            💬
          </div>
          <div>
            <h3 className="text-xl font-semibold text-gray-900">
              Connect WhatsApp
            </h3>
            <p className="text-sm text-gray-500">
              Scan the QR code with your phone
            </p>
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-green-600 mt-0.5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div className="text-sm text-green-800">
              <p className="font-medium mb-1">How to connect:</p>
              <ol className="list-decimal list-inside space-y-1 text-green-700">
                <li>Open WhatsApp on your phone</li>
                <li>Tap Menu or Settings and select Linked Devices</li>
                <li>Tap on "Link a Device"</li>
                <li>Point your phone at this screen to scan the QR code</li>
              </ol>
            </div>
          </div>
        </div>

        {/* QR Code Display */}
        <div className="flex flex-col items-center mb-6">
          {status === 'loading' && (
            <div className="w-64 h-64 bg-gray-100 rounded-lg flex items-center justify-center">
              <div className="text-center">
                <svg className="animate-spin h-10 w-10 text-green-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <p className="text-gray-500 text-sm">Generating QR code...</p>
              </div>
            </div>
          )}

          {status === 'pending_qr_scan' && qrCode && (
            <>
              <div className="w-64 h-64 bg-white border-2 border-green-500 rounded-lg p-2 flex items-center justify-center">
                <img
                  src={`data:image/png;base64,${qrCode}`}
                  alt="WhatsApp QR Code"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="mt-3 text-center">
                <p className="text-sm text-gray-500">
                  QR code expires in{' '}
                  <span className={`font-medium ${expiresIn <= 30 ? 'text-red-500' : 'text-green-600'}`}>
                    {formatTime(expiresIn)}
                  </span>
                </p>
              </div>
            </>
          )}

          {status === 'connected' && (
            <div className="w-64 h-64 bg-green-50 rounded-lg flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-green-700 font-medium">Connected!</p>
                <p className="text-green-600 text-sm mt-1">WhatsApp linked successfully</p>
              </div>
            </div>
          )}

          {(status === 'timeout' || status === 'error') && (
            <div className="w-64 h-64 bg-red-50 rounded-lg flex items-center justify-center">
              <div className="text-center px-4">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <p className="text-red-700 font-medium">
                  {status === 'timeout' ? 'QR Code Expired' : 'Connection Failed'}
                </p>
                <p className="text-red-600 text-sm mt-1">{error || 'Please try again'}</p>
              </div>
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && status !== 'timeout' && status !== 'error' && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Buttons */}
        <div className="flex space-x-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={status === 'loading'}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors font-medium disabled:opacity-50"
          >
            Cancel
          </button>
          {(status === 'timeout' || status === 'error' || status === 'idle') && (
            <button
              type="button"
              onClick={refreshQRCode}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors font-medium flex items-center justify-center"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh QR Code
            </button>
          )}
          {status === 'pending_qr_scan' && (
            <button
              type="button"
              onClick={refreshQRCode}
              disabled={expiresIn > 90}
              className={`flex-1 px-4 py-2 rounded transition-colors font-medium flex items-center justify-center ${
                expiresIn > 90
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default WhatsAppQRModal;
