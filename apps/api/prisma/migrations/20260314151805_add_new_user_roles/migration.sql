-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'SUPER_ADMIN';
ALTER TYPE "UserRole" ADD VALUE 'EXECUTIVE';
ALTER TYPE "UserRole" ADD VALUE 'ACCOUNTING';
ALTER TYPE "UserRole" ADD VALUE 'AR_AP';
ALTER TYPE "UserRole" ADD VALUE 'MARKETING';
ALTER TYPE "UserRole" ADD VALUE 'LEGAL';
