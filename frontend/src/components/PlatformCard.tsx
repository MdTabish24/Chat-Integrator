import React from 'react';
import { PlatformConfig } from '../types';

interface PlatformCardProps {
  platform: PlatformConfig;
  isConnected: boolean;
  isConnecting: boolean;
  onConnect: () => void;
}

const PlatformCard: React.FC<PlatformCardProps> = ({
  platform,
  isConnected,
  isConnecting,
  onConnect,
}) => {
  return (
    <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
      <div className="flex flex-col items-center">
        {/* Platform Icon */}
        <div className={`w-16 h-16 ${platform.color} rounded-full flex items-center justify-center text-3xl mb-4`}>
          {platform.icon}
        </div>

        {/* Platform Name */}
        <h3 className="text-lg font-semibold text-gray-900 mb-2 text-center">
          {platform.name}
        </h3>

        {/* Connection Status */}
        {isConnected ? (
          <div className="flex items-center text-green-600 mb-4">
            <svg
              className="w-5 h-5 mr-1"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-sm font-medium">Connected</span>
          </div>
        ) : (
          <button
            onClick={onConnect}
            disabled={isConnecting}
            className={`w-full py-2 px-4 rounded font-medium transition-colors ${
              isConnecting
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {isConnecting ? (
              <span className="flex items-center justify-center">
                <svg
                  className="animate-spin h-4 w-4 mr-2"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Connecting...
              </span>
            ) : (
              'Connect'
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default PlatformCard;
