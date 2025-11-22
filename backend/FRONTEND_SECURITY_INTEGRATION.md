# Frontend Security Integration Guide

This guide explains how the frontend should integrate with the new security features.

## CSRF Protection

### Overview

The backend now requires CSRF tokens for all state-changing requests (POST, PUT, PATCH, DELETE).

### Implementation Steps

1. **Fetch CSRF Token on App Load:**

```typescript
// On app initialization or login
const fetchCsrfToken = async (): Promise<string> => {
  const response = await fetch('/api/csrf-token', {
    credentials: 'include', // Important: Include cookies
  });
  const data = await response.json();
  return data.csrfToken;
};

// Store token in app state or context
const csrfToken = await fetchCsrfToken();
```

2. **Include Token in All State-Changing Requests:**

```typescript
// Example: Sending a message
const sendMessage = async (conversationId: string, content: string) => {
  const response = await fetch(`/api/messages/${conversationId}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken, // Include CSRF token
    },
    credentials: 'include', // Include cookies
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    throw new Error('Failed to send message');
  }

  return response.json();
};
```

3. **Handle CSRF Errors:**

```typescript
// If you get a 403 CSRF error, refresh the token
if (response.status === 403) {
  const errorData = await response.json();
  if (errorData.error.code === 'CSRF_TOKEN_INVALID' || 
      errorData.error.code === 'CSRF_TOKEN_MISSING') {
    // Refresh CSRF token
    csrfToken = await fetchCsrfToken();
    // Retry the request
  }
}
```

### React Example with Context

```typescript
// CSRFContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';

interface CSRFContextType {
  csrfToken: string | null;
  refreshToken: () => Promise<void>;
}

const CSRFContext = createContext<CSRFContextType | undefined>(undefined);

export const CSRFProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [csrfToken, setCsrfToken] = useState<string | null>(null);

  const refreshToken = async () => {
    try {
      const response = await fetch('/api/csrf-token', {
        credentials: 'include',
      });
      const data = await response.json();
      setCsrfToken(data.csrfToken);
    } catch (error) {
      console.error('Failed to fetch CSRF token:', error);
    }
  };

  useEffect(() => {
    refreshToken();
  }, []);

  return (
    <CSRFContext.Provider value={{ csrfToken, refreshToken }}>
      {children}
    </CSRFContext.Provider>
  );
};

export const useCSRF = () => {
  const context = useContext(CSRFContext);
  if (!context) {
    throw new Error('useCSRF must be used within CSRFProvider');
  }
  return context;
};
```

### Axios Interceptor Example

```typescript
import axios from 'axios';

let csrfToken: string | null = null;

// Fetch CSRF token
const fetchCsrfToken = async () => {
  const response = await axios.get('/api/csrf-token', {
    withCredentials: true,
  });
  csrfToken = response.data.csrfToken;
  return csrfToken;
};

// Initialize token
fetchCsrfToken();

// Add request interceptor
axios.interceptors.request.use(
  (config) => {
    // Add CSRF token to state-changing requests
    if (['post', 'put', 'patch', 'delete'].includes(config.method?.toLowerCase() || '')) {
      config.headers['X-CSRF-Token'] = csrfToken;
    }
    config.withCredentials = true;
    return config;
  },
  (error) => Promise.reject(error)
);

// Add response interceptor to handle CSRF errors
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 403 && 
        error.response?.data?.error?.code?.includes('CSRF')) {
      // Refresh token and retry
      await fetchCsrfToken();
      error.config.headers['X-CSRF-Token'] = csrfToken;
      return axios.request(error.config);
    }
    return Promise.reject(error);
  }
);
```

## CORS Configuration

### Important Notes

1. **Credentials Must Be Included:**
   - Always use `credentials: 'include'` in fetch requests
   - Or `withCredentials: true` in Axios

2. **Frontend URL Must Match:**
   - The backend expects requests from `FRONTEND_URL` environment variable
   - Default: `http://localhost:5173` (development)
   - Production: Set to your actual frontend domain

## XSS Protection

### What's Handled by Backend

The backend automatically sanitizes:
- All request body content
- All query parameters
- All URL parameters
- Message content (with basic formatting preserved)

### What Frontend Should Do

1. **Display User Content Safely:**
   - Use React's default escaping (don't use `dangerouslySetInnerHTML`)
   - If you need to display formatted messages, use a safe HTML renderer

2. **Example - Safe Message Display:**

