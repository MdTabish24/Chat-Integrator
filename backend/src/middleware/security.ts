import helmet from 'helmet';

/**
 * Security Headers Middleware
 * 
 * Configures Helmet to set various HTTP security headers
 */

/**
 * Get Helmet configuration based on environment
 */
export const getHelmetConfig = () => {

  return helmet({
    // Content Security Policy
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    // Strict Transport Security (HTTPS enforcement)
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    // Prevent clickjacking
    frameguard: {
      action: 'deny',
    },
    // Prevent MIME type sniffing
    noSniff: true,
    // XSS Protection
    xssFilter: true,
    // Hide X-Powered-By header
    hidePoweredBy: true,
  });
};
