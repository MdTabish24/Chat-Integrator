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
            <div className="py-8 px-4">
              <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                  <div className={`w-16 h-16 ${platformColor} rounded-full flex items-center justify-center text-3xl mx-auto mb-4`}>
                    {platformIcon}
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    {platformName}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {platform === 'twitter-dm' 
                      ? 'Manage your Twitter Direct Messages'
                      : 'Manage your LinkedIn Messages'}
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="grid grid-cols-1 gap-4">
                  {/* View All Messages */}
                  <button
                    onClick={() => {
                      const url = platform === 'twitter-dm' 
                        ? 'https://twitter.com/messages' 
                        : 'https://www.linkedin.com/messaging/';
                      window.open(url, `${platform}-messages`, 'width=1200,height=800,resizable=yes,scrollbars=yes');
                    }}
                    className="flex items-center justify-between p-4 bg-white border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all group"
                  >
                    <div className="flex items-center">
                      <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mr-4 group-hover:bg-blue-200 transition-colors">
                        <svg
                          className="w-6 h-6 text-blue-600"
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
                      </div>
                      <div className="text-left">
                        <p className="font-medium text-gray-900">View All Messages</p>
                        <p className="text-sm text-gray-500">Open your inbox and conversations</p>
                      </div>
                    </div>
                    <svg
                      className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>

                  {/* Compose New Message */}
                  <button
                    onClick={() => {
                      const url = platform === 'twitter-dm' 
                        ? 'https://twitter.com/messages/compose' 
                        : 'https://www.linkedin.com/messaging/compose/';
                      window.open(url, `${platform}-compose`, 'width=600,height=700,resizable=yes,scrollbars=yes');
                    }}
                    className="flex items-center justify-between p-4 bg-white border-2 border-gray-200 rounded-lg hover:border-green-500 hover:bg-green-50 transition-all group"
                  >
                    <div className="flex items-center">
                      <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mr-4 group-hover:bg-green-200 transition-colors">
                        <svg
                          className="w-6 h-6 text-green-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 4v16m8-8H4"
                          />
                        </svg>
                      </div>
                      <div className="text-left">
                        <p className="font-medium text-gray-900">Compose New Message</p>
                        <p className="text-sm text-gray-500">Start a new conversation</p>
                      </div>
                    </div>
                    <svg
                      className="w-5 h-5 text-gray-400 group-hover:text-green-600 transition-colors"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </div>

                {/* Info Box */}
                <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-start">
                    <svg
                      className="w-5 h-5 text-blue-600 mt-0.5 mr-3 flex-shrink-0"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <div className="text-left">
                      <p className="text-sm font-medium text-blue-900">Auto-Login Enabled</p>
                      <p className="text-xs text-blue-700 mt-1">
                        Uses your existing browser session. No repeated logins needed!
                      </p>
                    </div>
                  </div>
                </div>
              </div>
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
