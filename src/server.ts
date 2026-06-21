import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Follower, IFollower } from './models/Follower';
import { BlueSkyService } from './services/BlueSkyService';  // This path is correct since BlueSkyService is the orchestrator
import { ImportQueue } from './services/ImportQueue';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { getOAuthClient } from './services/auth/oauthClient';
import { randomUUID } from 'crypto';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  pingTimeout: 60000,
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const PORT = process.env.PORT || 3000;
const FOLLOWERS_PER_PAGE = 100;

// Parse command line arguments
const args = process.argv.slice(2);
const shouldForceImport = args.includes('--force-import');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Set view engine and views directory
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Auth is OAuth-backed. OWNER_DID is optional (single-user tool); the stored
// session is used when omitted. No BlueSky credentials live in the environment.
const blueSkyService = new BlueSkyService(process.env.OWNER_DID);

const importQueue = new ImportQueue(blueSkyService);
importQueue.setSocketServer(io);

mongoose.connect(process.env.MONGODB_URI || '')
  .then(async () => {
    console.log('MongoDB connected for web server');

    // One-time backfill: records imported before lastFetchedAt existed have no
    // value and would show "Never". Seed it from updatedAt (when the record was
    // last written/fetched). Idempotent — only fills records missing the field.
    try {
      const backfill = await Follower.updateMany(
        { lastFetchedAt: { $exists: false } },
        [{ $set: { lastFetchedAt: '$updatedAt' } }]
      );
      if (backfill.modifiedCount) {
        console.log(`[startup] Backfilled lastFetchedAt for ${backfill.modifiedCount} record(s)`);
      }
    } catch (err) {
      console.error('[startup] lastFetchedAt backfill failed:', err);
    }

    // Restore the persisted OAuth session (if the owner has logged in before).
    const authenticated = await blueSkyService.authenticate();
    if (!authenticated) {
      console.log(`[startup] No OAuth session yet. Visit http://127.0.0.1:${PORT}/login?handle=<your-handle> to connect BlueSky.`);
      return;
    }
    // Start import if requested and we have a usable session.
    if (shouldForceImport || process.env.AUTO_IMPORT === 'true') {
      console.log('Starting follower import process...');
      importQueue.startImport({ clearExisting: shouldForceImport })
        .catch(err => console.error('Import process failed:', err));
    }
  })
  .catch(err => console.error('MongoDB connection error:', err));

// --- OAuth routes ---

// Begin the OAuth flow: resolves the handle and redirects to the user's PDS authorize page.
app.get('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const handle = String(req.query.handle || process.env.OWNER_HANDLE || '').trim();
    if (!handle) {
      return res.status(400).send('Provide a handle: /login?handle=you.bsky.social');
    }
    const state = randomUUID();
    const oauthClient = await getOAuthClient();
    const url = await oauthClient.authorize(handle, { state });
    res.redirect(url.toString());
  } catch (error) {
    console.error('[OAuth] authorize failed:', error);
    next(error);
  }
});

// OAuth redirect target: exchanges the code and persists the session.
app.get('/oauth/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const oauthClient = await getOAuthClient();
    const { session } = await oauthClient.callback(params);
    console.log(`[OAuth] Logged in as ${session.did}`);
    // Pick up the freshly stored session for this process.
    await blueSkyService.authenticate();
    res.redirect('/');
  } catch (error) {
    console.error('[OAuth] callback failed:', error);
    next(error);
  }
});

interface FilterQuery {
  followerCount?: {
    $gte?: number;
    $lte?: number;
  };
  followingCount?: {
    $gte?: number;
    $lte?: number;
  };
  postCount?: {
    $gte?: number;
    $lte?: number;
  };
  postsPerDay?: {
    $gte?: number;
    $lte?: number;
  };
  followerRatio?: {
    $gte?: number;
    $lte?: number;
  };
  joinedAt?: {
    $gte?: Date;
    $lte?: Date;
  };
  lastPostAt?: {
    $gte?: Date;
    $lte?: Date;
  };
}

