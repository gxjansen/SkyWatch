import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { IFollower } from './models/Follower';
import { BlueSkyService } from './services/BlueSkyService';  // This path is correct since BlueSkyService is the orchestrator
import { ImportQueue } from './services/ImportQueue';
import { Server } from 'socket.io';
import { createServer } from 'http';

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

// Validate required environment variables
if (!process.env.BLUESKY_HANDLE || !process.env.BLUESKY_PASSWORD) {
  throw new Error('BLUESKY_HANDLE and BLUESKY_PASSWORD must be set in .env file');
}

const blueSkyService = new BlueSkyService(
  process.env.BLUESKY_HANDLE,
  process.env.BLUESKY_PASSWORD
);

const importQueue = new ImportQueue(blueSkyService);
importQueue.setSocketServer(io);

mongoose.connect(process.env.MONGODB_URI || '')
  .then(() => {
    console.log('MongoDB connected for web server');
    // Start import if force import flag is set
    if (shouldForceImport || process.env.AUTO_IMPORT === 'true') {
      console.log('Starting follower import process...');
      importQueue.startImport({ clearExisting: shouldForceImport })
        .catch(err => console.error('Import process failed:', err));
    }
  })
  .catch(err => console.error('MongoDB connection error:', err));

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
      handle: process.env.BLUESKY_HANDLE || '',
      displayName: process.env.BLUESKY_HANDLE || '',
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

    console.log('Fetching followers from database...');
    // Create sort object for MongoDB
    const sortObject: { [key: string]: 1 | -1 } = {
      [sortBy]: sortOrder === 'asc' ? 1 : -1
    };

    // Fetch data from database
    const followers = await blueSkyService.getStoredFollowers();
    const totalFollowers = followers.length;
    const totalPages = Math.ceil(totalFollowers / FOLLOWERS_PER_PAGE);

    // Apply filters and pagination in memory
    const filteredFollowers = followers.filter(follower => {
      let matches = true;
      if (filters.followerCount) {
        if (filters.followerCount.$gte !== undefined && follower.followerCount < filters.followerCount.$gte) matches = false;
        if (filters.followerCount.$lte !== undefined && follower.followerCount > filters.followerCount.$lte) matches = false;
      }
      // Add similar checks for other filters...
      return matches;
    });

    // Sort and paginate
    const sortedFollowers = filteredFollowers.sort((a, b) => {
      const aValue = (a as any)[sortBy];
      const bValue = (b as any)[sortBy];
      return (sortOrder === 'asc' ? 1 : -1) * (aValue > bValue ? 1 : -1);
    });

    const paginatedFollowers = sortedFollowers.slice(skip, skip + FOLLOWERS_PER_PAGE);

    // Calculate aggregate stats from filtered followers
    const stats = {
      minFollowers: Math.min(...filteredFollowers.map(f => f.followerCount)),
      maxFollowers: Math.max(...filteredFollowers.map(f => f.followerCount)),
      minFollowing: Math.min(...filteredFollowers.map(f => f.followingCount)),
      maxFollowing: Math.max(...filteredFollowers.map(f => f.followingCount)),
      minPosts: Math.min(...filteredFollowers.map(f => f.postCount)),
      maxPosts: Math.max(...filteredFollowers.map(f => f.postCount)),
      minPostsPerDay: Math.min(...filteredFollowers.map(f => f.postsPerDay || 0)),
      maxPostsPerDay: Math.max(...filteredFollowers.map(f => f.postsPerDay || 0)),
      minFollowerRatio: Math.min(...filteredFollowers.map(f => f.followerRatio || 0)),
      maxFollowerRatio: Math.max(...filteredFollowers.map(f => f.followerRatio || 0)),
      minJoined: new Date(Math.min(...filteredFollowers.map(f => f.joinedAt?.getTime() || 0))),
      maxJoined: new Date(Math.max(...filteredFollowers.map(f => f.joinedAt?.getTime() || 0))),
      minLastPost: new Date(Math.min(...filteredFollowers.filter(f => f.lastPostAt).map(f => f.lastPostAt?.getTime() || 0))),
      maxLastPost: new Date(Math.max(...filteredFollowers.filter(f => f.lastPostAt).map(f => f.lastPostAt?.getTime() || 0)))
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
      sortOrder
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
