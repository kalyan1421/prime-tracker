-- Multi-unit interest / per-unit waitlist (LeadUnitInterest join) — additive only.
CREATE TABLE "lead_unit_interests" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_unit_interests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lead_unit_interests_leadId_unitId_key" ON "lead_unit_interests"("leadId", "unitId");
CREATE INDEX "lead_unit_interests_unitId_idx" ON "lead_unit_interests"("unitId");
ALTER TABLE "lead_unit_interests" ADD CONSTRAINT "lead_unit_interests_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_unit_interests" ADD CONSTRAINT "lead_unit_interests_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
