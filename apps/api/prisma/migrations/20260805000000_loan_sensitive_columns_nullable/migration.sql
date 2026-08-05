-- Loan sensitive values move into "encryptedFields"; the columns must accept NULL
-- so the plaintext copy can be cleared.
--
-- This migration deliberately does NOT blank the existing rows. Scrubbing requires
-- decrypting each blob first to confirm it actually holds all four values — some
-- blobs are incomplete, because update() used to rebuild them from the incoming
-- patch alone. A blind UPDATE ... SET lender = NULL would destroy those values with
-- no way back. The repair-then-scrub pass lives in
-- prisma/backfill-loan-encryption.ts and is run explicitly.
ALTER TABLE "loans" ALTER COLUMN "lender" DROP NOT NULL;
ALTER TABLE "loans" ALTER COLUMN "principalAmt" DROP NOT NULL;
ALTER TABLE "loans" ALTER COLUMN "interestRate" DROP NOT NULL;
