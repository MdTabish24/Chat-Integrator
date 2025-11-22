import { OAuthBaseService, OAuthConfig } from './OAuthBaseService';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Facebook Pages OAuth Service
 * Uses Facebook Graph API for page messaging
 */
export class FacebookOAuthService extends OAuthBaseService {
  constructor() {
    const config: OAuthConfig = {
      clientId: process.env.FACEBOOK_APP_ID || '',
      clientSecret: process.env.FACEBOOK_APP_SECRET || '',
      redirectUri: `${process.env.WEBHOOK_BASE_URL}/api/auth/callback/facebook`,
      authorizationUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
      tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
      scopes: [
        'pages_show_list',
        'pages_messaging',
        'pages_manage_metadata',
        'pages_read_engagement',
      ],
    };

    super('facebook', config);
  }

  /**
   * Exchange authorization code for short-lived user access token
   * @param code - Authorization code
   * @returns OAuth tokens (short-lived)
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

      const shortLivedToken = response.data.access_token;

      // Exchange short-lived token for long-lived token (60 days)
      const longLivedToken = await this.exchangeForLongLivedToken(shortLivedToken);

      return longLivedToken;
    } catch (error: any) {
      console.error('[facebook] Token exchange failed:', error.response?.data || error.message);
      throw new Error(
        `Failed to exchange authorization code: ${error.response?.data?.error?.message || error.message}`
      );
    }
  }

  /**
   * Exchange short-lived token for long-lived token (60 days)
   * @param shortLivedToken - Short-lived access token
   * @returns Long-lived OAuth tokens
   */
  async exchangeForLongLivedToken(shortLivedToken: string): Promise<any> {
    try {
      const response = await this.httpClient.get(
        'https://graph.facebook.com/v18.0/oauth/access_token',
        {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            fb_exchange_token: shortLivedToken,
          },
        }
      );

      return {
        accessToken: response.data.access_token,
        refreshToken: undefined, // Facebook doesn't provide refresh tokens
        expiresIn: response.data.expires_in || 5184000, // 60 days
        tokenType: response.data.token_type || 'bearer',
      };
    } catch (error: any) {
      console.error(
        '[facebook] Long-lived token exchange failed:',
        error.response?.data || error.message
      );
      throw new Error('Failed to exchange for long-lived token');
    }
  }

  /**
   * Get page access token from user access token
   * @param userAccessToken - User access token
   * @param pageId - Facebook page ID
   * @returns Page access token
   */
  async getPageAccessToken(userAccessToken: string, pageId: string): Promise<string> {
    try {
      const response = await this.httpClient.get(
        `https://graph.facebook.com/v18.0/${pageId}`,
        {
          params: {
            fields: 'access_token',
            access_token: userAccessToken,
          },
        }
      );

      return response.data.access_token;
    } catch (error: any) {
      console.error(
        '[facebook] Failed to get page access token:',
        error.response?.data || error.message
      );
      throw new Error('Failed to retrieve page access token');
    }
  }

  /**
   * Refresh long-lived token (extends expiry by 60 days)
   * @param accessToken - Current access token
   * @returns Refreshed OAuth tokens
   */
  async refreshAccessToken(accessToken: string): Promise<any> {
    try {
      const response = await this.httpClient.get(
        'https://graph.facebook.com/v18.0/oauth/access_token',
        {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            fb_exchange_token: accessToken,
          },
        }
      );

      return {
        accessToken: response.data.access_token,
        refreshToken: undefined,
        expiresIn: response.data.expires_in || 5184000, // 60 days
        tokenType: response.data.token_type || 'bearer',
      };
    } catch (error: any) {
      console.error('[facebook] Token refresh failed:', error.response?.data || error.message);
      throw new Error(
        `Failed to refresh token: ${error.response?.data?.error?.message || error.message}`
      );
    }
  }

  /**
   * Get Facebook user's pages
   * @param accessToken - User access token
   * @returns List of pages
   */
  async getUserPages(accessToken: string): Promise<any[]> {
    try {
      const response = await this.httpClient.get(
        'https://graph.facebook.com/v18.0/me/accounts',
        {
          params: {
            access_token: accessToken,
            fields: 'id,name,access_token,category',
          },
        }
      );

      return response.data.data || [];
    } catch (error: any) {
      console.error('[facebook] Failed to get user pages:', error.response?.data || error.message);
      throw new Error('Failed to retrieve Facebook pages');
    }
  }

  /**
   * Get Facebook page information
   * @param accessToken - Access token
   * @returns User ID (page ID) and username (page name)
   */
  async getUserInfo(accessToken: string): Promise<{ userId: string; username: string }> {
    try {
      // Get user's pages
      const pages = await this.getUserPages(accessToken);

      if (pages.length === 0) {
        throw new Error('No Facebook pages found. Please create a page first.');
      }

      // Use the first page (or let user select in a real implementation)
      const page = pages[0];

      return {
        userId: page.id,
        username: page.name,
      };
    } catch (error: any) {
      console.error('[facebook] Failed to get user info:', error.response?.data || error.message);
      throw new Error('Failed to retrieve Facebook page information');
    }
  }

  /**
   * Get specific page information
   * @param pageId - Page ID
   * @param accessToken - Access token
   * @returns Page details
   */
  async getPageInfo(pageId: string, accessToken: string): Promise<any> {
    try {
      const response = await this.httpClient.get(
        `https://graph.facebook.com/v18.0/${pageId}`,
        {
          params: {
            fields: 'id,name,category,picture',
            access_token: accessToken,
          },
        }
      );

      return response.data;
    } catch (error: any) {
      console.error('[facebook] Failed to get page info:', error.response?.data || error.message);
      throw new Error('Failed to retrieve page information');
    }
  }

  /**
   * Subscribe page to webhooks
   * @param pageId - Page ID
   * @param pageAccessToken - Page access token
   * @returns Subscription result
   */
  async subscribePageToWebhooks(pageId: string, pageAccessToken: string): Promise<boolean> {
    try {
      const response = await this.httpClient.post(
        `https://graph.facebook.com/v18.0/${pageId}/subscribed_apps`,
        {},
        {
          params: {
            subscribed_fields: 'messages,messaging_postbacks,messaging_optins,message_deliveries,message_reads',
            access_token: pageAccessToken,
          },
        }
      );

      console.log('[facebook] Page subscribed to webhooks successfully');
      return response.data.success === true;
    } catch (error: any) {
      console.error(
        '[facebook] Webhook subscription failed:',
        error.response?.data || error.message
      );
      return false;
    }
  }

  /**
   * Revoke Facebook OAuth token
   * @param accountId - Connected account ID
   */
  async revokeToken(accountId: string): Promise<void> {
    try {
      const tokens = await this.getStoredTokens(accountId);

      await this.httpClient.delete('https://graph.facebook.com/v18.0/me/permissions', {
        params: {
          access_token: tokens.accessToken,
        },
      });

      console.log('[facebook] Token revoked successfully');
    } catch (error: any) {
      console.error('[facebook] Token revocation failed:', error.response?.data || error.message);
      // Don't throw error - mark as inactive anyway
    }
  }

  /**
   * Validate Facebook access token
   * @param accessToken - Access token to validate
   * @returns True if token is valid
   */
  async validateToken(accessToken: string): Promise<boolean> {
    try {
      const response = await this.httpClient.get(
        'https://graph.facebook.com/v18.0/me',
        {
          params: {
            access_token: accessToken,
          },
        }
      );
      return !!response.data.id;
    } catch (error) {
      console.error('[facebook] Token validation failed:', error);
      return false;
    }
  }

  /**
   * Debug access token (useful for troubleshooting)
   * @param accessToken - Access token to debug
   * @returns Token debug information
   */
  async debugToken(accessToken: string): Promise<any> {
    try {
      const appToken = `${this.config.clientId}|${this.config.clientSecret}`;
      const response = await this.httpClient.get(
        'https://graph.facebook.com/v18.0/debug_token',
        {
          params: {
            input_token: accessToken,
            access_token: appToken,
          },
        }
      );

      return response.data.data;
    } catch (error: any) {
      console.error('[facebook] Token debug failed:', error.response?.data || error.message);
      throw new Error('Failed to debug token');
    }
  }
}