interface QueryParams {
  page?: string;
  minFollowers?: string;
  maxFollowers?: string;
  minFollowing?: string;
  maxFollowing?: string;
  minPosts?: string;
  maxPosts?: string;
  minPostsPerDay?: string;
  maxPostsPerDay?: string;
  minFollowerRatio?: string;
  maxFollowerRatio?: string;
  minJoined?: string;
  maxJoined?: string;
  minLastPost?: string;
  maxLastPost?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

interface MainUser {
  handle: string;
  displayName?: string;
  avatar: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
  postsPerDay: number;
  followerRatio: number;
  joinedAt: string;
  lastPostAt: string | null;
}

// Parse a yyyy-mm-dd date string as the end of that day, so max-date filters
// include the whole day rather than cutting off at midnight.
function endOfDay(dateStr: string): Date {
  const d = new Date(dateStr);
  d.setHours(23, 59, 59, 999);
  return d;
}

// Helper function to get user profile data
async function getUserProfileData(blueSkyService: BlueSkyService): Promise<MainUser> {
  try {
    const authSuccess = await blueSkyService.authenticate();
    if (!authSuccess) {
      throw new Error('Authentication failed');
    }

    const mainUserProfile = await blueSkyService.getCurrentUserProfile();
    
    // Calculate posts per day
    const joinedDate = mainUserProfile.data.createdAt ? new Date(mainUserProfile.data.createdAt) : new Date();
    const daysSinceJoined = Math.max(1, Math.floor((Date.now() - joinedDate.getTime()) / (1000 * 60 * 60 * 24)));
    const postsCount = mainUserProfile.data.postsCount || 0;
    const postsPerDay = postsCount / daysSinceJoined;
    
    // Calculate follower ratio
    const followersCount = mainUserProfile.data.followersCount || 0;
    const followsCount = mainUserProfile.data.followsCount || 1;
    const followerRatio = followersCount / followsCount;

    return {
      handle: mainUserProfile.data.handle || '',
      displayName: mainUserProfile.data.displayName || mainUserProfile.data.handle,
      avatar: mainUserProfile.data.avatar || '',
      followerCount: followersCount,
      followingCount: followsCount,
      postCount: postsCount,
      postsPerDay: Number(postsPerDay.toFixed(1)),
      followerRatio: Number(followerRatio.toFixed(1)),
      joinedAt: mainUserProfile.data.createdAt || new Date().toISOString(),
      lastPostAt: null
    };
  } catch (error) {
    console.error('Failed to get initial profile data:', error);
    // Return default values
    return {
      handle: process.env.OWNER_HANDLE || '',
      displayName: process.env.OWNER_HANDLE || '',
      avatar: '',
      followerCount: 0,
      followingCount: 0,
      postCount: 0,
      postsPerDay: 0,
      followerRatio: 0,
      joinedAt: new Date().toISOString(),
      lastPostAt: null
    };
  }
}

// API endpoint to get user profile
app.get('/api/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mainUser = await getUserProfileData(blueSkyService);
    res.json(mainUser);
  } catch (error: any) {
    if (error?.status === 429) {
      res.status(429).json({ 
        error: 'Rate limit exceeded', 
        retryAfter: error?.headers?.['retry-after'] || 300 
      });
    } else {
      next(error);
    }
  }
});

// Unfollow endpoint
app.post('/unfollow', async (req: Request, res: Response) => {
  try {
    const { did } = req.body;
    if (!did) {
      return res.status(400).json({ success: false, message: 'DID is required' });
    }

    const success = await blueSkyService.unfollowUser(did);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false, message: 'Failed to unfollow user' });
    }
  } catch (error: any) {
    console.error('Error in unfollow endpoint:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'An error occurred while unfollowing the user'
    });
  }
});

// Trigger a follower refresh: adds newly-followed accounts and prunes any that
// are no longer followed. Progress is polled via /import-progress.
app.post('/import', async (req: Request, res: Response) => {
  try {
    const connected = await blueSkyService.authenticate();
    if (!connected) {
      return res.status(401).json({ success: false, message: 'Not connected to BlueSky. Visit /login.' });
    }
    if (importQueue.isCurrentlyImporting()) {
      return res.status(409).json({ success: false, message: 'A refresh is already in progress' });
    }
    // Fire-and-forget; the client polls /import-progress for status.
    importQueue.startImport({ clearExisting: false })
      .catch(err => console.error('Refresh import failed:', err));
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error starting refresh:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to start refresh' });
  }
});

// Import progress polling endpoint (consumed by the front-end).
app.get('/import-progress', async (req: Request, res: Response) => {
  try {
    const total = await Follower.countDocuments();
    res.json({
      isImporting: importQueue.isCurrentlyImporting(),
      total,
      processed: importQueue.getProcessedCount(),
      target: importQueue.getImportTarget()
    });
  } catch (error) {
    res.status(500).json({ isImporting: false, total: 0, target: 0 });
  }
});

