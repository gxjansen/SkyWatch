import { BskyAgent } from '@atproto/api';
import { BlueSkyRateLimits } from '../rate/RateLimiter';
import { AuthenticationService } from '../auth/AuthenticationService';

export class ProfileService {
  private authService: AuthenticationService;
  private agent: BskyAgent;

  constructor(authService: AuthenticationService) {
    this.authService = authService;
    this.agent = authService.getAgent();
  }

  /**
   * Get profile information for a specific user
   * @param did Decentralized Identifier of the user
   * @returns Promise resolving to profile response
   */
  async getProfile(did: string) {
    console.log(`[ProfileService] Fetching profile for DID: ${did}`);
    if (!this.agent.session) {
      const authSuccess = await this.authService.authenticate();
      if (!authSuccess) {
        throw new Error('Failed to authenticate with BlueSky');
      }
    }

    try {
      // Wait for rate limit
      await BlueSkyRateLimits.GENERAL.waitForNextSlot();
      
      return await this.agent.getProfile({ actor: did });
    } catch (error: any) {
      if (error?.status === 429 && error?.headers) {
        BlueSkyRateLimits.GENERAL.updateFromHeaders(error.headers);
        throw error;
      }
      throw error;
    }
  }

  /**
   * Get the latest post timestamp for a user
   * @param did Decentralized Identifier of the user
   * @returns Promise resolving to the latest post timestamp or undefined
   */
  async getLatestPostTimestamp(did: string): Promise<Date | undefined> {
    try {
      if (!this.agent.session) {
        const authSuccess = await this.authService.authenticate();
        if (!authSuccess) {
          throw new Error('Failed to authenticate with BlueSky');
        }
      }

      // Wait for rate limit
      await BlueSkyRateLimits.GENERAL.waitForNextSlot();

      console.log(`[ProfileService] Fetching latest post for DID: ${did}`);
      const feed = await this.agent.getAuthorFeed({
        actor: did,
        limit: 1
      });

      if (feed.data.feed.length > 0) {
        return new Date(feed.data.feed[0].post.indexedAt);
      }
      return undefined;
    } catch (error: any) {
      if (error?.status === 429 && error?.headers) {
        BlueSkyRateLimits.GENERAL.updateFromHeaders(error.headers);
      }
      console.error(`[ProfileService] Error fetching latest post for ${did}:`, error);
      return undefined;
    }
  }
}
