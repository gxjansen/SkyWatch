"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImportQueue = void 0;
const Follower_1 = require("../models/Follower");
const cliProgress = __importStar(require("cli-progress"));
class ImportQueue {
    constructor(blueSkyService) {
        this.isImporting = false;
        this.totalFollowersToImport = 0;
        this.blueSkyService = blueSkyService;
    }
    setSocketServer(io) {
        this.socketServer = io;
    }
    initializeProgressBar(total) {
        // Move cursor to bottom of terminal and create space for progress bar
        process.stdout.write('\n'.repeat(2));
        process.stdout.write('\x1B[1A'); // Move cursor up one line
        // Create a new progress bar with enhanced styling
        this.progressBar = new cliProgress.SingleBar({
            format: 'Import Progress |{bar}| {percentage}% || {value}/{total} Followers',
            barCompleteChar: '\u2588', // Full block character
            barIncompleteChar: '\u2591', // Light shade character
            hideCursor: true,
            clearOnComplete: true,
            stream: process.stdout, // Explicitly set output stream
        });
        // Start the progress bar
        this.progressBar.start(total, 0);
    }
    async startImport() {
        // Prevent multiple simultaneous imports
        if (this.isImporting) {
            console.log('[ImportQueue] Import already in progress');
            throw new Error('Import already in progress');
        }
        this.isImporting = true;
        console.log('[ImportQueue] Starting import process');
        try {
            // Authenticate first
            const authResult = await this.blueSkyService.authenticate();
            if (!authResult) {
                console.error('[ImportQueue] Authentication failed');
                this.isImporting = false;
                throw new Error('Authentication failed');
            }
            // Clear existing followers
            await Follower_1.Follower.deleteMany({});
            console.log('[ImportQueue] Existing followers cleared');
            // Estimate total followers to import
            const initialFollowersResponse = await this.blueSkyService.getFollowers();
            this.totalFollowersToImport = initialFollowersResponse.data.follows.length;
            // Initialize progress bar
            this.initializeProgressBar(this.totalFollowersToImport);
            // Start the import process
            await this.importFollowersBatched();
        }
        catch (error) {
            console.error('[ImportQueue] Import process failed:', error);
            this.isImporting = false;
            throw error;
        }
        finally {
            // Stop progress bar if it exists
            if (this.progressBar) {
                this.progressBar.stop();
            }
            // Ensure importing flag is reset
            this.isImporting = false;
            // Emit final import status
            if (this.socketServer) {
                const totalFollowers = await Follower_1.Follower.countDocuments();
                this.socketServer.emit('importComplete', {
                    total: totalFollowers,
                    complete: true
                });
                console.log(`\n[ImportQueue] Import completed. Total followers: ${totalFollowers}`);
            }
        }
    }
    async importFollowersBatched(cursor) {
        try {
            // Fetch followers with cursor for pagination
            const followersResponse = await this.blueSkyService.getFollowers(cursor);
            console.log(`[ImportQueue] Fetched followers batch. Cursor: ${cursor || 'initial'}`);
            // Process each follower
            for (const follower of followersResponse.data.follows) {
                try {
                    // Fetch additional profile information
                    const profileResponse = await this.blueSkyService.getProfile(follower.did);
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
                    // Upsert follower
                    const savedFollower = await Follower_1.Follower.findOneAndUpdate({ did: follower.did }, followerData, { upsert: true, new: true });
                    // Calculate follower ratio
                    savedFollower.calculateFollowerRatio();
                    await savedFollower.save();
                    // Update progress bar
                    if (this.progressBar) {
                        const totalFollowers = await Follower_1.Follower.countDocuments();
                        this.progressBar.update(totalFollowers);
                    }
                    // Emit progress if socket is available
                    if (this.socketServer) {
                        const totalFollowers = await Follower_1.Follower.countDocuments();
                        this.socketServer.emit('followerImportProgress', {
                            total: totalFollowers,
                            complete: false
                        });
                    }
                    // Optional: Add a small delay to respect rate limits
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                catch (profileError) {
                    console.error(`[ImportQueue] Error processing follower ${follower.handle}:`, profileError);
                }
            }
            // Check if there are more followers to import
            if (followersResponse.data.cursor) {
                // Continue importing with the next cursor
                await this.importFollowersBatched(followersResponse.data.cursor);
            }
        }
        catch (error) {
            console.error('[ImportQueue] Batched import error:', error);
            throw error;
        }
    }
    isCurrentlyImporting() {
        return this.isImporting;
    }
}
exports.ImportQueue = ImportQueue;
//# sourceMappingURL=ImportQueue.js.map