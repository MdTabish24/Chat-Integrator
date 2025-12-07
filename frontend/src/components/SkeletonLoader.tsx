import React from 'react';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular' | 'rounded';
  width?: string | number;
  height?: string | number;
  animation?: 'pulse' | 'wave' | 'none';
}

const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  variant = 'rectangular',
  width,
  height,
  animation = 'wave',
}) => {
  const baseClasses = 'bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%]';
  
  const variantClasses = {
    text: 'rounded',
    circular: 'rounded-full',
    rectangular: 'rounded-lg',
    rounded: 'rounded-xl',
  };

  const animationClasses = {
    pulse: 'animate-pulse',
    wave: 'animate-skeleton',
    none: '',
  };

  const style: React.CSSProperties = {
    width: width || '100%',
    height: height || '1rem',
  };

  return (
    <div
      className={`${baseClasses} ${variantClasses[variant]} ${animationClasses[animation]} ${className}`}
      style={style}
    />
  );
};

// Pre-built skeleton patterns
export const ConversationSkeleton: React.FC = () => (
  <div className="p-4 animate-fade-in">
    {[1, 2, 3, 4, 5].map((i) => (
      <div key={i} className="flex items-center space-x-3 mb-4 last:mb-0">
        <Skeleton variant="circular" width={40} height={40} />
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" width="60%" height={14} />
          <Skeleton variant="text" width="40%" height={12} />
        </div>
        <Skeleton variant="text" width={40} height={12} />
      </div>
    ))}
  </div>
);

export const MessageSkeleton: React.FC = () => (
  <div className="p-4 space-y-4 animate-fade-in">
    {[1, 2, 3, 4, 5, 6].map((i) => (
      <div
        key={i}
        className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}
      >
        <div className={`max-w-[70%] space-y-2 ${i % 2 === 0 ? 'items-end' : 'items-start'} flex flex-col`}>
          <Skeleton
            variant="rounded"
            width={i % 3 === 0 ? '200px' : i % 3 === 1 ? '280px' : '160px'}
            height={i % 2 === 0 ? 48 : 64}
          />
          <Skeleton variant="text" width={60} height={10} />
        </div>
      </div>
    ))}
  </div>
);

export const PlatformCardSkeleton: React.FC = () => (
  <div className="card-3d p-6 animate-fade-in">
    <div className="flex flex-col items-center">
      <Skeleton variant="rounded" width={64} height={64} className="mb-4" />
      <Skeleton variant="text" width="70%" height={20} className="mb-2" />
      <Skeleton variant="text" width="50%" height={14} className="mb-4" />
      <Skeleton variant="rounded" width="100%" height={40} />
    </div>
  </div>
);

export const AccountCardSkeleton: React.FC = () => (
  <div className="card-3d p-4 animate-fade-in">
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-4">
        <Skeleton variant="rounded" width={48} height={48} />
        <div className="space-y-2">
          <Skeleton variant="text" width={120} height={16} />
          <Skeleton variant="text" width={80} height={12} />
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <Skeleton variant="rounded" width={80} height={28} />
        <Skeleton variant="circular" width={32} height={32} />
      </div>
    </div>
  </div>
);

export const DashboardSkeleton: React.FC = () => (
  <div className="flex h-screen bg-gradient-to-br from-gray-50 to-gray-100">
    {/* Sidebar Skeleton */}
    <div className="w-80 bg-white border-r border-gray-200 p-4">
      <div className="mb-6">
        <Skeleton variant="text" width="60%" height={24} className="mb-2" />
        <Skeleton variant="text" width="40%" height={14} />
      </div>
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center space-x-3 p-3 rounded-xl bg-gray-50">
            <Skeleton variant="circular" width={44} height={44} />
            <div className="flex-1 space-y-2">
              <Skeleton variant="text" width="80%" height={16} />
              <Skeleton variant="text" width="50%" height={12} />
            </div>
          </div>
        ))}
      </div>
    </div>
    
    {/* Main Content Skeleton */}
    <div className="flex-1 flex flex-col">
      {/* Chat Header */}
      <div className="p-4 border-b border-gray-200 bg-white">
        <div className="flex items-center space-x-3">
          <Skeleton variant="circular" width={44} height={44} />
          <div className="space-y-2">
            <Skeleton variant="text" width={150} height={18} />
            <Skeleton variant="text" width={80} height={12} />
          </div>
        </div>
      </div>
      
      {/* Messages Area */}
      <div className="flex-1 p-4 bg-gray-50">
        <MessageSkeleton />
      </div>
      
      {/* Input Area */}
      <div className="p-4 bg-white border-t border-gray-200">
        <Skeleton variant="rounded" width="100%" height={48} />
      </div>
    </div>
  </div>
);

export const TableSkeleton: React.FC<{ rows?: number; columns?: number }> = ({ 
  rows = 5, 
  columns = 4 
}) => (
  <div className="card-3d overflow-hidden">
    {/* Header */}
    <div className="grid gap-4 p-4 bg-gray-50 border-b border-gray-100" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} variant="text" height={16} />
      ))}
    </div>
    {/* Rows */}
    {Array.from({ length: rows }).map((_, rowIndex) => (
      <div 
        key={rowIndex} 
        className="grid gap-4 p-4 border-b border-gray-50 last:border-0"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
      >
        {Array.from({ length: columns }).map((_, colIndex) => (
          <Skeleton key={colIndex} variant="text" height={14} width={colIndex === 0 ? '80%' : '60%'} />
        ))}
      </div>
    ))}
  </div>
);

export const FormSkeleton: React.FC = () => (
  <div className="form-card max-w-md mx-auto animate-fade-in">
    <div className="text-center mb-8">
      <Skeleton variant="text" width="60%" height={32} className="mx-auto mb-2" />
      <Skeleton variant="text" width="80%" height={16} className="mx-auto" />
    </div>
    <div className="space-y-6">
      <div>
        <Skeleton variant="text" width={80} height={14} className="mb-2" />
        <Skeleton variant="rounded" width="100%" height={48} />
      </div>
      <div>
        <Skeleton variant="text" width={80} height={14} className="mb-2" />
        <Skeleton variant="rounded" width="100%" height={48} />
      </div>
      <Skeleton variant="rounded" width="100%" height={48} />
    </div>
  </div>
);

export const PageSkeleton: React.FC = () => (
  <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-8">
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <Skeleton variant="text" width={150} height={20} className="mb-4" />
        <Skeleton variant="text" width="40%" height={32} className="mb-2" />
        <Skeleton variant="text" width="60%" height={16} />
      </div>
      
      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <PlatformCardSkeleton key={i} />
        ))}
      </div>
    </div>
  </div>
);

export default Skeleton;
