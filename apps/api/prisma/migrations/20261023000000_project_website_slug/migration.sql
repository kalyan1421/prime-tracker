-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "websiteSlug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "projects_websiteSlug_key" ON "projects"("websiteSlug");
