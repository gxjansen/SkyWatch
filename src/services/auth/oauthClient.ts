import { OAuthStateModel } from '../../models/OAuthState';
import { OAuthSessionModel } from '../../models/OAuthSession';

/**
 * MongoDB-backed stores for the AT Protocol OAuth client.
 * State is transient (per authorize flow); session is persistent (owner tokens + DPoP key).
 *
 * NOTE: @atproto/oauth-client-node is ESM-only and cannot be referenced in type
 * position from this CommonJS module (TS1479), so the library's NodeSaved* types
 * are represented loosely here. Values are persisted verbatim — never transform them.
 */
class MongoStateStore {
  async get(key: string): Promise<any | undefined> {
    const doc = await OAuthStateModel.findOne({ key }).lean();
    return doc?.state;
  }
  async set(key: string, state: any): Promise<void> {
    await OAuthStateModel.updateOne(
      { key },
      { key, state, createdAt: new Date() },
      { upsert: true }
    );
  }
  async del(key: string): Promise<void> {
    await OAuthStateModel.deleteOne({ key });
  }
}

class MongoSessionStore {
  async get(did: string): Promise<any | undefined> {
    const doc = await OAuthSessionModel.findOne({ did }).lean();
    return doc?.session;
  }
  async set(did: string, session: any): Promise<void> {
    await OAuthSessionModel.updateOne(
      { did },
      { did, session, updatedAt: new Date() },
      { upsert: true }
    );
  }
  async del(did: string): Promise<void> {
    await OAuthSessionModel.deleteOne({ did });
  }
}

const PORT = Number(process.env.PORT || 3000);
// Loopback redirect MUST use 127.0.0.1 (not "localhost") per the atproto OAuth spec.
const redirectBase = process.env.OAUTH_REDIRECT_BASE || `http://127.0.0.1:${PORT}`;
const redirectUri = `${redirectBase}/oauth/callback`;
// `atproto` is mandatory; `transition:generic` grants the broad read/write access
// (including deleting follows) this app needs until granular scopes ship.
const scope = process.env.OAUTH_SCOPE || 'atproto transition:generic';

// Loopback/development client: client_id origin is `http://localhost` with NO port.
// The authorization server synthesizes virtual client metadata from these query params.
const clientId =
  `http://localhost` +
  `?redirect_uri=${encodeURIComponent(redirectUri)}` +
  `&scope=${encodeURIComponent(scope)}`;

export const REDIRECT_URI = redirectUri;
export const OAUTH_SCOPE = scope;

// `@atproto/oauth-client-node` is ESM-only; load it via dynamic import from this
// CommonJS project and memoize the constructed client.
let clientPromise: Promise<any> | undefined;

export function getOAuthClient(): Promise<any> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { NodeOAuthClient } = await import('@atproto/oauth-client-node');
      return new NodeOAuthClient({
        clientMetadata: {
          client_id: clientId,
          client_name: 'SkyWatch',
          redirect_uris: [redirectUri],
          scope,
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          // Public client: no secret, no JWKS/keyset required.
          token_endpoint_auth_method: 'none',
          application_type: 'native',
          dpop_bound_access_tokens: true,
        },
        stateStore: new MongoStateStore(),
        sessionStore: new MongoSessionStore(),
      });
    })();
  }
  return clientPromise;
}
