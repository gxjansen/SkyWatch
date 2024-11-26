export interface IBlueSkyService {
  authenticate(): Promise<boolean>;
  getCurrentUserProfile(): Promise<any>;
  getFollowers(cursor?: string): Promise<any>;
  getProfile(did: string): Promise<any>;
  getLatestPostTimestamp(did: string): Promise<Date | undefined>;
  unfollowUser(did: string): Promise<boolean>;
  getStoredFollowers(): Promise<any[]>;
}
