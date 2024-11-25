"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
exports.startServer = startServer;
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const Follower_1 = require("./models/Follower");
const BlueSkyService_1 = require("./services/BlueSkyService");
const ImportQueue_1 = require("./services/ImportQueue");
const socket_io_1 = require("socket.io");
const http_1 = require("http");
dotenv_1.default.config();
const app = (0, express_1.default)();
exports.app = app;
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
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
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use(express_1.default.static(path_1.default.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path_1.default.join(__dirname, 'views'));
// Validate required environment variables
if (!process.env.BLUESKY_HANDLE || !process.env.BLUESKY_PASSWORD) {
    throw new Error('BLUESKY_HANDLE and BLUESKY_PASSWORD must be set in .env file');
}
const blueSkyService = new BlueSkyService_1.BlueSkyService(process.env.BLUESKY_HANDLE, process.env.BLUESKY_PASSWORD);
const importQueue = new ImportQueue_1.ImportQueue(blueSkyService);
importQueue.setSocketServer(io);
mongoose_1.default.connect(process.env.MONGODB_URI || '')
    .then(() => console.log('MongoDB connected for web server'))
    .catch(err => console.error('MongoDB connection error:', err));
// Helper function to get user profile data
async function getUserProfileData(blueSkyService) {
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
    }
    catch (error) {
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
app.get('/api/profile', async (req, res, next) => {
    try {
        const mainUser = await getUserProfileData(blueSkyService);
        res.json(mainUser);
    }
    catch (error) {
        if (error?.status === 429) {
            res.status(429).json({
                error: 'Rate limit exceeded',
                retryAfter: error?.headers?.['retry-after'] || 300
            });
        }
        else {
            next(error);
        }
    }
});
// Unfollow endpoint
app.post('/unfollow', async (req, res) => {
    try {
        const { did } = req.body;
        if (!did) {
            return res.status(400).json({ success: false, message: 'DID is required' });
        }
        const success = await blueSkyService.unfollowUser(did);
        if (success) {
            res.json({ success: true });
        }
        else {
            res.status(500).json({ success: false, message: 'Failed to unfollow user' });
        }
    }
    catch (error) {
        console.error('Error in unfollow endpoint:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'An error occurred while unfollowing the user'
        });
    }
});
// Main page route
app.get('/', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page || '1');
        const skip = (page - 1) * FOLLOWERS_PER_PAGE;
        const sortBy = req.query.sortBy || 'followedAt';
        const sortOrder = req.query.sortOrder || 'desc';
        // Get initial profile data
        const mainUser = await getUserProfileData(blueSkyService);
        // Filter parameters
        const filters = {};
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
        // Create sort object for MongoDB
        const sortObject = {
            [sortBy]: sortOrder === 'asc' ? 1 : -1
        };
        // Fetch data from database
        const totalFollowers = await Follower_1.Follower.countDocuments(filters);
        const totalPages = Math.ceil(totalFollowers / FOLLOWERS_PER_PAGE);
        const followers = await Follower_1.Follower.find(filters)
            .sort(sortObject)
            .skip(skip)
            .limit(FOLLOWERS_PER_PAGE);
        const aggregateStats = await Follower_1.Follower.aggregate([
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
            userHandle: mainUser.handle,
            stats: aggregateStats[0] || {},
            filters: req.query,
            mainUser,
            sortBy,
            sortOrder
        });
    }
    catch (error) {
        next(error);
    }
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
//# sourceMappingURL=server.js.map