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
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use(express_1.default.static(path_1.default.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path_1.default.join(__dirname, 'views'));
const blueSkyService = new BlueSkyService_1.BlueSkyService(process.env.BLUESKY_HANDLE || '', process.env.BLUESKY_PASSWORD || '');
const importQueue = new ImportQueue_1.ImportQueue(blueSkyService);
importQueue.setSocketServer(io);
mongoose_1.default.connect(process.env.MONGODB_URI || '')
    .then(() => console.log('MongoDB connected for web server'))
    .catch(err => console.error('MongoDB connection error:', err));
// Automatic import on server startup
async function autoImport() {
    try {
        console.log('🚀 Automatic import starting...');
        await importQueue.startImport();
    }
    catch (error) {
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
app.get('/', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page || '1');
        const skip = (page - 1) * FOLLOWERS_PER_PAGE;
        // Filter parameters
        const filters = {};
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
        // Fetch total followers with filters
        const totalFollowers = await Follower_1.Follower.countDocuments(filters);
        const totalPages = Math.ceil(totalFollowers / FOLLOWERS_PER_PAGE);
        // Fetch followers with filters
        const followers = await Follower_1.Follower.find(filters)
            .sort({ followedAt: -1 })
            .skip(skip)
            .limit(FOLLOWERS_PER_PAGE);
        // Get min and max values for filter ranges
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
                    minFollowerRatio: { $min: '$followerRatio' },
                    maxFollowerRatio: { $max: '$followerRatio' },
                    minJoined: { $min: '$joinedAt' },
                    maxJoined: { $max: '$joinedAt' }
                }
            }
        ]);
        res.render('index', {
            followers,
            currentPage: page,
            totalPages,
            totalFollowers,
            isImporting: importQueue.isCurrentlyImporting(),
            title: 'BlueSky Followers',
            stats: aggregateStats[0] || {},
            filters: req.query
        });
    }
    catch (error) {
        next(error);
    }
});
app.get('/import-progress', async (req, res) => {
    try {
        const importedFollowersCount = await Follower_1.Follower.countDocuments();
        res.json({
            total: importedFollowersCount,
            isImporting: importQueue.isCurrentlyImporting()
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch import progress' });
    }
});
app.post('/unfollow', async (req, res, next) => {
    try {
        const { did } = req.body;
        if (!did) {
            return res.status(400).json({ success: false, message: 'DID is required' });
        }
        await blueSkyService.authenticate();
        const unfollowResult = await blueSkyService.unfollowUser(did);
        if (unfollowResult) {
            res.json({ success: true, message: 'Successfully unfollowed user' });
        }
        else {
            res.status(500).json({ success: false, message: 'Failed to unfollow user' });
        }
    }
    catch (error) {
        next(error);
    }
});
app.use((err, req, res, next) => {
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
//# sourceMappingURL=server.js.map