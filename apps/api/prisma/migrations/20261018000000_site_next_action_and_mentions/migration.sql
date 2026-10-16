-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SITE_UPDATE_MENTION';

-- AlterTable
ALTER TABLE "units" ADD COLUMN     "siteNextAction" TEXT,
ADD COLUMN     "siteNextActionAt" TIMESTAMP(3),
ADD COLUMN     "siteNextActionById" TEXT;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_siteNextActionById_fkey" FOREIGN KEY ("siteNextActionById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

