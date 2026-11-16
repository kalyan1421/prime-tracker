-- Invoice files on fit-out bills (client, 2026-11-11: "invoices can be uploaded to the linked
-- purchase order"). A bill already belongs to a PO, so the file hangs off the bill.

-- New document category for a supplier's invoice.
ALTER TYPE "DocCategory" ADD VALUE 'INVOICE';

-- The bill a document is the invoice for. Nullable: every existing document has none.
ALTER TABLE "documents" ADD COLUMN "interiorInvoiceId" TEXT;

CREATE INDEX "documents_interiorInvoiceId_idx" ON "documents"("interiorInvoiceId");

ALTER TABLE "documents" ADD CONSTRAINT "documents_interiorInvoiceId_fkey"
  FOREIGN KEY ("interiorInvoiceId") REFERENCES "interior_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
