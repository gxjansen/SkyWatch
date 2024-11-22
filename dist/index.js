"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const Follower_1 = require("./models/Follower");
// Enable more verbose logging
mongoose_1.default.set('debug', true);
dotenv_1.default.config();
async function main() {
    console.log('🚀 BlueSky Follower Tracker - Detailed Database Inspection');
    console.log('-------------------------------------------');
    // Log environment variables for debugging
    console.log('🔍 Environment Variables:');
    console.log('   MONGODB_URI:', process.env.MONGODB_URI ? 'SET' : 'NOT SET');
    console.log('   BLUESKY_HANDLE:', process.env.BLUESKY_HANDLE ? 'SET' : 'NOT SET');
    try {
        // Detailed MongoDB connection logging
        console.log('\n🔌 Attempting to connect to MongoDB...');
        // More explicit connection with error handling
        await mongoose_1.default.connect(process.env.MONGODB_URI || '', {
            serverSelectionTimeoutMS: 10000, // 10 seconds timeout
            socketTimeoutMS: 45000, // 45 seconds
        });
        console.log('✅ Successfully connected to MongoDB');
        // Comprehensive database inspection
        console.log('\n📊 Database Inspection:');
        // Check database connection state
        console.log('   Mongoose Connection State:', mongoose_1.default.connection.readyState);
        // Count total followers with error handling
        try {
            const totalFollowers = await Follower_1.Follower.countDocuments();
            console.log(`   Total Followers in Database: ${totalFollowers}`);
            // Detailed collection information
            const collectionInfo = await mongoose_1.default.connection.db.listCollections({ name: 'followers' }).toArray();
            console.log('   Collection Information:', JSON.stringify(collectionInfo, null, 2));
            // Optional: Display first few followers with more details
            if (totalFollowers > 0) {
                console.log('\n📋 Sample Followers:');
                const sampleFollowers = await Follower_1.Follower.find().limit(10);
                sampleFollowers.forEach((follower, index) => {
                    console.log(`   ${index + 1}. @${follower.handle}`);
                    console.log(`      Display Name: ${follower.displayName || 'N/A'}`);
                    console.log(`      Followers: ${follower.followerCount}`);
                    console.log(`      Following: ${follower.followingCount}`);
                    console.log(`      Follower Ratio: ${follower.followerRatio?.toFixed(2) || 'N/A'}`);
                });
            }
        }
        catch (countError) {
            console.error('❌ Error counting or fetching followers:', countError);
        }
    }
    catch (connectionError) {
        console.error('❌ MongoDB Connection Error:', connectionError);
        // Detailed error logging
        if (connectionError instanceof Error) {
            console.error('   Error Name:', connectionError.name);
            console.error('   Error Message:', connectionError.message);
            // Additional context for common connection issues
            if (connectionError.message.includes('failed to connect')) {
                console.error('\n💡 Troubleshooting Tips:');
                console.error('   - Verify MongoDB URI is correct');
                console.error('   - Ensure MongoDB service is running');
                console.error('   - Check network connectivity');
                console.error('   - Verify firewall settings');
            }
        }
        process.exit(1);
    }
    finally {
        // Ensure mongoose connection is closed
        await mongoose_1.default.connection.close();
    }
}
main().catch(error => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map