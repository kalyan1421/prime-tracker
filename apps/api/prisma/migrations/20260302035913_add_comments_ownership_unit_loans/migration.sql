-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "unitId" TEXT;

-- AlterTable
ALTER TABLE "units" ADD COLUMN     "primeOwned" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "unit_comments" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unit_comments_unitId_idx" ON "unit_comments"("unitId");

-- CreateIndex
CREATE INDEX "unit_comments_userId_idx" ON "unit_comments"("userId");

-- CreateIndex
CREATE INDEX "unit_comments_createdAt_idx" ON "unit_comments"("createdAt");

-- CreateIndex
CREATE INDEX "loans_unitId_idx" ON "loans"("unitId");

-- AddForeignKey
ALTER TABLE "unit_comments" ADD CONSTRAINT "unit_comments_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_comments" ADD CONSTRAINT "unit_comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
