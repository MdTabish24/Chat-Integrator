import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../config/api';
import LoadingSpinner from './LoadingSpinner';
import { useToast } from '../contexts/ToastContext';

interface Email {
  id: string;         // Gmail message ID (for mark as read)
  threadId: string;   // Gmail thread ID (for replies)
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  body?: string;
  date: string;
  isUnread: boolean;
  isOutgoing?: boolean;  // To show sent replies
}

interface GmailInboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string | null;
}

const GmailInboxModal: React.FC<GmailInboxModalProps> = ({ isOpen, onClose, accountId }) => {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [sending, setSending] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const { showSuccess, showError } = useToast();
  
  // Ref for scroll container to detect when user scrolls to bottom
  const emailListRef = React.useRef<HTMLDivElement>(null);

  // Map raw API email to our Email interface
  const mapEmailData = (e: any): Email => {
    const threadId = e.conversationId || e.threadId || e.thread_id || '';
    const messageId = e.platformMessageId || e.platform_message_id || e.messageId || e.id || '';
    
    return {
      id: messageId,
      threadId: threadId,
      from: e.senderName || e.sender_name || e.from || 'Unknown',
      fromEmail: e.senderId || e.sender_id || e.senderEmail || e.fromEmail || '',
      subject: e.subject || '(No Subject)',
      snippet: e.snippet || e.preview || '',
      body: e.body || e.content || '',
      date: e.date || e.sentAt || e.sent_at || new Date().toISOString(),
      isUnread: e.isUnread ?? e.is_unread ?? !e.isRead ?? !e.is_read ?? true,
      isOutgoing: e.isOutgoing ?? e.is_outgoing ?? false,
    };
  };

  const fetchEmails = useCallback(async (reset: boolean = true) => {
    if (!accountId) return;
    
    try {
      if (reset) {
        setLoading(true);
        setEmails([]);
        setNextPageToken(null);
      }
      setError(null);
      
      // Fetch first 50 emails (all, not just unread)
      const response = await apiClient.get(`/api/platforms/gmail/emails/${accountId}`, {
        params: { limit: 50 }
      });
      
      console.log('[gmail] Raw API response (first email):', response.data.emails?.[0]);
      const emailData = (response.data.emails || []).map(mapEmailData);
      console.log('[gmail] Mapped email data (first):', emailData?.[0]);
      
      setEmails(emailData);
      setNextPageToken(response.data.nextPageToken || null);
      setHasMore(response.data.hasMore || false);
      
      console.log('[gmail] Fetched', emailData.length, 'emails, hasMore:', response.data.hasMore);
    } catch (err: any) {
      const errMsg = err.response?.data?.error?.message || 'Failed to fetch emails';
      setError(errMsg);
      showError(errMsg);
    } finally {
      setLoading(false);
    }
  }, [accountId, showError]);

  // Load more emails when user scrolls to bottom
  const loadMoreEmails = useCallback(async () => {
    if (!accountId || !nextPageToken || loadingMore) return;
    
    try {
      setLoadingMore(true);
      
      const response = await apiClient.get(`/api/platforms/gmail/emails/${accountId}`, {
        params: { 
          limit: 50,
          pageToken: nextPageToken 
        }
      });
      
      const newEmails = (response.data.emails || []).map(mapEmailData);
      
      setEmails(prev => [...prev, ...newEmails]);
      setNextPageToken(response.data.nextPageToken || null);
      setHasMore(response.data.hasMore || false);
      
      console.log('[gmail] Loaded', newEmails.length, 'more emails, total:', emails.length + newEmails.length);
    } catch (err: any) {
      console.error('[gmail] Failed to load more emails:', err);
      showError('Failed to load more emails');
    } finally {
      setLoadingMore(false);
    }
  }, [accountId, nextPageToken, loadingMore, emails.length, showError]);

  useEffect(() => {
    if (isOpen && accountId) {
      fetchEmails(true);
    }
  }, [isOpen, accountId, fetchEmails]);

  // Scroll handler for infinite scroll
  const handleScroll = useCallback(() => {
    const container = emailListRef.current;
    if (!container || loadingMore || !hasMore) return;
    
    // Check if user has scrolled near the bottom (within 100px)
    const { scrollTop, scrollHeight, clientHeight } = container;
    if (scrollTop + clientHeight >= scrollHeight - 100) {
      loadMoreEmails();
    }
  }, [loadingMore, hasMore, loadMoreEmails]);

  // Add scroll event listener
  useEffect(() => {
    const container = emailListRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  const handleEmailClick = async (email: Email) => {
    setSelectedEmail(email);
    setReplyContent('');
    
    // Mark as read (only if we have a valid message ID)
    if (email.isUnread && accountId && email.id && email.id.trim()) {
      try {
        console.log('[gmail] Marking as read:', { messageId: email.id });
        await apiClient.post(`/api/platforms/gmail/read/${accountId}`, {
          messageId: email.id,
        });
        // Update local state
        setEmails(prev => prev.map(e => 
          e.id === email.id ? { ...e, isUnread: false } : e
        ));
        console.log('[gmail] Marked as read successfully');
      } catch (err: any) {
        // Don't show error to user, just log it (non-critical feature)
        console.error('[gmail] Failed to mark as read:', err.response?.data || err);
      }
    } else if (email.isUnread && !email.id) {
      console.warn('[gmail] Cannot mark as read - no message ID available');
    }
  };

  const handleSendReply = async () => {
    if (!selectedEmail || !replyContent.trim() || !accountId) return;
    
    const replyText = replyContent.trim();
    
    console.log('[gmail] Sending reply:', {
      threadId: selectedEmail.threadId,
      emailId: selectedEmail.id,
      content: replyText.substring(0, 50) + '...',
    });
    
    try {
      setSending(true);
      const response = await apiClient.post(`/api/platforms/gmail/reply/${accountId}`, {
        threadId: selectedEmail.threadId,
        content: replyText,
      });
      
      showSuccess('Reply sent successfully!');
      
      // Add the sent reply to the selected email's body so it shows immediately
      const sentReplyText = `\n\n--- Your Reply (${new Date().toLocaleString()}) ---\n${replyText}`;
      setSelectedEmail(prev => prev ? {
        ...prev,
        body: (prev.body || prev.snippet) + sentReplyText,
      } : null);
      
      setReplyContent('');
      
      // Note: We don't refresh the full email list because our query only fetches 
      // unread emails from others, and sent replies won't appear there
      console.log('[gmail] Reply sent, response:', response.data);
    } catch (err: any) {
      console.error('[gmail] Reply error:', err.response?.data || err);
      const errMsg = err.response?.data?.error?.message || 'Failed to send reply';
      showError(errMsg);
    } finally {
      setSending(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffDays === 0) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else if (diffDays < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-red-500 to-red-600">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">📧</span>
            <h2 className="text-xl font-semibold text-white">Gmail Inbox</h2>
            <span className="bg-white bg-opacity-20 text-white text-xs px-2 py-1 rounded-full">
              Primary
            </span>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => fetchEmails(true)}
              className="text-white hover:bg-white hover:bg-opacity-20 p-2 rounded-full transition-colors"
              title="Refresh"
              disabled={loading}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="text-white hover:bg-white hover:bg-opacity-20 p-2 rounded-full transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Email List */}
          <div 
            ref={emailListRef}
            className={`${selectedEmail ? 'w-2/5' : 'w-full'} border-r overflow-y-auto transition-all`}
          >
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <LoadingSpinner size="lg" text="Loading emails..." />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full p-6">
                <span className="text-red-500 text-lg mb-2">⚠️</span>
                <p className="text-red-600 text-center">{error}</p>
                <button
                  onClick={() => fetchEmails(true)}
                  className="mt-4 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                >
                  Retry
                </button>
              </div>
            ) : emails.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-6 text-gray-500">
                <span className="text-4xl mb-4">📭</span>
                <p className="text-lg font-medium">No emails</p>
                <p className="text-sm">Your Primary inbox is empty</p>
              </div>
            ) : (
              <div className="divide-y">
                {emails.map((email, index) => (
                  <button
                    key={`${email.id}-${index}`}
                    onClick={() => handleEmailClick(email)}
                    className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                      selectedEmail?.id === email.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                    } ${email.isUnread ? 'bg-blue-50/50' : ''}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          {email.isUnread && (
                            <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"></span>
                          )}
                          <span className={`text-sm truncate ${email.isUnread ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                            {email.from}
                          </span>
                        </div>
                        <p className={`text-sm truncate mt-1 ${email.isUnread ? 'font-medium text-gray-900' : 'text-gray-600'}`}>
                          {email.subject}
                        </p>
                        <p className="text-xs text-gray-500 truncate mt-1">
                          {email.snippet}
                        </p>
                      </div>
                      <span className="text-xs text-gray-400 ml-2 flex-shrink-0">
                        {formatDate(email.date)}
                      </span>
                    </div>
                  </button>
                ))}
                
                {/* Load More Indicator */}
                {loadingMore && (
                  <div className="flex items-center justify-center py-4">
                    <LoadingSpinner size="sm" text="Loading more..." />
                  </div>
                )}
                
                {/* Load More Button (if auto-load didn't trigger) */}
                {hasMore && !loadingMore && (
                  <button
                    onClick={loadMoreEmails}
                    className="w-full py-3 text-center text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    Load more emails...
                  </button>
                )}
                
                {/* End of list indicator */}
                {!hasMore && emails.length > 0 && (
                  <div className="py-3 text-center text-xs text-gray-400">
                    — End of emails —
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Email Detail & Reply */}
          {selectedEmail && (
            <div className="w-3/5 flex flex-col overflow-hidden">
              {/* Email Detail */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className="mb-4">
                  <h3 className="text-xl font-semibold text-gray-900">{selectedEmail.subject}</h3>
                  <div className="flex items-center mt-2 text-sm text-gray-600">
                    <span className="font-medium">{selectedEmail.from}</span>
                    {selectedEmail.fromEmail && (
                      <span className="ml-2 text-gray-400">&lt;{selectedEmail.fromEmail}&gt;</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">{new Date(selectedEmail.date).toLocaleString()}</span>
                </div>
                
                <div className="border-t pt-4">
                  <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap">
                    {selectedEmail.body || selectedEmail.snippet}
                  </div>
                </div>
              </div>

              {/* Reply Section */}
              <div className="border-t p-4 bg-gray-50">
                <div className="flex items-start space-x-3">
                  <div className="flex-1">
                    <textarea
                      value={replyContent}
                      onChange={(e) => setReplyContent(e.target.value)}
                      placeholder="Write your reply..."
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"
                      rows={3}
                      disabled={sending}
                    />
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-gray-500">
                        💡 Only reply is supported. New compose is disabled.
                      </p>
                      <button
                        onClick={handleSendReply}
                        disabled={!replyContent.trim() || sending}
                        className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                      >
                        {sending ? (
                          <>
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            <span>Sending...</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                            </svg>
                            <span>Reply</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Note */}
        <div className="px-6 py-2 bg-gray-100 text-center text-xs text-gray-500 border-t flex items-center justify-center space-x-2">
          <span>📬 Primary inbox • {emails.length} emails loaded</span>
          {hasMore && <span className="text-gray-400">• Scroll for more</span>}
        </div>
      </div>
    </div>
  );
};

export default GmailInboxModal;
