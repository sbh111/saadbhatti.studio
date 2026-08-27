-- CreateTable
CREATE TABLE "rate_windows" (
    "bucket" VARCHAR(64) NOT NULL,
    "ipHash" VARCHAR(64) NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_windows_pkey" PRIMARY KEY ("bucket", "ipHash", "windowStart")
);

-- CreateIndex
CREATE INDEX "rate_windows_windowStart_idx" ON "rate_windows"("windowStart");
