import React from 'react';
import { Platform, PlatformData, Conversation } from '../types';

interface SidebarProps {
  platformsData: Map<Platform, PlatformData>;
  selectedConversationId: string | null;
  onPlatformExpand: (platform: Platform) => void;
  onConversationClick: (conversationId: string, platform: Platform) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  platformsData,
  selectedConversationId,
  onPlatformExpand,
  onConversationClick,
}) => {
  const platforms = Array.from(platformsData.values());

  return (
    <aside className="sidebar-professional w-80 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[var(--border-color)]">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Platforms</h2>
        <p className="text-sm text-[var(--text-muted)]">
          {platforms.filter(p => p.isConnected).length} connected
        </p>
      </div>

      {/* Platform List */}
      <div className="flex-1 overflow-y-auto p-2">
        {platforms.map((platformData) => (
          <PlatformSection
            key={platformData.platform}
            platformData={platformData}
            selectedConversationId={selectedConversationId}
            onExpand={() => onPlatformExpand(platformData.platform)}
            onConversationClick={(convId) => onConversationClick(convId, platformData.platform)}
          />
        ))}
      </div>
    </aside>
  );
};

interface PlatformSectionProps {
  platformData: PlatformData;
  selectedConversationId: string | null;
  onExpand: () => void;
  onConversationClick: (conversationId: string) => void;
}

const PlatformSection: React.FC<PlatformSectionProps> = ({
  platformData,
  selectedConversationId,
  onExpand,
  onConversationClick,
}) => {
  const { platform, name, icon, color, unreadCount, conversations, isExpanded, isLoading, isConnected, error } = platformData;

  return (
    <div className="mb-2">
      {/* Platform Header */}
      <button
        onClick={onExpand}
        className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
          isExpanded ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'
        } ${!isConnected ? 'opacity-50' : ''}`}
        disabled={!isConnected}
      >
        {/* Platform Icon */}
        <div className={`platform-icon ${color} text-white`}>
          {icon}
        </div>

        {/* Platform Info */}
        <div className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[var(--text-primary)]">{name}</span>
            {!isConnected && (
              <span className="text-xs text-[var(--text-muted)]">(Not connected)</span>
            )}
          </div>
          {isConnected && (
            <span className="text-xs text-[var(--text-muted)]">
              {conversations.length} conversations
            </span>
          )}
        </div>

        {/* Unread Badge */}
        {unreadCount > 0 && (
          <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-primary-500 text-white">
            {unreadCount}
          </span>
        )}

        {/* Expand Arrow */}
        {isConnected && (
          <svg
            className={`w-5 h-5 text-[var(--text-muted)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Conversations List */}
      {isExpanded && isConnected && (
        <div className="ml-4 mt-1 space-y-1">
          {isLoading ? (
            <div className="p-3 text-center">
              <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-[var(--text-muted)] mt-2">Loading...</p>
            </div>
          ) : error ? (
            <div className="p-3 text-center">
              <p className="text-xs text-red-500">{error}</p>
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-3 text-center">
              <p className="text-xs text-[var(--text-muted)]">No conversations yet</p>
            </div>
          ) : (
            conversations.map((conversation) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                isSelected={selectedConversationId === conversation.id}
                onClick={() => onConversationClick(conversation.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

interface ConversationItemProps {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
}

const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isSelected,
  onClick,
}) => {
  const { participantName, participantAvatarUrl, lastMessage, unreadCount, lastMessageAt } = conversation;

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  return (
    <button
      onClick={onClick}
      className={`conversation-item w-full flex items-center gap-3 p-3 text-left ${isSelected ? 'active' : ''}`}
    >
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-[var(--bg-hover)] flex items-center justify-center overflow-hidden flex-shrink-0">
        {participantAvatarUrl ? (
          <img src={participantAvatarUrl} alt={participantName} className="w-full h-full object-cover" />
        ) : (
          <span className="text-lg">{participantName.charAt(0).toUpperCase()}</span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-medium text-[var(--text-primary)] truncate">{participantName}</span>
          <span className="text-xs text-[var(--text-muted)] flex-shrink-0 ml-2">
            {formatTime(lastMessageAt)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-muted)] truncate">
            {lastMessage || 'No messages'}
          </span>
          {unreadCount > 0 && (
            <span className="w-5 h-5 flex items-center justify-center text-xs font-bold rounded-full bg-primary-500 text-white flex-shrink-0 ml-2">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
};

export default Sidebar;
