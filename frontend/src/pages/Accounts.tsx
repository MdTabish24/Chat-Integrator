import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import apiClient from '../config/api';
import { ConnectedAccount, PlatformConfig, Platform } from '../types';
import PlatformCard from '../components/PlatformCard';
import ConnectedAccountsList from '../components/ConnectedAccountsList';
import ConfirmDialog from '../components/ConfirmDialog';
import CookieInputModal, { CookieField } from '../components/CookieInputModal';
import TwitterLoginModal from '../components/TwitterLoginModal';
import WhatsAppQRModal from '../components/WhatsAppQRModal';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorDisplay from '../components/ErrorDisplay';

// Cookie-based platform configurations (for platforms that still need cookies)
const cookiePlatformConfigs: Record<string, {
  fields: CookieField[];
  endpoint: string;
}> = {
  linkedin: {
    fields: [
      {
        name: 'li_at',
        label: 'li_at',
        placeholder: 'Enter your li_at cookie value',
        helpText: 'Main authentication cookie from LinkedIn',
      },
      {
        name: 'JSESSIONID',
        label: 'JSESSIONID',
        placeholder: 'Enter your JSESSIONID cookie value',
        helpText: 'Session ID cookie from LinkedIn (include quotes if present)',
      },
    ],
    endpoint: '/api/platforms/linkedin/cookies',
  },
  facebook: {
    fields: [
      {
        name: 'c_user',
        label: 'c_user',
        placeholder: 'Enter your c_user cookie value',
        helpText: 'Your Facebook user ID cookie',
      },
      {
        name: 'xs',
        label: 'xs',
        placeholder: 'Enter your xs cookie value',
        helpText: 'Session cookie from Facebook',
      },
    ],
    endpoint: '/api/platforms/facebook/cookies',
  },
};

const platformConfigs: PlatformConfig[] = [
  { id: 'telegram', name: 'Telegram', icon: '📱', color: 'bg-blue-500' },
  { id: 'twitter', name: 'Twitter/X', icon: '🐦', color: 'bg-sky-500' },
  { id: 'linkedin', name: 'LinkedIn', icon: '💼', color: 'bg-blue-700' },
  { id: 'instagram', name: 'Instagram', icon: '📷', color: 'bg-pink-500' },
  { id: 'whatsapp', name: 'WhatsApp', icon: '💬', color: 'bg-green-500' },
  { id: 'facebook', name: 'Facebook', icon: '👥', color: 'bg-blue-600' },
  { id: 'teams', name: 'Microsoft Teams', icon: '👔', color: 'bg-purple-600' },
  { id: 'discord', name: 'Discord', icon: '🎮', color: 'bg-indigo-600' },
  { id: 'gmail', name: 'Gmail', icon: '📧', color: 'bg-red-500' },
];

