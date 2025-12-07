import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { useTheme } from '../contexts/ThemeContext';

const Settings: React.FC = () => {
  const navigate = useNavigate();
  const { showSuccess } = useToast();
  const { isDark } = useTheme();
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    const storedToken = localStorage.getItem('access_token') || '';
    setToken(storedToken);
  }, []);

  const copyToken = () => {
    navigator.clipboard.writeText(token);
    showSuccess('Token copied to clipboard!');
  };

  const DESKTOP_APP_URL = 'https://github.com/MdTabish24/Chat-Integrator/releases/download/v1.0.2/ChatOrbitor.Twitter.Sync.Setup.1.0.0.exe';

  return (
    <div className={`min-h-screen ${isDark ? 'bg-slate-900' : 'bg-gradient-to-br from-sky-50 to-slate-100'}`}>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <button
          onClick={() => navigate('/dashboard')}
          className={`mb-6 flex items-center gap-2 font-medium transition-colors ${
            isDark ? 'text-sky-400 hover:text-sky-300' : 'text-sky-600 hover:text-sky-700'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Dashboard
        </button>

        <h1 className={`text-2xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Settings
        </h1>

        {/* API Token Section */}
        <div className={`rounded-2xl p-6 mb-6 ${
          isDark ? 'bg-slate-800 border border-slate-700' : 'bg-white shadow-lg'
        }`}>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isDark ? 'bg-amber-900/30' : 'bg-amber-100'
            }`}>
              <svg className={`w-5 h-5 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              API Token
            </h2>
          </div>
          
          <p className={`text-sm mb-4 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            Use this token to connect the Desktop App to your Chat Orbitor account.
          </p>
          
          <div className="flex items-center gap-2 mb-4">
            <div className={`flex-1 relative rounded-xl overflow-hidden ${
              isDark ? 'bg-slate-700' : 'bg-gray-50'
            }`}>
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                readOnly
                className={`w-full px-4 py-3 font-mono text-sm border-2 rounded-xl transition-all ${
                  isDark 
                    ? 'bg-slate-700 border-slate-600 text-gray-200' 
                    : 'bg-gray-50 border-gray-200 text-gray-800'
                }`}
              />
            </div>
            <button
              onClick={() => setShowToken(!showToken)}
              className={`p-3 rounded-xl transition-all ${
                isDark 
                  ? 'bg-slate-700 text-gray-400 hover:text-white hover:bg-slate-600' 
                  : 'bg-gray-100 text-gray-600 hover:text-gray-900 hover:bg-gray-200'
              }`}
              title={showToken ? 'Hide token' : 'Show token'}
            >
              {showToken ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
            <button
              onClick={copyToken}
              className="px-5 py-3 bg-gradient-to-r from-sky-500 to-blue-600 text-white rounded-xl hover:from-sky-600 hover:to-blue-700 font-medium transition-all shadow-lg shadow-sky-500/25 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
              Copy
            </button>
          </div>
          
          <div className={`flex items-start gap-2 p-3 rounded-xl ${
            isDark ? 'bg-amber-900/20 border border-amber-800/50' : 'bg-amber-50 border border-amber-200'
          }`}>
            <svg className={`w-5 h-5 flex-shrink-0 mt-0.5 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className={`text-sm ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
              Keep this token secret. Anyone with this token can access your messages.
            </p>
          </div>
        </div>

        {/* Desktop App Section */}
        <div className={`rounded-2xl p-6 mb-6 ${
          isDark ? 'bg-slate-800 border border-slate-700' : 'bg-white shadow-lg'
        }`}>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isDark ? 'bg-sky-900/30' : 'bg-sky-100'
            }`}>
              <svg className={`w-5 h-5 ${isDark ? 'text-sky-400' : 'text-sky-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Desktop App
            </h2>
          </div>
          
          <p className={`text-sm mb-4 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            Download the Desktop App to sync messages from platforms that block server access 
            (Twitter, LinkedIn, Instagram, Facebook).
          </p>
          
          <div className={`rounded-xl p-4 mb-4 ${
            isDark ? 'bg-sky-900/20 border border-sky-800/50' : 'bg-sky-50 border border-sky-200'
          }`}>
            <h3 className={`font-semibold mb-2 ${isDark ? 'text-sky-300' : 'text-sky-800'}`}>
              Why do I need this?
            </h3>
            <p className={`text-sm ${isDark ? 'text-sky-200/70' : 'text-sky-700'}`}>
              Some platforms (like Twitter) block automated access from servers. 
              The desktop app runs on your computer, using your home internet, 
              which these platforms allow.
            </p>
          </div>

          <div className="space-y-3">
            <a
              href={DESKTOP_APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center px-4 py-4 bg-gradient-to-r from-sky-500 to-blue-600 text-white rounded-xl hover:from-sky-600 hover:to-blue-700 font-semibold transition-all shadow-lg shadow-sky-500/25 flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download for Windows (.exe)
            </a>
            
            <p className={`text-xs text-center ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
              macOS and Linux versions coming soon
            </p>
          </div>

          <div className={`mt-4 p-4 rounded-xl ${isDark ? 'bg-slate-700/50' : 'bg-gray-50'}`}>
            <h4 className={`font-semibold text-sm mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              How to use:
            </h4>
            <ol className={`text-sm space-y-2 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              <li className="flex items-start gap-3">
                <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  isDark ? 'bg-sky-900/50 text-sky-400' : 'bg-sky-100 text-sky-600'
                }`}>1</span>
                <span>Download and install the app</span>
              </li>
              <li className="flex items-start gap-3">
                <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  isDark ? 'bg-sky-900/50 text-sky-400' : 'bg-sky-100 text-sky-600'
                }`}>2</span>
                <span>Open the app and paste your API token (above)</span>
              </li>
              <li className="flex items-start gap-3">
                <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  isDark ? 'bg-sky-900/50 text-sky-400' : 'bg-sky-100 text-sky-600'
                }`}>3</span>
                <span>Add your platform cookies (instructions in app)</span>
              </li>
              <li className="flex items-start gap-3">
                <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  isDark ? 'bg-sky-900/50 text-sky-400' : 'bg-sky-100 text-sky-600'
                }`}>4</span>
                <span>Click "Sync" - messages will appear here!</span>
              </li>
            </ol>
          </div>
        </div>

        {/* Supported Platforms */}
        <div className={`rounded-2xl p-6 ${
          isDark ? 'bg-slate-800 border border-slate-700' : 'bg-white shadow-lg'
        }`}>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isDark ? 'bg-emerald-900/30' : 'bg-emerald-100'
            }`}>
              <svg className={`w-5 h-5 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Platform Support
            </h2>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: '📱', name: 'Telegram', type: 'direct', label: 'Direct sync' },
              { icon: '🐦', name: 'Twitter/X', type: 'desktop', label: 'Desktop App' },
              { icon: '💼', name: 'LinkedIn', type: 'desktop', label: 'Desktop App' },
              { icon: '📷', name: 'Instagram', type: 'desktop', label: 'Desktop App' },
              { icon: '👥', name: 'Facebook', type: 'desktop', label: 'Desktop App' },
              { icon: '💬', name: 'WhatsApp', type: 'direct', label: 'QR Code' },
            ].map((platform) => (
              <div 
                key={platform.name}
                className={`p-4 rounded-xl border transition-all ${
                  isDark 
                    ? 'bg-slate-700/50 border-slate-600 hover:border-slate-500' 
                    : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">{platform.icon}</span>
                  <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {platform.name}
                  </span>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-lg font-medium ${
                  platform.type === 'direct'
                    ? isDark 
                      ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-800' 
                      : 'bg-emerald-100 text-emerald-700'
                    : isDark 
                      ? 'bg-sky-900/50 text-sky-400 border border-sky-800' 
                      : 'bg-sky-100 text-sky-700'
                }`}>
                  {platform.type === 'direct' ? '✓ ' : ''}{platform.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
