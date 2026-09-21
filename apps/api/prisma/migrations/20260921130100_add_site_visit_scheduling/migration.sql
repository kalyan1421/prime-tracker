-- Site-visit scheduling: availability rules + bookings.
-- See docs/client-discovery/LEADS_BOARD_AND_SITE_VISIT_SPEC.md §6.
--
-- visit_availability stores RULES (local minutes + named timezone) because a recurring
-- "Tuesdays 10:00-16:00" has no absolute instant and storing one drifts at DST.
-- site_visits stores BOOKINGS as absolute UTC. That split is deliberate.
ALTER TABLE "org_settings" ADD COLUMN     "siteVisitDayEndMin" INTEGER NOT NULL DEFAULT 1080,
ADD COLUMN     "siteVisitDayStartMin" INTEGER NOT NULL DEFAULT 540,
ADD COLUMN     "siteVisitMinNoticeHours" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "siteVisitMissedGraceHours" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "siteVisitSlotMinutes" INTEGER NOT NULL DEFAULT 60;

-- CreateTable
CREATE TABLE "visit_availability" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OPEN',
    "dayOfWeek" INTEGER,
    "date" DATE,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "slotMinutes" INTEGER NOT NULL DEFAULT 60,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visit_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_visits" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "unitId" TEXT,
    "buildingId" TEXT,
    "hostId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "rescheduledFromId" TEXT,
    "rescheduleReason" TEXT,
    "outcomeNote" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visit_availability_hostId_dayOfWeek_idx" ON "visit_availability"("hostId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "visit_availability_hostId_date_idx" ON "visit_availability"("hostId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "site_visits_rescheduledFromId_key" ON "site_visits"("rescheduledFromId");

-- CreateIndex
CREATE INDEX "site_visits_hostId_startsAt_idx" ON "site_visits"("hostId", "startsAt");

-- CreateIndex
CREATE INDEX "site_visits_status_startsAt_idx" ON "site_visits"("status", "startsAt");

-- CreateIndex
CREATE INDEX "site_visits_leadId_idx" ON "site_visits"("leadId");

-- CreateIndex
CREATE INDEX "site_visits_projectId_startsAt_idx" ON "site_visits"("projectId", "startsAt");

-- AddForeignKey
ALTER TABLE "visit_availability" ADD CONSTRAINT "visit_availability_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_rescheduledFromId_fkey" FOREIGN KEY ("rescheduledFromId") REFERENCES "site_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The double-booking guard. Prisma cannot express a PARTIAL unique index, so it is raw
-- SQL here and must be verified after deploy — if it is silently missing, the UI still
-- looks correct while two reps can hold the same slot.
--
-- REQUESTED is included on purpose: a pending request SOFT-HOLDS the slot. If two reps
-- could both request 10:00 Tuesday, the Founder would have to arbitrate between two
-- clients who were each already promised a time, which is the exact phone-tag this
-- feature exists to remove. On reject/cancel the row leaves the predicate and the slot
-- returns to the pool automatically.
CREATE UNIQUE INDEX "site_visits_host_slot_active"
  ON "site_visits" ("hostId", "startsAt")
  WHERE "status" IN ('REQUESTED', 'CONFIRMED');
