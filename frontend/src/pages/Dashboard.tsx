import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useWebSocket } from '../hooks/useWebSocket';
import { useToast } from '../contexts/ToastContext';
import DashboardPlatformCard from '../components/DashboardPlatformCard';
import MessageThread from '../components/MessageThread';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import ErrorDisplay from '../components/ErrorDisplay';
import apiClient from '../config/api';
import { Platform, Conversation, ConnectedAccount } from '../types';

interface PlatformData {
  platform: Platform;
  name: string;
  icon: string;
  color: string;
  unreadCount: number;
  conversations: Conversation[];
  isExpanded: boolean;
  isLoading: boolean;
  error?: string;
}

const PLATFORM_CONFIGS: Record<Platform, { name: string; icon: string; color: string }> = {
  telegram: { name: 'Telegram', icon: '✈️', color: 'bg-blue-500' },
  twitter: { name: 'Twitter/X', icon: '🐦', color: 'bg-sky-500' },
  linkedin: { name: 'LinkedIn', icon: '💼', color: 'bg-blue-700' },
  instagram: { name: 'Instagram', icon: '📷', color: 'bg-pink-500' },
  whatsapp: { name: 'WhatsApp', icon: '💬', color: 'bg-green-500' },
  facebook: { name: 'Facebook', icon: '👥', color: 'bg-blue-600' },
  teams: { name: 'Microsoft Teams', icon: '👔', color: 'bg-purple-600' },
};

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { showError } = useToast();
  const [platformsData, setPlatformsData] = useState<Map<Platform, PlatformData>>(new Map());
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [totalUnread, setTotalUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

  // WebSocket callbacks
  const handleUnreadCountUpdate = useCallback((data: any) => {
    console.log('Unread count update received:', data);
    setTotalUnread(data.totalUnread);
    
    setPlatformsData((prev) => {
      const updated = new Map(prev);
      Object.entries(data.unreadCounts).forEach(([platform, count]) => {
        const platformData = updated.get(platform as Platform);
        if (platformData) {
          updated.set(platform as Platform, {
            ...platformData,
            unreadCount: count as number,
          });
        }
      });
      return updated;
    });
  }, []);

  const handleNewMessage = useCallback((data: any) => {
    console.log('New message received:', data);
    // Refresh conversations for the affected platform if expanded
    if (data.conversation) {
      const accountId = data.conversation.accountId;
      const account = connectedAccounts.find(acc => acc.id === accountId);
      if (account) {
        const platformData = platformsData.get(account.platform);
        if (platformData?.isExpanded) {
          loadConversationsForPlatform(account.platform);
        }
      }
    }
  }, [connectedAccounts, platformsData]);

  const handleConversationUpdate = useCallback((data: any) => {
    console.log('Conversation update received:', data);
    // Update the specific conversation in the platform data
    const conversation = data.conversation;
    setPlatformsData((prev) => {
      const updated = new Map(prev);
      updated.forEach((platformData, platform) => {
        const convIndex = platformData.conversations.findIndex(c => c.id === conversation.id);
        if (convIndex !== -1) {
          const updatedConversations = [...platformData.conversations];
          updatedConversations[convIndex] = conversation;
          updated.set(platform, {
            ...platformData,
            conversations: updatedConversations,
          });
        }
      });
      return updated;
    });
  }, []);

  // Initialize WebSocket
  const { isConnected, isAuthenticated } = useWebSocket({
    onUnreadCountUpdate: handleUnreadCountUpdate,
    onNewMessage: handleNewMessage,
    onConversationUpdate: handleConversationUpdate,
    onError: (error) => {
      console.error('WebSocket error:', error);
      showError('Real-time connection lost. Reconnecting...');
    },
  });

  // Load connected accounts
  const loadConnectedAccounts = useCallback(async () => {
    try {
      setIsLoadingAccounts(true);
      setError(null);
      const response = await apiClient.get('/api/oauth/accounts');
      const accounts = response.data.accounts || [];
      setConnectedAccounts(accounts);

      // Initialize platform data for connected accounts
      const newPlatformsData = new Map<Platform, PlatformData>();
      accounts.forEach((account: ConnectedAccount) => {
        if (!newPlatformsData.has(account.platform)) {
          const config = PLATFORM_CONFIGS[account.platform];
          newPlatformsData.set(account.platform, {
            platform: account.platform,
            name: config.name,
            icon: config.icon,
            color: config.color,
            unreadCount: 0,
            conversations: [],
            isExpanded: false,
            isLoading: false,
          });
        }
      });
      setPlatformsData(newPlatformsData);

      // Load unread counts
      await loadUnreadCounts();
    } catch (err: any) {
      console.error('Error loading connected accounts:', err);
      const errorMessage = err.response?.data?.error || 'Failed to load connected accounts';
      setError(errorMessage);
      showError(errorMessage);
    } finally {
      setIsLoadingAccounts(false);
    }
  }, [showError]);

  // Load unread counts
  const loadUnreadCounts = async () => {
    try {
      const response = await apiClient.get('/api/messages/unread/count');
      setTotalUnread(response.data.total);
      
      setPlatformsData((prev) => {
        const updated = new Map(prev);
        Object.entries(response.data.byPlatform).forEach(([platform, count]) => {
          const platformData = updated.get(platform as Platform);
          if (platformData) {
            updated.set(platform as Platform, {
              ...platformData,
              unreadCount: count as number,
            });
          }
        });
        return updated;
      });
    } catch (err) {
      console.error('Error loading unread counts:', err);
    }
  };

  // Load conversations for a specific platform
  const loadConversationsForPlatform = async (platform: Platform) => {
    setPlatformsData((prev) => {
      const updated = new Map(prev);
      const platformData = updated.get(platform);
      if (platformData) {
        updated.set(platform, { ...platformData, isLoading: true, error: undefined });
      }
      return updated;
    });

    try {
      // For Telegram, trigger sync first
      if (platform === 'telegram') {
        const telegramAccount = connectedAccounts.find(acc => acc.platform === 'telegram');
        if (telegramAccount) {
          try {
            await apiClient.post(`/api/telegram/${telegramAccount.id}/sync`);
          } catch (syncErr) {
            console.error('Telegram sync error:', syncErr);
          }
        }
      }

      const response = await apiClient.get('/api/conversations', {
        params: { platform },
      });
      
      const conversations = response.data.conversations || [];
      
      setPlatformsData((prev) => {
        const updated = new Map(prev);
        const platformData = updated.get(platform);
        if (platformData) {
          updated.set(platform, {
            ...platformData,
            conversations,
            isLoading: false,
            error: undefined,
          });
        }
        return updated;
      });
    } catch (err: any) {
      console.error(`Error loading conversations for ${platform}:`, err);
      setPlatformsData((prev) => {
        const updated = new Map(prev);
        const platformData = updated.get(platform);
        if (platformData) {
          updated.set(platform, {
            ...platformData,
            isLoading: false,
            error: err.response?.data?.error || 'Failed to load conversations',
          });
        }
        return updated;
      });
    }
  };

  // Handle platform card expand/collapse
  const handlePlatformExpand = (platform: Platform) => {
    setPlatformsData((prev) => {
      const updated = new Map(prev);
      const platformData = updated.get(platform);
      if (platformData) {
        const newIsExpanded = !platformData.isExpanded;
        updated.set(platform, {
          ...platformData,
          isExpanded: newIsExpanded,
        });

        // Load conversations when expanding
        if (newIsExpanded && platformData.conversations.length === 0) {
          loadConversationsForPlatform(platform);
        }
      }
      return updated;
    });
  };

  // Handle conversation click
  const handleConversationClick = (conversationId: string) => {
    setSelectedConversationId(conversationId);
  };

  // Handle message thread close
  const handleCloseMessageThread = () => {
    setSelectedConversationId(null);
  };

  // Handle message sent
  const handleMessageSent = () => {
    // Refresh unread counts after sending a message
    loadUnreadCounts();
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  useEffect(() => {
    loadConnectedAccounts();
  }, [loadConnectedAccounts]);

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Navigation Bar */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-gray-900">
                Multi-Platform Messaging Hub
              </h1>
              {totalUnread > 0 && (
                <span className="ml-3 bg-red-500 text-white text-xs font-bold rounded-full px-2 py-1">
                  {totalUnread > 99 ? '99+' : totalUnread}
                </span>
              )}
            </div>
            <div className="flex items-center space-x-4">
              {/* WebSocket Status Indicator */}
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${
                  isAuthenticated ? 'bg-green-500' : isConnected ? 'bg-yellow-500' : 'bg-red-500'
                }`} />
                <span className="text-xs text-gray-500">
                  {isAuthenticated ? 'Live' : isConnected ? 'Connecting...' : 'Offline'}
                </span>
              </div>
              
              <button
                onClick={() => navigate('/accounts')}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Manage Accounts
              </button>
              <span className="text-sm text-gray-700">{user?.email}</span>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 sm:px-0">
          {/* Loading State */}
          {isLoadingAccounts ? (
            <div className="py-12">
              <LoadingSpinner size="xl" text="Loading your accounts..." />
            </div>
          ) : error ? (
            <ErrorDisplay
              message={error}
              title="Failed to load accounts"
              onRetry={loadConnectedAccounts}
            />
          ) : connectedAccounts.length === 0 ? (
            <EmptyState
              icon={
                <svg
                  className="w-16 h-16 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              }
              title="No Connected Accounts"
              description="Connect your social media accounts to start managing messages"
              action={{
                label: 'Connect Accounts',
                onClick: () => navigate('/accounts'),
              }}
            />
          ) : (
            <>
              {/* Dashboard Header */}
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Your Messages</h2>
                <p className="text-gray-600 mt-1">
                  {connectedAccounts.length} platform{connectedAccounts.length !== 1 ? 's' : ''} connected
                </p>
              </div>

              {/* Platform Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Array.from(platformsData.values()).map((platformData) => (
                  <DashboardPlatformCard
                    key={platformData.platform}
                    platform={platformData.platform}
                    platformName={platformData.name}
                    platformIcon={platformData.icon}
                    platformColor={platformData.color}
                    unreadCount={platformData.unreadCount}
                    conversations={platformData.conversations}
                    isExpanded={platformData.isExpanded}
                    isLoading={platformData.isLoading}
                    error={platformData.error}
                    onExpand={() => handlePlatformExpand(platformData.platform)}
                    onConversationClick={handleConversationClick}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </main>

      {/* Message Thread Modal */}
      {selectedConversationId && (
        <MessageThread
          conversationId={selectedConversationId}
          onClose={handleCloseMessageThread}
          onMessageSent={handleMessageSent}
        />
      )}
    </div>
  );
};

export default Dashboard;
