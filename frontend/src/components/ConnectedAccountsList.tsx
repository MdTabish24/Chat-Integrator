import React from 'react';
import { ConnectedAccount, PlatformConfig } from '../types';

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
      <h2 className="text-xl font-semibold text-gray-900 mb-4">Connected Accounts</h2>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <ul className="divide-y divide-gray-200">
          {activeAccounts.map(account => {
            const platformConfig = getPlatformConfig(account.platform);
            
            return (
              <li key={account.id} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center flex-1">
                    {/* Platform Icon */}
                    {platformConfig && (
                      <div
                        className={`w-12 h-12 ${platformConfig.color} rounded-full flex items-center justify-center text-2xl mr-4`}
                      >
                        {platformConfig.icon}
                      </div>
                    )}

                    {/* Account Info */}
                    <div className="flex-1">
                      <h3 className="text-lg font-medium text-gray-900">
                        {platformConfig?.name || account.platform}
                      </h3>
                      <p className="text-sm text-gray-600">
                        @{account.platformUsername || account.platformUserId}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Connected on {formatDate(account.createdAt)}
                      </p>
                    </div>
                  </div>

                  {/* Disconnect Button */}
                  <button
                    onClick={() => onDisconnect(account)}
                    className="ml-4 px-4 py-2 border border-red-300 text-red-700 rounded hover:bg-red-50 transition-colors font-medium"
                  >
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