const Accounts: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { showSuccess, showError: showToastError } = useToast();
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectingPlatform, setConnectingPlatform] = useState<Platform | null>(null);
  const [disconnectingAccount, setDisconnectingAccount] = useState<ConnectedAccount | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showCookieModal, setShowCookieModal] = useState<Platform | null>(null);
  const [isSubmittingCookies, setIsSubmittingCookies] = useState(false);
  const [showWhatsAppQRModal, setShowWhatsAppQRModal] = useState(false);
  const [showTwitterLoginModal, setShowTwitterLoginModal] = useState(false);
  const [isSubmittingTwitter, setIsSubmittingTwitter] = useState(false);

  useEffect(() => {
    fetchConnectedAccounts();
  }, []);

  // Refresh accounts when redirected from OAuth callback
  useEffect(() => {
    if (location.state?.refresh) {
      fetchConnectedAccounts();
      // Clear the state to prevent refresh on subsequent renders
      window.history.replaceState({}, document.title);
    }
  }, [location]);

  const fetchConnectedAccounts = async () => {
    try {
      console.log('🔍 [ACCOUNTS DEBUG] Fetching connected accounts...');
      setLoading(true);
      setError(null);
      const response = await apiClient.get('/api/oauth/accounts');
      console.log('✅ [ACCOUNTS DEBUG] API Response:', response.data);
      const accounts = (response.data.accounts || []).map((acc: any) => ({
        ...acc,
        isActive: acc.is_active !== undefined ? acc.is_active : acc.isActive,
        platformUsername: acc.platform_username || acc.platformUsername,
        platformUserId: acc.platform_user_id || acc.platformUserId,
      }));
      console.log('📊 [ACCOUNTS DEBUG] Processed accounts:', accounts);
      setConnectedAccounts(accounts);
    } catch (err: any) {
      console.error('❌ [ACCOUNTS DEBUG] Error:', err);
      console.error('❌ [ACCOUNTS DEBUG] Error response:', err.response?.data);
      console.error('❌ [ACCOUNTS DEBUG] Error status:', err.response?.status);
      const errorMessage = err.response?.data?.error?.message || 'Failed to fetch connected accounts';
      setError(errorMessage);
      showToastError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (platform: Platform) => {
    console.log(`🔗 [ACCOUNTS DEBUG] Attempting to connect: ${platform}`);
    // Prevent connecting if already connected
    if (isConnected(platform)) {
      console.warn(`⚠️ [ACCOUNTS DEBUG] ${platform} is already connected`);
      showToastError(`${platform} is already connected`);
      return;
    }

    try {
      setConnectingPlatform(platform);
      setError(null);
      
      // For Telegram, use phone authentication
      if (platform === 'telegram') {
        navigate('/auth/telegram-phone');
        return;
      }
      
      // For Twitter, use username/password login
      if (platform === 'twitter') {
        setShowTwitterLoginModal(true);
        setConnectingPlatform(null);
        return;
      }
      
      // For cookie-based platforms, show the cookie input modal
      if (platform in cookiePlatformConfigs) {
        setShowCookieModal(platform);
        setConnectingPlatform(null);
        return;
      }
      
      // For WhatsApp, show the QR code modal
      if (platform === 'whatsapp') {
        setShowWhatsAppQRModal(true);
        setConnectingPlatform(null);
        return;
      }
      
      // Initiate OAuth flow for other platforms
      console.log(`🔍 [ACCOUNTS DEBUG] Initiating OAuth for ${platform}`);
      const response = await apiClient.get(`/api/oauth/connect/${platform}`);
      console.log(`✅ [ACCOUNTS DEBUG] OAuth response:`, response.data);
      const { authorizationUrl } = response.data;
      console.log(`🔗 [ACCOUNTS DEBUG] Redirecting to: ${authorizationUrl}`);
      
      // Redirect to OAuth provider
      window.location.href = authorizationUrl;
    } catch (err: any) {
      console.error(`❌ [ACCOUNTS DEBUG] Connect error for ${platform}:`, err);
      console.error(`❌ [ACCOUNTS DEBUG] Error response:`, err.response?.data);
      console.error(`❌ [ACCOUNTS DEBUG] Error status:`, err.response?.status);
      const errorMessage = err.response?.data?.error?.message || `Failed to connect ${platform}`;
      setError(errorMessage);
      showToastError(errorMessage);
      setConnectingPlatform(null);
    }
  };

  const handleCookieSubmit = async (cookies: Record<string, string>) => {
    if (!showCookieModal) return;
    
    const config = cookiePlatformConfigs[showCookieModal];
    if (!config) return;

    try {
      setIsSubmittingCookies(true);
      console.log(`🍪 [ACCOUNTS DEBUG] Submitting cookies for ${showCookieModal}`);
      
      await apiClient.post(config.endpoint, { cookies });
      
      console.log(`✅ [ACCOUNTS DEBUG] Cookies submitted successfully for ${showCookieModal}`);
      showSuccess(`${platformConfigs.find(p => p.id === showCookieModal)?.name} connected successfully`);
      setShowCookieModal(null);
      
      // Refresh the accounts list
      await fetchConnectedAccounts();
    } catch (err: any) {
      console.error(`❌ [ACCOUNTS DEBUG] Cookie submit error:`, err);
      const errorMessage = err.response?.data?.error?.message || err.response?.data?.error || 'Failed to connect account';
      throw new Error(errorMessage);
    } finally {
      setIsSubmittingCookies(false);
    }
  };

  const handleCookieModalCancel = () => {
    setShowCookieModal(null);
    setIsSubmittingCookies(false);
  };

  const handleWhatsAppQRSuccess = async () => {
    console.log('✅ [ACCOUNTS DEBUG] WhatsApp connected successfully');
    showSuccess('WhatsApp connected successfully');
    setShowWhatsAppQRModal(false);
    // Refresh the accounts list
    await fetchConnectedAccounts();
  };

  const handleWhatsAppQRCancel = () => {
    setShowWhatsAppQRModal(false);
  };

  const handleTwitterLogin = async (credentials: { username: string; password: string; email?: string }) => {
    try {
      setIsSubmittingTwitter(true);
      console.log(`🐦 [ACCOUNTS DEBUG] Logging in to Twitter as @${credentials.username}`);
      
      await apiClient.post('/api/platforms/twitter/login', credentials);
      
      console.log('✅ [ACCOUNTS DEBUG] Twitter login successful');
      showSuccess('Twitter/X connected successfully');
      setShowTwitterLoginModal(false);
      
      // Refresh the accounts list
      await fetchConnectedAccounts();
    } catch (err: any) {
      console.error('❌ [ACCOUNTS DEBUG] Twitter login error:', err);
      const errorMessage = err.response?.data?.error?.message || err.response?.data?.error || 'Failed to connect Twitter';
      throw new Error(errorMessage);
    } finally {
      setIsSubmittingTwitter(false);
    }
  };

  const handleTwitterLoginCancel = () => {
    setShowTwitterLoginModal(false);
    setIsSubmittingTwitter(false);
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
    return connectedAccounts.some(acc => acc.platform === platform && acc.isActive !== false);
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

        {/* Cookie Input Modal for Twitter, LinkedIn, Facebook */}
        {showCookieModal && cookiePlatformConfigs[showCookieModal] && (
          <CookieInputModal
            platform={showCookieModal}
            platformName={platformConfigs.find(p => p.id === showCookieModal)?.name || showCookieModal}
            platformIcon={platformConfigs.find(p => p.id === showCookieModal)?.icon || '🔗'}
            platformColor={platformConfigs.find(p => p.id === showCookieModal)?.color || 'bg-gray-500'}
            fields={cookiePlatformConfigs[showCookieModal].fields}
            onSubmit={handleCookieSubmit}
            onCancel={handleCookieModalCancel}
            isSubmitting={isSubmittingCookies}
          />
        )}

        {/* WhatsApp QR Code Modal */}
        {showWhatsAppQRModal && (
          <WhatsAppQRModal
            onSuccess={handleWhatsAppQRSuccess}
            onCancel={handleWhatsAppQRCancel}
          />
        )}

        {/* Twitter Login Modal */}
        {showTwitterLoginModal && (
          <TwitterLoginModal
            onSubmit={handleTwitterLogin}
            onCancel={handleTwitterLoginCancel}
            isSubmitting={isSubmittingTwitter}
          />
        )}
      </div>
    </div>
  );
};

export default Accounts;
