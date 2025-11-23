import { OAuthBaseService, OAuthConfig } from './OAuthBaseService';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Telegram OAuth Service
 * Note: Telegram uses Bot API with a different authentication flow
 * Users authenticate via Telegram Login Widget or direct bot interaction
 */
export class TelegramOAuthService extends OAuthBaseService {
  private botToken: string;

  constructor() {
    const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    const redirectUri = `${process.env.WEBHOOK_BASE_URL}/api/auth/callback/telegram`;

    // Telegram doesn't use traditional OAuth, but we maintain the interface
    const config: OAuthConfig = {
      clientId: botToken.split(':')[0] || '', // Bot ID is the first part of the token
      clientSecret: botToken,
      redirectUri,
      authorizationUrl: 'https://oauth.telegram.org/auth',
      tokenUrl: '', // Not used for Telegram
      scopes: [], // Telegram doesn't use scopes
    };

    super('telegram', config);
    this.botToken = botToken;
  }

  /**
   * Generate Telegram Login Widget URL
   * @param state - State parameter for CSRF protection
   * @returns Authorization URL for Telegram Login Widget
   */
  generateAuthorizationUrl(state: string): string {
    const botId = this.botToken.split(':')[0]; // Extract bot ID from token
    const baseUrl = process.env.WEBHOOK_BASE_URL || process.env.FRONTEND_URL || 'https://chatintegrator.onrender.com';
    
    const params = new URLSearchParams({
      bot_id: botId,
      origin: baseUrl,
      request_access: 'write',
      return_to: `${baseUrl}/api/auth/callback/telegram?state=${state}`,
    });

    return `https://oauth.telegram.org/auth?${params.toString()}`;
  }

  /**
   * Validate Telegram Login Widget data
   * @param authData - Data received from Telegram Login Widget
   * @returns True if data is valid
   */
  validateTelegramAuth(authData: Record<string, string>): boolean {
    const { hash, ...data } = authData;

    if (!hash) {
      return false;
    }

    // Create data check string
    const dataCheckString = Object.keys(data)
      .sort()
      .map((key) => `${key}=${data[key]}`)
      .join('\n');

    // Create secret key from bot token
    const secretKey = crypto.createHash('sha256').update(this.botToken).digest();

    // Calculate hash
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    // Check if hash matches and auth is not too old (1 day)
    const authDate = parseInt(data.auth_date || '0');
    const currentTime = Math.floor(Date.now() / 1000);
    const isRecent = currentTime - authDate < 86400; // 24 hours

    return calculatedHash === hash && isRecent;
  }

  /**
   * Exchange authorization code for token
   * For Telegram, we use the bot token directly
   * @param code - Not used for Telegram
   * @param authData - Telegram auth data from Login Widget
   */
  async exchangeCodeForToken(code: string, authData?: Record<string, string>): Promise<any> {
    if (!authData || !this.validateTelegramAuth(authData)) {
      throw new Error('Invalid Telegram authentication data');
    }

    // For Telegram, the "token" is the bot token, which doesn't expire
    return {
      accessToken: this.botToken,
      refreshToken: undefined,
      expiresIn: undefined, // Bot tokens don't expire
      tokenType: 'bot',
    };
  }

  /**
   * Refresh access token
   * Telegram bot tokens don't expire, so this is a no-op
   */
  async refreshAccessToken(refreshToken: string): Promise<any> {
    // Telegram bot tokens don't expire
    return {
      accessToken: this.botToken,
      refreshToken: undefined,
      expiresIn: undefined,
      tokenType: 'bot',
    };
  }

  /**
   * Get Telegram user info
   * @param accessToken - Bot token (not used, we use stored user data)
   * @param authData - Telegram auth data containing user info
   * @returns User ID and username
   */
  async getUserInfo(
    accessToken: string,
    authData?: Record<string, string>
  ): Promise<{ userId: string; username: string }> {
    if (!authData) {
      throw new Error('Telegram auth data is required');
    }

    return {
      userId: authData.id,
      username: authData.username || authData.first_name || 'Telegram User',
    };
  }

  /**
   * Validate bot token by calling getMe endpoint
   * @returns True if token is valid
   */
  async validateBotToken(): Promise<boolean> {
    try {
      const response = await this.httpClient.get(
        `https://api.telegram.org/bot${this.botToken}/getMe`
      );
      return response.data.ok === true;
    } catch (error) {
      console.error('[telegram] Bot token validation failed:', error);
      return false;
    }
  }

  /**
   * Get bot information
   * @returns Bot details
   */
  async getBotInfo(): Promise<any> {
    try {
      const response = await this.httpClient.get(
        `https://api.telegram.org/bot${this.botToken}/getMe`
      );
      return response.data.result;
    } catch (error) {
      console.error('[telegram] Failed to get bot info:', error);
      throw new Error('Failed to retrieve bot information');
    }
  }

  /**
   * Revoke token - not applicable for Telegram bot tokens
   */
  async revokeToken(accountId: string): Promise<void> {
    console.log('[telegram] Bot tokens cannot be revoked programmatically');
    // Mark account as inactive in database
    // The actual revocation happens when user blocks the bot
  }
}
