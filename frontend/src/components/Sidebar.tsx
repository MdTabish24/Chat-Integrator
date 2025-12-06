import React from 'react';
import { Platform, Conversation, ConnectedAccount } from '../types';
import LoadingSpinner from './LoadingSpinner';

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

interface SidebarProps {
  platformsData: Map<Platform, PlatformData>;
  connectedAccounts: ConnectedAccount[];
  selectedConversationId: string | null;
  onPlatformExpand: (platform: Platform) => void;
  onConversationClick: (conversationId: string, platform: Platform) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  platformsData,
  connectedAccounts,
  selectedConversationId,
  onPlatformExpand,
  onConversationClick,
}) => {
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <aside className="w-80 bg-white border-r border-gray-200 flex flex-col h-full overflow-hidden">
      {/* Sidebar Header */}
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Messages</h2>
        <p className="text-sm text-gray-500">
          {connectedAccounts.length} platform{connectedAccounts.length !== 1 ? 's' : ''} connected
        </p>
      </div>

      {/* Platform List */}
      <div className="flex-1 overflow-y-auto">
        {Array.from(platformsData.values()).map((platformData) => (
          <div key={platformData.platform} className="border-b border-gray-100 last:border-b-0">
            {/* Platform Header */}
            <button
              onClick={() => onPlatformExpand(platformData.platform)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center space-x-3">
                {/* Platform Icon */}
                <div className={`w-10 h-10 ${platformData.color} rounded-full flex items-center justify-center text-lg flex-shrink-0`}>
                  {platformData.icon}
                </div>
                <span className="font-medium text-gray-900">{platformData.name}</span>
              </div>
              <div className="flex items-center space-x-2">
                {/* Unread Badge */}
                {platformData.unreadCount > 0 && (
                  <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5 min-w-[20px] text-center">
                    {platformData.unreadCount > 99 ? '99+' : platformData.unreadCount}
                  </span>
                )}
                {/* Expand/Collapse Icon */}
                <svg
                  className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
                    platformData.isExpanded ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {/* Expanded Conversation List */}
            {platformData.isExpanded && (
              <div className="bg-gray-50">
                {platformData.isLoading ? (
                  <div className="py-4 flex flex-col items-center justify-center">
                    <LoadingSpinner size="sm" />
                    <span className="text-xs text-gray-500 mt-2">
                      {platformData.platform === 'telegram' ? 'Syncing with Telegram...' : 'Loading...'}
                    </span>
                  </div>
                ) : platformData.error ? (
                  <div className="px-4 py-3 text-sm text-red-600">
                    {platformData.error}
                  </div>
                ) : platformData.conversations.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-500 text-center">
                    No conversations yet
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto">
                    {platformData.conversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        onClick={() => onConversationClick(conversation.id, platformData.platform)}
                        className={`w-full px-4 py-3 flex items-center space-x-3 hover:bg-gray-100 transition-colors text-left ${
                          selectedConversationId === conversation.id ? 'bg-blue-50 border-l-2 border-blue-500' : ''
                        }`}
                      >
                        {/* Avatar */}
                        {conversation.participantAvatarUrl ? (
                          <img
                            src={conversation.participantAvatarUrl}
                            alt={conversation.participantName}
                            className="w-8 h-8 rounded-full flex-shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center flex-shrink-0">
                            <span className="text-gray-600 text-sm font-medium">
                              {conversation.participantName?.charAt(0).toUpperCase() || '?'}
                            </span>
                          </div>
                        )}
                        {/* Conversation Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className={`text-sm truncate ${
                              conversation.unreadCount > 0 ? 'font-semibold text-gray-900' : 'text-gray-700'
                            }`}>
                              {conversation.participantName}
                            </span>
                            <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                              {formatTimestamp(conversation.lastMessageAt)}
                            </span>
                          </div>
                          {conversation.unreadCount > 0 && (
                            <span className="text-xs text-blue-600 font-medium">
                              {conversation.unreadCount} new
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
};

export default Sidebar;
