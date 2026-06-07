-- Interior: handover sign-off fields + reusable package templates

-- Handover sign-off (client representative + notes; photos go via HANDOVER_CERTIFICATE docs)
ALTER TABLE "interior_projects" ADD COLUMN "handoverSignedBy" TEXT;
ALTER TABLE "interior_projects" ADD COLUMN "handoverNotes" TEXT;

-- Package templates ("2-3 generic options"; otherwise fully custom)
CREATE TABLE "interior_package_templates" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "defaultRatePerSqft" DECIMAL(12,2),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "interior_package_templates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "interior_package_templates_deletedAt_idx" ON "interior_package_templates"("deletedAt");

-- Preset BOQ lines on a template; copied into interior_scope_items on apply
CREATE TABLE "interior_package_items" (
  "id" TEXT NOT NULL,
  "packageTemplateId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT,
  "quantity" DECIMAL(12,2),
  "unit" TEXT,
  "unitPrice" DECIMAL(12,2),
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "interior_package_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "interior_package_items_packageTemplateId_idx" ON "interior_package_items"("packageTemplateId");

ALTER TABLE "interior_package_items"
  ADD CONSTRAINT "interior_package_items_packageTemplateId_fkey"
  FOREIGN KEY ("packageTemplateId") REFERENCES "interior_package_templates"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Link interior projects to the template they were created from (column already exists)
ALTER TABLE "interior_projects"
  ADD CONSTRAINT "interior_projects_packageTemplateId_fkey"
  FOREIGN KEY ("packageTemplateId") REFERENCES "interior_package_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
