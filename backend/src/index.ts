import express, { Application } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { errorHandler } from './middleware/errorHandler';
import { getHelmetConfig } from './middleware/security';
import { httpsRedirect } from './middleware/httpsRedirect';
import { sanitizeInput } from './middleware/xssSanitizer';
import { setCsrfToken, verifyCsrfToken, getCsrfToken } from './middleware/csrf';
import pool from './config/database';
import { connectRedis } from './config/redis';
import { websocketService } from './services/websocketService';

dotenv.config();

const app: Application = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3000;

// Security middleware (must be first)
app.use(httpsRedirect);
app.use(getHelmetConfig());

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://chatintegrator.onrender.com']
    : ['http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// XSS sanitization (after body parsing)
app.use(sanitizeInput);

// CSRF protection (set token for all requests)
app.use(setCsrfToken);

// Health check endpoint (no CSRF required)
app.get('/health', async (_req, res) => {
  try {
    // Check database connection
    await pool.query('SELECT 1');
    
    // Get WebSocket stats
    const wsStats = websocketService.getStats();
    
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        redis: 'connected',
        websocket: {
          status: 'active',
          connections: wsStats.totalConnections,
          authenticatedUsers: wsStats.authenticatedUsers
        }
      }
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'error', 
      timestamp: new Date().toISOString(),
      error: 'Service unavailable'
    });
  }
});

// CSRF token endpoint
app.get('/api/csrf-token', getCsrfToken);

// API routes
import authRoutes from './routes/authRoutes';
import oauthRoutes from './routes/oauthRoutes';
import messageRoutes from './routes/messageRoutes';
import conversationRoutes from './routes/conversationRoutes';
import webhookRoutes from './routes/webhookRoutes';
import telegramUserRoutes from './routes/telegramUserRoutes';

// Import middleware
import { rateLimiter } from './middleware/rateLimiter';
import { apiUsageLogger } from './middleware/apiUsageLogger';

// Auth routes (no CSRF, no rate limit for login/register)
app.use('/api/auth', authRoutes);

// Apply rate limiting and API usage logging to other API routes
app.use('/api/oauth', rateLimiter);
app.use('/api/messages', rateLimiter);
app.use('/api/conversations', rateLimiter);

app.use('/api/oauth', apiUsageLogger);
app.use('/api/messages', apiUsageLogger);
app.use('/api/conversations', apiUsageLogger);

// Apply CSRF verification only in development
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/oauth', verifyCsrfToken);
  app.use('/api/messages', verifyCsrfToken);
  app.use('/api/conversations', verifyCsrfToken);
}

app.use('/api/oauth', oauthRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/telegram', telegramUserRoutes);

// Serve frontend static files in production
if (process.env.NODE_ENV === 'production') {
  const path = require('path');
  app.use(express.static(path.join(__dirname, '../../frontend/dist')));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/health')) {
      res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
    }
  });
}

// Error handling middleware (must be last)
app.use(errorHandler);

// Initialize connections and start server
const startServer = async () => {
  try {
    // Connect to Redis
    await connectRedis();
    console.log('Redis connected successfully');

    // Test database connection
    await pool.query('SELECT NOW()');
    console.log('Database connected successfully');

    // Run database migrations
    console.log('Running database migrations...');
    try {
      const fs = await import('fs');
      const path = await import('path');
      const initSql = fs.readFileSync(path.join(__dirname, '../db/init.sql'), 'utf-8');
      await pool.query(initSql);
      console.log('Database migrations completed');
    } catch (migrationError) {
      console.error('Migration error (continuing anyway):', migrationError);
    }

    // Initialize WebSocket service
    websocketService.initialize(httpServer);
    console.log('WebSocket service initialized');

    // Initialize message polling service
    const { messagePollingService } = await import('./services/messagePollingService');
    await messagePollingService.initialize();
    console.log('Message polling service initialized');

    // One-time cleanup: Reset Telegram conversations
    try {
      console.log('[startup] Resetting Telegram conversations...');
      await pool.query(`DELETE FROM conversations WHERE account_id IN (SELECT id FROM connected_accounts WHERE platform = 'telegram')`);
      
      const accounts = await pool.query(`SELECT id FROM connected_accounts WHERE platform = 'telegram' AND is_active = true`);
      for (const account of accounts.rows) {
        const { telegramMessageSync } = await import('./services/telegram/TelegramMessageSync');
        await telegramMessageSync.syncMessages(account.id);
      }
      console.log('[startup] Telegram conversations reset complete');
    } catch (error) {
      console.error('[startup] Telegram reset failed:', error);
    }

    // Setup Telegram webhook
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    if (telegramToken) {
      const webhookUrl = `${process.env.WEBHOOK_BASE_URL || 'https://chatintegrator.onrender.com'}/api/webhooks/telegram`;
      try {
        const axios = await import('axios');
        await axios.default.post(`https://api.telegram.org/bot${telegramToken}/setWebhook`, {
          url: webhookUrl,
          allowed_updates: ['message', 'edited_message']
        });
        console.log('Telegram webhook set successfully:', webhookUrl);
      } catch (error) {
        console.error('Failed to set Telegram webhook:', error);
      }
    }

    // Start server
    httpServer.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);
      console.log(`WebSocket server ready for connections`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export default app;
