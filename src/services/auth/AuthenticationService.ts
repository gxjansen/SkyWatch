import { Agent } from '@atproto/api';
import { getOAuthClient } from './oauthClient';
import { OAuthSessionModel } from '../../models/OAuthSession';

/**
 * OAuth-backed authentication for the single owner account.
 *
 * Unlike the old app-password flow, there is no programmatic login. The owner
 * authorizes once via the browser (/login -> /oauth/callback), which persists an
 * OAuth session. From then on authenticate() restores that session and builds an
 * Agent; token refresh (and DPoP) is handled automatically by the OAuth client.
 */
export class AuthenticationService {
  private agent?: Agent;
  private did?: string;
  private authInProgress = false;

  /**
   * @param ownerDid Optional. If omitted, the single stored OAuth session is used
   * (this is a single-user tool).
   */
  constructor(ownerDid?: string) {
    this.did = ownerDid || undefined;
  }

  /**
   * Get the current authenticated user's DID.
   */
  getCurrentUserDid(): string {
    if (!this.did) {
      throw new Error('Not authenticated');
    }
    return this.did;
  }

  isAuthenticated(): boolean {
    return !!this.agent;
  }

  /**
   * Restore the persisted OAuth session and build an Agent.
   * @returns true if a session was restored, false if the owner has not logged in yet.
   */
  async authenticate(): Promise<boolean> {
    // If authentication is already in progress, wait for it to complete.
    if (this.authInProgress) {
      console.log('[AuthenticationService] Authentication already in progress, waiting...');
      await new Promise(resolve => setTimeout(resolve, 500));
      return this.authenticate();
    }

    try {
      this.authInProgress = true;

      // Already have a live agent for this process.
      if (this.agent && this.did) {
        return true;
      }

      // Single-user tool: if no DID was provided, use the most recent stored session.
      let did = this.did;
      if (!did) {
        const doc = await OAuthSessionModel.findOne().sort({ updatedAt: -1 }).lean();
        if (!doc) {
          console.log('[AuthenticationService] No stored OAuth session. Visit /login to connect.');
          return false;
        }
        did = doc.did;
      }

      // restore() transparently refreshes the access token using the stored
      // refresh token + DPoP key, and rewrites the session store.
      const oauthClient = await getOAuthClient();
      const oauthSession = await oauthClient.restore(did);
      this.agent = new Agent(oauthSession);
      this.did = did;
      console.log(`[AuthenticationService] OAuth session restored for ${did}`);
      return true;
    } catch (error: any) {
      console.error('[AuthenticationService] OAuth session restore failed:', error);
      // A revoked/expired refresh token lands here -> fall back to "not connected".
      this.agent = undefined;
      return false;
    } finally {
      this.authInProgress = false;
    }
  }

  /**
   * Return the OAuth-backed Agent. Throws if not authenticated.
   */
  getAgent(): Agent {
    if (!this.agent) {
      throw new Error('Not authenticated — call authenticate() first');
    }
    return this.agent;
  }

  /**
   * Ensure a session is available and return the Agent, authenticating if needed.
   * Throws if the owner has not completed the interactive OAuth login.
   */
  async requireAgent(): Promise<Agent> {
    if (!this.agent) {
      const ok = await this.authenticate();
      if (!ok) {
        throw new Error('Not authenticated with BlueSky — visit /login to connect');
      }
    }
    return this.getAgent();
  }
}
