import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import GmailInboxModal from './GmailInboxModal';
import apiClient from '../config/api';

interface HeaderProps {
  user: User | null;
  totalUnread: number;
  gmailUnread?: number;
  gmailAccountId?: string | null;
  currentConversationId?: string | null;
  onAIPrefill?: (text: string) => void;
  isConnected: boolean;
  isAuthenticated: boolean;
  onLogout: () => void;
}

const Header: React.FC<HeaderProps> = ({
  user,
  totalUnread,
  gmailUnread = 0,
  gmailAccountId = null,
  currentConversationId = null,
  onAIPrefill,
  isConnected,
  isAuthenticated,
  onLogout,
}) => {
  const navigate = useNavigate();
  const [showGmailModal, setShowGmailModal] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [customPrompt, setCustomPrompt] = useState('');
  const aiPanelRef = useRef<HTMLDivElement>(null);
  const aiButtonRef = useRef<HTMLButtonElement>(null);
  const { theme, toggleTheme, isDark } = useTheme();
  const { showSuccess } = useToast();

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!showAiPanel) return;

      const targetNode = event.target as Node;
      const clickedInsidePanel = aiPanelRef.current?.contains(targetNode);
      const clickedButton = aiButtonRef.current?.contains(targetNode);

      if (!clickedInsidePanel && !clickedButton) {
        setShowAiPanel(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [showAiPanel]);

  const handleGmailClick = () => {
    if (gmailAccountId) {
      setShowGmailModal(true);
    } else {
      navigate('/accounts');
    }
  };

  const applyAIPrefill = (text: string) => {
    const cleaned = text?.trim();
    if (!cleaned || !onAIPrefill) return;
    onAIPrefill(cleaned);
  };

  const handleAiSuggest = async () => {
    if (!currentConversationId) {
      setAiError('Pehle koi chat select karo, phir AI use karo.');
      return;
    }

    setAiError(null);
    setAiLoading(true);
    try {
      const response = await apiClient.post(`/api/messages/${currentConversationId}/ai-assist`, {
        action: 'suggest',
      });
      const suggestions = response.data.suggestions || [];
      setAiSuggestions(suggestions);
      if (suggestions.length === 0) {
        setAiError('AI suggestions empty aayi. Dobara try karo.');
      }
    } catch (err: any) {
      const message = err.response?.data?.error || 'Failed to get AI suggestions';
      setAiError(message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiCustomPrompt = async () => {
    if (!currentConversationId) {
      setAiError('Pehle koi chat select karo, phir AI use karo.');
      return;
    }
    if (!customPrompt.trim()) return;

    setAiError(null);
    setAiLoading(true);
    try {
      const response = await apiClient.post(`/api/messages/${currentConversationId}/ai-assist`, {
        action: 'custom',
        prompt: customPrompt,
      });

      const draftedText = response.data.prefill || '';
      if (!draftedText.trim()) {
        setAiError('AI ne empty draft diya. Prompt ko aur specific karo.');
        return;
      }

      applyAIPrefill(draftedText);
      showSuccess('AI draft message box me aa gaya');
      setShowAiPanel(false);
    } catch (err: any) {
      const message = err.response?.data?.error || 'Failed to generate AI draft';
      setAiError(message);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <>
      <header className="header-professional px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Left: Logo and Title */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-gradient-to-br from-sky-400 to-sky-600 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div>
                <h1 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Chat Orbitor</h1>
                <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Multi-Platform Sync</p>
              </div>
            </div>
            {totalUnread > 0 && (
              <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 text-xs font-bold text-white bg-gradient-to-r from-rose-500 to-red-500 rounded-full shadow-md shadow-red-500/25">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </div>

          {/* Right: Actions */}
          <div className="flex items-center space-x-3">
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="theme-toggle"
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDark ? (
                <svg className="sun-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="moon-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            {/* WebSocket Status */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-100'}`}>
              <div className={`w-2 h-2 rounded-full ${
                isAuthenticated ? 'bg-emerald-500' : isConnected ? 'bg-amber-500 animate-pulse' : 'bg-gray-400'
              }`} />
              <span className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                {isAuthenticated ? 'Live' : isConnected ? 'Connecting' : 'Offline'}
              </span>
            </div>

            {/* Gmail Icon with Badge */}
            <button
              onClick={handleGmailClick}
              className={`relative p-2.5 rounded-xl transition-all duration-200 ${
                gmailAccountId 
                  ? isDark ? 'bg-red-900/30 text-red-400 hover:bg-red-900/50 hover:shadow-md' : 'bg-red-50 text-red-500 hover:bg-red-100 hover:shadow-md'
                  : isDark ? 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300' : 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-500'
              }`}
              title={gmailAccountId ? 'Open Gmail Inbox' : 'Connect Gmail'}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {gmailUnread > 0 && (
                <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold text-white bg-red-500 rounded-full shadow-sm">
                  {gmailUnread > 9 ? '9+' : gmailUnread}
                </span>
              )}
              {!gmailAccountId && (
                <span className="absolute -top-1 -right-1 flex items-center justify-center w-4 h-4 text-[10px] font-bold text-white bg-gray-400 rounded-full">
                  +
                </span>
              )}
            </button>

            {/* AI Button (next to Gmail) */}
            <div className="relative">
              <button
                ref={aiButtonRef}
                type="button"
                onClick={() => setShowAiPanel((prev) => !prev)}
                className={`relative p-2.5 rounded-xl transition-all duration-200 ${
                  currentConversationId
                    ? isDark
                      ? 'bg-sky-900/30 text-sky-300 hover:bg-sky-900/50 hover:shadow-md'
                      : 'bg-sky-50 text-sky-600 hover:bg-sky-100 hover:shadow-md'
                    : isDark
                      ? 'bg-gray-800 text-gray-500 hover:bg-gray-700'
                      : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                }`}
                title={currentConversationId ? 'Open AI assistant' : 'Select a chat to use AI'}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 3l1.9 3.8L18 8.7l-3 2.9.7 4.1L12 13.8 8.3 15.7 9 11.6 6 8.7l4.1-.9L12 3z" />
                </svg>
              </button>

              {showAiPanel && (
                <div
                  ref={aiPanelRef}
                  className={`absolute right-0 mt-2 z-30 w-[360px] rounded-xl border shadow-xl p-4 ${
                    isDark ? 'bg-slate-900 border-gray-700' : 'bg-white border-gray-200'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>AI Chat Assistant</h4>
                      <button
                        type="button"
                        onClick={() => setShowAiPanel(false)}
                        className={isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleAiSuggest}
                      disabled={aiLoading || !currentConversationId}
                      className="w-full btn-professional btn-secondary py-2"
                    >
                      {aiLoading ? 'Generating...' : 'Suggest Reply Options'}
                    </button>

                    {aiSuggestions.length > 0 && (
                      <div className="space-y-2">
                        {aiSuggestions.map((suggestion, idx) => (
                          <button
                            key={`${idx}-${suggestion.slice(0, 12)}`}
                            type="button"
                            onClick={() => {
                              applyAIPrefill(suggestion);
                              setShowAiPanel(false);
                            }}
                            className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                              isDark
                                ? 'border-gray-700 hover:bg-slate-800 text-gray-200'
                                : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                            }`}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className={`pt-2 border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                      <label className={`text-xs mb-1 block ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        Custom prompt
                      </label>
                      <textarea
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        rows={3}
                        placeholder="Example: Is chat ke hisaab se leave letter draft karo"
                        className={`w-full px-3 py-2 rounded-lg border text-sm resize-none ${
                          isDark
                            ? 'bg-slate-800 border-gray-700 text-white placeholder-gray-500'
                            : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={handleAiCustomPrompt}
                        disabled={aiLoading || !customPrompt.trim() || !currentConversationId}
                        className="w-full mt-2 btn-professional btn-primary-3d py-2"
                      >
                        {aiLoading ? 'Generating...' : 'Generate From Custom Prompt'}
                      </button>
                    </div>

                    {aiError && (
                      <p className={`text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>{aiError}</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Manage Accounts Button */}
            <button
              onClick={() => navigate('/accounts')}
              className="btn-professional btn-secondary-3d text-sm"
            >
              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Accounts
            </button>

            {/* Settings Button */}
            <button
              onClick={() => navigate('/settings')}
              className={`p-2.5 rounded-xl transition-all duration-200 ${isDark ? 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200' : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700'}`}
              title="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            {/* User Info */}
            {user?.email && (
              <div className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-100'}`}>
                <div className="w-6 h-6 bg-gradient-to-br from-sky-400 to-sky-600 rounded-full flex items-center justify-center">
                  <span className="text-[10px] font-bold text-white">
                    {user.email.charAt(0).toUpperCase()}
                  </span>
                </div>
                <span className={`text-sm font-medium max-w-[120px] truncate ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  {user.email}
                </span>
              </div>
            )}

            {/* Logout Button */}
            <button
              onClick={onLogout}
              className="btn-professional btn-primary-3d text-sm"
            >
              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Gmail Inbox Modal */}
      <GmailInboxModal
        isOpen={showGmailModal}
        onClose={() => setShowGmailModal(false)}
        accountId={gmailAccountId}
      />
    </>
  );
};

export default Header;
