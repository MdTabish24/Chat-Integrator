# Security Enhancements

This document describes the security measures implemented in the Multi-Platform Messaging Hub.

## Overview

The application implements multiple layers of security to protect against common web vulnerabilities:

1. **CSRF Protection** - Prevents Cross-Site Request Forgery attacks
2. **XSS Sanitization** - Prevents Cross-Site Scripting attacks
3. **SQL Injection Prevention** - Uses parameterized queries
4. **Input Validation** - Validates all user inputs with Joi schemas
5. **HTTPS Enforcement** - Redirects HTTP to HTTPS in production
6. **Security Headers** - Sets secure HTTP headers with Helmet

## CSRF Protection

### Implementation

The application uses the **Double Submit Cookie** pattern for CSRF protection:

1. Server generates a random token and sends it as an HTTP-only cookie
2. Client must include the same token in the `X-CSRF-Token` header
3. Server verifies both tokens match using constant-time comparison

### Usage

**Backend:**
- CSRF tokens are automatically set for all requests via `setCsrfToken` middleware
- CSRF verification is applied to all state-changing routes (POST, PUT, PATCH, DELETE)
- Webhook endpoints are excluded from CSRF checks (they use signature verification)

**Frontend:**
```typescript
// Get CSRF token
const response = await fetch('/api/csrf-token', { credentials: 'include' });
const { csrfToken } = await response.json();

// Include token in requests
await fetch('/api/messages/send', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken,
  },
  credentials: 'include',
  body: JSON.stringify({ content: 'Hello' }),
});
```

### Configuration

- Cookie name: `csrf-token`
- Header name: `x-csrf-token`
- Cookie settings:
  - `httpOnly: true` - Prevents JavaScript access
  - `secure: true` (production) - HTTPS only
  - `sameSite: 'strict'` - Prevents cross-site requests
  - `maxAge: 24 hours`

## XSS Sanitization

### Implementation

Uses **DOMPurify** to sanitize all user input and prevent XSS attacks.

### Sanitization Levels

1. **General Input** (`sanitizeInput` middleware):
   - Removes all HTML tags and attributes
   - Applied to all request bodies, query params, and URL params
   - Keeps text content only

2. **Message Content** (`sanitizeMessageInput` middleware):
   - Allows basic formatting tags: `<b>`, `<i>`, `<em>`, `<strong>`, `<u>`, `<br>`, `<p>`
   - Removes scripts and dangerous tags
   - Applied specifically to message content

### Usage

```typescript
// Automatically applied via middleware
app.use(sanitizeInput); // General sanitization

// Message-specific sanitization
router.post('/send', sanitizeMessageInput, sendMessage);
```

## SQL Injection Prevention

### Implementation

All database queries use **parameterized queries** with PostgreSQL's native parameter binding.

### Examples

```typescript
// ✅ SAFE - Parameterized query
await pool.query('SELECT * FROM users WHERE email = $1', [email]);

// ❌ UNSAFE - String concatenation (never do this)
await pool.query(`SELECT * FROM users WHERE email = '${email}'`);
```

### Query Helpers

The application provides safe query helpers in `db/queryHelpers.ts`:

- `query(text, params)` - Execute parameterized query
- `queryOne(text, params)` - Get single row
- `queryMany(text, params)` - Get multiple rows
- `insertOne(table, data)` - Safe insert
- `updateById(table, id, data)` - Safe update
- `deleteById(table, id)` - Safe delete

## Input Validation

### Implementation

Uses **Joi** schemas to validate all user inputs before processing.

### Validation Schemas

Located in `middleware/validation.ts`:

- `messageSchemas` - Message-related validations
- `oauthSchemas` - OAuth-related validations
- `conversationSchemas` - Conversation-related validations
- `commonSchemas` - Reusable validation patterns

### Usage

```typescript
import { validate, messageSchemas } from '../middleware/validation';

router.post(
  '/send',
  validate(messageSchemas.sendMessage, 'body'),
  sendMessage
);
```

### Validation Features

