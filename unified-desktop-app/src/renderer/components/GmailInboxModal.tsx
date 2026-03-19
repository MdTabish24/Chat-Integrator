/**
 * Gmail Inbox Modal Component
 * Shows Gmail emails in a modal with reply functionality
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import LoadingSpinner from './LoadingSpinner';
import type { Platform, Conversation, Message } from '../types';

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
}

const GmailInboxModal: React.FC<GmailInboxModalProps> = ({ isOpen, onClose }) => {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [sending, setSending] = useState(false);
  const { isDark } = useTheme();
  const { showSuccess, showError } = useToast();

  const emailListRef = useRef<HTMLDivElement>(null);
  const emailBodyRef = useRef<HTMLDivElement>(null);

  // Map conversation/message to Email format
  const mapToEmail = (conv: Conversation, messages?: Message[]): Email => {
    const lastMsg = messages?.[messages.length - 1];
    return {
      id: lastMsg?.platformMessageId || conv.platformConversationId,
      threadId: conv.platformConversationId,
      from: conv.participantName,
      fromEmail: conv.participantId,
      subject: conv.lastMessage?.replace('📧 ', '') || '(No Subject)',
      snippet: lastMsg?.content || conv.lastMessage || '',
      body: lastMsg?.content,
      date: conv.lastMessageAt,
      isUnread: conv.unreadCount > 0,
      isOutgoing: lastMsg?.isOutgoing || false,
    };
  };

  // Fetch emails from Gmail adapter
  const fetchEmails = useCallback(async () => {
    if (!window.electronAPI) return;

    try {
      setLoading(true);
      setError(null);

      // Get Gmail conversations
      const conversations = await window.electronAPI.data.getConversations('gmail' as Platform);

      if (!conversations || conversations.length === 0) {
        setEmails([]);
        return;
      }

      // Map to email format
      const emailList: Email[] = conversations.map((conv: Conversation) => mapToEmail(conv));

      // Sort by date (newest first)
      emailList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      setEmails(emailList);
      console.log('[GmailModal] Loaded', emailList.length, 'emails');
    } catch (err: any) {
      console.error('[GmailModal] Error:', err);
      setError(err.message || 'Failed to fetch emails');
      showError('Failed to load Gmail');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  // Fetch on open
  useEffect(() => {
    if (isOpen) {
      fetchEmails();
    }
  }, [isOpen, fetchEmails]);

  // Handle email click - load full thread
  const handleEmailClick = async (email: Email) => {
    setSelectedEmail(email);
    setReplyContent('');

    if (!window.electronAPI) return;

    try {
      // Fetch full messages for this thread
      const messages = await window.electronAPI.data.getMessages(
        `gmail_${email.threadId}`,
        'gmail' as Platform
      );

      if (messages && messages.length > 0) {
        // Get the full body from messages - REVERSE ORDER (latest first)
        const fullBody = messages.reverse().map((m: Message) => {
          const prefix = m.isOutgoing ? '→ You' : `← ${m.senderName}`;
          const date = new Date(m.sentAt).toLocaleString();
          return `[${prefix} - ${date}]\n${m.content}`;
        }).join('\n\n---\n\n');

        setSelectedEmail(prev => prev ? { ...prev, body: fullBody } : null);
      }

      // Mark as read
      if (email.isUnread) {
        setEmails(prev => prev.map(e =>
          e.id === email.id ? { ...e, isUnread: false } : e
        ));
      }
    } catch (err: any) {
      console.error('[GmailModal] Failed to load thread:', err);
    }
  };

  // Send reply
  const handleSendReply = async () => {
    if (!selectedEmail || !replyContent.trim() || !window.electronAPI) return;

    try {
      setSending(true);

      const result = await window.electronAPI.data.sendMessage(
        `gmail_${selectedEmail.threadId}`,
        'gmail' as Platform,
        replyContent.trim()
      );

      if (result.success) {
        showSuccess('Reply sent!');

        // Add reply to body
        const replyText = `\n\n--- Your Reply (${new Date().toLocaleString()}) ---\n${replyContent.trim()}`;
        setSelectedEmail(prev => prev ? {
          ...prev,
          body: (prev.body || prev.snippet) + replyText,
        } : null);

        setReplyContent('');
      } else {
        showError(result.error || 'Failed to send reply');
      }
    } catch (err: any) {
      showError(err.message || 'Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  // Format date
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
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  const formatFullDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
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
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
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
    const index = (email || '').split('').reduce((a, b) => a + b.charCodeAt(0), 0) % colors.length;
    return colors[index];
  };

  // Handle keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
      if (e.ctrlKey && e.key === 'Enter' && replyContent.trim() && selectedEmail) {
        handleSendReply();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose, replyContent, selectedEmail]);

  if (!isOpen) return null;

  return (
    <div className="fixed top-0 left-0 right-0 bottom-0 z-50" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: '50px' }}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={`relative w-full flex flex-col overflow-hidden rounded-2xl shadow-2xl ${
          isDark ? 'bg-slate-900' : 'bg-white'
        }`}
        style={{ maxWidth: '1200px', height: '80vh', margin: 'auto' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-gradient-to-r from-red-600 to-rose-700">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Gmail Inbox</h2>
              <p className="text-sm text-white/70">{emails.length} emails • Primary only</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={fetchEmails}
              className="p-2.5 bg-white/10 hover:bg-white/20 rounded-xl transition-all text-white"
              title="Refresh"
              disabled={loading}
            >
              <svg className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="p-2.5 bg-white/10 hover:bg-white/20 rounded-xl transition-all text-white"
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
            className={`${selectedEmail ? 'w-[380px]' : 'w-full'} border-r overflow-y-auto transition-all ${
              isDark ? 'border-gray-700 bg-slate-800/50' : 'border-gray-200 bg-gray-50'
            }`}
          >
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <LoadingSpinner />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full p-8">
                <div className="w-16 h-16 rounded-2xl bg-red-900/30 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <p className="text-red-400 text-center mb-4">{error}</p>
                <button
                  onClick={fetchEmails}
                  className="px-6 py-2.5 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors"
                >
                  Try Again
                </button>
              </div>
            ) : emails.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-8">
                <div className="w-20 h-20 rounded-2xl bg-gray-800 flex items-center justify-center mb-4">
                  <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                  </svg>
                </div>
                <p className="text-lg font-semibold text-white mb-1">No Emails</p>
                <p className="text-sm text-gray-400">Your Primary inbox is empty</p>
              </div>
            ) : (
              <div className="p-3 space-y-2">
                {emails.map((email, index) => (
                  <button
                    key={`${email.id}-${index}`}
                    onClick={() => handleEmailClick(email)}
                    className={`w-full p-4 rounded-xl text-left transition-all ${
                      selectedEmail?.id === email.id
                        ? 'bg-sky-900/40 ring-2 ring-sky-500/50'
                        : email.isUnread
                          ? 'bg-slate-700/80 hover:bg-slate-700'
                          : 'bg-slate-800/50 hover:bg-slate-700/50'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center text-white font-semibold text-sm bg-gradient-to-br ${getAvatarColor(email.fromEmail)}`}>
                        {getInitials(email.from)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            {email.isUnread && (
                              <span className="w-2 h-2 bg-sky-500 rounded-full flex-shrink-0" />
                            )}
                            <span className={`text-sm truncate ${
                              email.isUnread ? 'font-semibold text-white' : 'text-gray-300'
                            }`}>
                              {email.from}
                            </span>
                          </div>
                          <span className="text-xs text-gray-500 flex-shrink-0">
                            {formatDate(email.date)}
                          </span>
                        </div>

                        <p className={`text-sm truncate mb-1 ${
                          email.isUnread ? 'font-medium text-gray-200' : 'text-gray-400'
                        }`}>
                          {email.subject}
                        </p>

                        <p className="text-xs text-gray-500 truncate">
                          {email.snippet}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Email Detail */}
          {selectedEmail && (
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-900">
              {/* Email Header */}
              <div className="p-6 border-b border-gray-700">
                <div className="p-4 rounded-xl bg-slate-800">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-semibold bg-gradient-to-br ${getAvatarColor(selectedEmail.fromEmail)}`}>
                      {getInitials(selectedEmail.from)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white">
                          {selectedEmail.from}
                        </span>
                      </div>
                      {selectedEmail.fromEmail && (
                        <p className="text-sm text-gray-400 mt-1">
                          {selectedEmail.fromEmail}
                        </p>
                      )}
                      <p className="text-sm text-gray-400 mt-1">
                        {formatFullDate(selectedEmail.date)} | {selectedEmail.subject}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Email Body */}
              <div
                ref={emailBodyRef}
                className="flex-1 overflow-y-auto p-6 bg-slate-800/30"
              >
                <div className="p-6 rounded-xl bg-slate-800">
                  <div className="prose prose-sm max-w-none whitespace-pre-wrap leading-relaxed text-gray-300">
                    {selectedEmail.body || selectedEmail.snippet}
                  </div>
                </div>
              </div>

              {/* Reply Section */}
              <div className="px-6 py-3 border-t border-gray-700 bg-slate-800">
                <div className="flex items-center gap-3">
                  <textarea
                    value={replyContent}
                    onChange={(e) => setReplyContent(e.target.value)}
                    placeholder="Write your reply..."
                    className="flex-1 px-4 py-2 rounded-xl resize-none bg-slate-700 border-2 border-slate-600 text-white placeholder-gray-400 focus:ring-2 focus:ring-red-500 focus:border-red-500 focus:outline-none transition-all"
                    rows={2}
                    disabled={sending}
                  />
                  <button
                    onClick={handleSendReply}
                    disabled={!replyContent.trim() || sending}
                    className="px-6 py-2 bg-gradient-to-r from-red-500 to-rose-600 text-white rounded-xl hover:from-red-600 hover:to-rose-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium transition-all shadow-lg shadow-red-500/25 self-end"
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
          )}
        </div>
      </div>
    </div>
  );
};

export default GmailInboxModal;
