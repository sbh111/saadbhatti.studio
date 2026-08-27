-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "inquiries" ADD COLUMN     "emailError" VARCHAR(500),
ADD COLUMN     "emailStatus" "EmailStatus" NOT NULL DEFAULT 'PENDING';

-- Backfill: existing inquiries predate email-status tracking; assume the
-- best-effort notification was attempted so they don't surface as false alerts.
UPDATE "inquiries" SET "emailStatus" = 'SENT';
