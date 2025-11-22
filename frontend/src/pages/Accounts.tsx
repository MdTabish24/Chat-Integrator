import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import apiClient from '../config/api';
import { ConnectedAccount, PlatformConfig, Platform } from '../types';
import PlatformCard from '../components/PlatformCard';
import ConnectedAccountsList from '../components/ConnectedAccountsList';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorDisplay from '../components/ErrorDisplay';

const platformConfigs: PlatformConfig[] = [
  { id: 'telegram', name: 'Telegram', icon: '📱', color: 'bg-blue-500' },
  { id: 'twitter', name: 'Twitter/X', icon: '🐦', color: 'bg-sky-500' },
  { id: 'linkedin', name: 'LinkedIn', icon: '💼', color: 'bg-blue-700' },
  { id: 'instagram', name: 'Instagram', icon: '📷', color: 'bg-pink-500' },
  { id: 'whatsapp', name: 'WhatsApp', icon: '💬', color: 'bg-green-500' },
  { id: 'facebook', name: 'Facebook', icon: '👥', color: 'bg-blue-600' },
  { id: 'teams', name: 'Microsoft Teams', icon: '👔', color: 'bg-purple-600' },
];

const Accounts: React.FC = () => {
  const navigate = useNavigate();
  const { showSuccess, showError: showToastError } = useToast();
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectingPlatform, setConnectingPlatform] = useState<Platform | null>(null);
  const [disconnectingAccount, setDisconnectingAccount] = useState<ConnectedAccount | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  useEffect(() => {
    fetchConnectedAccounts();
  }, []);

  const fetchConnectedAccounts = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get('/api/oauth/accounts');
      setConnectedAccounts(response.data);
    } catch (err: any) {
      const errorMessage = err.response?.data?.error?.message || 'Failed to fetch connected accounts';
      setError(errorMessage);
      showToastError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (platform: Platform) => {
    try {
      setConnectingPlatform(platform);
      setError(null);
      
      // Initiate OAuth flow
      const response = await apiClient.get(`/api/oauth/connect/${platform}`);
      const { authorizationUrl } = response.data;
      
      // Redirect to OAuth provider
      window.location.href = authorizationUrl;
    } catch (err: any) {
      const errorMessage = err.response?.data?.error?.message || `Failed to connect ${platform}`;
      setError(errorMessage);
      showToastError(errorMessage);
      setConnectingPlatform(null);
    }
  };

  const handleDisconnectClick = (account: ConnectedAccount) => {
    setDisconnectingAccount(account);
    setShowConfirmDialog(true);
  };

  const handleDisconnectConfirm = async () => {
    if (!disconnectingAccount) return;

    try {
      setError(null);
      await apiClient.delete(`/api/oauth/disconnect/${disconnectingAccount.id}`);
      
      // Remove from local state
      setConnectedAccounts(prev => 
        prev.filter(acc => acc.id !== disconnectingAccount.id)
      );
      
      showSuccess('Account disconnected successfully');
      setShowConfirmDialog(false);
      setDisconnectingAccount(null);
    } catch (err: any) {
      const errorMessage = err.response?.data?.error?.message || 'Failed to disconnect account';
      setError(errorMessage);
      showToastError(errorMessage);
      setShowConfirmDialog(false);
      setDisconnectingAccount(null);
    }
  };

  const handleDisconnectCancel = () => {
    setShowConfirmDialog(false);
    setDisconnectingAccount(null);
  };

  const isConnected = (platform: Platform): boolean => {
    return connectedAccounts.some(acc => acc.platform === platform && acc.isActive);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/dashboard')}
            className="text-blue-600 hover:text-blue-800 mb-4 flex items-center"
          >
            ← Back to Dashboard
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Connect Accounts</h1>
          <p className="mt-2 text-gray-600">
            Connect your social media and messaging accounts to manage all your messages in one place.
          </p>
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="py-12">
            <LoadingSpinner size="xl" text="Loading accounts..." />
          </div>
        ) : error ? (
          <ErrorDisplay
            message={error}
            title="Failed to load accounts"
            onRetry={fetchConnectedAccounts}
          />
        ) : (
          <>
            {/* Platform Cards Grid */}
            <div className="mb-12">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Available Platforms</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {platformConfigs.map(platform => (
                  <PlatformCard
                    key={platform.id}
                    platform={platform}
                    isConnected={isConnected(platform.id)}
                    isConnecting={connectingPlatform === platform.id}
                    onConnect={() => handleConnect(platform.id)}
                  />
                ))}
              </div>
            </div>

            {/* Connected Accounts List */}
            {connectedAccounts.length > 0 && (
              <ConnectedAccountsList
                accounts={connectedAccounts}
                platformConfigs={platformConfigs}
                onDisconnect={handleDisconnectClick}
              />
            )}
          </>
        )}

        {/* Confirm Disconnect Dialog */}
        {showConfirmDialog && disconnectingAccount && (
          <ConfirmDialog
            title="Disconnect Account"
            message={`Are you sure you want to disconnect your ${
              platformConfigs.find(p => p.id === disconnectingAccount.platform)?.name
            } account (${disconnectingAccount.platformUsername})? This will remove access to your messages from this platform.`}
            confirmText="Disconnect"
            cancelText="Cancel"
            onConfirm={handleDisconnectConfirm}
            onCancel={handleDisconnectCancel}
            variant="danger"
          />
        )}
      </div>
    </div>
  );
};

export default Accounts;
