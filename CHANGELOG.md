# Changelog

## 1.1.0 - 2026-06-21

### Added
- AT Protocol OAuth authentication, replacing app passwords. Uses a localhost loopback client; sessions (tokens + DPoP key) are persisted in MongoDB and refreshed automatically. New `/login` and `/oauth/callback` routes.
- Follower refresh: incrementally adds new follows, re-fetches data older than `REFRESH_STALE_DAYS` (default 7), and prunes accounts no longer followed. Plus a "Re-fetch all data" action to refresh every account.
- Data freshness indicators: per-account "Last Fetched" column and a summary of stale / never-fetched accounts.
- Multi-select rows with bulk unfollow, including a live progress bar.
- Star (protect) accounts; bulk unfollow skips starred accounts. Filter by starred / unstarred.
- Filtered / total account count shown in the follow list.
- "Connect BlueSky" state shown when no OAuth session is active.

### Fixed
- All table filters now apply (previously only the followers filter worked); max-date filters are inclusive of the whole day.
- Unfollow works regardless of follow count — resolves the follow-record URI from the profile's viewer state instead of scanning only the first 100 follows.
- Last-post date ignores pinned posts and reposts (takes the newest own post).
- Import/refresh progress reflects accounts processed, not the database row count.
- `RateLimiter` `ONE_DAY` constant (was 24 minutes, now 24 hours).

### Changed
- Stopped tracking `node_modules` and `dist` (already gitignored).
- `.env` removed from the repository and purged from git history; credentials are no longer stored in the environment.
