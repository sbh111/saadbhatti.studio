-- Email subscribers, and the per-post notification guard (Phase 3).
--
-- This is the first table in the schema holding an address this application
-- will MAIL, which is a different kind of responsibility from everything above
-- it: `inquiries` holds addresses people sent US, and nothing has ever emailed
-- a visitor before now.
--
-- Division of authority between Postgres and Resend, because the two hold
-- overlapping facts and it matters which one wins:
--
--   Postgres owns CONSENT        — does this address want mail, and when did it
--                                  say so. The legal record of double opt-in,
--                                  it outlives the Resend account, and it is
--                                  what scripts/backup-db.sh protects. Resend
--                                  has no concept of "pending".
--   Resend owns DELIVERABILITY   — which contacts a broadcast reaches, the
--                                  unsubscribe link in every mail, bounces and
--                                  complaints.
--
-- Drift is benign by construction: a broadcast can only reach Resend contacts,
-- so someone who unsubscribes through Resend's own link stops receiving mail
-- regardless of what Postgres says. Postgres is a record, not a gate.
--
-- The `posts` half is a metadata-only ALTER: three nullable columns and one
-- NOT NULL with a constant default, none of which rewrites the table on
-- Postgres 11+. Existing posts become NOT_SENT, which is correct — they
-- predate subscriptions and must not retroactively mail anyone.

-- CreateEnum
-- BOUNCED is declared though nothing sets it yet (a Resend webhook would):
-- adding a value to an existing Postgres enum is a migration of its own, the
-- same call PostStatus.ARCHIVED made in Phase 0.
CREATE TYPE "SubscriberStatus" AS ENUM ('PENDING', 'CONFIRMED', 'UNSUBSCRIBED', 'BOUNCED');

-- CreateEnum
-- SENDING exists because claiming the send and performing it are separate
-- steps: a serverless function that dies between them leaves SENDING, which
-- the owner can see and retry by hand. FAILED and SKIPPED are retryable BY
-- HAND ONLY — retrying automatically on a later publish is precisely the
-- double send this guard exists to prevent.
CREATE TYPE "NotifyStatus" AS ENUM ('NOT_SENT', 'SENDING', 'SENT', 'SKIPPED', 'FAILED');

-- AlterTable
-- The ONE-SHOT GUARD. Automatic-on-publish was chosen knowing that an
-- unpublish/re-publish cycle could double-send; these columns make it
-- impossible rather than unlikely. A publish CLAIMS the send with a
-- conditional UPDATE ... WHERE "notifyStatus" = 'NOT_SENT' and proceeds only
-- if exactly one row changed, so two concurrent publishes cannot both win and
-- no read-then-write race exists. Unpublish, archive and restore deliberately
-- leave these alone.
--
-- `notifiedAt` alone would have given "at most once" but SILENTLY: a transient
-- Resend 500 would set the timestamp, fail, and mute that post forever with
-- nothing recording why. The status column is what makes the outcome visible —
-- the argument `inquiries.emailStatus` already won in this schema.
ALTER TABLE "posts"
    ADD COLUMN "notifyStatus" "NotifyStatus" NOT NULL DEFAULT 'NOT_SENT',
    -- When the send was CLAIMED, not when mail landed. Nothing reads it as a
    -- delivery time.
    ADD COLUMN "notifiedAt" TIMESTAMP(3),
    -- Resend's broadcast id, stored immediately after creation. Closes the one
    -- real double-send hole: the broadcast API is create-then-send, two calls,
    -- so a retry without this would create a SECOND broadcast.
    ADD COLUMN "notifyBroadcastId" VARCHAR(64),
    -- Same width and purpose as `inquiries.emailError`.
    ADD COLUMN "notifyError" VARCHAR(500);

-- CreateTable
CREATE TABLE "subscribers" (
    "id" TEXT NOT NULL,
    -- Lowercased and trimmed by the application before it arrives. A Postgres
    -- unique index on text is CASE-SENSITIVE, so without that normalisation
    -- "A@x.com" and "a@x.com" would both be storable and both be mailed.
    "email" VARCHAR(254) NOT NULL,
    "status" "SubscriberStatus" NOT NULL DEFAULT 'PENDING',
    -- sha256 of the one-time confirmation token, never the token: that exists
    -- only in the email. Same reasoning as ADMIN_PASSWORD_HASH and ipHash — a
    -- database leak must not let the reader confirm anybody. NULLED on use,
    -- which is what makes the link single-use.
    "tokenHash" VARCHAR(64),
    "tokenSentAt" TIMESTAMP(3),
    -- The consent record. This, with "email", is the whole reason a Postgres
    -- copy exists alongside Resend's audience.
    "confirmedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    -- The Resend contact this row created: the join key that makes drift
    -- DETECTABLE. A CONFIRMED row with NULL here never reached the audience
    -- and will silently miss every broadcast.
    "resendContactId" VARCHAR(64),
    -- Signup IP, salted. Write-only, as on `inquiries`.
    "ipHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    -- NOT stored: an unsubscribe token. That link must stay valid forever and
    -- be mintable at every broadcast, which a single-use stored hash cannot
    -- do; it is derived as an HMAC of the id instead (lib/subscribers.ts).
    -- The rule worth remembering: a ONE-SHOT credential gets a stored hash
    -- plus a timestamp, a PERMANENT capability gets a derived HMAC and nothing
    -- at rest.
    CONSTRAINT "subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The dedup and the signup upsert's lookup, in one.
CREATE UNIQUE INDEX "subscribers_email_key" ON "subscribers"("email");

-- CreateIndex
-- The confirm route's only lookup. UNIQUE makes "one live token per row"
-- structural rather than a property of 256 bits of randomness, and Postgres
-- allows many NULLs in a unique index, so confirmed rows (token nulled) cost
-- nothing here.
CREATE UNIQUE INDEX "subscribers_tokenHash_key" ON "subscribers"("tokenHash");

-- NOT created: an index on "status". The only WHERE status = … reads are the
-- admin list, the drift count and the expired-pending sweep — all scans over a
-- table Resend's free tier caps at ~1,000 rows, and all the same call
-- schema-design.md §4 records for `inquiries.emailStatus`. Nothing on the four
-- new `posts` columns either: they are read only via a post already located by
-- id, and "which posts failed to notify" is a deliberate full scan.
