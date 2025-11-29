import React from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../types';

interface HeaderProps {
  user: User | null;
  totalUnread: number;
  gmailUnread?: number;
  isConnected: boolean;
  isAuthenticated: boolean;
  onLogout: () => void;
}

const Header: React.FC<HeaderProps> = ({
  user,
  totalUnread,
  gmailUnread = 0,
  isConnected,
  isAuthenticated,
  onLogout,
}) => {
  const navigate = useNavigate();

  return (
    <header className="bg-white border-b border-gray-200 px-4 py-3">
      <div className="flex items-center justify-between">
        {/* Left: Logo and Title */}
        <div className="flex items-center space-x-3">
          <h1 className="text-xl font-bold text-gray-900">Chat Orbitor</h1>
          {totalUnread > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center space-x-4">
          {/* WebSocket Status */}
          <div className="flex items-center space-x-1.5">
            <div className={`w-2 h-2 rounded-full ${
              isAuthenticated ? 'bg-green-500' : isConnected ? 'bg-yellow-500' : 'bg-red-500'
            }`} />
            <span className="text-xs text-gray-500">
              {isAuthenticated ? 'Live' : isConnected ? 'Connecting...' : 'Offline'}
            </span>
          </div>

          {/* Gmail Icon with Badge */}
          <button
            onClick={() => navigate('/dashboard')}
            className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
            title="Gmail notifications"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {gmailUnread > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {gmailUnread > 9 ? '9+' : gmailUnread}
              </span>
            )}
          </button>

          {/* Manage Accounts Button */}
          <button
            onClick={() => navigate('/accounts')}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            Manage accounts
          </button>

          {/* User Email */}
          {user?.email && (
            <span className="text-sm text-gray-600 hidden sm:block">{user.email}</span>
          )}

          {/* Logout Button */}
          <button
            onClick={onLogout}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
