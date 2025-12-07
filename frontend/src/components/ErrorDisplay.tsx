import React from 'react';

interface ErrorDisplayProps {
  message: string;
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
  fullScreen?: boolean;
}

const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
  message,
  title = 'Something went wrong',
  onRetry,
  retryLabel = 'Try Again',
  fullScreen = false,
}) => {
  const content = (
    <div className="card-3d p-8 max-w-md w-full mx-auto animate-fade-in">
      <div className="flex flex-col items-center text-center">
        {/* Error Icon */}
        <div className="w-16 h-16 mb-6 bg-gradient-to-br from-red-50 to-red-100 rounded-2xl flex items-center justify-center">
          <svg
            className="w-8 h-8 text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        
        {/* Title */}
        <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
        
        {/* Error Message */}
        <div className="p-4 bg-red-50 border border-red-100 rounded-xl mb-6 w-full">
          <p className="text-sm text-red-600">{message}</p>
        </div>
        
        {/* Retry Button */}
        {onRetry && (
          <button
            onClick={onRetry}
            className="btn-professional btn-primary-3d px-6"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-slate-50 to-gray-100 flex items-center justify-center z-50 p-4">
        {content}
      </div>
    );
  }

  return <div className="py-12 px-4">{content}</div>;
};

export default ErrorDisplay;
