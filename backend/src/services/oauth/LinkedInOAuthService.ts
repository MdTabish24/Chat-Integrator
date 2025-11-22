import { OAuthBaseService, OAuthConfig } from './OAuthBaseService';
import dotenv from 'dotenv';

dotenv.config();

/**
 * LinkedIn OAuth Service
 * Implements OAuth 2.0 for LinkedIn API
 */
export class LinkedInOAuthService extends OAuthBaseService {
  constructor() {
    const config: OAuthConfig = {
      clientId: process.env.LINKEDIN_CLIENT_ID || '',
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET || '',
      redirectUri: `${process.env.WEBHOOK_BASE_URL}/api/auth/callback/linkedin`,
      authorizationUrl: 'https://www.linkedin.com/oauth/v2/authorization',
      tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
      scopes: ['r_liteprofile', 'r_emailaddress', 'w_member_social'],
    };

    super('linkedin', config);
  }

  /**
   * Exchange authorization code for access token
   * @param code - Authorization code
   * @returns OAuth tokens
   */
  async exchangeCodeForToken(code: string): Promise<any> {
    try {
      const response = await this.httpClient.post(
        this.config.tokenUrl,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          redirect_uri: this.config.redirectUri,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return this.parseTokenResponse(response.data);
    } catch (error: any) {
      console.error('[linkedin] Token exchange failed:', error.response?.data || error.message);
      throw new Error(
        `Failed to exchange authorization code: ${error.response?.data?.error_description || error.message}`
      );
    }
  }

  /**
   * Refresh LinkedIn access token
   * Note: LinkedIn tokens expire after 60 days and require re-authorization
   * @param refreshToken - Refresh token
   * @returns New OAuth tokens
   */
  async refreshAccessToken(refreshToken: string): Promise<any> {
    try {
      const response = await this.httpClient.post(
        this.config.tokenUrl,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return this.parseTokenResponse(response.data);
    } catch (error: any) {
      console.error('[linkedin] Token refresh failed:', error.response?.data || error.message);
      throw new Error(
        `Failed to refresh token: ${error.response?.data?.error_description || error.message}`
      );
    }
  }

  /**
   * Get LinkedIn user information
   * @param accessToken - Access token
   * @returns User ID and username
   */
  async getUserInfo(accessToken: string): Promise<{ userId: string; username: string }> {
    try {
      // Get user profile
      const profileResponse = await this.httpClient.get('https://api.linkedin.com/v2/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const userId = profileResponse.data.id;
      const firstName = profileResponse.data.localizedFirstName || '';
      const lastName = profileResponse.data.localizedLastName || '';
      const username = `${firstName} ${lastName}`.trim() || 'LinkedIn User';

      return {
        userId,
        username,
      };
    } catch (error: any) {
      console.error('[linkedin] Failed to get user info:', error.response?.data || error.message);
      throw new Error('Failed to retrieve LinkedIn user information');
    }
  }

  /**
   * Get LinkedIn user email (requires r_emailaddress scope)
   * @param accessToken - Access token
   * @returns User email
   */
  async getUserEmail(accessToken: string): Promise<string> {
    try {
      const response = await this.httpClient.get(
        'https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const emailData = response.data.elements?.[0]?.['handle~'];
      return emailData?.emailAddress || '';
    } catch (error: any) {
      console.error('[linkedin] Failed to get user email:', error.response?.data || error.message);
      return '';
    }
  }

  /**
   * Revoke LinkedIn OAuth token
   * Note: LinkedIn doesn't provide a token revocation endpoint
   * @param accountId - Connected account ID
   */
  async revokeToken(accountId: string): Promise<void> {
    console.log('[linkedin] LinkedIn does not support programmatic token revocation');
    // Token will expire after 60 days or when user revokes access manually
  }

  /**
   * Validate LinkedIn access token
   * @param accessToken - Access token to validate
   * @returns True if token is valid
   */
  async validateToken(accessToken: string): Promise<boolean> {
    try {
      await this.httpClient.get('https://api.linkedin.com/v2/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return true;
    } catch (error) {
      console.error('[linkedin] Token validation failed:', error);
      return false;
    }
  }
}
