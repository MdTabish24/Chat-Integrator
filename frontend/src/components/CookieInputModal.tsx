import React, { useState } from 'react';

export interface CookieField {
  name: string;
  label: string;
  placeholder: string;
  helpText?: string;
}

interface CookieInputModalProps {
  platform: string;
  platformName: string;
  platformIcon: string;
  platformColor: string;
  fields: CookieField[];
  instructionsUrl?: string;
  onSubmit: (cookies: Record<string, string>) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
}

const CookieInputModal: React.FC<CookieInputModalProps> = ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  platform,
  platformName,
  platformIcon,
  platformColor,
  fields,
  instructionsUrl,
  onSubmit,
  onCancel,
  isSubmitting = false,
}) => {
  const [cookieValues, setCookieValues] = useState<Record<string, string>>(
    fields.reduce((acc, field) => ({ ...acc, [field.name]: '' }), {})
  );
  const [consentChecked, setConsentChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (fieldName: string, value: string) => {
    setCookieValues(prev => ({ ...prev, [fieldName]: value }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate all fields are filled
    const emptyFields = fields.filter(field => !cookieValues[field.name]?.trim());
    if (emptyFields.length > 0) {
      setError(`Please fill in all required fields: ${emptyFields.map(f => f.label).join(', ')}`);
      return;
    }

    if (!consentChecked) {
      setError('Please acknowledge the consent checkbox to continue');
      return;
    }

    try {
      await onSubmit(cookieValues);
    } catch (err: any) {
      setError(err.message || 'Failed to connect account');
    }
  };


  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center mb-6">
          <div className={`w-12 h-12 ${platformColor} rounded-full flex items-center justify-center text-2xl mr-4`}>
            {platformIcon}
          </div>
          <div>
            <h3 className="text-xl font-semibold text-gray-900">
              Connect {platformName}
            </h3>
            <p className="text-sm text-gray-500">
              Enter your browser cookies to connect
            </p>
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-yellow-600 mt-0.5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div className="text-sm text-yellow-800">
              <p className="font-medium mb-1">How to get your cookies:</p>
              <ol className="list-decimal list-inside space-y-1 text-yellow-700">
                <li>Log in to {platformName} in your browser</li>
                <li>Open Developer Tools (F12)</li>
                <li>Go to Application → Cookies</li>
                <li>Copy the required cookie values</li>
              </ol>
              {instructionsUrl && (
                <a
                  href={instructionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-yellow-600 hover:text-yellow-800 underline mt-2 inline-block"
                >
                  View detailed instructions →
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {/* Cookie Fields */}
          <div className="space-y-4 mb-6">
            {fields.map(field => (
              <div key={field.name}>
                <label htmlFor={field.name} className="block text-sm font-medium text-gray-700 mb-1">
                  {field.label} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id={field.name}
                  value={cookieValues[field.name]}
                  onChange={(e) => handleInputChange(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={isSubmitting}
                />
                {field.helpText && (
                  <p className="mt-1 text-xs text-gray-500">{field.helpText}</p>
                )}
              </div>
            ))}
          </div>

          {/* Consent Checkbox */}
          <div className="mb-6">
            <label className="flex items-start cursor-pointer">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                disabled={isSubmitting}
              />
              <span className="ml-2 text-sm text-gray-600">
                I understand that my cookies will be stored securely and used only to access my {platformName} messages. 
                I acknowledge that using unofficial APIs may violate {platformName}'s terms of service.
              </span>
            </label>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Buttons */}
          <div className="flex space-x-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors font-medium disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`flex-1 px-4 py-2 rounded transition-colors font-medium text-white ${
                isSubmitting
                  ? 'bg-blue-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Connecting...
                </span>
              ) : (
                'Connect'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CookieInputModal;
