-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('NEW', 'READ');

-- CreateTable
CREATE TABLE "inquiries" (
    "id" TEXT NOT NULL,
    "artworkPublicId" VARCHAR(255) NOT NULL,
    "artworkTitle" VARCHAR(255) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "status" "InquiryStatus" NOT NULL DEFAULT 'NEW',
    "ipHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inquiries_createdAt_idx" ON "inquiries"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "inquiries_ipHash_createdAt_idx" ON "inquiries"("ipHash", "createdAt");
