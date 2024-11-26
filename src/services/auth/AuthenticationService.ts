import { BskyAgent } from '@atproto/api';
import { BlueSkyRateLimits } from '../rate/RateLimiter';

export class AuthenticationService {
  private agent: BskyAgent;
  private handle: string;
  private password: string;
  private static MAX_AUTH_RETRIES = 3;
  private authInProgress = false;

  constructor(handle: string, password: string) {
    if (!handle || !password) {
      throw new Error('BlueSky handle and password are required');
    }

    this.agent = new BskyAgent({ 
      service: 'https://bsky.social' 
    });
    this.handle = handle;
    this.password = password;
  }

  /**
   * Get the current authenticated user's DID
   * @returns The DID of the authenticated user
   */
  getCurrentUserDid(): string {
    if (!this.agent.session) {
      throw new Error('Not authenticated');
    }
    return this.agent.session.did;
  }

  /**
   * Authenticate with BlueSky
   * @returns Promise resolving to boolean indicating authentication success
   */
  async authenticate(retryCount = 0): Promise<boolean> {
    // If authentication is already in progress, wait for it to complete
    if (this.authInProgress) {
      console.log('[AuthenticationService] Authentication already in progress, waiting...');
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      return this.authenticate(retryCount);
    }

    try {
      this.authInProgress = true;

      // If already authenticated with a valid session, verify it
      if (this.agent.session?.did) {
        try {
          // Verify the session is still valid
          await BlueSkyRateLimits.GENERAL.waitForNextSlot();
          await this.agent.getProfile({ actor: this.agent.session.did });
          console.log('[AuthenticationService] Using existing valid session');
          return true;
        } catch (error: any) {
          if (error?.status === 429 && error?.headers) {
            BlueSkyRateLimits.GENERAL.updateFromHeaders(error.headers);
          }
          console.log('[AuthenticationService] Existing session invalid, re-authenticating');
          // Session invalid, continue with re-authentication
        }
      }

      // Check retry count
      if (retryCount >= AuthenticationService.MAX_AUTH_RETRIES) {
        console.error(`[AuthenticationService] Maximum authentication retries (${AuthenticationService.MAX_AUTH_RETRIES}) exceeded`);
        return false;
      }

      // Wait for authentication rate limit
      await BlueSkyRateLimits.AUTH.waitForNextSlot();

      console.log(`[AuthenticationService] Authenticating user: ${this.handle} (attempt ${retryCount + 1}/${AuthenticationService.MAX_AUTH_RETRIES})`);
      await this.agent.login({
        identifier: this.handle,
        password: this.password
      });
      
      console.log('[AuthenticationService] Authentication successful');
      return true;
    } catch (error: any) {
      if (error?.status === 429) {
        console.error('[AuthenticationService] Rate limit exceeded during authentication. Will retry with backoff.');
        if (error.headers) {
          BlueSkyRateLimits.AUTH.updateFromHeaders(error.headers);
        }
        // Wait for rate limit to reset before retrying
        await BlueSkyRateLimits.AUTH.waitForNextSlot();
        return this.authenticate(retryCount + 1);
      }
      
      console.error('[AuthenticationService] Authentication failed:', error);
      return false;
    } finally {
      this.authInProgress = false;
    }
  }

  getAgent(): BskyAgent {
    return this.agent;
  }
}
