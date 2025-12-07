import React from 'react';
import { ConnectedAccount, PlatformConfig } from '../types';
import { useTheme } from '../contexts/ThemeContext';

interface ConnectedAccountsListProps {
  accounts: ConnectedAccount[];
  platformConfigs: PlatformConfig[];
  onDisconnect: (account: ConnectedAccount) => void;
}

const ConnectedAccountsList: React.FC<ConnectedAccountsListProps> = ({
  accounts,
  platformConfigs,
  onDisconnect,
}) => {
  const { isDark } = useTheme();
  
  const getPlatformConfig = (platformId: string): PlatformConfig | undefined => {
    return platformConfigs.find(p => p.id === platformId);
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const activeAccounts = accounts.filter(acc => acc.isActive);

  if (activeAccounts.length === 0) {
    return null;
  }

  return (
    <div>
      <h2 className={`text-xl font-bold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
        Connected Accounts
      </h2>
      <div className={`rounded-2xl overflow-hidden ${
        isDark ? 'bg-slate-800 border border-slate-700' : 'bg-white shadow-lg'
      }`}>
        <ul className={`divide-y ${isDark ? 'divide-slate-700' : 'divide-gray-100'}`}>
          {activeAccounts.map(account => {
            const platformConfig = getPlatformConfig(account.platform);
            
            return (
              <li 
                key={account.id} 
                className={`p-5 transition-colors ${
                  isDark ? 'hover:bg-slate-700/50' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center flex-1 gap-4">
                    {/* Platform Icon */}
                    {platformConfig && (
                      <div
                        className={`w-14 h-14 ${platformConfig.color} rounded-xl flex items-center justify-center text-2xl shadow-lg`}
                        style={{
                          boxShadow: `0 4px 14px -3px ${
                            platformConfig.color.includes('blue') ? 'rgba(59, 130, 246, 0.4)' :
                            platformConfig.color.includes('sky') ? 'rgba(14, 165, 233, 0.4)' :
                            platformConfig.color.includes('green') ? 'rgba(34, 197, 94, 0.4)' :
                            platformConfig.color.includes('pink') ? 'rgba(236, 72, 153, 0.4)' :
                            platformConfig.color.includes('purple') ? 'rgba(168, 85, 247, 0.4)' :
                            platformConfig.color.includes('indigo') ? 'rgba(99, 102, 241, 0.4)' :
                            platformConfig.color.includes('red') ? 'rgba(239, 68, 68, 0.4)' :
                            'rgba(0, 0, 0, 0.2)'
                          }`
                        }}
                      >
                        {platformConfig.icon}
                      </div>
                    )}

                    {/* Account Info */}
                    <div className="flex-1">
                      <h3 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {platformConfig?.name || account.platform}
                      </h3>
                      <p className={`text-sm font-medium ${isDark ? 'text-sky-400' : 'text-sky-600'}`}>
                        @{account.platformUsername || account.platformUserId}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          Connected on {formatDate(account.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Disconnect Button */}
                  <button
                    onClick={() => onDisconnect(account)}
                    className={`ml-4 px-5 py-2.5 rounded-xl font-medium transition-all duration-200 flex items-center gap-2 ${
                      isDark 
                        ? 'bg-red-900/30 text-red-400 border border-red-800 hover:bg-red-900/50' 
                        : 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Disconnect
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default ConnectedAccountsList;
