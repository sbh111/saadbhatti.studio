-- Blog cover images (Phase 1).
--
-- Four nullable columns, so this is a metadata-only ALTER: Postgres 11+ adds a
-- nullable column (and a non-null one with a constant default) without
-- rewriting the table, and `posts` has no rows in production yet regardless.
-- Nothing here needs a backfill — a post written in Phase 0 simply has no
-- cover, which renders exactly as it did before.
--
-- Note what is NOT in this migration: Markdown. The body column was
-- deliberately named `body` rather than `bodyMarkdown` in Phase 0 precisely so
-- that interpreting it as Markdown would be a rendering change
-- (lib/markdown.ts) and not a schema change. Same for reading time, which is
-- derived at read time rather than stored — see the note in lib/posts.ts about
-- when that trade stops being the right one.

-- AlterTable
ALTER TABLE "posts"
    -- A Cloudinary public_id ("blog/kq3n8x"), never a delivery URL: storing a
    -- URL would freeze today's transformation parameters into the row, so
    -- changing the display cap later would mean rewriting data instead of
    -- editing lib/cloudinary.ts. Width 255 matches every other public_id
    -- column in this schema (`inquiries`, `likes`, `artwork_embeddings`).
    ADD COLUMN "coverPublicId" VARCHAR(255),

    -- Alt text, nullable and distinct from the title: a decorative cover wants
    -- an empty alt, and reusing the title makes a screen reader say it twice.
    ADD COLUMN "coverAlt" VARCHAR(200),

    -- Intrinsic dimensions as Cloudinary reported them at upload time, so the
    -- aspect ratio can be reserved before the image loads without an Admin API
    -- call during a render. Raw integers rather than a ratio because Phase 5's
    -- og:image:width / og:image:height need exactly these.
    ADD COLUMN "coverWidth" INTEGER,
    ADD COLUMN "coverHeight" INTEGER;

-- No index on any of these. They are never a query predicate — the cover is
-- read only as part of a post already located by slug or id, and
-- schema-design.md §4's rule is that an index must serve a real access
-- pattern rather than exist in case one appears.
