import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../types';
import GmailInboxModal from './GmailInboxModal';

interface HeaderProps {
  user: User | null;
  totalUnread: number;
  gmailUnread?: number;
  gmailAccountId?: string | null;
  isConnected: boolean;
  isAuthenticated: boolean;
  onLogout: () => void;
}

const Header: React.FC<HeaderProps> = ({
  user,
  totalUnread,
  gmailUnread = 0,
  gmailAccountId = null,
  isConnected,
  isAuthenticated,
  onLogout,
}) => {
  const navigate = useNavigate();
  const [showGmailModal, setShowGmailModal] = useState(false);

  const handleGmailClick = () => {
    if (gmailAccountId) {
      setShowGmailModal(true);
    } else {
      navigate('/accounts');
    }
  };

  return (
    <>
      <header className="header-professional px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Left: Logo and Title */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">Chat Orbitor</h1>
                <p className="text-xs text-gray-500">Multi-Platform Sync</p>
              </div>
            </div>
            {totalUnread > 0 && (
              <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 text-xs font-bold text-white bg-gradient-to-r from-red-500 to-rose-500 rounded-full shadow-sm">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </div>

          {/* Right: Actions */}
          <div className="flex items-center space-x-3">
            {/* WebSocket Status */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg border border-gray-100">
              <div className={`w-2 h-2 rounded-full ${
                isAuthenticated ? 'bg-emerald-500' : isConnected ? 'bg-amber-500 animate-pulse' : 'bg-gray-400'
              }`} />
              <span className="text-xs font-medium text-gray-600">
                {isAuthenticated ? 'Live' : isConnected ? 'Connecting' : 'Offline'}
              </span>
            </div>

            {/* Gmail Icon with Badge */}
            <button
              onClick={handleGmailClick}
              className={`relative p-2.5 rounded-xl transition-all duration-200 ${
                gmailAccountId 
                  ? 'bg-red-50 text-red-500 hover:bg-red-100 hover:shadow-md' 
                  : 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-500'
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
              className="p-2.5 rounded-xl bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-all duration-200"
              title="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            {/* User Info */}
            {user?.email && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg border border-gray-100">
                <div className="w-6 h-6 bg-gradient-to-br from-indigo-400 to-purple-500 rounded-full flex items-center justify-center">
                  <span className="text-[10px] font-bold text-white">
                    {user.email.charAt(0).toUpperCase()}
                  </span>
                </div>
                <span className="text-sm font-medium text-gray-600 max-w-[120px] truncate">
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
