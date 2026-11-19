-- Blog engagement (Phase 2): likes and comments on posts.
--
-- THE FIRST FOREIGN KEYS IN THIS SCHEMA. Every other table references artwork
-- by Cloudinary public_id as a plain string, because the parent entity lives in
-- another system and there is no `artworks` table to point at
-- (docs/schema-design.md §1). `posts` is a real row in THIS database, so that
-- reasoning does not apply and carrying the no-FK rule over would be cargo
-- culting. ON DELETE CASCADE is what lets `deletePostAction` stay a single
-- delete, and what makes a hand-written `DELETE FROM posts` in psql clean up
-- after itself instead of silently orphaning rows.
--
-- The relations are declared in schema.prisma as well, not just here. With the
-- default `relationMode = "foreignKeys"` the schema is the source of truth, so
-- a foreign key written only into migration SQL shows up as drift and the next
-- `prisma migrate dev` tries to drop it.
--
-- §1's "one table per concern" property survives: cascade fires only on PARENT
-- delete, so both tables below can still be truncated or dropped on their own.
-- The one new constraint is that truncating or dropping `posts` now needs
-- CASCADE.
--
-- Column widths mirror lib/commentLimits.ts, so the database is a second line
-- of defence rather than the only one — the same rule `inquiries` follows.

-- CreateEnum
-- SPAM is a state, not a deletion: a binned comment is kept so Akismet can be
-- given feedback on it and so a false positive is recoverable. Nothing in the
-- filter path ever hard-deletes.
CREATE TYPE "CommentStatus" AS ENUM ('PUBLISHED', 'HELD', 'SPAM');

-- CreateTable
CREATE TABLE "post_likes" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    -- sha256(ip + IP_HASH_SALT). Never a raw address (invariant 6).
    "ipHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_comments" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorName" VARCHAR(80) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    -- DEFAULT 'HELD' is the real guarantee behind the spam filter: no code
    -- path, no bug, and no hand-written INSERT can land a comment publicly
    -- without it having been scored. Promotion is an explicit UPDATE that only
    -- happens after the filter runs.
    "status" "CommentStatus" NOT NULL DEFAULT 'HELD',
    -- The owner's own replies, auto-published with a badge. Comments are flat;
    -- there is no parentId, because an owner reply covers the only threading
    -- case that matters at this size.
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    -- Which rule held or binned it. Never rendered publicly: it would tell a
    -- spammer precisely which heuristic to route around.
    "spamReason" VARCHAR(200),
    "ipHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- NOT stored: "userAgent". Its only plausible reader would be Akismet's
    -- submit-spam/submit-ham feedback endpoints, and those want the original
    -- raw IP above all, which invariant 6 forbids keeping. Training Akismet
    -- without it is weak, so the feedback call is out of scope and so is the
    -- column — storing a visitor's user agent to feed a request this app never
    -- makes would be collecting PII-adjacent data for no reader.
    CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The dedup mechanism itself, not an optimisation: a second like from the same
-- visitor violates this and the route converts P2002 into its normal 204.
-- `postId` leads it, so this one index also serves the public count query AND
-- the cascade's child lookup. Deliberately NO standalone "postId" index —
-- `likes_artworkPublicId_idx` was exactly that redundancy, and migration
-- 20260830120000_drop_unused_indexes removed it.
CREATE UNIQUE INDEX "post_likes_postId_ipHash_key" ON "post_likes"("postId", "ipHash");

-- CreateIndex
-- The one hot public query: WHERE "postId" = $1 AND status = 'PUBLISHED'
-- ORDER BY "createdAt" ASC. Note ASCENDING — the only index in this schema
-- that is, because a conversation reads oldest-first while every log here reads
-- newest-first. Matching the query exactly means an index scan with no sort
-- step. `postId` leading also means the cascade's child lookup uses it:
-- Postgres does NOT index the referencing side of a foreign key for you, so
-- without a postId-leading index every post delete would sequentially scan
-- this table. Anyone "simplifying" this to (status, postId, ...) would
-- silently reintroduce that scan.
CREATE INDEX "post_comments_postId_status_createdAt_idx" ON "post_comments"("postId", "status", "createdAt");

-- NOT created: an index on "status" alone. The moderation queue's
-- WHERE status = 'HELD' is a deliberate sequential scan over a small table,
-- the same call schema-design.md §4 already records for
-- `inquiries.emailStatus` — the admin reads one page and filters in
-- JavaScript. An index must serve a real access pattern rather than exist in
-- case one appears.

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
