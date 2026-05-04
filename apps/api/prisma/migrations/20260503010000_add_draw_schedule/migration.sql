-- CreateTable
CREATE TABLE "draw_schedules" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "drawNumber" INTEGER NOT NULL,
    "plannedAmount" DECIMAL(14,2) NOT NULL,
    "plannedDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "draw_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "draw_schedules_loanId_drawNumber_key" ON "draw_schedules"("loanId", "drawNumber");

-- CreateIndex
CREATE INDEX "draw_schedules_loanId_idx" ON "draw_schedules"("loanId");

-- AddForeignKey
ALTER TABLE "draw_schedules" ADD CONSTRAINT "draw_schedules_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
