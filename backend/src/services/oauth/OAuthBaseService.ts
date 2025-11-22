import axios, { AxiosInstance } from 'axios';
import { encrypt, decrypt } from '../../utils/encryption';
import pool from '../../config/database';
import { Platform } from '../../types';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
}

export interface StoredTokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

/**
 * Base OAuth service providing common OAuth 2.0 flow functionality
 * Platform-specific services should extend this class
 */
export abstract class OAuthBaseService {
  protected config: OAuthConfig;
  protected platform: Platform;
  protected httpClient: AxiosInstance;

  constructor(platform: Platform, config: OAuthConfig) {
    this.platform = platform;
    this.config = config;
    this.httpClient = axios.create({
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Generate OAuth 2.0 authorization URL
   * @param state - Random state parameter for CSRF protection
   * @param additionalParams - Platform-specific additional parameters
   * @returns Authorization URL
   */
  generateAuthorizationUrl(state: string, additionalParams: Record<string, string> = {}): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state,
      ...additionalParams,
    });

    return `${this.config.authorizationUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * @param code - Authorization code from OAuth callback
   * @param additionalParams - Platform-specific additional parameters
   * @returns OAuth tokens
   */
  async exchangeCodeForToken(
    code: string,
    additionalParams: Record<string, string> = {}
  ): Promise<OAuthTokens> {
    try {
      const response = await this.httpClient.post(
        this.config.tokenUrl,
        {
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code,
          redirect_uri: this.config.redirectUri,
          grant_type: 'authorization_code',
          ...additionalParams,
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return this.parseTokenResponse(response.data);
    } catch (error: any) {
      console.error(`[${this.platform}] Token exchange failed:`, error.response?.data || error.message);
      throw new Error(`Failed to exchange authorization code: ${error.response?.data?.error_description || error.message}`);
    }
  }

  /**
   * Refresh an expired access token
   * @param refreshToken - The refresh token
   * @param additionalParams - Platform-specific additional parameters
   * @returns New OAuth tokens
   */
  async refreshAccessToken(
    refreshToken: string,
    additionalParams: Record<string, string> = {}
  ): Promise<OAuthTokens> {
    if (!refreshToken) {
      throw new Error('Refresh token is required');
    }

    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      try {
        const response = await this.httpClient.post(
          this.config.tokenUrl,
          {
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            ...additionalParams,
          },
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          }
        );

        return this.parseTokenResponse(response.data);
      } catch (error: any) {
        retries++;
        console.error(
          `[${this.platform}] Token refresh attempt ${retries}/${maxRetries} failed:`,
          error.response?.data || error.message
        );

        if (retries >= maxRetries) {
          throw new Error(
            `Failed to refresh token after ${maxRetries} attempts: ${error.response?.data?.error_description || error.message}`
          );
        }

        // Exponential backoff: 1s, 2s, 4s
        await this.sleep(Math.pow(2, retries - 1) * 1000);
      }
    }

    throw new Error('Token refresh failed');
  }

  /**
   * Store OAuth tokens securely in the database
   * @param userId - User ID
   * @param platformUserId - Platform-specific user ID
   * @param platformUsername - Platform username
   * @param tokens - OAuth tokens to store
   * @returns Connected account ID
   */
  async storeTokens(
    userId: string,
    platformUserId: string,
    platformUsername: string,
    tokens: OAuthTokens
  ): Promise<string> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Encrypt tokens before storage
      const encryptedAccessToken = encrypt(tokens.accessToken);
      const encryptedRefreshToken = tokens.refreshToken ? encrypt(tokens.refreshToken) : null;

      // Calculate token expiry
      const tokenExpiresAt = tokens.expiresIn
        ? new Date(Date.now() + tokens.expiresIn * 1000)
        : null;

      // Check if account already exists
      const existingAccount = await client.query(
        `SELECT id FROM connected_accounts 
         WHERE user_id = $1 AND platform = $2 AND platform_user_id = $3`,
        [userId, this.platform, platformUserId]
      );

      let accountId: string;

      if (existingAccount.rows.length > 0) {
        // Update existing account
        accountId = existingAccount.rows[0].id;
        await client.query(
          `UPDATE connected_accounts 
           SET access_token = $1, 
               refresh_token = $2, 
               token_expires_at = $3,
               platform_username = $4,
               is_active = true,
               updated_at = NOW()
           WHERE id = $5`,
          [encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt, platformUsername, accountId]
        );
      } else {
        // Insert new account
        const result = await client.query(
          `INSERT INTO connected_accounts 
           (user_id, platform, platform_user_id, platform_username, access_token, refresh_token, token_expires_at, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true)
           RETURNING id`,
          [userId, this.platform, platformUserId, platformUsername, encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt]
        );
        accountId = result.rows[0].id;
      }

      await client.query('COMMIT');
      console.log(`[${this.platform}] Tokens stored successfully for account ${accountId}`);
      return accountId;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`[${this.platform}] Failed to store tokens:`, error);
      throw new Error('Failed to store OAuth tokens');
    } finally {
      client.release();
    }
  }

  /**
   * Retrieve and decrypt stored tokens
   * @param accountId - Connected account ID
   * @returns Decrypted token data
   */
  async getStoredTokens(accountId: string): Promise<StoredTokenData> {
    try {
      const result = await pool.query(
        `SELECT access_token, refresh_token, token_expires_at 
         FROM connected_accounts 
         WHERE id = $1 AND platform = $2 AND is_active = true`,
        [accountId, this.platform]
      );

      if (result.rows.length === 0) {
        throw new Error('Account not found or inactive');
      }

      const row = result.rows[0];

      return {
        accessToken: decrypt(row.access_token),
        refreshToken: row.refresh_token ? decrypt(row.refresh_token) : undefined,
        expiresAt: row.token_expires_at ? new Date(row.token_expires_at) : undefined,
      };
    } catch (error) {
      console.error(`[${this.platform}] Failed to retrieve tokens:`, error);
      throw new Error('Failed to retrieve stored tokens');
    }
  }

  /**
   * Check if token is expired and refresh if necessary
   * @param accountId - Connected account ID
   * @returns Valid access token
   */
  async ensureValidToken(accountId: string): Promise<string> {
    const tokens = await this.getStoredTokens(accountId);

    // If no expiry time, assume token is valid
    if (!tokens.expiresAt) {
      return tokens.accessToken;
    }

    // Check if token expires within next 5 minutes
    const expiryBuffer = 5 * 60 * 1000; // 5 minutes
    const isExpiringSoon = tokens.expiresAt.getTime() - Date.now() < expiryBuffer;

    if (isExpiringSoon && tokens.refreshToken) {
      console.log(`[${this.platform}] Token expiring soon, refreshing...`);
      const newTokens = await this.refreshAccessToken(tokens.refreshToken);

      // Get account details for re-storing
      const accountResult = await pool.query(
        `SELECT user_id, platform_user_id, platform_username 
         FROM connected_accounts 
         WHERE id = $1`,
        [accountId]
      );

      if (accountResult.rows.length === 0) {
        throw new Error('Account not found');
      }

      const account = accountResult.rows[0];
      await this.storeTokens(
        account.user_id,
        account.platform_user_id,
        account.platform_username,
        newTokens
      );

      return newTokens.accessToken;
    }

    return tokens.accessToken;
  }

  /**
   * Revoke OAuth token with the platform
   * @param accountId - Connected account ID
   */
  async revokeToken(accountId: string): Promise<void> {
    // Default implementation - platforms should override if they support revocation
    console.log(`[${this.platform}] Token revocation not implemented for this platform`);
  }

  /**
   * Parse token response from OAuth provider
   * Platform-specific services can override this for custom parsing
   * @param data - Response data from token endpoint
   * @returns Parsed OAuth tokens
   */
  protected parseTokenResponse(data: any): OAuthTokens {
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type,
    };
  }

  /**
   * Sleep utility for retry delays
   * @param ms - Milliseconds to sleep
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Platform-specific method to get user info after authentication
   * Must be implemented by each platform service
   * @param accessToken - Access token
   * @returns Platform user ID and username
   */
  abstract getUserInfo(accessToken: string): Promise<{ userId: string; username: string }>;
}
