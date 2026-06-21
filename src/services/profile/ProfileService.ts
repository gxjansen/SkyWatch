import { BlueSkyRateLimits } from '../rate/RateLimiter';
import { AuthenticationService } from '../auth/AuthenticationService';

export class ProfileService {
  private authService: AuthenticationService;

  constructor(authService: AuthenticationService) {
    this.authService = authService;
  }

  /**
   * Get profile information for a specific user
   * @param did Decentralized Identifier of the user
   * @returns Promise resolving to profile response
   */
  async getProfile(did: string) {
    console.log(`[ProfileService] Fetching profile for DID: ${did}`);
    const agent = await this.authService.requireAgent();

    try {
      // Wait for rate limit
      await BlueSkyRateLimits.GENERAL.waitForNextSlot();

      return await agent.app.bsky.actor.getProfile({ actor: did });
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
      const agent = await this.authService.requireAgent();

      // Wait for rate limit
      await BlueSkyRateLimits.GENERAL.waitForNextSlot();

      console.log(`[ProfileService] Fetching latest post for DID: ${did}`);
      const feed = await agent.app.bsky.feed.getAuthorFeed({
        actor: did,
        limit: 30
      });

      // The author feed surfaces pinned posts and reposts out of chronological
      // order, and a repost's post.indexedAt is the *original* post's date. So we
      // can't just take feed[0]. Instead, take the most recent timestamp among
      // the account's own (non-reposted) posts.
      let latest: number | undefined;
      for (const item of feed.data.feed) {
        // Skip reposts (the timestamp would belong to someone else's post).
        if ((item.reason as any)?.$type === 'app.bsky.feed.defs#reasonRepost') continue;
        // Skip anything not authored by this account.
        if (item.post?.author?.did !== did) continue;

        const ts = new Date(item.post.indexedAt).getTime();
        if (!Number.isNaN(ts) && (latest === undefined || ts > latest)) {
          latest = ts;
        }
      }

      return latest !== undefined ? new Date(latest) : undefined;
    } catch (error: any) {
      if (error?.status === 429 && error?.headers) {
        BlueSkyRateLimits.GENERAL.updateFromHeaders(error.headers);
      }
      console.error(`[ProfileService] Error fetching latest post for ${did}:`, error);
      return undefined;
    }
  }
}
