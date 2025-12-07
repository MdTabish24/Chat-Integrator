import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../config/api';
import LoadingSpinner from './LoadingSpinner';
import { useToast } from '../contexts/ToastContext';
import { useTheme } from '../contexts/ThemeContext';

interface Email {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  body?: string;
  date: string;
  isUnread: boolean;
  isOutgoing?: boolean;
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
  const { isDark } = useTheme();
  
  const emailListRef = React.useRef<HTMLDivElement>(null);

  const stripHtml = (html: string): string => {
    if (!html) return '';
    if (!html.includes('<') || !html.includes('>')) return html;
    
    let text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&#x27;/g, "'");
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n\s*\n/g, '\n\n');
    text = text.split('\n').map(line => line.trim()).join('\n');
    text = text.replace(/\n{3,}/g, '\n\n');
    
    return text.trim();
  };

  const mapEmailData = (e: any): Email => {
    const threadId = e.conversationId || e.threadId || e.thread_id || '';
    const messageId = e.platformMessageId || e.platform_message_id || e.messageId || e.id || '';
    
    let body = e.body || e.content || '';
    if (body && (body.includes('<html') || body.includes('<body') || body.includes('<div') || body.includes('<table'))) {
      body = stripHtml(body);
    }
    
    return {
      id: messageId,
      threadId: threadId,
      from: e.senderName || e.sender_name || e.from || 'Unknown',
      fromEmail: e.senderId || e.sender_id || e.senderEmail || e.fromEmail || '',
      subject: e.subject || '(No Subject)',
      snippet: e.snippet || e.preview || '',
      body: body,
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
      
      const response = await apiClient.get(`/api/platforms/gmail/emails/${accountId}`, {
        params: { limit: 50 }
      });
      
      const emailData = (response.data.emails || []).map(mapEmailData);
      setEmails(emailData);
      setNextPageToken(response.data.nextPageToken || null);
      setHasMore(response.data.hasMore || false);
    } catch (err: any) {
      const errMsg = err.response?.data?.error?.message || 'Failed to fetch emails';
      setError(errMsg);
      showError(errMsg);
    } finally {
      setLoading(false);
    }
  }, [accountId, showError]);

  const loadMoreEmails = useCallback(async () => {
    if (!accountId || !nextPageToken || loadingMore) return;
    
    try {
      setLoadingMore(true);
      
      const response = await apiClient.get(`/api/platforms/gmail/emails/${accountId}`, {
        params: { limit: 50, pageToken: nextPageToken }
      });
      
      const newEmails = (response.data.emails || []).map(mapEmailData);
      setEmails(prev => [...prev, ...newEmails]);
      setNextPageToken(response.data.nextPageToken || null);
      setHasMore(response.data.hasMore || false);
    } catch (err: any) {
      showError('Failed to load more emails');
    } finally {
      setLoadingMore(false);
    }
  }, [accountId, nextPageToken, loadingMore, showError]);

  useEffect(() => {
    if (isOpen && accountId) {
      fetchEmails(true);
    }
  }, [isOpen, accountId, fetchEmails]);

  const handleScroll = useCallback(() => {
    const container = emailListRef.current;
    if (!container || loadingMore || !hasMore) return;
    
    const { scrollTop, scrollHeight, clientHeight } = container;
    if (scrollTop + clientHeight >= scrollHeight - 100) {
      loadMoreEmails();
    }
  }, [loadingMore, hasMore, loadMoreEmails]);

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
    
    if (email.isUnread && accountId && email.id && email.id.trim()) {
      try {
        await apiClient.post(`/api/platforms/gmail/read/${accountId}`, {
          messageId: email.id,
        });
        setEmails(prev => prev.map(e => 
          e.id === email.id ? { ...e, isUnread: false } : e
        ));
      } catch (err: any) {
        console.error('[gmail] Failed to mark as read:', err);
      }
    }
  };

  const handleSendReply = async () => {
    if (!selectedEmail || !replyContent.trim() || !accountId) return;
    
    const replyText = replyContent.trim();
    
    try {
      setSending(true);
      await apiClient.post(`/api/platforms/gmail/reply/${accountId}`, {
        threadId: selectedEmail.threadId,
        content: replyText,
      });
      
      showSuccess('Reply sent successfully!');
      
      const sentReplyText = `\n\n--- Your Reply (${new Date().toLocaleString()}) ---\n${replyText}`;
      setSelectedEmail(prev => prev ? {
        ...prev,
        body: (prev.body || prev.snippet) + sentReplyText,
      } : null);
      
      setReplyContent('');
    } catch (err: any) {
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
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else if (diffDays < 365) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  };

  const formatFullDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const getAvatarColor = (email: string) => {
    const colors = [
      'from-red-500 to-rose-600',
      'from-blue-500 to-indigo-600',
      'from-green-500 to-emerald-600',
      'from-purple-500 to-violet-600',
      'from-orange-500 to-amber-600',
      'from-cyan-500 to-teal-600',
      'from-pink-500 to-fuchsia-600',
    ];
    const index = email.split('').reduce((a, b) => a + b.charCodeAt(0), 0) % colors.length;
    return colors[index];
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className={`relative w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden rounded-2xl shadow-2xl ${
        isDark ? 'bg-slate-900' : 'bg-white'
      }`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${
          isDark ? 'border-gray-700 bg-gradient-to-r from-red-600 to-rose-700' : 'bg-gradient-to-r from-red-500 to-rose-600'
        }`}>
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Gmail Inbox</h2>
              <p className="text-sm text-white/70">{emails.length} emails loaded</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => fetchEmails(true)}
              className="p-2.5 bg-white/10 hover:bg-white/20 rounded-xl transition-all duration-200 text-white"
              title="Refresh"
              disabled={loading}
            >
              <svg className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="p-2.5 bg-white/10 hover:bg-white/20 rounded-xl transition-all duration-200 text-white"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            className={`${selectedEmail ? 'w-[420px]' : 'w-full'} border-r overflow-y-auto transition-all duration-300 ${
              isDark ? 'border-gray-700 bg-slate-800/50' : 'border-gray-200 bg-gray-50/50'
            }`}
          >
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <LoadingSpinner size="lg" text="Loading emails..." />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full p-8">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${
                  isDark ? 'bg-red-900/30' : 'bg-red-100'
                }`}>
                  <svg className={`w-8 h-8 ${isDark ? 'text-red-400' : 'text-red-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <p className={`text-center mb-4 ${isDark ? 'text-red-400' : 'text-red-600'}`}>{error}</p>
                <button
                  onClick={() => fetchEmails(true)}
                  className="px-6 py-2.5 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors font-medium"
                >
                  Try Again
                </button>
              </div>
            ) : emails.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-8">
                <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-4 ${
                  isDark ? 'bg-gray-800' : 'bg-gray-100'
                }`}>
                  <svg className={`w-10 h-10 ${isDark ? 'text-gray-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                  </svg>
                </div>
                <p className={`text-lg font-semibold mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>No Emails</p>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Your inbox is empty</p>
              </div>
            ) : (
              <div className="p-3 space-y-2">
                {emails.map((email, index) => (
                  <button
                    key={`${email.id}-${index}`}
                    onClick={() => handleEmailClick(email)}
                    className={`w-full p-4 rounded-xl text-left transition-all duration-200 ${
                      selectedEmail?.id === email.id 
                        ? isDark 
                          ? 'bg-sky-900/40 ring-2 ring-sky-500/50' 
                          : 'bg-sky-50 ring-2 ring-sky-500/30'
                        : email.isUnread
                          ? isDark 
                            ? 'bg-slate-700/80 hover:bg-slate-700' 
                            : 'bg-white hover:bg-sky-50/50 shadow-sm'
                          : isDark 
                            ? 'bg-slate-800/50 hover:bg-slate-700/50' 
                            : 'bg-white/60 hover:bg-white shadow-sm'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div className={`w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center text-white font-semibold text-sm bg-gradient-to-br ${getAvatarColor(email.fromEmail)}`}>
                        {getInitials(email.from)}
                      </div>
                      
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            {email.isUnread && (
                              <span className="w-2 h-2 bg-sky-500 rounded-full flex-shrink-0" />
                            )}
                            <span className={`text-sm truncate ${
                              email.isUnread 
                                ? isDark ? 'font-semibold text-white' : 'font-semibold text-gray-900'
                                : isDark ? 'text-gray-300' : 'text-gray-700'
                            }`}>
                              {email.from}
                            </span>
                          </div>
                          <span className={`text-xs flex-shrink-0 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            {formatDate(email.date)}
                          </span>
                        </div>
                        
                        <p className={`text-sm truncate mb-1 ${
                          email.isUnread 
                            ? isDark ? 'font-medium text-gray-200' : 'font-medium text-gray-800'
                            : isDark ? 'text-gray-400' : 'text-gray-600'
                        }`}>
                          {email.subject}
                        </p>
                        
                        <p className={`text-xs truncate ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          {email.snippet}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
                
                {loadingMore && (
                  <div className="flex items-center justify-center py-4">
                    <LoadingSpinner size="sm" text="Loading more..." />
                  </div>
                )}
                
                {hasMore && !loadingMore && (
                  <button
                    onClick={loadMoreEmails}
                    className={`w-full py-3 rounded-xl text-sm font-medium transition-colors ${
                      isDark 
                        ? 'text-sky-400 hover:bg-sky-900/30' 
                        : 'text-sky-600 hover:bg-sky-50'
                    }`}
                  >
                    Load more emails
                  </button>
                )}
                
                {!hasMore && emails.length > 0 && (
                  <div className={`py-4 text-center text-xs ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
                    End of emails
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Email Detail */}
          {selectedEmail && (
            <div className={`flex-1 flex flex-col overflow-hidden ${isDark ? 'bg-slate-900' : 'bg-white'}`}>
              {/* Email Header */}
              <div className={`p-6 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                <h3 className={`text-xl font-bold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {selectedEmail.subject}
                </h3>
                
                {/* Sender Card */}
                <div className={`p-4 rounded-xl ${isDark ? 'bg-slate-800' : 'bg-gray-50'}`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-semibold bg-gradient-to-br ${getAvatarColor(selectedEmail.fromEmail)}`}>
                      {getInitials(selectedEmail.from)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {selectedEmail.from}
                        </span>
                        {selectedEmail.fromEmail && (
                          <span className={`text-sm px-2 py-0.5 rounded-md ${
                            isDark ? 'bg-slate-700 text-gray-400' : 'bg-gray-200 text-gray-600'
                          }`}>
                            {selectedEmail.fromEmail}
                          </span>
                        )}
                      </div>
                      <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {formatFullDate(selectedEmail.date)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Email Body */}
              <div className={`flex-1 overflow-y-auto p-6 ${isDark ? 'bg-slate-800/30' : 'bg-gray-50/50'}`}>
                <div className={`p-6 rounded-xl ${isDark ? 'bg-slate-800' : 'bg-white shadow-sm'}`}>
                  <div className={`prose prose-sm max-w-none whitespace-pre-wrap leading-relaxed ${
                    isDark ? 'text-gray-300' : 'text-gray-700'
                  }`} style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                    {selectedEmail.body || selectedEmail.snippet}
                  </div>
                </div>
              </div>

              {/* Reply Section */}
              <div className={`p-4 border-t ${isDark ? 'border-gray-700 bg-slate-800' : 'border-gray-200 bg-gray-50'}`}>
                <div className="space-y-3">
                  <textarea
                    value={replyContent}
                    onChange={(e) => setReplyContent(e.target.value)}
                    placeholder="Write your reply..."
                    className={`w-full px-4 py-3 rounded-xl resize-none transition-all duration-200 ${
                      isDark 
                        ? 'bg-slate-700 border-slate-600 text-white placeholder-gray-400 focus:ring-red-500 focus:border-red-500' 
                        : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-red-500 focus:border-red-500'
                    } border-2 focus:outline-none focus:ring-2`}
                    rows={3}
                    disabled={sending}
                  />
                  <div className="flex items-center justify-between">
                    <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      Press Ctrl+Enter to send reply
                    </p>
                    <button
                      onClick={handleSendReply}
                      disabled={!replyContent.trim() || sending}
                      className="px-6 py-2.5 bg-gradient-to-r from-red-500 to-rose-600 text-white rounded-xl hover:from-red-600 hover:to-rose-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium transition-all duration-200 shadow-lg shadow-red-500/25"
                    >
                      {sending ? (
                        <>
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
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
                          <span>Send Reply</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GmailInboxModal;
