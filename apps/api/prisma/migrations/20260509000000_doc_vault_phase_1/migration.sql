-- Document Vault Phase 1 — sales-lifecycle documents + versioning + buyer-portal scaffold
--
-- This migration is additive only:
--   * Existing Document rows are preserved (new columns nullable or defaulted)
--   * New DocumentVersion table archives prior versions on replace
--   * New Client model + ClientStatus enum + UserRole.CLIENT scaffold the buyer portal
--     (Phase 2 service wiring; no live portal route yet)

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'COMPLETED', 'TERMINATED');

-- AlterEnum: UserRole + CLIENT
ALTER TYPE "UserRole" ADD VALUE 'CLIENT';

-- AlterEnum: DocCategory — sales lifecycle + buyer-portal categories
ALTER TYPE "DocCategory" ADD VALUE 'BROCHURE';
ALTER TYPE "DocCategory" ADD VALUE 'LOI';
ALTER TYPE "DocCategory" ADD VALUE 'DEED';
ALTER TYPE "DocCategory" ADD VALUE 'BOOKING_AGREEMENT';
ALTER TYPE "DocCategory" ADD VALUE 'RECEIPT';
ALTER TYPE "DocCategory" ADD VALUE 'NOC';
ALTER TYPE "DocCategory" ADD VALUE 'POSSESSION_CERTIFICATE';

-- AlterTable: documents — extend to building/sale/lead, add versioning + portal flag + soft-delete
-- updatedAt is added nullable, backfilled from createdAt, then constrained to NOT NULL to keep
-- the live table compatible with existing rows.
ALTER TABLE "documents"
    ADD COLUMN "buildingId"      TEXT,
    ADD COLUMN "saleId"          TEXT,
    ADD COLUMN "leadId"          TEXT,
    ADD COLUMN "externalUrl"     TEXT,
    ADD COLUMN "isClientVisible" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "versionNumber"   INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "deletedAt"       TIMESTAMP(3),
    ADD COLUMN "updatedAt"       TIMESTAMP(3);

UPDATE "documents" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

ALTER TABLE "documents"
    ALTER COLUMN "updatedAt" SET NOT NULL,
    ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateTable: document_versions
CREATE TABLE "document_versions" (
    "id"            TEXT         NOT NULL,
    "documentId"    TEXT         NOT NULL,
    "versionNumber" INTEGER      NOT NULL,
    "fileName"      TEXT         NOT NULL,
    "fileUrl"       TEXT         NOT NULL,
    "storagePath"   TEXT,
    "fileSize"      INTEGER,
    "mimeType"      TEXT,
    "externalUrl"   TEXT,
    "notes"         TEXT,
    "uploadedById"  TEXT         NOT NULL,
    "uploadedAt"    TIMESTAMP(3) NOT NULL,
    "archivedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: clients
CREATE TABLE "clients" (
    "id"          TEXT           NOT NULL,
    "userId"      TEXT           NOT NULL,
    "saleId"      TEXT           NOT NULL,
    "projectId"   TEXT           NOT NULL,
    "unitId"      TEXT           NOT NULL,
    "status"      "ClientStatus" NOT NULL DEFAULT 'ONBOARDING',
    "invitedAt"   TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "notes"       TEXT,
    "createdAt"   TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3)   NOT NULL,
    "deletedAt"   TIMESTAMP(3),

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: documents (new lookup paths)
CREATE INDEX "documents_buildingId_idx"               ON "documents"("buildingId");
CREATE INDEX "documents_saleId_idx"                   ON "documents"("saleId");
CREATE INDEX "documents_leadId_idx"                   ON "documents"("leadId");
CREATE INDEX "documents_category_deletedAt_idx"       ON "documents"("category", "deletedAt");
CREATE INDEX "documents_isClientVisible_deletedAt_idx" ON "documents"("isClientVisible", "deletedAt");
CREATE INDEX "documents_deletedAt_idx"                ON "documents"("deletedAt");

-- CreateIndex: document_versions
CREATE INDEX        "document_versions_documentId_idx"               ON "document_versions"("documentId");
CREATE UNIQUE INDEX "document_versions_documentId_versionNumber_key" ON "document_versions"("documentId", "versionNumber");

-- CreateIndex: clients
CREATE UNIQUE INDEX "clients_userId_key"           ON "clients"("userId");
CREATE UNIQUE INDEX "clients_saleId_key"           ON "clients"("saleId");
CREATE INDEX        "clients_projectId_idx"        ON "clients"("projectId");
CREATE INDEX        "clients_unitId_idx"           ON "clients"("unitId");
CREATE INDEX        "clients_status_deletedAt_idx" ON "clients"("status", "deletedAt");
CREATE INDEX        "clients_deletedAt_idx"        ON "clients"("deletedAt");

-- AddForeignKey: documents
ALTER TABLE "documents" ADD CONSTRAINT "documents_buildingId_fkey"
    FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: document_versions
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: clients
ALTER TABLE "clients" ADD CONSTRAINT "clients_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clients" ADD CONSTRAINT "clients_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clients" ADD CONSTRAINT "clients_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clients" ADD CONSTRAINT "clients_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