```typescript
// ✅ SAFE - React automatically escapes
const MessageBubble = ({ content }: { content: string }) => {
  return <div className="message">{content}</div>;
};

// ⚠️ USE WITH CAUTION - Only if backend allows HTML formatting
import DOMPurify from 'dompurify';

const FormattedMessage = ({ content }: { content: string }) => {
  const sanitized = DOMPurify.sanitize(content, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'u', 'br', 'p'],
    ALLOWED_ATTR: [],
  });
  
  return <div dangerouslySetInnerHTML={{ __html: sanitized }} />;
};
```

## Input Validation

### What's Validated by Backend

The backend validates:
- Message content (1-10000 characters)
- UUIDs for IDs
- Platform names (enum)
- Pagination parameters
- Email format
- Date formats (ISO 8601)

### Frontend Validation

You should still validate on the frontend for better UX:

```typescript
// Example: Message validation
const validateMessage = (content: string): string | null => {
  if (!content || content.trim().length === 0) {
    return 'Message cannot be empty';
  }
  if (content.length > 10000) {
    return 'Message is too long (max 10000 characters)';
  }
  return null;
};

// Use in form
const handleSubmit = async (content: string) => {
  const error = validateMessage(content);
  if (error) {
    setError(error);
    return;
  }
  
  try {
    await sendMessage(conversationId, content);
  } catch (err) {
    // Handle backend validation errors
    if (err.response?.data?.error?.code === 'VALIDATION_ERROR') {
      setError(err.response.data.error.message);
    }
  }
};
```

## HTTPS in Production

### Development

- HTTP is allowed in development
- No special configuration needed

### Production

- All HTTP requests are automatically redirected to HTTPS
- Ensure your frontend is also served over HTTPS
- Use secure WebSocket connections (wss://)

## Error Handling

### Common Security-Related Errors

```typescript
interface SecurityError {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: any;
  };
}

// Handle security errors
const handleSecurityError = (error: SecurityError) => {
  switch (error.error.code) {
    case 'CSRF_TOKEN_MISSING':
    case 'CSRF_TOKEN_INVALID':
      // Refresh CSRF token and retry
      return 'Security token expired. Please try again.';
      
    case 'VALIDATION_ERROR':
      // Show validation errors to user
      return error.error.message;
      
    case 'UNAUTHORIZED':
      // Redirect to login
      return 'Please log in to continue.';
      
    default:
      return 'An error occurred. Please try again.';
  }
};
```

## WebSocket Security

### Connection with Authentication

```typescript
import io from 'socket.io-client';

// Include credentials for cookie-based auth
const socket = io('http://localhost:3000', {
  withCredentials: true,
  auth: {
    token: jwtToken, // If using token-based auth
  },
});

// Handle connection errors
socket.on('connect_error', (error) => {
  console.error('WebSocket connection error:', error);
  // Refresh authentication if needed
});
```

## Testing Security Integration

### Manual Tests

1. **Test CSRF Protection:**
   - Try making a POST request without CSRF token (should fail)
   - Try with invalid token (should fail)
   - Try with valid token (should succeed)

2. **Test XSS Protection:**
   - Try sending message with `<script>alert('XSS')</script>`
   - Verify script is removed but text remains

3. **Test Input Validation:**
   - Try sending empty message (should fail)
   - Try sending message > 10000 chars (should fail)
   - Try invalid UUID (should fail)

### Automated Tests

```typescript
// Example: Test CSRF protection
describe('CSRF Protection', () => {
  it('should reject requests without CSRF token', async () => {
    const response = await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'test' }),
    });
    
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error.code).toBe('CSRF_TOKEN_MISSING');
  });
  
  it('should accept requests with valid CSRF token', async () => {
    const csrfToken = await fetchCsrfToken();
    
    const response = await fetch('/api/messages/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      credentials: 'include',
      body: JSON.stringify({ content: 'test' }),
    });
    
    expect(response.ok).toBe(true);
  });
});
```

## Checklist for Frontend Integration

- [ ] Fetch CSRF token on app initialization
- [ ] Include CSRF token in all state-changing requests
- [ ] Include `credentials: 'include'` in all API requests
- [ ] Handle CSRF token refresh on 403 errors
- [ ] Implement proper error handling for security errors
- [ ] Use secure WebSocket connections (wss://) in production
- [ ] Validate user input on frontend for better UX
- [ ] Display user content safely (avoid dangerouslySetInnerHTML)
- [ ] Test security features in development
- [ ] Verify HTTPS works correctly in production

## Support

If you encounter any issues with security integration:

1. Check browser console for CORS errors
2. Verify CSRF token is being sent in headers
3. Ensure cookies are being sent with requests
4. Check backend logs for security-related errors
5. Refer to `backend/src/middleware/SECURITY.md` for detailed documentation
