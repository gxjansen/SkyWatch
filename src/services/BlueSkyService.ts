import { AuthenticationService } from './auth/AuthenticationService';
import { ProfileService } from './profile/ProfileService';
import { FollowerService } from './follower/FollowerService';
import { DatabaseService } from './db/DatabaseService';
import { IFollower } from '../models/Follower';

export class BlueSkyService {
  private authService: AuthenticationService;
  private profileService: ProfileService;
  private followerService: FollowerService;
  private dbService: DatabaseService;

  constructor(handle: string, password: string) {
    // Initialize services
    this.authService = new AuthenticationService(handle, password);
    this.dbService = new DatabaseService();
    this.profileService = new ProfileService(this.authService);
    this.followerService = new FollowerService(
      this.authService,
      this.profileService,
      this.dbService
    );
  }

  /**
   * Authenticate with BlueSky
   */
  async authenticate(): Promise<boolean> {
    return this.authService.authenticate();
  }

  /**
   * Get the current authenticated user's profile
   */
  async getCurrentUserProfile() {
    return this.profileService.getProfile(this.authService.getCurrentUserDid());
  }

  /**
   * Unfollow a user
   * @param did Decentralized Identifier of the user to unfollow
   */
  async unfollowUser(did: string): Promise<boolean> {
    return this.followerService.unfollowUser(did);
  }

  /**
   * Fetch and store followers
   */
  async fetchAndStoreFollowers(): Promise<Partial<IFollower>[]> {
    return this.followerService.fetchAndStoreFollowers();
  }

  /**
   * Get stored followers
   */
  async getStoredFollowers(): Promise<IFollower[]> {
    return this.dbService.getStoredFollowers();
  }

  /**
   * Set callback for tracking imported followers
   * @param callback The callback function
   */
  setFollowerImportCallback(callback: (follower: Partial<IFollower>) => void) {
    this.followerService.onFollowerImported = callback;
  }
}
