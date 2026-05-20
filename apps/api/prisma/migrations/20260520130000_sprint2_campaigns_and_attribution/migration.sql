-- Sprint 2 — Campaign attribution + spend ledger + UTM passthrough
--
-- Adds the marketing-spend tracking that the client requested directly:
--   * Track ad budgets per campaign (Meta / Google / newspaper / broker / etc.)
--   * Track real spend through a ledger (manual entries + future Meta/Google API sync)
--   * Attribute each Lead to a Campaign (explicit FK) AND keep raw UTM passthrough
--     for cases where the campaign hasn't been created yet at lead-capture time.
--
-- This migration is ADDITIVE — new enums, new tables, new nullable columns on Lead.
-- No existing data is rewritten.

-- ── New enums ──────────────────────────────────────────────────────────────
CREATE TYPE "CampaignChannel" AS ENUM (
    'META',
    'GOOGLE_ADS',
    'NEWSPAPER',
    'BROKER',
    'EMAIL',
    'SIGNAGE',
    'EVENT',
    'OTHER'
);

CREATE TYPE "CampaignStatus" AS ENUM (
    'PLANNED',
    'ACTIVE',
    'PAUSED',
    'COMPLETED'
);

CREATE TYPE "CampaignSpendSource" AS ENUM (
    'MANUAL',
    'META_API',
    'GOOGLE_API',
    'AGENCY_REPORT'
);

-- ── leads: campaign attribution + UTM passthrough ─────────────────────────
ALTER TABLE "leads"
    ADD COLUMN "campaignId"  TEXT,
    ADD COLUMN "utmSource"   TEXT,
    ADD COLUMN "utmMedium"   TEXT,
    ADD COLUMN "utmCampaign" TEXT,
    ADD COLUMN "utmContent"  TEXT;

CREATE INDEX "leads_campaignId_idx" ON "leads"("campaignId");

-- ── campaigns ──────────────────────────────────────────────────────────────
CREATE TABLE "campaigns" (
    "id"            TEXT              NOT NULL,
    "projectId"     TEXT,
    "name"          TEXT              NOT NULL,
    "channel"       "CampaignChannel" NOT NULL,
    "externalId"    TEXT,
    "plannedBudget" DECIMAL(14, 2),
    "status"        "CampaignStatus"  NOT NULL DEFAULT 'PLANNED',
    "startDate"     TIMESTAMP(3),
    "endDate"       TIMESTAMP(3),
    "notes"         TEXT,
    "createdBy"     TEXT              NOT NULL,
    "createdAt"     TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3)      NOT NULL,
    "deletedAt"     TIMESTAMP(3),

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "campaigns_projectId_idx"  ON "campaigns"("projectId");
CREATE INDEX "campaigns_channel_idx"    ON "campaigns"("channel");
CREATE INDEX "campaigns_status_idx"     ON "campaigns"("status");
CREATE INDEX "campaigns_externalId_idx" ON "campaigns"("externalId");
CREATE INDEX "campaigns_deletedAt_idx"  ON "campaigns"("deletedAt");

ALTER TABLE "campaigns"
    ADD CONSTRAINT "campaigns_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "campaigns"
    ADD CONSTRAINT "campaigns_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

-- ── campaign_spend (append-only ledger) ───────────────────────────────────
CREATE TABLE "campaign_spend" (
    "id"          TEXT                  NOT NULL,
    "campaignId"  TEXT                  NOT NULL,
    "amount"      DECIMAL(14, 2)        NOT NULL,
    "currency"    TEXT                  NOT NULL DEFAULT 'USD',
    "spentOn"     TIMESTAMP(3)          NOT NULL,
    "source"      "CampaignSpendSource" NOT NULL,
    "externalRef" TEXT,
    "recordedBy"  TEXT                  NOT NULL,
    "createdAt"   TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_spend_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "campaign_spend_campaignId_idx" ON "campaign_spend"("campaignId");
CREATE INDEX "campaign_spend_spentOn_idx"    ON "campaign_spend"("spentOn");
CREATE INDEX "campaign_spend_source_idx"     ON "campaign_spend"("source");

-- Dedup constraint: when an external system re-imports the same row, the
-- (campaignId, source, externalRef) triple uniqueness rejects duplicates.
-- NULL externalRef rows are allowed to repeat (manual entries pile up).
CREATE UNIQUE INDEX "campaign_spend_dedupe"
    ON "campaign_spend"("campaignId", "source", "externalRef");

ALTER TABLE "campaign_spend"
    ADD CONSTRAINT "campaign_spend_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "campaign_spend"
    ADD CONSTRAINT "campaign_spend_recordedBy_fkey"
    FOREIGN KEY ("recordedBy") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

-- ── leads.campaignId → campaigns FK ───────────────────────────────────────
ALTER TABLE "leads"
    ADD CONSTRAINT "leads_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
