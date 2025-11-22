import { Platform } from '../types';
import { PlatformAdapter } from './PlatformAdapter';
import { TelegramAdapter } from './TelegramAdapter';
import { TwitterAdapter } from './TwitterAdapter';
import { LinkedInAdapter } from './LinkedInAdapter';
import { InstagramAdapter } from './InstagramAdapter';
import { WhatsAppAdapter } from './WhatsAppAdapter';
import { FacebookAdapter } from './FacebookAdapter';
import { TeamsAdapter } from './TeamsAdapter';

/**
 * Factory class to create platform-specific adapters
 */
export class AdapterFactory {
  private static adapters: Map<Platform, PlatformAdapter> = new Map();

  /**
   * Get an adapter instance for the specified platform
   * Uses singleton pattern to reuse adapter instances
   */
  static getAdapter(platform: Platform): PlatformAdapter {
    if (!this.adapters.has(platform)) {
      this.adapters.set(platform, this.createAdapter(platform));
    }
    return this.adapters.get(platform)!;
  }

  /**
   * Create a new adapter instance for the specified platform
   */
  private static createAdapter(platform: Platform): PlatformAdapter {
    switch (platform) {
      case 'telegram':
        return new TelegramAdapter();
      case 'twitter':
        return new TwitterAdapter();
      case 'linkedin':
        return new LinkedInAdapter();
      case 'instagram':
        return new InstagramAdapter();
      case 'whatsapp':
        return new WhatsAppAdapter();
      case 'facebook':
        return new FacebookAdapter();
      case 'teams':
        return new TeamsAdapter();
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * Clear all cached adapter instances
   * Useful for testing or when configuration changes
   */
  static clearCache(): void {
    this.adapters.clear();
  }
}
