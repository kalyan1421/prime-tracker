-- S3 — unit swap mid-contract.
--
-- A buyer who signed an LOI on unit 101 and then wants unit 205 keeps the SAME sale:
-- the buyer, the documents, the broker, the payments and (conditionally) the discount
-- approval all carry forward. Client decision 2026-08-14: carry forward, not
-- cancel-and-restart.
--
-- Rejected: UPDATE sales SET "unitId" = :newUnit. It leaves the old unit stranded in
-- UNDER_CONTRACT with no occupancy event, silently restates every percentOfPrice
-- installment against a price the buyer never agreed to, and carries a discount
-- approval granted for one asset onto another — the approval gate stops meaning
-- anything the moment a swap can walk around it.

CREATE TABLE "sale_unit_transfers" (
    "id"                 TEXT NOT NULL,
    "saleId"             TEXT NOT NULL,
    "fromUnitId"         TEXT NOT NULL,
    "toUnitId"           TEXT NOT NULL,
    -- When the switch takes effect in the real world. Both occupancy events (the old
    -- unit going back on the market, the new one being reserved) are dated to this,
    -- never to now() — otherwise a swap recorded a week late reads as a week of
    -- vacancy that did not happen.
    "effectiveDate"      TIMESTAMP(3) NOT NULL,
    -- SNAPSHOT of the agreed price on either side. The sale row only ever holds the
    -- current one, and the installment rebase is derived from the difference.
    "priceBefore"        DECIMAL(14,2),
    "priceAfter"         DECIMAL(14,2),
    -- The discount off each unit's asking price, so the carry-or-clear decision below
    -- stays auditable even after an asking price is edited.
    "discountPctBefore"  DECIMAL(6,2),
    "discountPctAfter"   DECIMAL(6,2),
    -- True when this transfer left the sale needing a Founder discount approval it does
    -- not have. Approving 12% off an $800k unit is not approving 12% off a $1.1M one.
    "approvalReRequired" BOOLEAN NOT NULL DEFAULT false,
    "reason"             TEXT,
    "note"               TEXT,
    "recordedById"       TEXT,
    "recordedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_unit_transfers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sale_unit_transfers_saleId_effectiveDate_idx"
    ON "sale_unit_transfers"("saleId", "effectiveDate");
CREATE INDEX "sale_unit_transfers_fromUnitId_idx" ON "sale_unit_transfers"("fromUnitId");
CREATE INDEX "sale_unit_transfers_toUnitId_idx" ON "sale_unit_transfers"("toUnitId");

ALTER TABLE "sale_unit_transfers"
    ADD CONSTRAINT "sale_unit_transfers_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, not CASCADE: this row is the only record that the deal ever stood on the
-- old unit. Units are soft-deleted anyway, so a hard delete that would orphan a
-- transfer is a data-repair operation that ought to fail loudly.
ALTER TABLE "sale_unit_transfers"
    ADD CONSTRAINT "sale_unit_transfers_fromUnitId_fkey"
    FOREIGN KEY ("fromUnitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_unit_transfers"
    ADD CONSTRAINT "sale_unit_transfers_toUnitId_fkey"
    FOREIGN KEY ("toUnitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SET NULL on the recorder: losing who pressed the button is bad, but not a reason to
-- block removing a departed user. Same call as sale_cancellations.cancelledById.
ALTER TABLE "sale_unit_transfers"
    ADD CONSTRAINT "sale_unit_transfers_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A swap to the same unit is not a swap. Enforced in the service with a message that
-- names the unit; here as the backstop no console session can slip past.
ALTER TABLE "sale_unit_transfers"
    ADD CONSTRAINT "sale_unit_transfer_units_differ"
    CHECK ("fromUnitId" <> "toUnitId");

-- ─────────────────────────────────────────────────────────────────────────────
-- Flagging paid installments the rebase could not restate.
--
-- Same two columns, and the same reasoning, as lease_rent_invoices.needsReview (R22):
-- paidAmount is the record of what a buyer actually handed over. Moving the figure it
-- was paid against would destroy exactly the discrepancy Finance needs in order to
-- decide between collecting the difference, refunding it, and leaving it alone.
ALTER TABLE "sale_payments" ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sale_payments" ADD COLUMN "reviewReason" TEXT;

-- No index: flagged installments are only ever read through their sale, which
-- "sale_payments_saleId_sequence_idx" already covers. A boolean index that is false on
-- every row but a handful earns nothing.