// Main page route with error handling
app.get('/', async (req: Request<{}, {}, {}, QueryParams>, res: Response, next: NextFunction) => {
  try {
    console.log('Handling main page request...');
    const page = parseInt(req.query.page || '1');
    const skip = (page - 1) * FOLLOWERS_PER_PAGE;
    const sortBy = req.query.sortBy || 'followedAt';
    const sortOrder = req.query.sortOrder || 'desc';

    console.log('Getting initial profile data...');
    // Get initial profile data
    const mainUser = await getUserProfileData(blueSkyService);
    console.log('Got profile data:', mainUser);

    // Whether a real OAuth session is active. When false, the page is showing
    // cached data only and we surface a "Connect BlueSky" prompt.
    const connected = await blueSkyService.authenticate();

    // Filter parameters
    const filters: FilterQuery = {};

    // Add filter logic for each parameter...
    if (req.query.minFollowers) {
      filters.followerCount = { $gte: parseInt(req.query.minFollowers) };
    }
    if (req.query.maxFollowers) {
      filters.followerCount = {
        ...filters.followerCount,
        $lte: parseInt(req.query.maxFollowers)
      };
    }

    // Following count filter
    if (req.query.minFollowing) {
      filters.followingCount = { $gte: parseInt(req.query.minFollowing) };
    }
    if (req.query.maxFollowing) {
      filters.followingCount = {
        ...filters.followingCount,
        $lte: parseInt(req.query.maxFollowing)
      };
    }

    // Posts count filter
    if (req.query.minPosts) {
      filters.postCount = { $gte: parseInt(req.query.minPosts) };
    }
    if (req.query.maxPosts) {
      filters.postCount = {
        ...filters.postCount,
        $lte: parseInt(req.query.maxPosts)
      };
    }

    // Posts per day filter
    if (req.query.minPostsPerDay) {
      filters.postsPerDay = { $gte: parseFloat(req.query.minPostsPerDay) };
    }
    if (req.query.maxPostsPerDay) {
      filters.postsPerDay = {
        ...filters.postsPerDay,
        $lte: parseFloat(req.query.maxPostsPerDay)
      };
    }

    // Follower ratio filter
    if (req.query.minFollowerRatio) {
      filters.followerRatio = { $gte: parseFloat(req.query.minFollowerRatio) };
    }
    if (req.query.maxFollowerRatio) {
      filters.followerRatio = {
        ...filters.followerRatio,
        $lte: parseFloat(req.query.maxFollowerRatio)
      };
    }

    // Joined date filter
    if (req.query.minJoined) {
      filters.joinedAt = { $gte: new Date(req.query.minJoined) };
    }
    if (req.query.maxJoined) {
      filters.joinedAt = {
        ...filters.joinedAt,
        $lte: endOfDay(req.query.maxJoined)
      };
    }

    // Last post date filter
    if (req.query.minLastPost) {
      filters.lastPostAt = { $gte: new Date(req.query.minLastPost) };
    }
    if (req.query.maxLastPost) {
      filters.lastPostAt = {
        ...filters.lastPostAt,
        $lte: endOfDay(req.query.maxLastPost)
      };
    }

    console.log('Fetching followers from database...');
    // Create sort object for MongoDB
    const sortObject: { [key: string]: 1 | -1 } = {
      [sortBy]: sortOrder === 'asc' ? 1 : -1
    };

    // Fetch data from database
    const followers = await blueSkyService.getStoredFollowers();
    const totalFollowers = followers.length;

    // Compute data freshness across all stored accounts.
    const staleDays = Number(process.env.REFRESH_STALE_DAYS || 7);
    const staleCutoffMs = Date.now() - staleDays * 24 * 60 * 60 * 1000;
    const fetchTimesMs = followers
      .map(f => (f.lastFetchedAt ? f.lastFetchedAt.getTime() : null))
      .filter((t): t is number => t !== null);
    const freshness = {
      staleDays,
      newest: fetchTimesMs.length ? new Date(Math.max(...fetchTimesMs)) : null,
      oldest: fetchTimesMs.length ? new Date(Math.min(...fetchTimesMs)) : null,
      staleCount: followers.filter(f => !f.lastFetchedAt || f.lastFetchedAt.getTime() < staleCutoffMs).length,
      neverFetched: followers.filter(f => !f.lastFetchedAt).length
    };

    // Apply filters in memory. Numeric ranges treat a missing value as 0;
    // date ranges exclude records with no date when that filter is active.
    const inNumRange = (val: number | undefined, range?: { $gte?: number; $lte?: number }) => {
      if (!range) return true;
      const v = typeof val === 'number' ? val : 0;
      if (range.$gte !== undefined && v < range.$gte) return false;
      if (range.$lte !== undefined && v > range.$lte) return false;
      return true;
    };
    const inDateRange = (val: Date | undefined, range?: { $gte?: Date; $lte?: Date }) => {
      if (!range) return true;
      if (!val) return false;
      const t = val.getTime();
      if (range.$gte !== undefined && t < range.$gte.getTime()) return false;
      if (range.$lte !== undefined && t > range.$lte.getTime()) return false;
      return true;
    };

    const filteredFollowers = followers.filter(follower =>
      inNumRange(follower.followerCount, filters.followerCount) &&
      inNumRange(follower.followingCount, filters.followingCount) &&
      inNumRange(follower.postCount, filters.postCount) &&
      inNumRange(follower.postsPerDay, filters.postsPerDay) &&
      inNumRange(follower.followerRatio, filters.followerRatio) &&
      inDateRange(follower.joinedAt, filters.joinedAt) &&
      inDateRange(follower.lastPostAt, filters.lastPostAt)
    );

    // Pagination is based on the filtered result set.
    const totalPages = Math.max(1, Math.ceil(filteredFollowers.length / FOLLOWERS_PER_PAGE));

    // Sort and paginate
    const sortedFollowers = filteredFollowers.sort((a, b) => {
      const aValue = (a as any)[sortBy];
      const bValue = (b as any)[sortBy];
      return (sortOrder === 'asc' ? 1 : -1) * (aValue > bValue ? 1 : -1);
    });

    const paginatedFollowers = sortedFollowers.slice(skip, skip + FOLLOWERS_PER_PAGE);

    // Calculate aggregate stats from filtered followers. Guard against an empty
    // result set (Math.min/max of [] is ±Infinity).
    const safeMin = (arr: number[]) => (arr.length ? Math.min(...arr) : 0);
    const safeMax = (arr: number[]) => (arr.length ? Math.max(...arr) : 0);
    const lastPostTimes = filteredFollowers.filter(f => f.lastPostAt).map(f => f.lastPostAt!.getTime());
    const joinedTimes = filteredFollowers.filter(f => f.joinedAt).map(f => f.joinedAt!.getTime());
    const stats = {
      minFollowers: safeMin(filteredFollowers.map(f => f.followerCount)),
      maxFollowers: safeMax(filteredFollowers.map(f => f.followerCount)),
      minFollowing: safeMin(filteredFollowers.map(f => f.followingCount)),
      maxFollowing: safeMax(filteredFollowers.map(f => f.followingCount)),
      minPosts: safeMin(filteredFollowers.map(f => f.postCount)),
      maxPosts: safeMax(filteredFollowers.map(f => f.postCount)),
      minPostsPerDay: safeMin(filteredFollowers.map(f => f.postsPerDay || 0)),
      maxPostsPerDay: safeMax(filteredFollowers.map(f => f.postsPerDay || 0)),
      minFollowerRatio: safeMin(filteredFollowers.map(f => f.followerRatio || 0)),
      maxFollowerRatio: safeMax(filteredFollowers.map(f => f.followerRatio || 0)),
      minJoined: new Date(safeMin(joinedTimes)),
      maxJoined: new Date(safeMax(joinedTimes)),
      minLastPost: new Date(safeMin(lastPostTimes)),
      maxLastPost: new Date(safeMax(lastPostTimes))
    };

    console.log('Rendering template...');
    res.render('index', { 
      followers: paginatedFollowers,
      currentPage: page,
      totalPages,
      totalFollowers: filteredFollowers.length,
      isImporting: importQueue.isCurrentlyImporting(),
      title: 'SkyWatch',
      subtitle: 'BlueSky Follower Analytics & Management',
      userHandle: mainUser.handle,
      stats,
      filters: req.query,
      mainUser,
      sortBy,
      sortOrder,
      connected,
      freshness
    });
    console.log('Template rendered successfully');
  } catch (error) {
    console.error('Error in main route:', error);
    next(error);
  }
});

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Global error handler:', err);
  res.status(500).send('Internal Server Error: ' + err.message);
});

// Add the startServer function
function startServer() {
  return httpServer.listen(PORT, () => {
    console.log(`Web server running on http://localhost:${PORT}`);
  });
}

// Ensure the server can be started if this file is run directly
if (require.main === module) {
  startServer();
}

export { app, startServer };
