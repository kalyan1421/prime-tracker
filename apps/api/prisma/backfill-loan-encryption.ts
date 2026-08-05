/**
 * One-off backfill: move Loan sensitive values fully into `encryptedFields` and clear
 * the plaintext columns.
 *
 * Why this is a script and not SQL in the migration
 * -------------------------------------------------
 * `encryptFields` used to return the object untouched, so every loan was written with
 * the plaintext in its own column AND an encrypted copy alongside — the ciphertext was
 * decorative. Clearing the columns is the actual fix, but it cannot be a blind
 * `UPDATE ... SET lender = NULL`:
 *
 *   `update()` rebuilt the blob from the incoming patch alone, so a loan last edited
 *   via a partial update (say, only currentBalance) has a blob containing ONLY that
 *   field. Null its columns and lender/principal/rate are gone permanently.
 *
 * So each row is REPAIRED before it is scrubbed:
 *   1. decrypt whatever the blob holds
 *   2. merge over it from the plaintext columns (columns win — they are the complete,
 *      authoritative copy today)
 *   3. re-encrypt the full set and write it back
 *   4. only then null the columns
 *
 * A row is never scrubbed unless step 3 was verified to round-trip.
 *
 * Usage:
 *   ENCRYPTION_KEY=<64-hex> npx ts-node prisma/backfill-loan-encryption.ts --dry-run
 *   ENCRYPTION_KEY=<64-hex> npx ts-node prisma/backfill-loan-encryption.ts --apply
 *
 * Idempotent: rows already scrubbed (all four columns null) are skipped.
 */
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../src/common/encryption/encryption.service';

const FIELDS = ['lender', 'principalAmt', 'interestRate', 'currentBalance'] as const;

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

function buildEncryption(): EncryptionService {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY is required — use the SAME key the data was written with.');
  const config = {
    get: (k: string, fallback?: string) => process.env[k] ?? fallback,
    getOrThrow: (k: string) => {
      const v = process.env[k];
      if (!v) throw new Error(`Missing ${k}`);
      return v;
    },
  } as unknown as ConfigService;
  return new EncryptionService(config);
}

async function main() {
  const enc = buildEncryption();

  const loans = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, lender, "principalAmt", "interestRate", "currentBalance", "encryptedFields" FROM loans`,
  );

  let repaired = 0, scrubbed = 0, alreadyClean = 0, skipped = 0;
  const problems: string[] = [];

  for (const row of loans) {
    const plainPresent = FIELDS.some((f) => row[f] !== null && row[f] !== undefined);
    if (!plainPresent) { alreadyClean++; continue; }

    // What the blob currently holds (may be partial, or missing entirely).
    let fromBlob: Record<string, unknown> = {};
    if (row.encryptedFields) {
      const d = enc.decryptFields({ encryptedFields: row.encryptedFields } as any) as any;
      const { encryptedFields: _drop, ...rest } = d;
      fromBlob = rest;
    }

    // Columns win: they are the complete copy today.
    const merged: Record<string, unknown> = { ...fromBlob };
    for (const f of FIELDS) {
      if (row[f] !== null && row[f] !== undefined) {
        merged[f] = f === 'lender' ? String(row[f]) : Number(row[f]);
      }
    }

    const rebuilt = enc.encryptFields({ ...merged }, FIELDS as unknown as string[]);

    // Verify the round-trip before trusting it enough to delete the source.
    const check = enc.decryptFields({ encryptedFields: rebuilt.encryptedFields } as any) as any;
    const ok = FIELDS.every((f) => {
      if (merged[f] === undefined || merged[f] === null) return true;
      return String(check[f]) === String(merged[f]);
    });
    if (!ok) {
      problems.push(`${row.id}: round-trip verification FAILED — left untouched`);
      skipped++;
      continue;
    }

    if (apply) {
      await prisma.$executeRawUnsafe(
        `UPDATE loans SET "encryptedFields" = $1, lender = NULL, "principalAmt" = NULL,
           "interestRate" = NULL, "currentBalance" = NULL WHERE id = $2`,
        rebuilt.encryptedFields, row.id,
      );
    }
    if (Object.keys(fromBlob).length < Object.keys(merged).length) repaired++;
    scrubbed++;
  }

  console.log(`${apply ? 'APPLIED' : 'DRY RUN'} — ${loans.length} loan(s) examined`);
  console.log(`  already clean (no plaintext): ${alreadyClean}`);
  console.log(`  blobs repaired (were incomplete): ${repaired}`);
  console.log(`  rows scrubbed: ${scrubbed}`);
  console.log(`  skipped (verification failed): ${skipped}`);
  for (const p of problems) console.log(`  !! ${p}`);
  if (!apply) console.log('\nRe-run with --apply to write changes.');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
