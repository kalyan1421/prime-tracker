-- Auth hardening from the 2026-10-24 security audit.
--
-- 1. Refresh tokens are stored as a SHA-256 hash instead of in plaintext.
--
--    EVERY EXISTING REFRESH TOKEN IS DELETED, which signs everyone out: each user has to
--    sign in again once their current access token expires (at most 15 minutes after this
--    runs). That is deliberate, not a shortcut:
--
--    - The plaintext values have been sitting in this table, and in every backup taken of
--      it, for as long as the app has existed. Hashing them in place would keep exactly
--      those exposed values valid for up to another 7 days. Deleting them is the only way
--      to make sure no token that was ever stored readable can still be redeemed.
--    - The new column is NOT NULL and has no sensible value for an old row anyway.
--
--    The DELETE must come before the column change, because adding a NOT NULL column
--    with no default fails on a non-empty table.
DELETE FROM "refresh_tokens";

DROP INDEX "refresh_tokens_token_key";

ALTER TABLE "refresh_tokens" DROP COLUMN "token",
ADD COLUMN     "tokenHash" TEXT NOT NULL;

CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- 2. Per-account login lockout and TOTP replay protection.
--
--    Additive only. Every existing user starts with no failures, no lock, and no
--    remembered TOTP step — so nobody is locked out by the migration, and the first code
--    each MFA user enters afterwards is accepted as normal.
ALTER TABLE "users" ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "mfaLastUsedStep" INTEGER;
