import { OAuthBaseService, OAuthConfig } from './OAuthBaseService';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Twitter/X OAuth Service
 * Implements OAuth 2.0 with PKCE (Proof Key for Code Exchange)
 */
export class TwitterOAuthService extends OAuthBaseService {
  private codeVerifierStore: Map<string, string> = new Map();

  constructor() {
    const config: OAuthConfig = {
      clientId: process.env.TWITTER_CLIENT_ID || '',
      clientSecret: process.env.TWITTER_CLIENT_SECRET || '',
      redirectUri: `${process.env.WEBHOOK_BASE_URL}/api/auth/callback/twitter`,
      authorizationUrl: 'https://twitter.com/i/oauth2/authorize',
      tokenUrl: 'https://api.twitter.com/2/oauth2/token',
      scopes: ['tweet.read', 'users.read', 'dm.read', 'dm.write', 'offline.access'],
    };

    super('twitter', config);
  }

  /**
   * Generate code verifier for PKCE
   * @returns Base64 URL-encoded random string
   */
  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Generate code challenge from verifier
   * @param verifier - Code verifier
   * @returns SHA256 hash of verifier, base64 URL-encoded
   */
  private generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  /**
   * Generate Twitter OAuth 2.0 authorization URL with PKCE
   * @param state - State parameter for CSRF protection
   * @returns Authorization URL
   */
  generateAuthorizationUrl(state: string): string {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    // Store code verifier for later use in token exchange
    this.codeVerifierStore.set(state, codeVerifier);

    // Clean up old verifiers (older than 10 minutes)
    setTimeout(() => {
      this.codeVerifierStore.delete(state);
    }, 10 * 60 * 1000);

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `${this.config.authorizationUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token with PKCE
   * @param code - Authorization code
   * @param state - State parameter to retrieve code verifier
   * @returns OAuth tokens
   */
  async exchangeCodeForToken(code: string, state?: string): Promise<any> {
    if (!state) {
      throw new Error('State parameter is required for Twitter OAuth');
    }

    const codeVerifier = this.codeVerifierStore.get(state);
    if (!codeVerifier) {
      throw new Error('Code verifier not found. Authorization may have expired.');
    }

    try {
      // Create Basic Auth header
      const credentials = Buffer.from(
        `${this.config.clientId}:${this.config.clientSecret}`
      ).toString('base64');

      const response = await this.httpClient.post(
        this.config.tokenUrl,
        new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          client_id: this.config.clientId,
          redirect_uri: this.config.redirectUri,
          code_verifier: codeVerifier,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${credentials}`,
          },
        }
      );

      // Clean up code verifier
      this.codeVerifierStore.delete(state);

      return this.parseTokenResponse(response.data);
    } catch (error: any) {
      console.error('[twitter] Token exchange failed:', error.response?.data || error.message);
      throw new Error(
        `Failed to exchange authorization code: ${error.response?.data?.error_description || error.message}`
      );
    }
  }

  /**
   * Refresh Twitter access token
   * @param refreshToken - Refresh token
   * @returns New OAuth tokens
   */
  async refreshAccessToken(refreshToken: string): Promise<any> {
    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString('base64');

    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      try {
        const response = await this.httpClient.post(
          this.config.tokenUrl,
          new URLSearchParams({
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            client_id: this.config.clientId,
          }).toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: `Basic ${credentials}`,
            },
          }
        );

        return this.parseTokenResponse(response.data);
      } catch (error: any) {
        retries++;
        console.error(
          `[twitter] Token refresh attempt ${retries}/${maxRetries} failed:`,
          error.response?.data || error.message
        );

        if (retries >= maxRetries) {
          throw new Error(
            `Failed to refresh token after ${maxRetries} attempts: ${error.response?.data?.error_description || error.message}`
          );
        }

        await this.sleep(Math.pow(2, retries - 1) * 1000);
      }
    }

    throw new Error('Token refresh failed');
  }

  /**
   * Get Twitter user information
   * @param accessToken - Access token
   * @returns User ID and username
   */
  async getUserInfo(accessToken: string): Promise<{ userId: string; username: string }> {
    try {
      const response = await this.httpClient.get('https://api.twitter.com/2/users/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const userData = response.data.data;
      return {
        userId: userData.id,
        username: userData.username,
      };
    } catch (error: any) {
      console.error('[twitter] Failed to get user info:', error.response?.data || error.message);
      throw new Error('Failed to retrieve Twitter user information');
    }
  }

  /**
   * Revoke Twitter OAuth token
   * @param accountId - Connected account ID
   */
  async revokeToken(accountId: string): Promise<void> {
    try {
      const tokens = await this.getStoredTokens(accountId);
      const credentials = Buffer.from(
        `${this.config.clientId}:${this.config.clientSecret}`
      ).toString('base64');

      await this.httpClient.post(
        'https://api.twitter.com/2/oauth2/revoke',
        new URLSearchParams({
          token: tokens.accessToken,
          token_type_hint: 'access_token',
          client_id: this.config.clientId,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${credentials}`,
          },
        }
      );

      console.log('[twitter] Token revoked successfully');
    } catch (error: any) {
      console.error('[twitter] Token revocation failed:', error.response?.data || error.message);
      // Don't throw error - mark as inactive anyway
    }
  }
}
