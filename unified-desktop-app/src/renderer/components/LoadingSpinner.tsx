import React from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ size = 'md', className = '' }) => {
  const sizeClasses = {
    sm: 'w-5 h-5 border-2',
    md: 'w-8 h-8 border-2',
    lg: 'w-12 h-12 border-3',
  };

  return (
    <div className={`flex items-center justify-center min-h-screen dashboard-bg ${className}`}>
      <div className="flex flex-col items-center gap-4">
        <div
          className={`${sizeClasses[size]} border-primary-500 border-t-transparent rounded-full animate-spin`}
        />
        <p className="text-[var(--text-muted)] text-sm">Loading...</p>
      </div>
    </div>
  );
};

export default LoadingSpinner;
