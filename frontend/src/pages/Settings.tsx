import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';

const Settings: React.FC = () => {
  const navigate = useNavigate();
  const { showSuccess } = useToast();
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    // Get token from localStorage (saved as 'access_token' during login)
    const storedToken = localStorage.getItem('access_token') || '';
    setToken(storedToken);
  }, []);

  const copyToken = () => {
    navigator.clipboard.writeText(token);
    showSuccess('Token copied to clipboard!');
  };

  // Desktop app download URL
  const DESKTOP_APP_URL = 'https://github.com/MdTabish24/Chat-Integrator/releases/download/v1.0.0/ChatOrbitor.Twitter.Sync.Setup.1.0.0.exe';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <button
          onClick={() => navigate('/dashboard')}
          className="text-blue-600 hover:text-blue-800 mb-6 flex items-center"
        >
          ← Back to Dashboard
        </button>

        <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

        {/* API Token Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">🔑 API Token</h2>
          <p className="text-sm text-gray-600 mb-4">
            Use this token to connect the Desktop App to your Chat Orbitor account.
          </p>
          
          <div className="flex items-center gap-2 mb-4">
            <input
              type={showToken ? 'text' : 'password'}
              value={token}
              readOnly
              className="flex-1 px-3 py-2 border rounded-lg bg-gray-50 font-mono text-sm"
            />
            <button
              onClick={() => setShowToken(!showToken)}
              className="px-3 py-2 text-gray-600 hover:text-gray-800"
            >
              {showToken ? '🙈' : '👁️'}
            </button>
            <button
              onClick={copyToken}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Copy
            </button>
          </div>
          
          <p className="text-xs text-gray-500">
            ⚠️ Keep this token secret. Anyone with this token can access your messages.
          </p>
        </div>

        {/* Desktop App Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">💻 Desktop App</h2>
          <p className="text-sm text-gray-600 mb-4">
            Download the Desktop App to sync messages from platforms that block server access 
            (Twitter, LinkedIn, Instagram, Facebook).
          </p>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <h3 className="font-medium text-blue-900 mb-2">Why do I need this?</h3>
            <p className="text-sm text-blue-800">
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
              className="block w-full text-center px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 font-medium"
            >
              ⬇️ Download for Windows (.exe)
            </a>
            
            <p className="text-xs text-gray-500 text-center">
              macOS and Linux versions coming soon
            </p>
          </div>

          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <h4 className="font-medium text-sm mb-2">How to use:</h4>
            <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
              <li>Download and install the app</li>
              <li>Open the app and paste your API token (above)</li>
              <li>Add your platform cookies (instructions in app)</li>
              <li>Click "Sync" - messages will appear here!</li>
            </ol>
          </div>
        </div>

        {/* Supported Platforms */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">📱 Platform Support</h2>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 border rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <span>📱</span>
                <span className="font-medium">Telegram</span>
              </div>
              <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">✓ Direct sync</span>
            </div>
            
            <div className="p-3 border rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <span>🐦</span>
                <span className="font-medium">Twitter/X</span>
              </div>
              <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded">Desktop App</span>
            </div>
            
            <div className="p-3 border rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <span>💼</span>
                <span className="font-medium">LinkedIn</span>
              </div>
              <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded">Desktop App</span>
            </div>
            
            <div className="p-3 border rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <span>📷</span>
                <span className="font-medium">Instagram</span>
              </div>
              <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded">Desktop App</span>
            </div>
            
            <div className="p-3 border rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <span>👥</span>
                <span className="font-medium">Facebook</span>
              </div>
              <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded">Desktop App</span>
            </div>
            
            <div className="p-3 border rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <span>💬</span>
                <span className="font-medium">WhatsApp</span>
              </div>
              <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">✓ QR Code</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
