-- Drop two indexes that serve no query (tech debt 3.7):
--   * "inquiries_ipHash_createdAt_idx" was built for the original count-based
--     rate limiter, which counted recent inquiry rows for an IP. That limiter
--     was replaced by rate_windows, and no query filters inquiries by ipHash
--     any more.
--   * "likes_artworkPublicId_idx" is redundant: its column is already the
--     leading column of the unique index "likes_artworkPublicId_ipHash_key",
--     which Postgres can use for the same lookups.
-- Both were pure write amplification on hot public-write paths.
DROP INDEX IF EXISTS "inquiries_ipHash_createdAt_idx";
DROP INDEX IF EXISTS "likes_artworkPublicId_idx";
