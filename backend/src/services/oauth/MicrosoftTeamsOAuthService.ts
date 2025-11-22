import { OAuthBaseService, OAuthConfig } from './OAuthBaseService';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Microsoft Teams OAuth Service
 * Uses Microsoft Graph API with Azure AD OAuth 2.0
 */
export class MicrosoftTeamsOAuthService extends OAuthBaseService {
  private tenantId: string;

  constructor() {
    const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';

    const config: OAuthConfig = {
      clientId: process.env.MICROSOFT_CLIENT_ID || '',
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
      redirectUri: `${process.env.WEBHOOK_BASE_URL}/api/auth/callback/teams`,
      authorizationUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      scopes: [
        'offline_access',
        'User.Read',
        'Chat.Read',
        'Chat.ReadWrite',
        'ChatMessage.Send',
      ],
    };

    super('teams', config);
    this.tenantId = tenantId;
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
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code,
          redirect_uri: this.config.redirectUri,
          grant_type: 'authorization_code',
          scope: this.config.scopes.join(' '),
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return this.parseTokenResponse(response.data);
    } catch (error: any) {
      console.error('[teams] Token exchange failed:', error.response?.data || error.message);
      throw new Error(
        `Failed to exchange authorization code: ${error.response?.data?.error_description || error.message}`
      );
    }
  }

  /**
   * Refresh Microsoft Teams access token
   * @param refreshToken - Refresh token
   * @returns New OAuth tokens
   */
  async refreshAccessToken(refreshToken: string): Promise<any> {
    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      try {
        const response = await this.httpClient.post(
          this.config.tokenUrl,
          new URLSearchParams({
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            scope: this.config.scopes.join(' '),
          }).toString(),
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
          `[teams] Token refresh attempt ${retries}/${maxRetries} failed:`,
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
   * Get Microsoft user information
   * @param accessToken - Access token
   * @returns User ID and username
   */
  async getUserInfo(accessToken: string): Promise<{ userId: string; username: string }> {
    try {
      const response = await this.httpClient.get('https://graph.microsoft.com/v1.0/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const userData = response.data;
      return {
        userId: userData.id,
        username: userData.displayName || userData.userPrincipalName || 'Teams User',
      };
    } catch (error: any) {
      console.error('[teams] Failed to get user info:', error.response?.data || error.message);
      throw new Error('Failed to retrieve Microsoft Teams user information');
    }
  }

  /**
   * Get user's Teams chats
   * @param accessToken - Access token
   * @returns List of chats
   */
  async getUserChats(accessToken: string): Promise<any[]> {
    try {
      const response = await this.httpClient.get('https://graph.microsoft.com/v1.0/me/chats', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return response.data.value || [];
    } catch (error: any) {
      console.error('[teams] Failed to get user chats:', error.response?.data || error.message);
      throw new Error('Failed to retrieve Teams chats');
    }
  }

  /**
   * Get chat messages
   * @param accessToken - Access token
   * @param chatId - Chat ID
   * @returns List of messages
   */
  async getChatMessages(accessToken: string, chatId: string): Promise<any[]> {
    try {
      const response = await this.httpClient.get(
        `https://graph.microsoft.com/v1.0/me/chats/${chatId}/messages`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      return response.data.value || [];
    } catch (error: any) {
      console.error('[teams] Failed to get chat messages:', error.response?.data || error.message);
      throw new Error('Failed to retrieve chat messages');
    }
  }

  /**
   * Create a chat subscription for webhooks
   * @param accessToken - Access token
   * @param notificationUrl - Webhook URL
   * @returns Subscription details
   */
  async createChatSubscription(accessToken: string, notificationUrl: string): Promise<any> {
    try {
      const expirationDateTime = new Date();
      expirationDateTime.setHours(expirationDateTime.getHours() + 1); // 1 hour max

      const response = await this.httpClient.post(
        'https://graph.microsoft.com/v1.0/subscriptions',
        {
          changeType: 'created,updated',
          notificationUrl,
          resource: '/me/chats/getAllMessages',
          expirationDateTime: expirationDateTime.toISOString(),
          clientState: process.env.TEAMS_CLIENT_STATE || 'teams_webhook_secret',
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('[teams] Chat subscription created successfully');
      return response.data;
    } catch (error: any) {
      console.error(
        '[teams] Failed to create subscription:',
        error.response?.data || error.message
      );
      throw new Error('Failed to create Teams chat subscription');
    }
  }

  /**
   * Renew a chat subscription
   * @param accessToken - Access token
   * @param subscriptionId - Subscription ID
   * @returns Updated subscription details
   */
  async renewChatSubscription(accessToken: string, subscriptionId: string): Promise<any> {
    try {
      const expirationDateTime = new Date();
      expirationDateTime.setHours(expirationDateTime.getHours() + 1);

      const response = await this.httpClient.patch(
        `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`,
        {
          expirationDateTime: expirationDateTime.toISOString(),
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('[teams] Chat subscription renewed successfully');
      return response.data;
    } catch (error: any) {
      console.error(
        '[teams] Failed to renew subscription:',
        error.response?.data || error.message
      );
      throw new Error('Failed to renew Teams chat subscription');
    }
  }

  /**
   * Delete a chat subscription
   * @param accessToken - Access token
   * @param subscriptionId - Subscription ID
   */
  async deleteChatSubscription(accessToken: string, subscriptionId: string): Promise<void> {
    try {
      await this.httpClient.delete(
        `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      console.log('[teams] Chat subscription deleted successfully');
    } catch (error: any) {
      console.error(
        '[teams] Failed to delete subscription:',
        error.response?.data || error.message
      );
      // Don't throw - subscription may have already expired
    }
  }

  /**
   * Revoke Microsoft Teams OAuth token
   * Note: Microsoft doesn't provide a direct revocation endpoint
   * @param accountId - Connected account ID
   */
  async revokeToken(accountId: string): Promise<void> {
    console.log('[teams] Microsoft does not support direct token revocation');
    // Token will expire after 1 hour or when user revokes access manually
    // We should delete any active subscriptions
  }

  /**
   * Validate Microsoft access token
   * @param accessToken - Access token to validate
   * @returns True if token is valid
   */
  async validateToken(accessToken: string): Promise<boolean> {
    try {
      await this.httpClient.get('https://graph.microsoft.com/v1.0/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return true;
    } catch (error) {
      console.error('[teams] Token validation failed:', error);
      return false;
    }
  }

  /**
   * Get user's presence status
   * @param accessToken - Access token
   * @returns Presence information
   */
  async getUserPresence(accessToken: string): Promise<any> {
    try {
      const response = await this.httpClient.get(
        'https://graph.microsoft.com/v1.0/me/presence',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      return response.data;
    } catch (error: any) {
      console.error('[teams] Failed to get user presence:', error.response?.data || error.message);
      return null;
    }
  }
}
