-- Site Tracker weeks 1-2 (2026-10-16): multi-unit rows (units.trackedWithId), unit watchers,
-- and three site notifications. Additive only.

-- AlterEnum


ALTER TYPE "NotificationType" ADD VALUE 'SITE_UPDATE_POSTED';
ALTER TYPE "NotificationType" ADD VALUE 'SITE_UNIT_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'SITE_BLOCKER_FLAGGED';

-- AlterTable
ALTER TABLE "units" ADD COLUMN     "trackedWithId" TEXT;

-- CreateTable
CREATE TABLE "unit_watchers" (
    "unitId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_watchers_pkey" PRIMARY KEY ("unitId","userId")
);

-- CreateIndex
CREATE INDEX "unit_watchers_userId_idx" ON "unit_watchers"("userId");

-- CreateIndex
CREATE INDEX "units_trackedWithId_idx" ON "units"("trackedWithId");

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_trackedWithId_fkey" FOREIGN KEY ("trackedWithId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_watchers" ADD CONSTRAINT "unit_watchers_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_watchers" ADD CONSTRAINT "unit_watchers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

