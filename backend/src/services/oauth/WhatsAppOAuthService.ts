import { OAuthBaseService, OAuthConfig } from './OAuthBaseService';
import dotenv from 'dotenv';

dotenv.config();

/**
 * WhatsApp Business OAuth Service
 * Uses WhatsApp Cloud API with system user tokens
 */
export class WhatsAppOAuthService extends OAuthBaseService {
  private phoneNumberId: string;
  private systemUserToken: string;

  constructor() {
    const config: OAuthConfig = {
      clientId: process.env.FACEBOOK_APP_ID || '', // WhatsApp uses Facebook App
      clientSecret: process.env.FACEBOOK_APP_SECRET || '',
      redirectUri: `${process.env.WEBHOOK_BASE_URL}/api/auth/callback/whatsapp`,
      authorizationUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
      tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
      scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
    };

    super('whatsapp', config);
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    this.systemUserToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
  }

  /**
   * Generate WhatsApp authorization URL
   * @param state - State parameter for CSRF protection
   * @returns Authorization URL
   */
  generateAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(','),
      state,
      config_id: process.env.WHATSAPP_CONFIG_ID || '', // WhatsApp embedded signup config
    });

    return `${this.config.authorizationUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * @param code - Authorization code
   * @returns OAuth tokens
   */
  async exchangeCodeForToken(code: string): Promise<any> {
    try {
      const response = await this.httpClient.get(this.config.tokenUrl, {
        params: {
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code,
          redirect_uri: this.config.redirectUri,
        },
      });

      // For WhatsApp, we typically use system user tokens that don't expire
      // But we'll store the user access token if provided
      return {
        accessToken: response.data.access_token || this.systemUserToken,
        refreshToken: undefined, // System user tokens don't have refresh tokens
        expiresIn: undefined, // System user tokens don't expire
        tokenType: 'bearer',
      };
    } catch (error: any) {
      console.error('[whatsapp] Token exchange failed:', error.response?.data || error.message);
      throw new Error(
        `Failed to exchange authorization code: ${error.response?.data?.error?.message || error.message}`
      );
    }
  }

  /**
   * Refresh access token
   * WhatsApp system user tokens don't expire, so this returns the existing token
   * @param refreshToken - Not used for WhatsApp
   * @returns OAuth tokens
   */
  async refreshAccessToken(refreshToken: string): Promise<any> {
    // System user tokens don't expire
    return {
      accessToken: this.systemUserToken,
      refreshToken: undefined,
      expiresIn: undefined,
      tokenType: 'bearer',
    };
  }

  /**
   * Get WhatsApp Business account information
   * @param accessToken - Access token
   * @returns User ID and username (phone number)
   */
  async getUserInfo(accessToken: string): Promise<{ userId: string; username: string }> {
    try {
      // Get phone number details
      const response = await this.httpClient.get(
        `https://graph.facebook.com/v18.0/${this.phoneNumberId}`,
        {
          params: {
            access_token: accessToken,
          },
        }
      );

      return {
        userId: response.data.id,
        username: response.data.display_phone_number || response.data.verified_name || 'WhatsApp Business',
      };
    } catch (error: any) {
      console.error('[whatsapp] Failed to get user info:', error.response?.data || error.message);
      throw new Error('Failed to retrieve WhatsApp Business account information');
    }
  }

  /**
   * Verify webhook for WhatsApp
   * @param mode - Verification mode
   * @param token - Verification token
   * @param challenge - Challenge string
   * @returns Challenge if verification succeeds
   */
  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'whatsapp_verify_token';

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('[whatsapp] Webhook verified successfully');
      return challenge;
    }

    console.error('[whatsapp] Webhook verification failed');
    return null;
  }

  /**
   * Get WhatsApp Business profile
   * @param accessToken - Access token
   * @returns Business profile information
   */
  async getBusinessProfile(accessToken: string): Promise<any> {
    try {
      const response = await this.httpClient.get(
        `https://graph.facebook.com/v18.0/${this.phoneNumberId}/whatsapp_business_profile`,
        {
          params: {
            access_token: accessToken,
          },
        }
      );

      return response.data.data?.[0] || {};
    } catch (error: any) {
      console.error(
        '[whatsapp] Failed to get business profile:',
        error.response?.data || error.message
      );
      throw new Error('Failed to retrieve WhatsApp Business profile');
    }
  }

  /**
   * Register webhook for WhatsApp phone number
   * @param accessToken - Access token
   * @param webhookUrl - Webhook URL
   * @returns Registration result
   */
  async registerWebhook(accessToken: string, webhookUrl: string): Promise<boolean> {
    try {
      const response = await this.httpClient.post(
        `https://graph.facebook.com/v18.0/${this.phoneNumberId}/subscribed_apps`,
        {},
        {
          params: {
            access_token: accessToken,
          },
        }
      );

      console.log('[whatsapp] Webhook registered successfully');
      return response.data.success === true;
    } catch (error: any) {
      console.error('[whatsapp] Webhook registration failed:', error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Revoke WhatsApp OAuth token
   * @param accountId - Connected account ID
   */
  async revokeToken(accountId: string): Promise<void> {
    console.log('[whatsapp] System user tokens cannot be revoked programmatically');
    // System user tokens are managed at the app level
    // Actual revocation happens when user removes app permissions
  }

  /**
   * Validate WhatsApp access token
   * @param accessToken - Access token to validate
   * @returns True if token is valid
   */
  async validateToken(accessToken: string): Promise<boolean> {
    try {
      const response = await this.httpClient.get(
        `https://graph.facebook.com/v18.0/${this.phoneNumberId}`,
        {
          params: {
            access_token: accessToken,
          },
        }
      );
      return !!response.data.id;
    } catch (error) {
      console.error('[whatsapp] Token validation failed:', error);
      return false;
    }
  }
}
