import { Follower, IFollower } from '../../models/Follower';

export class DatabaseService {
  /**
   * Save or update a follower in the database
   * @param followerData The follower data to save
   * @returns Promise resolving to the saved follower
   */
  async upsertFollower(followerData: Partial<IFollower>) {
    try {
      // Upsert follower (insert or update)
      const savedFollower = await Follower.findOneAndUpdate(
        { did: followerData.did },
        followerData,
        { upsert: true, new: true }
      );

      // Calculate follower ratio and posts per day
      savedFollower.calculateFollowerRatio();
      savedFollower.calculatePostsPerDay();
      await savedFollower.save();

      return savedFollower;
    } catch (error) {
      console.error('[DatabaseService] Error upserting follower:', error);
      throw error;
    }
  }

  /**
   * Remove a follower from the database
   * @param did The DID of the follower to remove
   */
  async removeFollower(did: string) {
    try {
      await Follower.deleteOne({ did });
    } catch (error) {
      console.error('[DatabaseService] Error removing follower:', error);
      throw error;
    }
  }

  /**
   * Get all stored followers
   * @returns Promise resolving to array of stored followers
   */
  async getStoredFollowers(): Promise<IFollower[]> {
    try {
      return await Follower.find().sort({ followedAt: -1 });
    } catch (error) {
      console.error('[DatabaseService] Error retrieving stored followers:', error);
      return [];
    }
  }
}
