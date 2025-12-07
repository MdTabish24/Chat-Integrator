import React from 'react';
import { DashboardSkeleton, FormSkeleton, PageSkeleton } from './SkeletonLoader';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  color?: 'primary' | 'white' | 'gray';
  text?: string;
  fullScreen?: boolean;
  variant?: 'spinner' | 'skeleton-dashboard' | 'skeleton-form' | 'skeleton-page';
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  color = 'primary',
  text,
  fullScreen = false,
  variant = 'spinner',
}) => {
  // Return skeleton variants
  if (variant === 'skeleton-dashboard') {
    return <DashboardSkeleton />;
  }
  
  if (variant === 'skeleton-form') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <FormSkeleton />
      </div>
    );
  }
  
  if (variant === 'skeleton-page') {
    return <PageSkeleton />;
  }

  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
    xl: 'h-16 w-16',
  };

  const colorClasses = {
    primary: 'text-indigo-600',
    white: 'text-white',
    gray: 'text-gray-500',
  };

  const spinner = (
    <div className="relative">
      {/* Outer ring */}
      <div className={`${sizeClasses[size]} rounded-full border-[3px] border-gray-200`}></div>
      {/* Spinning arc */}
      <div 
        className={`absolute top-0 left-0 ${sizeClasses[size]} rounded-full border-[3px] border-transparent animate-spin`}
        style={{
          borderTopColor: color === 'primary' ? '#6366f1' : color === 'white' ? '#ffffff' : '#6b7280',
        }}
      ></div>
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center z-50">
        <div className="card-3d p-8 flex flex-col items-center">
          {spinner}
          {text && (
            <p className="mt-4 text-gray-600 font-medium text-sm">{text}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center">
      {spinner}
      {text && <p className="mt-3 text-gray-600 text-sm font-medium">{text}</p>}
    </div>
  );
};

export default LoadingSpinner;
