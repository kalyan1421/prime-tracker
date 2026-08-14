-- S1 — Sale cancellation refund/penalty ledger.
--
-- Until now CancelSaleModal collected a refund amount and a penalty amount and
-- SalesService.update threw them away (deferred as "discovery item D18"). SalePayment
-- carries real paidAmount/paidAt, so there is genuinely collected money with no account
-- of what became of it.
--
-- Rejected: refundAmount / penaltyAmount columns on "sales". Two loose numbers with no
-- relationship to the money actually collected, no record of WHEN it moved, and no way
-- to express a mixed outcome. This mirrors LeasesService.settleDeposit instead: record a
-- DECISION, do not move money. SalePayment.paidAmount keeps meaning "what was collected".

-- Void, not forgiven. WAIVED already means "we let the buyer off this installment";
-- an installment on a dead sale was never owed in the first place. Reusing WAIVED would
-- put real forgiveness and cancelled scaffolding into the same bucket in every report.
ALTER TYPE "SalePaymentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

CREATE TYPE "SaleCancellationDisposition" AS ENUM ('REFUND', 'FORFEIT', 'NET', 'DECIDE_LATER');

CREATE TABLE "sale_cancellations" (
    "id"              TEXT NOT NULL,
    -- One per sale. A sale has one cancellation outcome, not a history of them.
    "saleId"          TEXT NOT NULL,
    "cancelledAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledById"   TEXT,
    -- SNAPSHOT of sum(sale_payments.paidAmount) at the moment of cancellation, taken
    -- inside the cancelling transaction. Not recomputed on read: an installment edited
    -- afterwards must not silently restate what the ledger reconciled against.
    "totalCollected"  DECIMAL(14,2) NOT NULL,
    "disposition"     "SaleCancellationDisposition" NOT NULL DEFAULT 'DECIDE_LATER',
    "refundAmount"    DECIMAL(14,2) NOT NULL DEFAULT 0,
    "penaltyAmount"   DECIMAL(14,2) NOT NULL DEFAULT 0,
    -- When the money ACTUALLY moved, deliberately separate from cancelledAt (when the
    -- decision was made). A recorded decision is not a cheque written.
    "refundPaidAt"    TIMESTAMP(3),
    "refundReference" TEXT,
    "note"            TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_cancellations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sale_cancellations_saleId_key" ON "sale_cancellations"("saleId");
CREATE INDEX "sale_cancellations_disposition_idx" ON "sale_cancellations"("disposition");
CREATE INDEX "sale_cancellations_cancelledAt_idx" ON "sale_cancellations"("cancelledAt");

ALTER TABLE "sale_cancellations"
    ADD CONSTRAINT "sale_cancellations_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL on the canceller: losing who pressed the button is bad, but not a reason to
-- block removing a departed user. Same call as historical_record_deletions' decider.
ALTER TABLE "sale_cancellations"
    ADD CONSTRAINT "sale_cancellations_cancelledById_fkey"
    FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- THE INVARIANT — this is what makes the row a ledger rather than two free-text boxes.
-- Every dollar collected must be accounted for as either refunded or retained once a
-- decision has been made. DECIDE_LATER is exempt precisely because no decision exists
-- yet; that is the state that lets a sale be cancelled without Finance in the room.
-- Enforced in SalesService as well, so the user gets a message naming all three figures
-- rather than a raw constraint violation. Here as the backstop that no other write path,
-- migration or console session can slip past.
ALTER TABLE "sale_cancellations"
    ADD CONSTRAINT "sale_cancellation_reconciles"
    CHECK (
      "disposition" = 'DECIDE_LATER'
      OR "refundAmount" + "penaltyAmount" = "totalCollected"
    );

-- Money cannot move backwards, and a refund cannot be marked paid when none is owed.
ALTER TABLE "sale_cancellations"
    ADD CONSTRAINT "sale_cancellation_amounts_non_negative"
    CHECK ("refundAmount" >= 0 AND "penaltyAmount" >= 0 AND "totalCollected" >= 0);

ALTER TABLE "sale_cancellations"
    ADD CONSTRAINT "sale_cancellation_refund_paid_needs_refund"
    CHECK ("refundPaidAt" IS NULL OR "refundAmount" > 0);
