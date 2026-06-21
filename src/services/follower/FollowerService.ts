import { IFollower } from '../../models/Follower';
import { BlueSkyRateLimits } from '../rate/RateLimiter';
import { AuthenticationService } from '../auth/AuthenticationService';
import { ProfileService } from '../profile/ProfileService';
import { DatabaseService } from '../db/DatabaseService';

export class FollowerService {
  private authService: AuthenticationService;
  private profileService: ProfileService;
  private dbService: DatabaseService;

  // Callback for tracking imported followers
  onFollowerImported?: (follower: Partial<IFollower>) => void;

  constructor(
    authService: AuthenticationService,
    profileService: ProfileService,
    dbService: DatabaseService
  ) {
    this.authService = authService;
    this.profileService = profileService;
    this.dbService = dbService;
  }

  /**
   * Get followers with optional cursor
   * @param cursor Optional cursor for pagination
   * @returns Promise resolving to followers response
   */
  async getFollowers(cursor?: string) {
    console.log(`[FollowerService] Fetching followers. Cursor: ${cursor || 'initial'}`);
    const agent = await this.authService.requireAgent();

    try {
      // Wait for rate limit
      await BlueSkyRateLimits.FOLLOWS.waitForNextSlot();

      return await agent.app.bsky.graph.getFollows({
        actor: this.authService.getCurrentUserDid(),
        cursor: cursor,
        limit: 100 // Maximum allowed by BlueSky API
      });
    } catch (error: any) {
      if (error?.status === 429 && error?.headers) {
        BlueSkyRateLimits.FOLLOWS.updateFromHeaders(error.headers);
        throw error;
      }
      throw error;
    }
  }

  /**
   * Unfollow a user
   * @param did Decentralized Identifier of the user to unfollow
   * @returns Promise resolving to boolean indicating success
   */
  async unfollowUser(did: string): Promise<boolean> {
    try {
      // Wait for rate limit
      await BlueSkyRateLimits.UNFOLLOW.waitForNextSlot();

      // Ensure we're authenticated
      const agent = await this.authService.requireAgent();

      // The follow-record URI is returned on the profile's viewer state. This
      // works no matter how many accounts you follow (no pagination needed).
      const profile = await agent.app.bsky.actor.getProfile({ actor: did });
      const followUri = profile.data.viewer?.following;

      if (!followUri) {
        // Not actually following (already unfollowed / stale row): reconcile the
        // local DB and treat as success, since the desired end state holds.
        await this.dbService.removeFollower(did);
        return true;
      }

      // Delete the follow record by its URI.
      await agent.deleteFollow(followUri);

      // Remove from local database
      await this.dbService.removeFollower(did);

      return true;
    } catch (error: any) {
      if (error?.status === 429 && error?.headers) {
        BlueSkyRateLimits.UNFOLLOW.updateFromHeaders(error.headers);
      }
      console.error(`[FollowerService] Error unfollowing user ${did}:`, error);
      throw error; // Propagate error to show proper message to user
    }
  }

  /**
   * Fetch and store followers
   * @returns Promise resolving to array of stored followers
   */
  async fetchAndStoreFollowers(): Promise<Partial<IFollower>[]> {
    try {
      console.log('[FollowerService] Starting follower fetch and store process');

      // Ensure we're authenticated before starting the batch loop.
      await this.authService.requireAgent();

      // Wait for rate limit
      await BlueSkyRateLimits.FOLLOWS.waitForNextSlot();

      // Initialize variables for pagination
      let cursor: string | undefined;
      const storedFollowers: Partial<IFollower>[] = [];

      // Fetch all followers without a hard limit
      while (true) {
        try {
          // Fetch followers with cursor for pagination
          const followersResponse = await this.getFollowers(cursor);

          // Store followers in MongoDB
          for (const follower of followersResponse.data.follows) {
            try {
              // Fetch additional profile information
              const profileResponse = await this.profileService.getProfile(follower.did);
              const profile = profileResponse.data;

              // Get latest post timestamp
              const latestPostTimestamp = await this.profileService.getLatestPostTimestamp(follower.did);

              const followerData: Partial<IFollower> = {
                did: follower.did,
                handle: follower.handle,
                displayName: follower.displayName,
                avatar: follower.avatar,
                followedAt: new Date(),
                followerCount: profile.followersCount || 0,
                followingCount: profile.followsCount || 0,
                postCount: profile.postsCount || 0,
                joinedAt: profile.createdAt ? new Date(profile.createdAt) : undefined,
                lastPostAt: latestPostTimestamp
              };

              // Save to database
              const savedFollower = await this.dbService.upsertFollower(followerData);

              // Call the callback if it exists
              if (this.onFollowerImported) {
                this.onFollowerImported(followerData);
              }

              storedFollowers.push(followerData);

              console.log(`[FollowerService] Imported follower: ${follower.handle}`);
            } catch (profileError: any) {
              if (profileError?.status === 429 && profileError?.headers) {
                BlueSkyRateLimits.GENERAL.updateFromHeaders(profileError.headers);
                // Wait before retrying this follower
                await BlueSkyRateLimits.GENERAL.waitForNextSlot();
                // Retry this follower
                continue;
              }
              console.error(`[FollowerService] Error fetching profile for ${follower.handle}:`, profileError);
            }
          }

          // Update cursor for next iteration
          cursor = followersResponse.data.cursor;

          // Break if no more followers
          if (!cursor) break;

        } catch (error: any) {
          if (error?.status === 429 && error?.headers) {
            BlueSkyRateLimits.FOLLOWS.updateFromHeaders(error.headers);
            // Wait before retrying this batch
            await BlueSkyRateLimits.FOLLOWS.waitForNextSlot();
            // Retry this batch (don't update cursor)
            continue;
          }
          throw error;
        }
      }

      console.log(`[FollowerService] Total followers fetched and stored: ${storedFollowers.length}`);
      return storedFollowers;
    } catch (error) {
      console.error('[FollowerService] Error fetching and storing followers:', error);
      throw error;
    }
  }
}
