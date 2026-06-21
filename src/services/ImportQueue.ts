import { Follower, IFollower } from '../models/Follower';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import * as cliProgress from 'cli-progress';
import { IBlueSkyService } from './interfaces/IBlueSkyService';

export interface ImportOptions {
  clearExisting?: boolean;
}

export class ImportQueue {
  private blueSkyService: IBlueSkyService;
  public socketServer?: Server;
  private isImporting: boolean = false;
  private progressBar?: cliProgress.SingleBar;
  private totalFollowersToImport: number = 0;
  // DIDs still followed as of the current pass; used to prune removed accounts.
  private seenDids: Set<string> = new Set();
  // Accounts processed (added, refreshed, or skipped-as-fresh) this pass.
  private processedCount: number = 0;
  // Accounts whose data is older than this are re-fetched; newer ones are skipped.
  private staleCutoff: Date = new Date(0);

  constructor(blueSkyService: IBlueSkyService) {
    this.blueSkyService = blueSkyService;
  }

  setSocketServer(io: Server) {
    this.socketServer = io;
  }

  private async getTotalFollowerCount(): Promise<number> {
    try {
      // Get the authenticated user's profile to get total follower count
      const profile = await this.blueSkyService.getCurrentUserProfile();
      return profile.data.followsCount || 0;
    } catch (error) {
      console.error('[ImportQueue] Error getting total follower count:', error);
      return 0;
    }
  }

  private initializeProgressBar(total: number, current: number = 0): void {
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

    // Start the progress bar with current progress
    this.progressBar.start(total, current);
  }

  async startImport(options: ImportOptions = {}): Promise<void> {
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

      // Clear existing followers if requested
      if (options.clearExisting) {
        await Follower.deleteMany({});
        console.log('[ImportQueue] Existing followers cleared');
      }

      // Get total follower count for accurate progress tracking
      this.totalFollowersToImport = await this.getTotalFollowerCount();
      const existingCount = await Follower.countDocuments();
      console.log(`[ImportQueue] Total followers to import: ${this.totalFollowersToImport} (${existingCount} existing)`);

      // Progress is tracked by accounts processed this pass (out of the live
      // follow count), so it advances even when refreshing existing records.
      this.initializeProgressBar(this.totalFollowersToImport, 0);

      // Reset per-pass tracking.
      this.seenDids = new Set();
      this.processedCount = 0;

      // Accounts not refreshed within this window are re-fetched (default 7 days).
      const staleDays = Number(process.env.REFRESH_STALE_DAYS || 7);
      this.staleCutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

      // Start the import process
      await this.importFollowersBatched();

      // Prune accounts that are no longer followed (unfollowed since last import).
      // Skip when doing a full clear+reimport, and only prune if we actually saw
      // follows this pass (guards against wiping everything on an anomaly).
      if (!options.clearExisting && this.seenDids.size > 0) {
        const pruneResult = await Follower.deleteMany({ did: { $nin: Array.from(this.seenDids) } });
        if (pruneResult.deletedCount) {
          console.log(`[ImportQueue] Pruned ${pruneResult.deletedCount} account(s) no longer followed`);
        }
      }
    } catch (error) {
      console.error('[ImportQueue] Import process failed:', error);
      this.isImporting = false;
      throw error;
    } finally {
      // Stop progress bar if it exists
      if (this.progressBar) {
        this.progressBar.stop();
      }

      // Ensure importing flag is reset
      this.isImporting = false;
      
      // Emit final import status
      if (this.socketServer) {
        const totalFollowers = await Follower.countDocuments();
        this.socketServer.emit('importComplete', {
          total: totalFollowers,
          complete: true
        });
        console.log(`\n[ImportQueue] Import completed. Total followers: ${totalFollowers}`);
      }
    }
  }

  private async importFollowersBatched(cursor?: string): Promise<void> {
    try {
      // Fetch followers with cursor for pagination
      const followersResponse = await this.blueSkyService.getFollowers(cursor);
      console.log(`[ImportQueue] Fetched followers batch. Cursor: ${cursor || 'initial'}`);

      // Process each follower
      for (const follower of followersResponse.data.follows) {
        // Record that this account is still followed (used for pruning).
        this.seenDids.add(follower.did);
        try {
          const existingFollower = await Follower.findOne({ did: follower.did });

          // Skip accounts whose data is still fresh; re-fetch new or stale ones.
          const isFresh = !!(existingFollower
            && existingFollower.lastFetchedAt
            && existingFollower.lastFetchedAt > this.staleCutoff);

          if (isFresh) {
            console.log(`[ImportQueue] Fresh, skipping: ${follower.handle}`);
          } else {
            // Fetch profile + latest post (new account, or stale data).
            const profileResponse = await this.blueSkyService.getProfile(follower.did);
            const profile = profileResponse.data;
            const latestPostTimestamp = await this.blueSkyService.getLatestPostTimestamp(follower.did);

            const followerData: Partial<IFollower> = {
              did: follower.did,
              handle: follower.handle,
              displayName: follower.displayName,
              avatar: follower.avatar,
              followerCount: profile.followersCount || 0,
              followingCount: profile.followsCount || 0,
              postCount: profile.postsCount || 0,
              joinedAt: profile.createdAt ? new Date(profile.createdAt) : undefined,
              lastPostAt: latestPostTimestamp,
              lastFetchedAt: new Date()
            };
            // Preserve the original first-seen date; only set it for new records.
            if (!existingFollower) {
              followerData.followedAt = new Date();
            }

            const savedFollower = await Follower.findOneAndUpdate(
              { did: follower.did },
              followerData,
              { upsert: true, new: true }
            );

            savedFollower.calculateFollowerRatio();
            savedFollower.calculatePostsPerDay();
            await savedFollower.save();

            console.log(`[ImportQueue] ${existingFollower ? 'Refreshed' : 'Imported'} follower: ${follower.handle}`);
          }
        } catch (profileError) {
          console.error(`[ImportQueue] Error processing follower ${follower.handle}:`, profileError);
        } finally {
          this.processedCount++;
        }

        // Update progress bar by accounts processed this pass.
        if (this.progressBar) {
          this.progressBar.update(this.processedCount);
          if (this.socketServer) {
            this.socketServer.emit('followerImportProgress', {
              total: this.processedCount,
              complete: false
            });
          }
        }
      }

      // Check if there are more followers to import
      if (followersResponse.data.cursor) {
        // Continue importing with the next cursor
        await this.importFollowersBatched(followersResponse.data.cursor);
      }
    } catch (error) {
      console.error('[ImportQueue] Batched import error:', error);
      throw error;
    }
  }

  isCurrentlyImporting(): boolean {
    return this.isImporting;
  }

  getImportTarget(): number {
    return this.totalFollowersToImport;
  }

  getProcessedCount(): number {
    return this.processedCount;
  }
}
