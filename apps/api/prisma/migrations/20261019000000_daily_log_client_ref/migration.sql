-- AlterTable
ALTER TABLE "daily_logs" ADD COLUMN     "clientRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "daily_logs_authorId_clientRef_key" ON "daily_logs"("authorId", "clientRef");

