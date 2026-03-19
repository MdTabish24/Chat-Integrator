import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useElectron } from '../contexts/ElectronContext';
import GmailInboxModal from './GmailInboxModal';

interface HeaderProps {
  totalUnread: number;
  gmailConnected?: boolean;
}

const Header: React.FC<HeaderProps> = ({ totalUnread, gmailConnected = false }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDark, toggleTheme } = useTheme();
  const { minimizeToTray, appVersion } = useElectron();
  const [showGmailModal, setShowGmailModal] = useState(false);

  const navItems = [
    { path: '/dashboard', label: 'Messages', icon: '💬' },
    { path: '/accounts', label: 'Accounts', icon: '🔗' },
    { path: '/settings', label: 'Settings', icon: '⚙️' },
  ];

  return (
    <header className="header-professional h-16 px-6 flex items-center justify-between">
      {/* Logo & Title */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-primary flex items-center justify-center shadow-md">
          <span className="text-white text-xl">🌐</span>
        </div>
        <div>
          <h1 className="text-lg font-bold text-gradient">Chat Orbitor</h1>
          <p className="text-xs text-[var(--text-muted)]">v{appVersion}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex items-center gap-1">
        {navItems.map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              location.pathname === item.path
                ? 'bg-primary-500 text-white shadow-md'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            <span className="mr-2">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {/* Right Section */}
      <div className="flex items-center gap-3">
        {/* Gmail Icon - Only show if connected */}
        {gmailConnected && (
          <button
            onClick={() => setShowGmailModal(true)}
            className="relative p-2 rounded-lg hover:bg-[var(--bg-hover)] transition-all"
            title="Open Gmail Inbox"
          >
            <svg className="w-6 h-6 text-red-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 010 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/>
            </svg>
          </button>
        )}

        {/* Unread Badge */}
        {totalUnread > 0 && (
          <div className="status-badge status-syncing">
            <span className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
            {totalUnread} unread
          </div>
        )}

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="theme-toggle"
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? (
            <svg className="sun-icon" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg className="moon-icon" fill="currentColor" viewBox="0 0 20 20">
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          )}
        </button>

        {/* Minimize to Tray */}
        <button
          onClick={minimizeToTray}
          className="btn-secondary-3d btn-professional"
          title="Minimize to tray"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Gmail Inbox Modal */}
      <GmailInboxModal 
        isOpen={showGmailModal} 
        onClose={() => setShowGmailModal(false)} 
      />
    </header>
  );
};

export default Header;
