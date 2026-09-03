-- pgvector: semantic image-search embeddings. The extension must exist before the
-- vector column can be created.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "artwork_embeddings" (
    "publicId" VARCHAR(255) NOT NULL,
    "embedding" vector(512) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artwork_embeddings_pkey" PRIMARY KEY ("publicId")
);
