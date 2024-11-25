import { BskyAgent } from '@atproto/api';
import mongoose from 'mongoose';
import { Follower, IFollower } from '../models/Follower';
import dotenv from 'dotenv';
import { BlueSkyRateLimits } from './RateLimiter';

dotenv.config();

export class BlueSkyService {
  private agent: BskyAgent;
  private handle: string;
  private password: string;
  private authPromise: Promise<boolean> | null = null;
  private static MAX_AUTH_RETRIES = 3;
  private authInProgress = false;
  
  // Callback for tracking imported followers
  onFollowerImported?: (follower: Partial<IFollower>) => void;

  constructor(handle: string, password: string) {
    if (!handle || !password) {
      throw new Error('BlueSky handle and password are required');
    }

    // Initialize BlueSky agent
    this.agent = new BskyAgent({ 
      service: 'https://bsky.social' 
    });
    this.handle = handle;
    this.password = password;
  }

  /**
   * Get the current authenticated user's DID
   * @returns The DID of the authenticated user
   */
  getCurrentUserDid(): string {
    if (!this.agent.session) {
      throw new Error('Not authenticated');
    }
    return this.agent.session.did;
  }

  /**
   * Get the current authenticated user's profile
   * @returns Promise resolving to the user's profile
   */
  async getCurrentUserProfile() {
    if (!this.agent.session) {
      const authSuccess = await this.authenticate();
      if (!authSuccess) {
        throw new Error('Failed to authenticate with BlueSky');
      }
    }
    
    try {
      // Use general rate limiter for profile requests
      await BlueSkyRateLimits.GENERAL.waitForNextSlot();
      return await this.getProfile(this.agent.session!.did);
    } catch (error: any) {
      if (error?.status === 429 && error?.headers) {
        BlueSkyRateLimits.GENERAL.updateFromHeaders(error.headers);
        throw error;
      }
      throw error;
    }
  }

  /**
   * Authenticate with BlueSky
   * @returns Promise resolving to boolean indicating authentication success
   */
  async authenticate(retryCount = 0): Promise<boolean> {
    // If authentication is already in progress, wait for it to complete
    if (this.authInProgress) {
      console.log('[BlueSkyService] Authentication already in progress, waiting...');
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      return this.authenticate(retryCount);
    }

    try {
      this.authInProgress = true;

      // If already authenticated with a valid session, verify it
      if (this.agent.session?.did) {
        try {
          // Verify the session is still valid
          await BlueSkyRateLimits.GENERAL.waitForNextSlot();
          await this.agent.getProfile({ actor: this.agent.session.did });
          console.log('[BlueSkyService] Using existing valid session');
          return true;
        } catch (error: any) {
          if (error?.status === 429 && error?.headers) {
            BlueSkyRateLimits.GENERAL.updateFromHeaders(error.headers);
          }
          console.log('[BlueSkyService] Existing session invalid, re-authenticating');
          // Session invalid, continue with re-authentication
        }
      }

      // Check retry count
      if (retryCount >= BlueSkyService.MAX_AUTH_RETRIES) {
        console.error(`[BlueSkyService] Maximum authentication retries (${BlueSkyService.MAX_AUTH_RETRIES}) exceeded`);
        return false;
      }

      // Wait for authentication rate limit
      await BlueSkyRateLimits.AUTH.waitForNextSlot();

      console.log(`[BlueSkyService] Authenticating user: ${this.handle} (attempt ${retryCount + 1}/${BlueSkyService.MAX_AUTH_RETRIES})`);
      await this.agent.login({
        identifier: this.handle,
        password: this.password
      });
      
      console.log('[BlueSkyService] Authentication successful');
      return true;
    } catch (error: any) {
      if (error?.status === 429) {
        console.error('[BlueSkyService] Rate limit exceeded during authentication. Will retry with backoff.');
        if (error.headers) {
          BlueSkyRateLimits.AUTH.updateFromHeaders(error.headers);
        }
        // Wait for rate limit to reset before retrying
        await BlueSkyRateLimits.AUTH.waitForNextSlot();
        return this.authenticate(retryCount + 1);
      }
      
      console.error('[BlueSkyService] Authentication failed:', error);
      return false;
    } finally {
      this.authInProgress = false;
    }
  }

