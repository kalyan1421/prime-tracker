-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE', 'INDUSTRIAL');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "projectType" "ProjectType";
