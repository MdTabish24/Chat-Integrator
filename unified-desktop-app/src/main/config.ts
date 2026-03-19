/**
 * Application Configuration
 * 
 * For OAuth credentials, you can either:
 * 1. Set environment variables (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
 * 2. Create a .env file in the unified-desktop-app folder
 * 3. Hardcode values here (not recommended for production)
 */

import { app } from 'electron';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

// Try to load .env file
function loadEnvFile(): Record<string, string> {
  const envVars: Record<string, string> = {};
  
  // Check multiple locations for .env file
  const possiblePaths = [
    path.join(app.getAppPath(), '.env'),
    path.join(app.getAppPath(), '..', '.env'),
    path.join(process.cwd(), '.env'),
  ];
  
  for (const envPath of possiblePaths) {
    if (existsSync(envPath)) {
      try {
        const content = readFileSync(envPath, 'utf-8');
        const lines = content.split('\n');
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          
          const [key, ...valueParts] = trimmed.split('=');
          if (key && valueParts.length > 0) {
            let value = valueParts.join('=').trim();
            // Remove quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) || 
                (value.startsWith("'") && value.endsWith("'"))) {
              value = value.slice(1, -1);
            }
            envVars[key.trim()] = value;
          }
        }
        
        console.log(`[Config] Loaded .env from: ${envPath}`);
        break;
      } catch (e) {
        console.error(`[Config] Failed to load .env from ${envPath}:`, e);
      }
    }
  }
  
  return envVars;
}

// Load env file once
const envFile = loadEnvFile();

// Helper to get config value
function getConfig(key: string, defaultValue: string = ''): string {
  return process.env[key] || envFile[key] || defaultValue;
}

// ============================================
// Google OAuth Configuration (for Gmail)
// ============================================
// Get these from: https://console.cloud.google.com/apis/credentials
// 1. Create a new project or select existing
// 2. Enable Gmail API
// 3. Create OAuth 2.0 Client ID (Desktop app type)
// 4. Add http://localhost:8923/callback to authorized redirect URIs

export const GOOGLE_CLIENT_ID = getConfig('GOOGLE_CLIENT_ID', '');
export const GOOGLE_CLIENT_SECRET = getConfig('GOOGLE_CLIENT_SECRET', '');

// ============================================
// Microsoft OAuth Configuration (for Teams)
// ============================================
// Get these from: https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps
export const MICROSOFT_CLIENT_ID = getConfig('MICROSOFT_CLIENT_ID', '');
export const MICROSOFT_CLIENT_SECRET = getConfig('MICROSOFT_CLIENT_SECRET', '');
export const MICROSOFT_TENANT_ID = getConfig('MICROSOFT_TENANT_ID', 'common');

// ============================================
// Export all config
// ============================================
export const config = {
  google: {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
  },
  microsoft: {
    clientId: MICROSOFT_CLIENT_ID,
    clientSecret: MICROSOFT_CLIENT_SECRET,
    tenantId: MICROSOFT_TENANT_ID,
  },
};

// Log config status (without secrets)
console.log('[Config] Google OAuth configured:', !!GOOGLE_CLIENT_ID);
console.log('[Config] Microsoft OAuth configured:', !!MICROSOFT_CLIENT_ID);
