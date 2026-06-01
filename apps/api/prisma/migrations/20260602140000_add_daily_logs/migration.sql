-- Daily construction logs (Phase 4) — additive only.

-- CreateTable
CREATE TABLE "daily_logs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "buildingId" TEXT,
    "logDate" TIMESTAMP(3) NOT NULL,
    "authorId" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "weather" TEXT,
    "crewCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_log_photos" (
    "id" TEXT NOT NULL,
    "dailyLogId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "caption" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_log_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_logs_projectId_logDate_idx" ON "daily_logs"("projectId", "logDate");
CREATE INDEX "daily_logs_buildingId_idx" ON "daily_logs"("buildingId");
CREATE INDEX "daily_log_photos_dailyLogId_idx" ON "daily_log_photos"("dailyLogId");

-- AddForeignKey
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_log_photos" ADD CONSTRAINT "daily_log_photos_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
