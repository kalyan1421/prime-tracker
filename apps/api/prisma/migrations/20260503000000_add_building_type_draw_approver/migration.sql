-- CreateEnum BuildingType
CREATE TYPE "BuildingType" AS ENUM (
  'RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE', 'INDUSTRIAL',
  'PARKING', 'AMENITY', 'RETAIL', 'OFFICE'
);

-- AlterTable buildings: change buildingType from text to enum
ALTER TABLE "buildings"
  ALTER COLUMN "buildingType" TYPE "BuildingType"
  USING "buildingType"::"BuildingType";

-- AlterTable draw_requests: add approvedById and rejectionReason
ALTER TABLE "draw_requests"
  ADD COLUMN "approvedById"    TEXT,
  ADD COLUMN "rejectionReason" TEXT;

-- AddForeignKey draw_requests.approvedById -> users.id
ALTER TABLE "draw_requests"
  ADD CONSTRAINT "draw_requests_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
