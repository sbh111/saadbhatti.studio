-- Blog posts (Phase 0) — the first content entity this database owns.
--
-- Every existing table holds side-channel data ABOUT artwork whose
-- authoritative copy lives in Cloudinary. A post's prose lives only here, so
-- this is the first migration after which a lost database means lost content
-- rather than a rebuildable cache. scripts/backup-db.sh stops being optional
-- (tech debt 4.3 notes it has never actually been run).
--
-- No foreign keys on this table because it has no parent. That is NOT the same
-- reason the rest of the schema has none — there, the parent genuinely lives in
-- another system (docs/schema-design.md §1). When Phase 2 adds post_likes those
-- children get a real FK with ON DELETE CASCADE, because `posts` is a real row
-- in this database and the "parent lives elsewhere" reasoning does not apply.
--
-- Column widths mirror lib/blogLimits.ts exactly, so the database is a second
-- line of defence rather than the only one (the same rule as `inquiries`).

-- CreateEnum
-- ARCHIVED is declared now even though Phase 0 ships no archive button:
-- adding a value to an existing Postgres enum is a migration of its own.
CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "excerpt" VARCHAR(300) NOT NULL,
    -- Postgres TOASTs a value this large out-of-line (compressed) once the row
    -- exceeds ~2 kB, so the admin list's `SELECT id, title, status, "updatedAt"`
    -- never reads a post body it does not display.
    "body" VARCHAR(60000) NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'DRAFT',
    -- Nullable: a post that has never been published has no public date. Set on
    -- the FIRST publish and never rewritten thereafter.
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- App-maintained via Prisma's @updatedAt, hence no DB default and no
    -- trigger — the same convention as `settings` (schema-design.md §5).
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The slug is the public URL contract, so uniqueness is enforced by the
-- database rather than only by the admin create path. Doubles as the hot
-- point lookup for /blog/<slug>.
CREATE UNIQUE INDEX "posts_slug_key" ON "posts"("slug");

-- CreateIndex
-- The public index's only query: `WHERE status = 'PUBLISHED'
-- ORDER BY "publishedAt" DESC`. `status` leads because it is always an
-- equality predicate; `publishedAt DESC` matches the ORDER BY exactly, so the
-- plan is an index scan with no sort step.
CREATE INDEX "posts_status_publishedAt_idx" ON "posts"("status", "publishedAt" DESC);