  /**
   * Get followers with optional cursor
   * @param cursor Optional cursor for pagination
   * @returns Promise resolving to followers response
   */
  async getFollowers(cursor?: string) {
    console.log(`[BlueSkyService] Fetching followers. Cursor: ${cursor || 'initial'}`);
    if (!this.agent.session) {
      const authSuccess = await this.authenticate();
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
   * Get profile information for a specific user
   * @param did Decentralized Identifier of the user
   * @returns Promise resolving to profile response
   */
  async getProfile(did: string) {
    console.log(`[BlueSkyService] Fetching profile for DID: ${did}`);
    if (!this.agent.session) {
      const authSuccess = await this.authenticate();
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
        const authSuccess = await this.authenticate();
        if (!authSuccess) {
          throw new Error('Failed to authenticate with BlueSky');
        }
      }

      // Wait for rate limit
      await BlueSkyRateLimits.GENERAL.waitForNextSlot();

      console.log(`[BlueSkyService] Fetching latest post for DID: ${did}`);
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
      console.error(`[BlueSkyService] Error fetching latest post for ${did}:`, error);
      return undefined;
    }
  }

  /**
   * Fetch and store followers
   * @returns Promise resolving to array of stored followers
   */
  async fetchAndStoreFollowers(): Promise<Partial<IFollower>[]> {
    try {
      console.log('[BlueSkyService] Starting follower fetch and store process');
      
      // Ensure we're authenticated
      if (!this.agent.session) {
        const authSuccess = await this.authenticate();
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
              const profileResponse = await this.getProfile(follower.did);
              const profile = profileResponse.data;

              // Get latest post timestamp
              const latestPostTimestamp = await this.getLatestPostTimestamp(follower.did);

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

              // Upsert follower (insert or update)
              const savedFollower = await Follower.findOneAndUpdate(
                { did: follower.did },
                followerData,
                { upsert: true, new: true }
              );

              // Calculate follower ratio and posts per day
              savedFollower.calculateFollowerRatio();
              savedFollower.calculatePostsPerDay();
              await savedFollower.save();

              // Call the callback if it exists
              if (this.onFollowerImported) {
                this.onFollowerImported(followerData);
              }

              storedFollowers.push(followerData);

              console.log(`[BlueSkyService] Imported follower: ${follower.handle}`);
            } catch (profileError: any) {
              if (profileError?.status === 429 && profileError?.headers) {
                BlueSkyRateLimits.GENERAL.updateFromHeaders(profileError.headers);
                // Wait before retrying this follower
                await BlueSkyRateLimits.GENERAL.waitForNextSlot();
                // Retry this follower
                continue;
              }
              console.error(`[BlueSkyService] Error fetching profile for ${follower.handle}:`, profileError);
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

      console.log(`[BlueSkyService] Total followers fetched and stored: ${storedFollowers.length}`);
      return storedFollowers;
    } catch (error) {
      console.error('[BlueSkyService] Error fetching and storing followers:', error);
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
      if (!this.agent.session) {
        const authSuccess = await this.authenticate();
        if (!authSuccess) {
          throw new Error('Failed to authenticate with BlueSky');
        }
      }

      // Unfollow the user
      await this.agent.deleteFollow(did);

      // Remove from local database
      await Follower.deleteOne({ did });

      return true;
    } catch (error: any) {
      if (error?.status === 429 && error?.headers) {
        BlueSkyRateLimits.UNFOLLOW.updateFromHeaders(error.headers);
      }
      console.error(`[BlueSkyService] Error unfollowing user ${did}:`, error);
      return false;
    }
  }

  /**
   * Retrieve stored followers from MongoDB
   * @returns Promise resolving to array of stored followers
   */
  async getStoredFollowers(): Promise<IFollower[]> {
    try {
      return await Follower.find().sort({ followedAt: -1 });
    } catch (error) {
      console.error('[BlueSkyService] Error retrieving stored followers:', error);
      return [];
    }
  }
}
