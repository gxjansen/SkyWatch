"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlueSkyService = void 0;
const api_1 = require("@atproto/api");
const mongoose_1 = __importDefault(require("mongoose"));
const Follower_1 = require("../models/Follower");
const dotenv_1 = __importDefault(require("dotenv"));
const RateLimiter_1 = require("./RateLimiter");
dotenv_1.default.config();
class BlueSkyService {
    constructor(handle, password) {
        this.authPromise = null;
        if (!handle || !password) {
            throw new Error('BlueSky handle and password are required');
        }
        // Initialize BlueSky agent
        this.agent = new api_1.BskyAgent({
            service: 'https://bsky.social'
        });
        this.handle = handle;
        this.password = password;
    }
    /**
     * Get the current authenticated user's DID
     * @returns The DID of the authenticated user
     */
    getCurrentUserDid() {
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
            await RateLimiter_1.BlueSkyRateLimits.GENERAL.waitForNextSlot();
            return await this.getProfile(this.agent.session.did);
        }
        catch (error) {
            if (error?.status === 429 && error?.headers) {
                RateLimiter_1.BlueSkyRateLimits.GENERAL.updateFromHeaders(error.headers);
                throw error;
            }
            throw error;
        }
    }
    /**
     * Authenticate with BlueSky
     * @returns Promise resolving to boolean indicating authentication success
     */
    async authenticate(retryCount = 0) {
        // If there's already an authentication in progress, wait for it
        if (this.authPromise) {
            console.log('[BlueSkyService] Authentication already in progress, waiting for completion...');
            return this.authPromise;
        }
        // Create new authentication promise
        this.authPromise = this.performAuthentication(retryCount);
        try {
            return await this.authPromise;
        }
        finally {
            this.authPromise = null;
        }
    }
    /**
     * Internal method to perform authentication
     */
    async performAuthentication(retryCount) {
        try {
            // If already authenticated with a valid session, verify it
            if (this.agent.session?.did) {
                try {
                    // Verify the session is still valid
                    await RateLimiter_1.BlueSkyRateLimits.GENERAL.waitForNextSlot();
                    await this.agent.getProfile({ actor: this.agent.session.did });
                    console.log('[BlueSkyService] Using existing valid session');
                    return true;
                }
                catch (error) {
                    if (error?.status === 429 && error?.headers) {
                        RateLimiter_1.BlueSkyRateLimits.GENERAL.updateFromHeaders(error.headers);
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
            await RateLimiter_1.BlueSkyRateLimits.AUTH.waitForNextSlot();
            console.log(`[BlueSkyService] Authenticating user: ${this.handle} (attempt ${retryCount + 1}/${BlueSkyService.MAX_AUTH_RETRIES})`);
            await this.agent.login({
                identifier: this.handle,
                password: this.password
            });
            console.log('[BlueSkyService] Authentication successful');
            return true;
        }
        catch (error) {
            if (error?.status === 429) {
                console.error('[BlueSkyService] Rate limit exceeded during authentication. Will retry with backoff.');
                if (error.headers) {
                    RateLimiter_1.BlueSkyRateLimits.AUTH.updateFromHeaders(error.headers);
                }
                // Wait for rate limit to reset before retrying
                await RateLimiter_1.BlueSkyRateLimits.AUTH.waitForNextSlot();
                return this.authenticate(retryCount + 1);
            }
            console.error('[BlueSkyService] Authentication failed:', error);
            return false;
        }
    }
    /**
     * Get followers with optional cursor
     * @param cursor Optional cursor for pagination
     * @returns Promise resolving to followers response
     */
    async getFollowers(cursor) {
        console.log(`[BlueSkyService] Fetching followers. Cursor: ${cursor || 'initial'}`);
        if (!this.agent.session) {
            const authSuccess = await this.authenticate();
            if (!authSuccess) {
                throw new Error('Failed to authenticate with BlueSky');
            }
        }
        try {
            // Wait for rate limit
            await RateLimiter_1.BlueSkyRateLimits.FOLLOWS.waitForNextSlot();
            return await this.agent.getFollows({
                actor: this.agent.session.did,
                cursor: cursor,
                limit: 100 // Maximum allowed by BlueSky API
            });
        }
        catch (error) {
            if (error?.status === 429 && error?.headers) {
                RateLimiter_1.BlueSkyRateLimits.FOLLOWS.updateFromHeaders(error.headers);
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
    async getProfile(did) {
        console.log(`[BlueSkyService] Fetching profile for DID: ${did}`);
        if (!this.agent.session) {
            const authSuccess = await this.authenticate();
            if (!authSuccess) {
                throw new Error('Failed to authenticate with BlueSky');
            }
        }
        try {
            // Wait for rate limit
            await RateLimiter_1.BlueSkyRateLimits.GENERAL.waitForNextSlot();
            return await this.agent.getProfile({ actor: did });
        }
        catch (error) {
            if (error?.status === 429 && error?.headers) {
                RateLimiter_1.BlueSkyRateLimits.GENERAL.updateFromHeaders(error.headers);
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
    async getLatestPostTimestamp(did) {
        try {
            if (!this.agent.session) {
                const authSuccess = await this.authenticate();
                if (!authSuccess) {
                    throw new Error('Failed to authenticate with BlueSky');
                }
            }
            // Wait for rate limit
            await RateLimiter_1.BlueSkyRateLimits.GENERAL.waitForNextSlot();
            console.log(`[BlueSkyService] Fetching latest post for DID: ${did}`);
            const feed = await this.agent.getAuthorFeed({
                actor: did,
                limit: 1
            });
            if (feed.data.feed.length > 0) {
                return new Date(feed.data.feed[0].post.indexedAt);
            }
            return undefined;
        }
        catch (error) {
            if (error?.status === 429 && error?.headers) {
                RateLimiter_1.BlueSkyRateLimits.GENERAL.updateFromHeaders(error.headers);
            }
            console.error(`[BlueSkyService] Error fetching latest post for ${did}:`, error);
            return undefined;
        }
    }
    /**
     * Fetch and store followers
     * @returns Promise resolving to array of stored followers
     */
    async fetchAndStoreFollowers() {
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
            await RateLimiter_1.BlueSkyRateLimits.FOLLOWS.waitForNextSlot();
            // Establish MongoDB connection
            await mongoose_1.default.connect(process.env.MONGODB_URI || '');
            // Initialize variables for pagination
            let cursor;
            const storedFollowers = [];
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
                            const followerData = {
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
                            const savedFollower = await Follower_1.Follower.findOneAndUpdate({ did: follower.did }, followerData, { upsert: true, new: true });
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
                        }
                        catch (profileError) {
                            if (profileError?.status === 429 && profileError?.headers) {
                                RateLimiter_1.BlueSkyRateLimits.GENERAL.updateFromHeaders(profileError.headers);
                                // Wait before retrying this follower
                                await RateLimiter_1.BlueSkyRateLimits.GENERAL.waitForNextSlot();
                                // Retry this follower
                                continue;
                            }
                            console.error(`[BlueSkyService] Error fetching profile for ${follower.handle}:`, profileError);
                        }
                    }
                    // Update cursor for next iteration
                    cursor = followersResponse.data.cursor;
                    // Break if no more followers
                    if (!cursor)
                        break;
                }
                catch (error) {
                    if (error?.status === 429 && error?.headers) {
                        RateLimiter_1.BlueSkyRateLimits.FOLLOWS.updateFromHeaders(error.headers);
                        // Wait before retrying this batch
                        await RateLimiter_1.BlueSkyRateLimits.FOLLOWS.waitForNextSlot();
                        // Retry this batch (don't update cursor)
                        continue;
                    }
                    throw error;
                }
            }
            console.log(`[BlueSkyService] Total followers fetched and stored: ${storedFollowers.length}`);
            return storedFollowers;
        }
        catch (error) {
            console.error('[BlueSkyService] Error fetching and storing followers:', error);
            throw error; // Re-throw to ensure error is properly handled by caller
        }
        finally {
            // Ensure connection is closed
            await mongoose_1.default.connection.close();
        }
    }
    /**
     * Unfollow a user
     * @param did Decentralized Identifier of the user to unfollow
     * @returns Promise resolving to boolean indicating success
     */
    async unfollowUser(did) {
        try {
            // Wait for rate limit
            await RateLimiter_1.BlueSkyRateLimits.UNFOLLOW.waitForNextSlot();
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
            await Follower_1.Follower.deleteOne({ did });
            return true;
        }
        catch (error) {
            if (error?.status === 429 && error?.headers) {
                RateLimiter_1.BlueSkyRateLimits.UNFOLLOW.updateFromHeaders(error.headers);
            }
            console.error(`[BlueSkyService] Error unfollowing user ${did}:`, error);
            return false;
        }
    }
    /**
     * Retrieve stored followers from MongoDB
     * @returns Promise resolving to array of stored followers
     */
    async getStoredFollowers() {
        try {
            return await Follower_1.Follower.find().sort({ followedAt: -1 });
        }
        catch (error) {
            console.error('[BlueSkyService] Error retrieving stored followers:', error);
            return [];
        }
    }
}
exports.BlueSkyService = BlueSkyService;
BlueSkyService.MAX_AUTH_RETRIES = 3;
//# sourceMappingURL=BlueSkyService.js.map