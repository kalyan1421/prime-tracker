-- Sale.combinedDealRef — several units sold TOGETHER as one negotiated deal.
--
-- Mirrors leases.combinedDealRef (20260822030000) and exists for the same reason: the
-- units stay separate, independently priced, independently closable Sale rows, linked
-- only by a label. Closing stays per sale — the discount gate, the document gate
-- (assertStageDocumentsAttached reads documents BY saleId) and the tenancy handover are
-- all genuinely per-unit decisions, and a group close that half-failed would be the worst
-- possible state for a sale.
--
-- Nullable, no default, no backfill: every existing sale keeps exactly the behaviour it
-- has today.
ALTER TABLE "sales" ADD COLUMN "combinedDealRef" TEXT;

-- Deliberately NOT unique. A group's label is legitimately reused across time (a resale
-- of the same units), and the refs originate as free text from a client spreadsheet, so
-- uniqueness would reject real data. Reads are always scoped by project + liveness.
CREATE INDEX "sales_combinedDealRef_idx" ON "sales"("combinedDealRef");
