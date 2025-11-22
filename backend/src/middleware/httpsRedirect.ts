import { Request, Response, NextFunction } from 'express';

/**
 * HTTPS Redirect Middleware
 * 
 * Redirects HTTP requests to HTTPS in production
 */

export const httpsRedirect = (req: Request, res: Response, next: NextFunction): void => {
  // Only enforce HTTPS in production
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }

  // Check if request is already HTTPS
  const isHttps = req.secure || 
                  req.headers['x-forwarded-proto'] === 'https' ||
                  req.headers['x-forwarded-ssl'] === 'on';

  if (!isHttps) {
    // Redirect to HTTPS
    const httpsUrl = `https://${req.headers.host}${req.url}`;
    return res.redirect(301, httpsUrl);
  }

  next();
};
