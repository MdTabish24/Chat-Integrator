import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { useTheme } from '../contexts/ThemeContext';
import { useElectron } from '../contexts/ElectronContext';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import ChatView from '../components/ChatView';
import EmptyState from '../components/EmptyState';
import LoadingSpinner from '../components/LoadingSpinner';
import type { Platform, Conversation } from '../types';
import type { PlatformData, ChatTab } from '../types';

const PLATFORM_CONFIGS: Record<string, { name: string; icon: string; color: string }> = {
  telegram: { name: 'Telegram', icon: '✈️', color: 'bg-blue-500' },
  twitter: { name: 'Twitter/X', icon: '🐦', color: 'bg-sky-500' },
  linkedin: { name: 'LinkedIn', icon: '💼', color: 'bg-blue-700' },
  instagram: { name: 'Instagram', icon: '📸', color: 'bg-gradient-to-br from-purple-500 to-pink-500' },
  whatsapp: { name: 'WhatsApp', icon: '📱', color: 'bg-green-500' },
  facebook: { name: 'Facebook', icon: '👤', color: 'bg-blue-600' },
  discord: { name: 'Discord', icon: '🎮', color: 'bg-indigo-600' },
  teams: { name: 'Microsoft Teams', icon: '👥', color: 'bg-purple-600' },
};

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { showError, showSuccess, showInfo } = useToast();
  const { isDark } = useTheme();
  const { 
    isElectron, 
    platformStatuses, 
    conversations: globalConversations,
    isLoadingConversations,
    newMessages,
    getConversations,
    refreshAllStatuses,
    clearNewMessage,
  } = useElectron();
  
  const [platformsData, setPlatformsData] = useState<Map<Platform, PlatformData>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [totalUnread, setTotalUnread] = useState(0);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);
  const [openTabs, setOpenTabs] = useState<ChatTab[]>([]);

  // Listen for open-settings event from tray
  useEffect(() => {
    const handleOpenSettings = () => {
      navigate('/settings');
    };
    window.addEventListener('open-settings', handleOpenSettings);
    return () => window.removeEventListener('open-settings', handleOpenSettings);
  }, [navigate]);

  // Listen for open-conversation event from notification click
  useEffect(() => {
    const handleOpenConversation = (event: CustomEvent<{ conversationId: string; platform: Platform }>) => {
      const { conversationId, platform } = event.detail;
      console.log('[Dashboard] Opening conversation from notification:', conversationId, platform);
      
      // Expand the platform if not already expanded
      const platformData = platformsData.get(platform);
      if (platformData && !platformData.isExpanded) {
        setPlatformsData((prev) => {
          const updated = new Map(prev);
          const data = updated.get(platform);
          if (data) {
            updated.set(platform, { ...data, isExpanded: true });
          }
          return updated;
        });
      }
      
      // Find the conversation and open it
      const conversation = platformData?.conversations.find(c => c.id === conversationId);
      if (conversation) {
        const existingTab = openTabs.find(tab => tab.conversationId === conversationId);
        if (!existingTab) {
          const newTab: ChatTab = {
            id: `tab_${conversationId}`,
            conversationId,
            platform,
            participantName: conversation.participantName,
            participantAvatarUrl: conversation.participantAvatarUrl,
          };
          setOpenTabs(prev => [...prev, newTab]);
        }
        setSelectedConversationId(conversationId);
        setSelectedPlatform(platform);
      }
    };
    
    window.addEventListener('open-conversation', handleOpenConversation as EventListener);
    return () => window.removeEventListener('open-conversation', handleOpenConversation as EventListener);
  }, [platformsData, openTabs]);

  // Initialize platforms - NO AUTO FETCH, only on expand
  useEffect(() => {
    const initializePlatforms = async () => {
      // Initialize all supported platforms
      const newPlatformsData = new Map<Platform, PlatformData>();
      Object.entries(PLATFORM_CONFIGS).forEach(([platform, config]) => {
        const status = platformStatuses[platform as Platform];
        newPlatformsData.set(platform as Platform, {
          platform: platform as Platform,
          name: config.name,
          icon: config.icon,
          color: config.color,
          unreadCount: 0,
          conversations: [],
          isExpanded: false,
          isLoading: false,
          isConnected: status?.connected || false,
        });
      });
      
      setPlatformsData(newPlatformsData);
      
      // Just refresh statuses, DON'T fetch conversations
      // Conversations will be fetched when user expands a platform
      if (isElectron) {
        await refreshAllStatuses();
      }
      setIsLoading(false);
    };

    initializePlatforms();
  }, [isElectron]); // Remove refreshAllStatuses and getConversations from deps

  // Update platforms data when statuses change
  useEffect(() => {
    setPlatformsData(prev => {
      const updated = new Map(prev);
      Object.entries(platformStatuses).forEach(([platform, status]) => {
        const existing = updated.get(platform as Platform);
        if (existing) {
          updated.set(platform as Platform, {
            ...existing,
            isConnected: status.connected,
          });
        }
      });
      return updated;
    });
  }, [platformStatuses]);

  // Update platforms data when conversations change
  useEffect(() => {
    setPlatformsData(prev => {
      const updated = new Map(prev);
      
      // Group conversations by platform
      const convsByPlatform = new Map<Platform, Conversation[]>();
      globalConversations.forEach(conv => {
        const existing = convsByPlatform.get(conv.platform) || [];
        convsByPlatform.set(conv.platform, [...existing, conv]);
      });
      
      // Update each platform's data
      updated.forEach((data, platform) => {
        const platformConvs = convsByPlatform.get(platform) || [];
        const unreadCount = platformConvs.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
        updated.set(platform, {
          ...data,
          conversations: platformConvs,
          unreadCount,
        });
      });
      
      return updated;
    });
    
    // Calculate total unread
    const total = globalConversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    setTotalUnread(total);
  }, [globalConversations]);

  // Handle new messages - show notification
  useEffect(() => {
    if (newMessages.length > 0) {
      const latestMessage = newMessages[newMessages.length - 1];
      showInfo(`New message from ${latestMessage.message.senderName}`);
      
      // Clear the message from the queue
      clearNewMessage(latestMessage.message.id);
    }
  }, [newMessages, showInfo, clearNewMessage]);

  // Load conversations for a platform
  const loadConversationsForPlatform = useCallback(async (platform: Platform) => {
    setPlatformsData((prev) => {
      const updated = new Map(prev);
      const platformData = updated.get(platform);
      if (platformData) {
        updated.set(platform, { ...platformData, isLoading: true, error: undefined });
      }
      return updated;
    });

    try {
      const conversations = await getConversations(platform);
      
      setPlatformsData((prev) => {
        const updated = new Map(prev);
        const platformData = updated.get(platform);
        if (platformData) {
          const unreadCount = conversations.reduce((sum: number, c: Conversation) => sum + (c.unreadCount || 0), 0);
          updated.set(platform, { 
            ...platformData, 
            conversations, 
            unreadCount,
            isLoading: false, 
            error: undefined 
          });
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
            error: err.message || 'Failed to load conversations',
          });
        }
        return updated;
      });
      showError(`Failed to load ${platform} conversations`);
    }
  }, [getConversations, showError]);

  const handlePlatformExpand = async (platform: Platform) => {
    const platformData = platformsData.get(platform);
    if (!platformData) return;
    
    const newIsExpanded = !platformData.isExpanded;
    
    setPlatformsData((prev) => {
      const updated = new Map(prev);
      const data = updated.get(platform);
      if (data) {
        updated.set(platform, { ...data, isExpanded: newIsExpanded });
      }
      return updated;
    });
    
    if (newIsExpanded && platformData.isConnected && platformData.conversations.length === 0) {
      loadConversationsForPlatform(platform);
    }
  };

  const handleConversationClick = (conversationId: string, platform: Platform) => {
    const platformData = platformsData.get(platform);
    const conversation = platformData?.conversations.find(c => c.id === conversationId);
    
    // Keep platform expanded when clicking conversation
    if (platformData && !platformData.isExpanded) {
      setPlatformsData((prev) => {
        const updated = new Map(prev);
        const data = updated.get(platform);
        if (data) {
          updated.set(platform, { ...data, isExpanded: true });
        }
        return updated;
      });
    }
    
    const existingTab = openTabs.find(tab => tab.conversationId === conversationId);
    
    if (!existingTab && conversation) {
      const newTab: ChatTab = {
        id: `tab_${conversationId}`,
        conversationId,
        platform,
        participantName: conversation.participantName,
        participantAvatarUrl: conversation.participantAvatarUrl,
      };
      setOpenTabs(prev => [...prev, newTab]);
    }
    
    setSelectedConversationId(conversationId);
    setSelectedPlatform(platform);
  };

  const handleTabClick = (tab: ChatTab) => {
    setSelectedConversationId(tab.conversationId);
    setSelectedPlatform(tab.platform);
  };

  const handleTabClose = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    setOpenTabs(prev => {
      const newTabs = prev.filter(t => t.id !== tabId);
      
      const closedTab = prev.find(t => t.id === tabId);
      if (closedTab && closedTab.conversationId === selectedConversationId) {
        if (newTabs.length > 0) {
          const lastTab = newTabs[newTabs.length - 1];
          setSelectedConversationId(lastTab.conversationId);
          setSelectedPlatform(lastTab.platform);
        } else {
          setSelectedConversationId(null);
          setSelectedPlatform(null);
        }
      }
      
      return newTabs;
    });
  };

  const handleMessageSent = () => {
    showSuccess('Message sent!');
  };

  // Check if Gmail is connected
  const gmailConnected = platformStatuses?.gmail?.connected || false;

  if (isLoading || isLoadingConversations) {
    return <LoadingSpinner />;
  }

  // Check if any platform is connected
  const hasConnectedPlatforms = Array.from(platformsData.values()).some(p => p.isConnected);

  if (!hasConnectedPlatforms) {
    return (
      <div className="min-h-screen flex flex-col dashboard-bg">
        <Header totalUnread={0} gmailConnected={gmailConnected} />
        <div className="flex-1 flex items-center justify-center p-4">
          <EmptyState
            icon={
              <svg className={`w-16 h-16 ${isDark ? 'text-gray-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
            title="No Connected Accounts"
            description="Connect your social media accounts to start managing messages from your desktop"
            action={{ label: 'Connect Accounts', onClick: () => navigate('/accounts') }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col dashboard-bg">
      <Header totalUnread={totalUnread} gmailConnected={gmailConnected} />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          platformsData={platformsData}
          selectedConversationId={selectedConversationId}
          onPlatformExpand={handlePlatformExpand}
          onConversationClick={handleConversationClick}
        />

        <ChatView
          conversationId={selectedConversationId}
          platform={selectedPlatform}
          onMessageSent={handleMessageSent}
          openTabs={openTabs}
          onTabClick={handleTabClick}
          onTabClose={handleTabClose}
        />
      </div>
    </div>
  );
};

export default Dashboard;
