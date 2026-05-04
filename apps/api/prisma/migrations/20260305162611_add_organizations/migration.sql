-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('LEAD', 'EMPLOYEE');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "orgId" TEXT;

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "entityType" TEXT,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_memberships" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgRole" "OrgRole" NOT NULL DEFAULT 'EMPLOYEE',
    "reportsTo" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "org_memberships_userId_idx" ON "org_memberships"("userId");

-- CreateIndex
CREATE INDEX "org_memberships_orgId_idx" ON "org_memberships"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "org_memberships_orgId_userId_key" ON "org_memberships"("orgId", "userId");

-- CreateIndex
CREATE INDEX "projects_orgId_idx" ON "projects"("orgId");

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_reportsTo_fkey" FOREIGN KEY ("reportsTo") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default organization
INSERT INTO "organizations" ("id", "name", "slug", "entityType", "isDefault", "isActive", "createdAt", "updatedAt")
VALUES ('org_prime_default', 'Prime Developers', 'prime-developers', 'LLC', true, true, NOW(), NOW());

-- Assign all existing projects to default org
UPDATE "projects" SET "orgId" = 'org_prime_default' WHERE "orgId" IS NULL;

-- Auto-assign non-FOUNDER users to default org
-- PM, FINANCE -> LEAD; SALES, CONSTRUCTION, VIEWER -> EMPLOYEE
INSERT INTO "org_memberships" ("id", "orgId", "userId", "orgRole", "joinedAt")
SELECT
  'mem_' || "id",
  'org_prime_default',
  "id",
  CASE WHEN "role" IN ('PROJECT_MANAGER', 'FINANCE') THEN 'LEAD'::"OrgRole" ELSE 'EMPLOYEE'::"OrgRole" END,
  NOW()
FROM "users"
WHERE "role" != 'FOUNDER';
