import { OAuthBaseService, OAuthConfig } from './OAuthBaseService';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Instagram Business OAuth Service
 * Uses Facebook Graph API for Instagram Business accounts
 */
export class InstagramOAuthService extends OAuthBaseService {
  constructor() {
    const config: OAuthConfig = {
      clientId: process.env.INSTAGRAM_APP_ID || '',
      clientSecret: process.env.INSTAGRAM_APP_SECRET || '',
      redirectUri: `${process.env.WEBHOOK_BASE_URL}/api/auth/callback/instagram`,
      authorizationUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
      tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
      scopes: [
        'public_profile',
        'pages_show_list',
      ],
    };

    super('instagram', config);
  }

  /**
   * Exchange authorization code for short-lived access token
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
      console.error('[instagram] Token exchange failed:', error.response?.data || error.message);
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
        '[instagram] Long-lived token exchange failed:',
        error.response?.data || error.message
      );
      throw new Error('Failed to exchange for long-lived token');
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
      console.error('[instagram] Token refresh failed:', error.response?.data || error.message);
      throw new Error(
        `Failed to refresh token: ${error.response?.data?.error?.message || error.message}`
      );
    }
  }

  /**
   * Get Instagram Business account information
   * @param accessToken - Access token
   * @returns User ID and username
   */
  async getUserInfo(accessToken: string): Promise<{ userId: string; username: string }> {
    try {
      // First, get Facebook user's pages
      const pagesResponse = await this.httpClient.get(
        'https://graph.facebook.com/v18.0/me/accounts',
        {
          params: {
            access_token: accessToken,
          },
        }
      );

      if (!pagesResponse.data.data || pagesResponse.data.data.length === 0) {
        throw new Error('No Facebook pages found. Instagram Business requires a Facebook page.');
      }

      // Get the first page (or let user select in a real implementation)
      const page = pagesResponse.data.data[0];
      const pageAccessToken = page.access_token;

      // Get Instagram Business account connected to the page
      const igAccountResponse = await this.httpClient.get(
        `https://graph.facebook.com/v18.0/${page.id}`,
        {
          params: {
            fields: 'instagram_business_account',
            access_token: pageAccessToken,
          },
        }
      );

      const igAccountId = igAccountResponse.data.instagram_business_account?.id;

      if (!igAccountId) {
        throw new Error('No Instagram Business account connected to this Facebook page.');
      }

      // Get Instagram account details
      const igDetailsResponse = await this.httpClient.get(
        `https://graph.facebook.com/v18.0/${igAccountId}`,
        {
          params: {
            fields: 'id,username,name',
            access_token: pageAccessToken,
          },
        }
      );

      return {
        userId: igDetailsResponse.data.id,
        username: igDetailsResponse.data.username || igDetailsResponse.data.name || 'Instagram User',
      };
    } catch (error: any) {
      console.error('[instagram] Failed to get user info:', error.response?.data || error.message);
      throw new Error('Failed to retrieve Instagram Business account information');
    }
  }

  /**
   * Get Instagram Business account ID from page
   * @param accessToken - Access token
   * @param pageId - Facebook page ID
   * @returns Instagram Business account ID
   */
  async getInstagramAccountId(accessToken: string, pageId: string): Promise<string> {
    try {
      const response = await this.httpClient.get(
        `https://graph.facebook.com/v18.0/${pageId}`,
        {
          params: {
            fields: 'instagram_business_account',
            access_token: accessToken,
          },
        }
      );

      return response.data.instagram_business_account?.id || '';
    } catch (error: any) {
      console.error(
        '[instagram] Failed to get Instagram account ID:',
        error.response?.data || error.message
      );
      throw new Error('Failed to retrieve Instagram Business account ID');
    }
  }

  /**
   * Revoke Instagram OAuth token
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

      console.log('[instagram] Token revoked successfully');
    } catch (error: any) {
      console.error('[instagram] Token revocation failed:', error.response?.data || error.message);
      // Don't throw error - mark as inactive anyway
    }
  }

  /**
   * Validate Instagram access token
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
      console.error('[instagram] Token validation failed:', error);
      return false;
    }
  }
}
