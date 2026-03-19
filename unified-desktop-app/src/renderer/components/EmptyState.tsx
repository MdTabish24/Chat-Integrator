import React from 'react';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => {
  return (
    <div className="flex flex-col items-center justify-center text-center p-8 max-w-md">
      <div className="mb-4">{icon}</div>
      <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-2">{title}</h3>
      <p className="text-[var(--text-muted)] mb-6">{description}</p>
      {action && (
        <button onClick={action.onClick} className="btn-primary-3d btn-professional">
          {action.label}
        </button>
      )}
    </div>
  );
};

export default EmptyState;
