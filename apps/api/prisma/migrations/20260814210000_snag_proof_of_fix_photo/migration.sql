-- Proof-of-fix ("after") photo on a punch-list item. Purely additive.
-- Separate from "photoPath" (the before/defect shot) on purpose: keeping both is what
-- makes the snag record auditable. Required by the service to resolve a snag; cleared
-- when a snag is reopened.
ALTER TABLE "snag_items" ADD COLUMN "afterPhotoPath" TEXT;
