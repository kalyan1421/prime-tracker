-- R8: link historical leases that spanned more than one physical unit, without building
-- full Unit Groups. Free text on purpose — see the comment on the schema field.
ALTER TABLE "leases" ADD COLUMN "combinedDealRef" TEXT;
CREATE INDEX "leases_combinedDealRef_idx" ON "leases"("combinedDealRef");
