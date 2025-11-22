/**
 * OAuth Services Index
 * Exports all platform-specific OAuth services
 */

export { OAuthBaseService, OAuthConfig, OAuthTokens, StoredTokenData } from './OAuthBaseService';
export { TelegramOAuthService } from './TelegramOAuthService';
export { TwitterOAuthService } from './TwitterOAuthService';
export { LinkedInOAuthService } from './LinkedInOAuthService';
export { InstagramOAuthService } from './InstagramOAuthService';
export { WhatsAppOAuthService } from './WhatsAppOAuthService';
export { FacebookOAuthService } from './FacebookOAuthService';
export { MicrosoftTeamsOAuthService } from './MicrosoftTeamsOAuthService';

import { Platform } from '../../types';
import { OAuthBaseService } from './OAuthBaseService';
import { TelegramOAuthService } from './TelegramOAuthService';
import { TwitterOAuthService } from './TwitterOAuthService';
import { LinkedInOAuthService } from './LinkedInOAuthService';
import { InstagramOAuthService } from './InstagramOAuthService';
import { WhatsAppOAuthService } from './WhatsAppOAuthService';
import { FacebookOAuthService } from './FacebookOAuthService';
import { MicrosoftTeamsOAuthService } from './MicrosoftTeamsOAuthService';

/**
 * Factory function to get the appropriate OAuth service for a platform
 * @param platform - Platform name
 * @returns OAuth service instance
 */
export function getOAuthService(platform: Platform): OAuthBaseService {
  switch (platform) {
    case 'telegram':
      return new TelegramOAuthService();
    case 'twitter':
      return new TwitterOAuthService();
    case 'linkedin':
      return new LinkedInOAuthService();
    case 'instagram':
      return new InstagramOAuthService();
    case 'whatsapp':
      return new WhatsAppOAuthService();
    case 'facebook':
      return new FacebookOAuthService();
    case 'teams':
      return new MicrosoftTeamsOAuthService();
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Get all available OAuth services
 * @returns Map of platform to OAuth service
 */
export function getAllOAuthServices(): Map<Platform, OAuthBaseService> {
  const services = new Map<Platform, OAuthBaseService>();
  
  const platforms: Platform[] = [
    'telegram',
    'twitter',
    'linkedin',
    'instagram',
    'whatsapp',
    'facebook',
    'teams',
  ];

  platforms.forEach((platform) => {
    services.set(platform, getOAuthService(platform));
  });

  return services;
}
