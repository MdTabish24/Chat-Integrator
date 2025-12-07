import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
}) => {
  const { isDark } = useTheme();
  
  const defaultIcon = (
    <svg
      className={`w-16 h-16 ${isDark ? 'text-gray-600' : 'text-gray-300'}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
      />
    </svg>
  );

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center animate-fade-in">
      {/* Icon Container */}
      <div className={`w-24 h-24 mb-6 rounded-3xl flex items-center justify-center shadow-inner ${isDark ? 'bg-gradient-to-br from-gray-800 to-gray-900' : 'bg-gradient-to-br from-gray-50 to-gray-100'}`}>
        {icon || defaultIcon}
      </div>
      
      {/* Title */}
      <h3 className={`text-xl font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>{title}</h3>
      
      {/* Description */}
      {description && (
        <p className={`mb-8 max-w-md leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{description}</p>
      )}
      
      {/* Action Button */}
      {action && (
        <button
          onClick={action.onClick}
          className="btn-professional btn-primary-3d px-8 py-3"
        >
          {action.label}
        </button>
      )}
    </div>
  );
};

export default EmptyState;
