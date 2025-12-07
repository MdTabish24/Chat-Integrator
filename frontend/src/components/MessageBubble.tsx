import React from 'react';
import { Message } from '../types';

interface MessageBubbleProps {
  message: Message;
  isOutgoing: boolean;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isOutgoing }) => {
  const formatTime = (timestamp: string) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const renderMediaContent = () => {
    if (!message.mediaUrl) return null;

    switch (message.messageType) {
      case 'image':
        return (
          <div className="mb-2">
            <img
              src={message.mediaUrl}
              alt="Message attachment"
              className="max-w-xs rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => window.open(message.mediaUrl, '_blank')}
            />
          </div>
        );
      
      case 'video':
        return (
          <div className="mb-2">
            <video
              src={message.mediaUrl}
              controls
              className="max-w-xs rounded-lg"
            >
              Your browser does not support the video tag.
            </video>
          </div>
        );
      
      case 'file':
        return (
          <div className="mb-2">
            <a
              href={message.mediaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-2 p-3 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <svg
                className="w-6 h-6 text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <span className="text-sm text-gray-700">Download File</span>
            </a>
          </div>
        );
      
      default:
        return null;
    }
  };

  return (
    <div className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[70%] ${isOutgoing ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* Sender name for incoming messages */}
        {!isOutgoing && (
          <span className="text-xs text-gray-500 mb-1 px-1">
            {message.senderName}
          </span>
        )}
        
        {/* Message bubble */}
        <div
          className={`rounded-lg px-4 py-2 ${
            isOutgoing
              ? (message.id.startsWith('pending_') || message.content?.startsWith('⏳'))
                ? 'bg-blue-400 text-white rounded-br-none opacity-70'  // Pending message
                : 'bg-blue-600 text-white rounded-br-none'  // Sent message
              : 'bg-gray-200 text-gray-900 rounded-bl-none'
          }`}
        >
          {/* Media content */}
          {renderMediaContent()}
          
          {/* Text content */}
          {message.content && (
            <p className="text-sm whitespace-pre-wrap break-words">
              {message.content}
            </p>
          )}
        </div>
        
        {/* Timestamp and status */}
        <div className={`flex items-center space-x-1 mt-1 px-1 ${
          isOutgoing ? 'flex-row-reverse space-x-reverse' : 'flex-row'
        }`}>
          <span className="text-xs text-gray-500">
            {formatTime(message.sentAt)}
          </span>
          
          {/* Status indicators for outgoing messages */}
          {isOutgoing && (
            <div className="flex items-center space-x-0.5">
              {message.isRead ? (
                // Double check mark for read
                <div className="flex items-center" title="Read">
                  <svg
                    className="w-4 h-4 text-blue-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <svg
                    className="w-4 h-4 text-blue-600 -ml-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              ) : message.deliveredAt ? (
                // Double check mark for delivered (gray)
                <div className="flex items-center" title="Delivered">
                  <svg
                    className="w-4 h-4 text-gray-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <svg
                    className="w-4 h-4 text-gray-500 -ml-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              ) : (
                // Single check mark for sent
                <div title="Sent">
                  <svg
                    className="w-4 h-4 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
