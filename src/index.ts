import { BlueSkyService } from './services/BlueSkyService';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Follower } from './models/Follower';
import { startServer } from './server';

// Enable more verbose logging
mongoose.set('debug', true);

dotenv.config();

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
    await mongoose.connect(process.env.MONGODB_URI || '', {
      serverSelectionTimeoutMS: 10000, // 10 seconds timeout
      socketTimeoutMS: 45000, // 45 seconds
    });
    
    console.log('✅ Successfully connected to MongoDB');

    // Comprehensive database inspection
    console.log('\n📊 Database Inspection:');
    
    // Check database connection state
    console.log('   Mongoose Connection State:', mongoose.connection.readyState);
    
    // Count total followers with error handling
    try {
      const totalFollowers = await Follower.countDocuments();
      console.log(`   Total Followers in Database: ${totalFollowers}`);

      // Detailed collection information
      const collectionInfo = await mongoose.connection.db.listCollections({ name: 'followers' }).toArray();
      console.log('   Collection Information:', JSON.stringify(collectionInfo, null, 2));

      // Optional: Display first few followers with more details
      if (totalFollowers > 0) {
        console.log('\n📋 Sample Followers:');
        const sampleFollowers = await Follower.find().limit(10);
        sampleFollowers.forEach((follower, index) => {
          console.log(`   ${index + 1}. @${follower.handle}`);
          console.log(`      Display Name: ${follower.displayName || 'N/A'}`);
          console.log(`      Followers: ${follower.followerCount}`);
          console.log(`      Following: ${follower.followingCount}`);
          console.log(`      Follower Ratio: ${follower.followerRatio?.toFixed(2) || 'N/A'}`);
        });
      }
    } catch (countError) {
      console.error('❌ Error counting or fetching followers:', countError);
    }

    // Start the web server
    startServer();
    
  } catch (connectionError) {
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
}

main().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});
