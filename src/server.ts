import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Follower, IFollower } from './models/Follower';
import { BlueSkyService } from './services/BlueSkyService';
import { ImportQueue } from './services/ImportQueue';
import { Server } from 'socket.io';
import { createServer } from 'http';

// Type definitions
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
}

interface MainUser {
  handle: string;
  avatar: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
  postsPerDay: number;
  followerRatio: number;
  joinedAt: string;
  lastPostAt: string | null;
}

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

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const blueSkyService = new BlueSkyService(
  process.env.BLUESKY_HANDLE || '', 
  process.env.BLUESKY_PASSWORD || ''
);

const importQueue = new ImportQueue(blueSkyService);
importQueue.setSocketServer(io);

mongoose.connect(process.env.MONGODB_URI || '')
  .then(() => console.log('MongoDB connected for web server'))
  .catch(err => console.error('MongoDB connection error:', err));

// Automatic import on server startup
async function autoImport() {
  try {
    // If force import is requested, start fresh
    if (shouldForceImport) {
      console.log('🔄 Force import requested, starting fresh import...');
      await importQueue.startImport({ clearExisting: true });
      return;
    }

    // Check existing data
    const existingCount = await Follower.countDocuments();
    
    // Authenticate to get the user's profile
    await blueSkyService.authenticate();
    const profile = await blueSkyService.getCurrentUserProfile();
    const totalFollowers = profile.data.followsCount || 0;

    if (existingCount === 0) {
      // No existing data, start fresh import
      console.log('🚀 No existing data found, starting fresh import...');
      await importQueue.startImport({ clearExisting: true });
    } else if (existingCount < totalFollowers) {
      // Incomplete data, continue import
      console.log(`📥 Found incomplete data (${existingCount}/${totalFollowers} followers), continuing import...`);
      await importQueue.startImport({ clearExisting: false });
    } else {
      // Complete data, skip import
      console.log(`✅ Using existing data (${existingCount}/${totalFollowers} followers). Use --force-import to start fresh.`);
    }
  } catch (error) {
    console.error('❌ Automatic import failed:', error);
  }
}

// Run auto import when server starts
if (process.env.AUTO_IMPORT === 'true') {
  autoImport();
}

// Simplified socket.io connection handling
io.on('connection', (socket) => {
  console.log('Client connected to socket');

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });

  // Minimal data emission to prevent circular reference
  socket.emit('importStatus', {
    isImporting: importQueue.isCurrentlyImporting(),
    total: 0
  });
});

app.get('/', async (req: Request<{}, {}, {}, QueryParams>, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page || '1');
    const skip = (page - 1) * FOLLOWERS_PER_PAGE;

    // Get main user profile data
    await blueSkyService.authenticate();
    const mainUserProfile = await blueSkyService.getCurrentUserProfile();
    
    // Calculate posts per day for main user
    const joinedDate = mainUserProfile.data.createdAt ? new Date(mainUserProfile.data.createdAt) : new Date();
    const daysSinceJoined = Math.max(1, Math.floor((Date.now() - joinedDate.getTime()) / (1000 * 60 * 60 * 24)));
    const postsCount = mainUserProfile.data.postsCount || 0;
    const postsPerDay = postsCount / daysSinceJoined;
    
    // Calculate follower ratio for main user
    const followersCount = mainUserProfile.data.followersCount || 0;
    const followsCount = mainUserProfile.data.followsCount || 1; // Prevent division by zero
    const followerRatio = followersCount / followsCount;

    const mainUser: MainUser = {
      handle: mainUserProfile.data.handle || '',
      avatar: mainUserProfile.data.avatar || '',
      followerCount: followersCount,
      followingCount: followsCount,
      postCount: postsCount,
      postsPerDay: Number(postsPerDay.toFixed(1)),
      followerRatio: Number(followerRatio.toFixed(1)),
      joinedAt: mainUserProfile.data.createdAt || new Date().toISOString(),
      lastPostAt: null // We would need an additional API call to get this
    };

    // Filter parameters
    const filters: FilterQuery = {};

    // Follower count filter
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
        $lte: new Date(req.query.maxJoined)
      };
    }

    // Last post date filter
    if (req.query.minLastPost) {
      filters.lastPostAt = { $gte: new Date(req.query.minLastPost) };
    }
    if (req.query.maxLastPost) {
      filters.lastPostAt = {
        ...filters.lastPostAt,
        $lte: new Date(req.query.maxLastPost)
      };
    }

    // Fetch total followers with filters
    const totalFollowers = await Follower.countDocuments(filters);
    const totalPages = Math.ceil(totalFollowers / FOLLOWERS_PER_PAGE);

    // Fetch followers with filters
    const followers = await Follower.find(filters)
      .sort({ followedAt: -1 })
      .skip(skip)
      .limit(FOLLOWERS_PER_PAGE);

    // Get min and max values for filter ranges
    const aggregateStats = await Follower.aggregate([
      {
        $group: {
          _id: null,
          minFollowers: { $min: '$followerCount' },
          maxFollowers: { $max: '$followerCount' },
          minFollowing: { $min: '$followingCount' },
          maxFollowing: { $max: '$followingCount' },
          minPosts: { $min: '$postCount' },
          maxPosts: { $max: '$postCount' },
          minPostsPerDay: { $min: '$postsPerDay' },
          maxPostsPerDay: { $max: '$postsPerDay' },
          minFollowerRatio: { $min: '$followerRatio' },
          maxFollowerRatio: { $max: '$followerRatio' },
          minJoined: { $min: '$joinedAt' },
          maxJoined: { $max: '$joinedAt' },
          minLastPost: { $min: '$lastPostAt' },
          maxLastPost: { $max: '$lastPostAt' }
        }
      }
    ]);

    res.render('index', { 
      followers,
      currentPage: page,
      totalPages,
      totalFollowers,
      isImporting: importQueue.isCurrentlyImporting(),
      title: 'SkyWatch',
      subtitle: 'BlueSky Follower Analytics & Management',
      userHandle: mainUserProfile.data.handle || '',
      stats: aggregateStats[0] || {},
      filters: req.query,
      mainUser
    });
  } catch (error) {
    next(error);
  }
});

// Add a new endpoint to trigger manual import
app.post('/start-import', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (importQueue.isCurrentlyImporting()) {
      return res.status(400).json({ success: false, message: 'Import already in progress' });
    }

    // Start new import
    autoImport();
    res.json({ success: true, message: 'Import started' });
  } catch (error) {
    next(error);
  }
});

app.get('/import-progress', async (req: Request, res: Response) => {
  try {
    const importedFollowersCount = await Follower.countDocuments();
    res.json({ 
      total: importedFollowersCount,
      isImporting: importQueue.isCurrentlyImporting()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch import progress' });
  }
});

interface UnfollowRequest extends Request {
  body: {
    did: string;
  };
}

app.post('/unfollow', async (req: UnfollowRequest, res: Response, next: NextFunction) => {
  try {
    const { did } = req.body;

    if (!did) {
      return res.status(400).json({ success: false, message: 'DID is required' });
    }

    await blueSkyService.authenticate();
    const unfollowResult = await blueSkyService.unfollowUser(did);

    if (unfollowResult) {
      res.json({ success: true, message: 'Successfully unfollowed user' });
    } else {
      res.status(500).json({ success: false, message: 'Failed to unfollow user' });
    }
  } catch (error) {
    next(error);
  }
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err);
  res.status(500).json({ 
    success: false, 
    message: 'An unexpected error occurred',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined 
  });
});

function startServer() {
  return httpServer.listen(PORT, () => {
    console.log(`Web server running on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startServer();
}

export { app, startServer };
