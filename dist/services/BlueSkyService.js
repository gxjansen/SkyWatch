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
        // Initialize BlueSky agent
        this.agent = new api_1.BskyAgent({
            service: 'https://bsky.social'
        });
        this.handle = handle;
        this.password = password;
    }
    /**
     * Authenticate with BlueSky
     * @returns Promise resolving to boolean indicating authentication success
     */
    async authenticate() {
        try {
            console.log(`[BlueSkyService] Authenticating user: ${this.handle}`);
            await this.agent.login({
                identifier: this.handle,
                password: this.password
            });
            console.log('[BlueSkyService] Authentication successful');
            return true;
        }
        catch (error) {
            console.error('Authentication failed:', error);
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
            await this.authenticate();
        }
        return this.agent.getFollows({
            actor: this.agent.session?.did || '',
            cursor: cursor,
            limit: 100 // Maximum allowed by BlueSky API
        });
    }
    /**
     * Get profile information for a specific user
     * @param did Decentralized Identifier of the user
     * @returns Promise resolving to profile response
     */
    async getProfile(did) {
        console.log(`[BlueSkyService] Fetching profile for DID: ${did}`);
        return this.agent.getProfile({ actor: did });
    }
    /**
     * Fetch and store followers
     * @returns Promise resolving to array of stored followers
     */
    async fetchAndStoreFollowers() {
        try {
            console.log('[BlueSkyService] Starting follower fetch and store process');
            // Wait for rate limit
            await RateLimiter_1.BlueSkyRateLimits.FOLLOWS.waitForNextSlot();
            // Establish MongoDB connection
            await mongoose_1.default.connect(process.env.MONGODB_URI || '');
            // Initialize variables for pagination
            let cursor;
            const storedFollowers = [];
            // Fetch all followers without a hard limit
            while (true) {
                // Fetch followers with cursor for pagination
                const followersResponse = await this.getFollowers(cursor);
                // Store followers in MongoDB
                for (const follower of followersResponse.data.follows) {
                    try {
                        // Fetch additional profile information
                        const profileResponse = await this.getProfile(follower.did);
                        const profile = profileResponse.data;
                        const followerData = {
                            did: follower.did,
                            handle: follower.handle,
                            displayName: follower.displayName,
                            avatar: follower.avatar,
                            followedAt: new Date(),
                            followerCount: profile.followersCount || 0,
                            followingCount: profile.followsCount || 0,
                            postCount: profile.postsCount || 0,
                            joinedAt: profile.createdAt ? new Date(profile.createdAt) : undefined
                        };
                        // Upsert follower (insert or update)
                        const savedFollower = await Follower_1.Follower.findOneAndUpdate({ did: follower.did }, followerData, { upsert: true, new: true });
                        // Calculate follower ratio
                        savedFollower.calculateFollowerRatio();
                        await savedFollower.save();
                        // Call the callback if it exists
                        if (this.onFollowerImported) {
                            this.onFollowerImported(followerData);
                        }
                        storedFollowers.push(followerData);
                        console.log(`[BlueSkyService] Imported follower: ${follower.handle}`);
                    }
                    catch (profileError) {
                        console.error(`[BlueSkyService] Error fetching profile for ${follower.handle}:`, profileError);
                    }
                }
                // Update cursor for next iteration
                cursor = followersResponse.data.cursor;
                // Break if no more followers
                if (!cursor)
                    break;
                // Optional: Add a small delay to respect rate limits
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            console.log(`[BlueSkyService] Total followers fetched and stored: ${storedFollowers.length}`);
            return storedFollowers;
        }
        catch (error) {
            console.error('[BlueSkyService] Error fetching and storing followers:', error);
            return [];
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
                await this.authenticate();
            }
            // Unfollow the user
            await this.agent.deleteFollow(did);
            // Remove from local database
            await Follower_1.Follower.deleteOne({ did });
            return true;
        }
        catch (error) {
            console.error(`Error unfollowing user ${did}:`, error);
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
            console.error('Error retrieving stored followers:', error);
            return [];
        }
    }
}
exports.BlueSkyService = BlueSkyService;
//# sourceMappingURL=BlueSkyService.js.map