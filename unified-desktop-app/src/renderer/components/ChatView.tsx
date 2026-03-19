import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Platform, Message } from '../types';
import type { ChatTab } from '../types';
import { useElectron } from '../contexts/ElectronContext';
import { useTheme } from '../contexts/ThemeContext';
import EmptyState from './EmptyState';

interface ChatViewProps {
  conversationId: string | null;
  platform: Platform | null;
  onMessageSent: () => void;
  openTabs: ChatTab[];
  onTabClick: (tab: ChatTab) => void;
  onTabClose: (tabId: string, e: React.MouseEvent) => void;
}

const ChatView: React.FC<ChatViewProps> = ({
  conversationId,
  platform,
  onMessageSent,
  openTabs,
  onTabClick,
  onTabClose,
}) => {
  const { getMessages, sendMessage, markAsRead, typingIndicators, newMessages } = useElectron();
  const { isDark } = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Get typing indicators for current conversation
  const currentTypingUsers = useMemo(() => {
    if (!conversationId || !platform) return [];
    const users: string[] = [];
    typingIndicators.forEach((indicator) => {
      if (indicator.conversationId === conversationId && indicator.platform === platform && indicator.isTyping) {
        users.push(indicator.userId);
      }
    });
    return users;
  }, [typingIndicators, conversationId, platform]);

  // Load messages when conversation changes
  useEffect(() => {
    if (conversationId && platform) {
      loadMessages();
      markAsRead(conversationId, platform);
    } else {
      setMessages([]);
    }
  }, [conversationId, platform]);

  // Listen for new messages in current conversation
  useEffect(() => {
    if (!conversationId || !platform) return;
    const relevantMessages = newMessages.filter(
      m => m.conversationId === conversationId && m.platform === platform
    );
    if (relevantMessages.length > 0) {
      setMessages(prev => {
        const newMsgs = [...prev];
        relevantMessages.forEach(event => {
          if (!newMsgs.some(m => m.id === event.message.id)) {
            newMsgs.push(event.message);
          }
        });
        newMsgs.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
        return newMsgs;
      });
      markAsRead(conversationId, platform);
    }
  }, [newMessages, conversationId, platform, markAsRead]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (conversationId) inputRef.current?.focus();
  }, [conversationId]);

  const loadMessages = async () => {
    if (!conversationId || !platform) return;
    setIsLoading(true);
    try {
      const msgs = await getMessages(conversationId, platform);
      setMessages(msgs);
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('[ChatView] handleSendMessage called');
    console.log('[ChatView] newMessage:', newMessage);
    console.log('[ChatView] conversationId:', conversationId);
    console.log('[ChatView] platform:', platform);
    console.log('[ChatView] isSending:', isSending);
    
    if (!newMessage.trim() || !conversationId || !platform || isSending) {
      console.log('[ChatView] Early return - validation failed');
      return;
    }
    
    const messageContent = newMessage.trim();
    setIsSending(true);
    setNewMessage('');
    
    console.log('[ChatView] Calling sendMessage...');
    
    try {
      const result = await sendMessage(conversationId, platform, messageContent);
      console.log('[ChatView] sendMessage result:', result);
      
      if (result?.success) {
        const sentMessage: Message = {
          id: result.messageId || `temp_${Date.now()}`,
          conversationId,
          platformMessageId: result.messageId || '',
          senderId: 'me',
          senderName: 'You',
          content: messageContent,
          messageType: 'text',
          isOutgoing: true,
          isRead: false,
          sentAt: result.sentAt || new Date().toISOString(),
        };
        setMessages(prev => [...prev, sentMessage]);
        onMessageSent();
      } else {
        console.log('[ChatView] Send failed, restoring message');
        setNewMessage(messageContent);
      }
    } catch (error) {
      console.error('[ChatView] Failed to send message:', error);
      setNewMessage(messageContent);
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  };

  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: Message[] }[] = [];
    let currentDate = '';
    messages.forEach(message => {
      const messageDate = new Date(message.sentAt).toDateString();
      if (messageDate !== currentDate) {
        currentDate = messageDate;
        groups.push({ date: message.sentAt, messages: [message] });
      } else {
        groups[groups.length - 1].messages.push(message);
      }
    });
    return groups;
  }, [messages]);

  if (!conversationId) {
    return (
      <div className="flex-1 flex flex-col chat-area-professional">
        {openTabs.length > 0 && (
          <div className="tab-bar bg-[var(--bg-navbar)] border-b border-[var(--border-color)] flex overflow-x-auto">
            {openTabs.map((tab) => (
              <div key={tab.id} onClick={() => onTabClick(tab)} className="tab-item flex items-center gap-2 px-4 py-2 cursor-pointer border-b-2 border-transparent hover:bg-[var(--bg-hover)]">
                <span className="truncate text-sm max-w-[120px]">{tab.participantName}</span>
                <button onClick={(e) => onTabClose(tab.id, e)} className="tab-close p-1 rounded hover:bg-[var(--bg-card)] opacity-60 hover:opacity-100">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex-1 flex items-center justify-center">
          <EmptyState icon={<svg className={`w-16 h-16 ${isDark ? 'text-gray-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>} title="Select a Conversation" description="Choose a conversation from the sidebar to start messaging" />
        </div>
      </div>
    );
  }

  const currentTab = openTabs.find(t => t.conversationId === conversationId);

  return (
    <div className="flex-1 flex flex-col chat-area-professional">
      {openTabs.length > 0 && (
        <div className="tab-bar bg-[var(--bg-navbar)] border-b border-[var(--border-color)] flex overflow-x-auto">
          {openTabs.map((tab) => (
            <div key={tab.id} onClick={() => onTabClick(tab)} className={`tab-item flex items-center gap-2 px-4 py-2 cursor-pointer border-b-2 transition-colors ${tab.conversationId === conversationId ? 'border-primary-500 bg-[var(--bg-hover)]' : 'border-transparent hover:bg-[var(--bg-hover)]'}`}>
              <span className="truncate text-sm max-w-[120px]">{tab.participantName}</span>
              <button onClick={(e) => onTabClose(tab.id, e)} className="tab-close p-1 rounded hover:bg-[var(--bg-card)] opacity-60 hover:opacity-100">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="h-16 px-6 flex items-center border-b border-[var(--border-color)] bg-[var(--bg-card)]">
        <div className="w-10 h-10 rounded-full bg-[var(--bg-hover)] flex items-center justify-center overflow-hidden mr-3">
          {currentTab?.participantAvatarUrl ? <img src={currentTab.participantAvatarUrl} alt={currentTab.participantName} className="w-full h-full object-cover" /> : <span className="text-lg">{currentTab?.participantName?.charAt(0).toUpperCase() || '?'}</span>}
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-[var(--text-primary)]">{currentTab?.participantName || 'Unknown'}</h3>
          <div className="flex items-center gap-2">
            <p className="text-xs text-[var(--text-muted)] capitalize">{platform}</p>
            {currentTypingUsers.length > 0 && <span className="text-xs text-primary-500 animate-pulse">typing...</span>}
          </div>
        </div>
        <button onClick={loadMessages} disabled={isLoading} className="p-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors" title="Refresh messages">
          <svg className={`w-5 h-5 text-[var(--text-muted)] ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full"><p className="text-[var(--text-muted)]">No messages yet. Start the conversation!</p></div>
        ) : (
          <div className="space-y-4">
            {groupedMessages.map((group, groupIndex) => (
              <div key={groupIndex}>
                <div className="flex items-center justify-center my-4"><span className="px-3 py-1 text-xs text-[var(--text-muted)] bg-[var(--bg-hover)] rounded-full">{formatDate(group.date)}</span></div>
                <div className="space-y-2">
                  {group.messages.map((message) => (
                    <div key={message.id} className={`flex ${message.isOutgoing ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[70%] px-4 py-2 rounded-2xl ${message.isOutgoing ? 'bg-primary-500 text-white rounded-br-md' : 'bg-[var(--bg-card)] text-[var(--text-primary)] rounded-bl-md border border-[var(--border-color)]'}`}>
                        {!message.isOutgoing && <p className="text-xs font-medium text-primary-500 mb-1">{message.senderName}</p>}
                        <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                        <div className={`flex items-center gap-1 mt-1 ${message.isOutgoing ? 'justify-end' : 'justify-start'}`}>
                          <span className={`text-xs ${message.isOutgoing ? 'text-white/70' : 'text-[var(--text-muted)]'}`}>{formatTime(message.sentAt)}</span>
                          {message.isOutgoing && <span className="ml-1">{message.isRead ? <svg className="w-4 h-4 text-white/70" fill="currentColor" viewBox="0 0 24 24"><path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z" /></svg> : <svg className="w-4 h-4 text-white/50" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" /></svg>}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {currentTypingUsers.length > 0 && (
              <div className="flex justify-start">
                <div className="px-4 py-2 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] rounded-bl-md">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-[var(--text-muted)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-[var(--text-muted)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-[var(--text-muted)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSendMessage} className="p-4 border-t border-[var(--border-color)] bg-[var(--bg-card)]">
        <div className="flex items-center gap-3">
          <input ref={inputRef} type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} onKeyDown={handleKeyDown} placeholder="Type a message..." className="input-professional flex-1" disabled={isSending} />
          <button type="submit" disabled={!newMessage.trim() || isSending} className="btn-primary-3d btn-professional px-6 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center">
            {isSending ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ChatView;
