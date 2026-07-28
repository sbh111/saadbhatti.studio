-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(64) NOT NULL,
    "value" VARCHAR(255) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "likes" (
    "id" TEXT NOT NULL,
    "artworkPublicId" VARCHAR(255) NOT NULL,
    "ipHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "likes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "likes_artworkPublicId_idx" ON "likes"("artworkPublicId");

-- CreateIndex
CREATE UNIQUE INDEX "likes_artworkPublicId_ipHash_key" ON "likes"("artworkPublicId", "ipHash");
