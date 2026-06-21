import mongoose, { Schema } from 'mongoose';

/**
 * Short-lived storage for the per-authorization OAuth state.
 * The library writes one entry at the start of an authorize() flow and
 * deletes it during callback(). A TTL is a safety net for abandoned flows.
 *
 * `state` holds the library's opaque NodeSavedState, persisted verbatim. It is
 * typed loosely here because @atproto/oauth-client-node is ESM-only and cannot be
 * referenced in type position from this CommonJS module (TS1479).
 */
interface IOAuthState {
  key: string;
  state: Record<string, unknown>;
  createdAt: Date;
}

const OAuthStateSchema = new Schema<IOAuthState>({
  key: { type: String, required: true, unique: true, index: true },
  state: { type: Schema.Types.Mixed, required: true },
  // TTL: abandoned authorize flows are cleaned up after 10 minutes.
  createdAt: { type: Date, default: Date.now, expires: 600 },
});

export const OAuthStateModel = mongoose.model<IOAuthState>('OAuthState', OAuthStateSchema);
