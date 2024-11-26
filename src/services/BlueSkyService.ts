import { BskyAgent } from '@atproto/api';
import { AuthenticationService } from './auth/AuthenticationService';
import { ProfileService } from './profile/ProfileService';
import { FollowerService } from './follower/FollowerService';
import { DatabaseService } from './db/DatabaseService';
import { IFollower } from '../models/Follower';
import { IBlueSkyService } from './interfaces/IBlueSkyService';

export class BlueSkyService implements IBlueSkyService {
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
   * Get followers with optional cursor
   */
  async getFollowers(cursor?: string) {
    return this.followerService.getFollowers(cursor);
  }

  /**
   * Get profile information for a specific user
   */
  async getProfile(did: string) {
    return this.profileService.getProfile(did);
  }

  /**
   * Get the latest post timestamp for a user
   */
  async getLatestPostTimestamp(did: string): Promise<Date | undefined> {
    return this.profileService.getLatestPostTimestamp(did);
  }

  /**
   * Unfollow a user
   */
  async unfollowUser(did: string): Promise<boolean> {
    return this.followerService.unfollowUser(did);
  }

  /**
   * Get stored followers
   */
  async getStoredFollowers(): Promise<IFollower[]> {
    return this.dbService.getStoredFollowers();
  }

  /**
   * Set callback for tracking imported followers
   */
  setFollowerImportCallback(callback: (follower: Partial<IFollower>) => void) {
    this.followerService.onFollowerImported = callback;
  }
}
