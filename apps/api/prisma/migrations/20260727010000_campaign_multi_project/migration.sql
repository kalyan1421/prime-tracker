-- Campaigns can now span any number of projects (0 = portfolio-wide, 1 or more =
-- specific projects), not just a single optional projectId. Introduces an explicit
-- join table (same pattern as project_members) and backfills every existing
-- campaign's single projectId into it before dropping the old column.

CREATE TABLE "campaign_projects" (
    "id"         TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "projectId"  TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_projects_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_projects_campaignId_projectId_key" ON "campaign_projects"("campaignId", "projectId");
CREATE INDEX "campaign_projects_campaignId_idx" ON "campaign_projects"("campaignId");
CREATE INDEX "campaign_projects_projectId_idx" ON "campaign_projects"("projectId");

ALTER TABLE "campaign_projects" ADD CONSTRAINT "campaign_projects_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_projects" ADD CONSTRAINT "campaign_projects_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one join row per campaign that was already tied to a single project.
-- Portfolio-wide campaigns (projectId IS NULL) get zero rows, which is the new
-- representation of "portfolio-wide" — no data loss either way.
INSERT INTO "campaign_projects" ("id", "campaignId", "projectId")
SELECT gen_random_uuid()::text, "id", "projectId"
FROM "campaigns"
WHERE "projectId" IS NOT NULL;

ALTER TABLE "campaigns" DROP CONSTRAINT "campaigns_projectId_fkey";
DROP INDEX "campaigns_projectId_idx";
ALTER TABLE "campaigns" DROP COLUMN "projectId";
