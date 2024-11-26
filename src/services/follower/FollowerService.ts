import { BskyAgent, AppBskyGraphGetFollows } from '@atproto/api';
import { IFollower } from '../../models/Follower';
import { BlueSkyRateLimits } from '../rate/RateLimiter';
import { AuthenticationService } from '../auth/AuthenticationService';
import { ProfileService } from '../profile/ProfileService';
import { DatabaseService } from '../db/DatabaseService';

interface FollowRecord {
  uri: string;
  did: string;
}

export class FollowerService {
  private authService: AuthenticationService;
  private profileService: ProfileService;
  private dbService: DatabaseService;
  private agent: BskyAgent;

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
    this.agent = authService.getAgent();
  }

  /**
   * Get followers with optional cursor
   * @param cursor Optional cursor for pagination
   * @returns Promise resolving to followers response
   */
  async getFollowers(cursor?: string) {
    console.log(`[FollowerService] Fetching followers. Cursor: ${cursor || 'initial'}`);
    if (!this.agent.session) {
      const authSuccess = await this.authService.authenticate();
      if (!authSuccess) {
        throw new Error('Failed to authenticate with BlueSky');
      }
    }

    try {
      // Wait for rate limit
      await BlueSkyRateLimits.FOLLOWS.waitForNextSlot();
      
      return await this.agent.getFollows({
        actor: this.agent.session!.did,
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
   * Get follow record for a user
   * @param did Decentralized Identifier of the user
   * @returns Promise resolving to the follow record or null
   */
  private async getFollowRecord(did: string): Promise<FollowRecord | null> {
    try {
      await BlueSkyRateLimits.GENERAL.waitForNextSlot();
      const response = await this.agent.api.app.bsky.graph.getFollows({
        actor: this.agent.session!.did,
        limit: 100
      });

      // Find the follow record for this user
      const followRecord = response.data.follows.find(f => f.did === did) as AppBskyGraphGetFollows.OutputSchema['follows'][0];
      if (!followRecord || !followRecord.uri) {
        console.log(`[FollowerService] Follow record not found for ${did}`);
        return null;
      }

      return {
        did: followRecord.did,
        uri: followRecord.uri as string
      };
    } catch (error: any) {
      console.error(`[FollowerService] Error getting follow record for ${did}:`, error);
      return null;
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
      if (!this.agent.session) {
        const authSuccess = await this.authService.authenticate();
        if (!authSuccess) {
          throw new Error('Failed to authenticate with BlueSky');
        }
      }

      // Get the follow record first
      const followRecord = await this.getFollowRecord(did);
      if (!followRecord) {
        throw new Error('Could not find follow record');
      }

      // Get the rkey from the follow record URI
      const rkey = followRecord.uri.split('/').pop();
      if (!rkey) {
        throw new Error('Invalid follow record URI');
      }

      // Unfollow using the rkey
      await this.agent.deleteFollow(rkey);

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
      
      // Ensure we're authenticated
      if (!this.agent.session) {
        const authSuccess = await this.authService.authenticate();
        if (!authSuccess) {
          throw new Error('Failed to authenticate with BlueSky');
        }
      }

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
