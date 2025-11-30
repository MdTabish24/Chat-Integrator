import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useWebSocket } from '../hooks/useWebSocket';
import { useToast } from '../contexts/ToastContext';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import ChatView from '../components/ChatView';
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
  'twitter-dm': { name: 'Twitter DMs', icon: '💬', color: 'bg-sky-600' },
  linkedin: { name: 'LinkedIn', icon: '💼', color: 'bg-blue-700' },
  'linkedin-dm': { name: 'LinkedIn DMs', icon: '💼', color: 'bg-blue-800' },
  instagram: { name: 'Instagram', icon: '📷', color: 'bg-pink-500' },
  whatsapp: { name: 'WhatsApp', icon: '💬', color: 'bg-green-500' },
  facebook: { name: 'Facebook', icon: '👥', color: 'bg-blue-600' },
  teams: { name: 'Microsoft Teams', icon: '👔', color: 'bg-purple-600' },
  discord: { name: 'Discord', icon: '🎮', color: 'bg-indigo-600' },
  gmail: { name: 'Gmail', icon: '📧', color: 'bg-red-500' },
};

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { showError } = useToast();
  const [platformsData, setPlatformsData] = useState<Map<Platform, PlatformData>>(new Map());
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [totalUnread, setTotalUnread] = useState(0);
  const [gmailUnread, setGmailUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);


  // WebSocket callbacks
  const handleUnreadCountUpdate = useCallback((data: any) => {
    setTotalUnread(data.totalUnread);
    if (data.unreadCounts?.gmail) {
      setGmailUnread(data.unreadCounts.gmail);
    }
    setPlatformsData((prev) => {
      const updated = new Map(prev);
      Object.entries(data.unreadCounts).forEach(([platform, count]) => {
        const platformData = updated.get(platform as Platform);
        if (platformData) {
          updated.set(platform as Platform, { ...platformData, unreadCount: count as number });
        }
      });
      return updated;
    });
  }, []);

  const handleNewMessage = useCallback((data: any) => {
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
    const conversation = data.conversation;
    setPlatformsData((prev) => {
      const updated = new Map(prev);
      updated.forEach((platformData, platform) => {
        const convIndex = platformData.conversations.findIndex(c => c.id === conversation.id);
        if (convIndex !== -1) {
          const updatedConversations = [...platformData.conversations];
          updatedConversations[convIndex] = conversation;
          updated.set(platform, { ...platformData, conversations: updatedConversations });
        }
      });
      return updated;
    });
  }, []);

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

      const newPlatformsData = new Map<Platform, PlatformData>();
      accounts.forEach((account: ConnectedAccount) => {
        if (!newPlatformsData.has(account.platform)) {
          const config = PLATFORM_CONFIGS[account.platform];
          if (config) {
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
        }
      });
      setPlatformsData(newPlatformsData);
      await loadUnreadCounts();
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || 'Failed to load connected accounts';
      setError(errorMessage);
      showError(errorMessage);
    } finally {
      setIsLoadingAccounts(false);
    }
  }, [showError]);

  const loadUnreadCounts = async () => {
    try {
      const response = await apiClient.get('/api/messages/unread/count');
      setTotalUnread(response.data.total);
      if (response.data.byPlatform?.gmail) {
        setGmailUnread(response.data.byPlatform.gmail);
      }
      setPlatformsData((prev) => {
        const updated = new Map(prev);
        Object.entries(response.data.byPlatform).forEach(([platform, count]) => {
          const platformData = updated.get(platform as Platform);
          if (platformData) {
            updated.set(platform as Platform, { ...platformData, unreadCount: count as number });
          }
        });
        return updated;
      });
    } catch (err) {
      console.error('Error loading unread counts:', err);
    }
  };


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
      // For Telegram, sync first then load conversations
      if (platform === 'telegram') {
        const telegramAccount = connectedAccounts.find(acc => acc.platform === 'telegram');
        if (telegramAccount) {
          try {
            // Sync and wait for it to complete
            await apiClient.post(`/api/telegram/${telegramAccount.id}/sync`, {}, {
              timeout: 120000, // 2 minutes for sync
            });
          } catch (syncErr: any) {
            console.error('Telegram sync error:', syncErr);
            // Continue to load whatever conversations exist
          }
        }
      }

      // For Twitter - load conversations synced from Desktop App
      // Note: Twitter blocks server-side access, so Desktop App is needed for syncing

      // Now load conversations (after sync completes or fails)
      const response = await apiClient.get('/api/conversations', { params: { platform } });
      const conversations = (response.data.conversations || []).map((c: any) => ({
        ...c,
        participantName: c.participant_name || c.participantName,
        participantId: c.participant_id || c.participantId,
        participantAvatarUrl: c.participant_avatar_url || c.participantAvatarUrl,
        lastMessageAt: c.last_message_at || c.lastMessageAt,
        unreadCount: c.unread_count || c.unreadCount || 0,
        accountId: c.account_id || c.accountId,
        platformConversationId: c.platform_conversation_id || c.platformConversationId,
        createdAt: c.created_at || c.createdAt,
        updatedAt: c.updated_at || c.updatedAt,
      }));

      setPlatformsData((prev) => {
        const updated = new Map(prev);
        const platformData = updated.get(platform);
        if (platformData) {
          updated.set(platform, { ...platformData, conversations, isLoading: false, error: undefined });
        }
        return updated;
      });
    } catch (err: any) {
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

  const handlePlatformExpand = async (platform: Platform) => {
    const platformData = platformsData.get(platform);
    if (!platformData) return;
    
    const newIsExpanded = !platformData.isExpanded;
    
    // Update expanded state first
    setPlatformsData((prev) => {
      const updated = new Map(prev);
      const data = updated.get(platform);
      if (data) {
        updated.set(platform, { ...data, isExpanded: newIsExpanded });
      }
      return updated;
    });
    
    // Load conversations after state update (outside of setState callback)
    if (newIsExpanded) {
      // For LinkedIn, trigger backend sync first (backend fetches messages via linkedin-api)
      if (platform === 'linkedin') {
        try {
          const account = connectedAccounts.find(acc => acc.platform === 'linkedin');
          if (account) {
            console.log('[linkedin] Triggering backend sync...');
            await apiClient.get(`/api/platforms/linkedin/conversations/${account.id}`);
          }
        } catch (err) {
          console.log('[linkedin] Sync error (will still load cached):', err);
        }
      }
      
      loadConversationsForPlatform(platform);
    }
  };

  const handleConversationClick = (conversationId: string, platform: Platform) => {
    setSelectedConversationId(conversationId);
    setSelectedPlatform(platform);
  };

  const handleMessageSent = () => {
    loadUnreadCounts();
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  useEffect(() => {
    loadConnectedAccounts();
  }, [loadConnectedAccounts]);


  // Loading state
  if (isLoadingAccounts) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <LoadingSpinner size="xl" text="Loading your accounts..." />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <ErrorDisplay message={error} title="Failed to load accounts" onRetry={loadConnectedAccounts} />
      </div>
    );
  }

  // No connected accounts
  if (connectedAccounts.length === 0) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col">
        <Header
          user={user}
          totalUnread={0}
          gmailUnread={0}
          isConnected={isConnected}
          isAuthenticated={isAuthenticated}
          onLogout={handleLogout}
        />
        <div className="flex-1 flex items-center justify-center p-4">
          <EmptyState
            icon={
              <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
            title="No Connected Accounts"
            description="Connect your social media accounts to start managing messages"
            action={{ label: 'Connect Accounts', onClick: () => navigate('/accounts') }}
          />
        </div>
      </div>
    );
  }

  // Main dashboard layout with sidebar
  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Header */}
      <Header
        user={user}
        totalUnread={totalUnread}
        gmailUnread={gmailUnread}
        isConnected={isConnected}
        isAuthenticated={isAuthenticated}
        onLogout={handleLogout}
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          platformsData={platformsData}
          connectedAccounts={connectedAccounts}
          selectedConversationId={selectedConversationId}
          onPlatformExpand={handlePlatformExpand}
          onConversationClick={handleConversationClick}
        />

        {/* Chat View */}
        <ChatView
          conversationId={selectedConversationId}
          platform={selectedPlatform}
          onMessageSent={handleMessageSent}
        />
      </div>
    </div>
  );
};

export default Dashboard;
