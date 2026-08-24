-- Unit Construction Checklist (2026-08-21) — a fixed, ordered per-unit stage checklist,
-- separate from the Task/TaskUnit "Construction Updates Board". See schema.prisma comment
-- above model ConstructionStageTemplateItem for why this is a new system.

-- CreateTable
CREATE TABLE "construction_stage_template_items" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "construction_stage_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_construction_stages" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "ownerId" TEXT,
    "inspectionStatus" TEXT,
    "inspectionDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_construction_stages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "construction_stage_template_items_buildingId_sortOrder_idx" ON "construction_stage_template_items"("buildingId", "sortOrder");

-- CreateIndex
CREATE INDEX "unit_construction_stages_unitId_sortOrder_idx" ON "unit_construction_stages"("unitId", "sortOrder");

-- AddForeignKey
ALTER TABLE "construction_stage_template_items" ADD CONSTRAINT "construction_stage_template_items_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_stage_template_items" ADD CONSTRAINT "construction_stage_template_items_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_construction_stages" ADD CONSTRAINT "unit_construction_stages_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_construction_stages" ADD CONSTRAINT "unit_construction_stages_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_construction_stages" ADD CONSTRAINT "unit_construction_stages_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
