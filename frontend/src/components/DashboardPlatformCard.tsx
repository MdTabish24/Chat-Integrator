import React from 'react';
import { Platform, Conversation } from '../types';
import LoadingSpinner from './LoadingSpinner';
import EmptyState from './EmptyState';
import ErrorDisplay from './ErrorDisplay';

interface DashboardPlatformCardProps {
  platform: Platform;
  platformName: string;
  platformIcon: string;
  platformColor: string;
  unreadCount: number;
  conversations: Conversation[];
  isExpanded: boolean;
  isLoading?: boolean;
  error?: string;
  onExpand: () => void;
  onConversationClick: (conversationId: string, platform: Platform) => void;
}

const DashboardPlatformCard: React.FC<DashboardPlatformCardProps> = ({
  platform,
  platformName,
  platformIcon,
  platformColor,
  unreadCount,
  conversations,
  isExpanded,
  isLoading = false,
  error,
  onExpand,
  onConversationClick,
}) => {
  const hasUnread = unreadCount > 0;

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className={`bg-white rounded-lg shadow-md transition-all duration-300 ${
      isExpanded ? 'col-span-full' : ''
    }`}>
      {/* Card Header */}
      <div
        className={`p-6 cursor-pointer hover:bg-gray-50 transition-colors ${
          isExpanded ? 'border-b border-gray-200' : ''
        }`}
        onClick={onExpand}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            {/* Platform Icon */}
            <div className={`w-12 h-12 ${platformColor} rounded-full flex items-center justify-center text-2xl flex-shrink-0`}>
              {platformIcon}
            </div>

            {/* Platform Name */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                {platformName}
              </h3>
              {!isExpanded && conversations.length > 0 && (
                <p className="text-sm text-gray-500">
                  {conversations.length} conversation{conversations.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Unread Badge */}
            {hasUnread && (
              <div className="bg-red-500 text-white text-sm font-bold rounded-full w-8 h-8 flex items-center justify-center">
                {unreadCount > 99 ? '99+' : unreadCount}
              </div>
            )}

            {/* Expand/Collapse Icon */}
            <svg
              className={`w-6 h-6 text-gray-400 transition-transform duration-300 ${
                isExpanded ? 'transform rotate-180' : ''
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Expanded Content - Conversation List or WebView */}
      {isExpanded && (
        <div className="p-4">
          {/* WebView for Twitter DMs and LinkedIn DMs */}
          {(platform === 'twitter-dm' || platform === 'linkedin-dm') ? (
            <div className="w-full" style={{ height: '600px' }}>
              <iframe
                src={platform === 'twitter-dm' ? 'https://twitter.com/messages' : 'https://www.linkedin.com/messaging/'}
                className="w-full h-full border-0 rounded-lg"
                title={`${platformName} Messages`}
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              />
            </div>
          ) : isLoading ? (
            <div className="py-8">
              <LoadingSpinner size="lg" text="Loading conversations..." />
            </div>
          ) : error ? (
            <div className="py-4">
              <ErrorDisplay
                message={error}
                title="Failed to load conversations"
                onRetry={onExpand}
                retryLabel="Try again"
              />
            </div>
          ) : conversations.length === 0 ? (
            <div className="py-4">
              {platform === 'linkedin' ? (
                <div className="text-center py-6 px-4 bg-blue-50 rounded-lg border border-blue-200">
                  <svg
                    className="w-12 h-12 text-blue-500 mx-auto mb-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">
                    LinkedIn DMs Not Available
                  </h3>
                  <p className="text-xs text-gray-600 mb-3">
                    LinkedIn messaging is only available for Business Pages, not personal accounts.
                  </p>
                  <p className="text-xs text-blue-600 font-medium">
                    Connect your LinkedIn Business Page to enable messaging.
                  </p>
                </div>
              ) : (
                <EmptyState
                  icon={
                    <svg
                      className="w-12 h-12 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                      />
                    </svg>
                  }
                  title="No conversations yet"
                />
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {conversations.map((conversation) => (
                <div
                  key={conversation.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onConversationClick(conversation.id, platform);
                  }}
                  className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                    conversation.unreadCount > 0
                      ? 'bg-blue-50 border-blue-200 hover:bg-blue-100'
                      : 'bg-white border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-3 flex-1 min-w-0">
                      {/* Avatar */}
                      {conversation.participantAvatarUrl ? (
                        <img
                          src={conversation.participantAvatarUrl}
                          alt={conversation.participantName}
                          className="w-10 h-10 rounded-full flex-shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-gray-600 font-medium text-sm">
                            {conversation.participantName?.charAt(0).toUpperCase() || '?'}
                          </span>
                        </div>
                      )}

                      {/* Conversation Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h4 className={`text-sm font-medium truncate ${
                            conversation.unreadCount > 0 ? 'text-gray-900' : 'text-gray-700'
                          }`}>
                            {conversation.participantName}
                          </h4>
                          <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                            {formatTimestamp(conversation.lastMessageAt)}
                          </span>
                        </div>
                        {conversation.unreadCount > 0 && (
                          <div className="flex items-center">
                            <span className="text-xs font-semibold text-blue-600">
                              {conversation.unreadCount} new message{conversation.unreadCount !== 1 ? 's' : ''}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DashboardPlatformCard;
