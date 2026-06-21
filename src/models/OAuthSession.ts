import mongoose, { Schema } from 'mongoose';

/**
 * Persistent storage for the owner's OAuth session: access/refresh tokens plus
 * the DPoP private key. This MUST survive restarts so the long-running server can
 * restore the session and refresh tokens silently. Do NOT add a TTL here.
 *
 * `session` holds the library's opaque NodeSavedSession, persisted verbatim. It is
 * typed loosely here because @atproto/oauth-client-node is ESM-only and cannot be
 * referenced in type position from this CommonJS module (TS1479).
 */
interface IOAuthSession {
  did: string;
  session: Record<string, unknown>;
  updatedAt: Date;
}

const OAuthSessionSchema = new Schema<IOAuthSession>({
  did: { type: String, required: true, unique: true, index: true },
  session: { type: Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now },
});

export const OAuthSessionModel = mongoose.model<IOAuthSession>('OAuthSession', OAuthSessionSchema);