- Type checking (string, number, date, UUID, etc.)
- Length constraints (min/max)
- Format validation (email, ISO dates, etc.)
- Enum validation (platform names)
- Automatic stripping of unknown fields
- Detailed error messages

## HTTPS Enforcement

### Implementation

The `httpsRedirect` middleware redirects all HTTP requests to HTTPS in production.

### Configuration

- Only active when `NODE_ENV=production`
- Checks for HTTPS via:
  - `req.secure`
  - `X-Forwarded-Proto` header (for proxies)
  - `X-Forwarded-SSL` header
- Returns 301 permanent redirect

### Usage

```typescript
// Applied globally in index.ts
app.use(httpsRedirect);
```

## Security Headers

### Implementation

Uses **Helmet** to set secure HTTP headers.

### Headers Set

1. **Content-Security-Policy** - Prevents XSS and data injection
2. **Strict-Transport-Security** - Enforces HTTPS (1 year)
3. **X-Frame-Options** - Prevents clickjacking (DENY)
4. **X-Content-Type-Options** - Prevents MIME sniffing
5. **X-XSS-Protection** - Enables browser XSS filter
6. **X-Powered-By** - Hidden (doesn't reveal Express)

### Configuration

Located in `middleware/security.ts`:

```typescript
app.use(getHelmetConfig());
```

## Additional Security Measures

### Rate Limiting

- 100 requests per minute per user (API routes)
- Platform-specific rate limits for external APIs
- Implemented with Redis

### Authentication

- JWT tokens with 15-minute expiry
- Refresh tokens with 7-day expiry
- Secure token storage in HTTP-only cookies

### Encryption

- AES-256 encryption for sensitive data at rest
- OAuth tokens encrypted in database
- Message content encrypted in database
- TLS 1.3 for data in transit

### CORS Configuration

- Restricted to frontend origin only
- Credentials enabled for cookie support
- No wildcard origins in production

## Security Checklist

- [x] CSRF protection implemented
- [x] XSS sanitization implemented
- [x] SQL injection prevention verified
- [x] Input validation with Joi schemas
- [x] HTTPS enforcement configured
- [x] Security headers set with Helmet
- [x] Rate limiting enabled
- [x] Authentication with JWT
- [x] Data encryption at rest
- [x] Secure cookie configuration
- [x] CORS properly configured
- [x] Error messages don't leak sensitive info

## Testing Security

### Manual Testing

1. **CSRF Protection:**
   ```bash
   # Should fail without CSRF token
   curl -X POST http://localhost:3000/api/messages/send \
     -H "Content-Type: application/json" \
     -d '{"content":"test"}'
   ```

2. **XSS Sanitization:**
   ```bash
   # Script tags should be removed
   curl -X POST http://localhost:3000/api/messages/send \
     -H "Content-Type: application/json" \
     -H "X-CSRF-Token: <token>" \
     -d '{"content":"<script>alert(1)</script>Hello"}'
   ```

3. **Input Validation:**
   ```bash
   # Should fail validation
   curl -X POST http://localhost:3000/api/messages/send \
     -H "Content-Type: application/json" \
     -H "X-CSRF-Token: <token>" \
     -d '{"content":""}'
   ```

### Automated Testing

Security tests should be added to verify:
- CSRF token validation
- XSS sanitization effectiveness
- SQL injection prevention
- Input validation rules
- HTTPS redirect behavior
- Security headers presence

## Production Deployment

### Environment Variables

Ensure these are set in production:

```bash
NODE_ENV=production
JWT_SECRET=<strong-random-secret>
JWT_REFRESH_SECRET=<strong-random-secret>
ENCRYPTION_KEY=<32-character-key>
FRONTEND_URL=https://your-domain.com
```

### SSL/TLS Configuration

- Use Let's Encrypt or similar for SSL certificates
- Configure Nginx or load balancer for TLS termination
- Enable HTTP/2 for better performance
- Set up automatic certificate renewal

### Monitoring

- Monitor failed authentication attempts
- Track rate limit violations
- Log security-related errors
- Set up alerts for suspicious activity

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
