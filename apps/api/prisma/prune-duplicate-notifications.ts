/**
 * One-off cleanup for the notification backlog produced before send() deduplicated.
 *
 * Every cron run re-raised each still-overdue item as a NEW row, so a single run on
 * 2026-07-29 wrote 2,185 notifications (215 rent alerts x ~10 recipients) and the backlog
 * only ever grew. Users saw a permanently red bell where "mark all as read" appeared not
 * to stick, because the next run refilled it.
 *
 * `NotificationsService.suppressAlreadyPending` stops this happening again, keyed on the
 * new `dedupeKey` column. This prunes what is already there:
 *
 *   - For RECURRING types only, keep the NEWEST row per (userId, type, identity) and
 *     delete the older copies. The newest carries the current state ("42 days overdue"),
 *     so the alert survives — only the stale restatements go.
 *   - EVENT types (comments, lead assignment, draw decisions) are never touched: two
 *     comments on the same unit share a title and are genuinely two things.
 *
 * "identity" is dedupeKey where present. Every row written BEFORE that column existed has
 * NULL, so those fall back to the title with its day counter normalised out — seven
 * recurring types embed one ("Rent overdue (29d): Mathnasium" is "(30d)" the next
 * morning), and grouping on the raw title sees each day as a different alert. That is the
 * whole reason the backlog exists, so the cleanup has to undo it the same way.
 *
 *   npx tsx prisma/prune-duplicate-notifications.ts            # report only
 *   npx tsx prisma/prune-duplicate-notifications.ts --apply    # delete
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Kept in step with RECURRING_TYPES in notifications.service.ts. Duplicated rather than
// imported so this script stays runnable via tsx without booting the Nest module graph.
const RECURRING = [
  'MILESTONE_OVERDUE', 'LEASE_EXPIRING_30', 'LEASE_EXPIRING_7', 'LOAN_MATURITY_60',
  'BUDGET_VARIANCE', 'PAYMENT_OVERDUE', 'PAYMENT_DUE_7', 'RENT_OVERDUE',
  'DEPOSIT_OUTSTANDING', 'SNAG_OVERDUE', 'INTERIOR_HANDOVER_DUE', 'DRAW_FUNDING_OVERDUE',
  'FREE_RENT_ENDING_30',
];

/**
 * Strip the age counter out of a legacy title so the same condition groups together.
 *
 *   "Rent overdue (29d): Mathnasium"  -> "Rent overdue (Nd): Mathnasium"
 *   "Free rent ends in 12d: Acme"     -> "Free rent ends in Nd: Acme"
 *   "Lease Expiring in 29 Days"       -> "Lease Expiring in N Days"
 */
const NORMALISED_TITLE = `
  regexp_replace(
    regexp_replace(
      regexp_replace(title, '\\(\\d+d\\)', '(Nd)', 'g'),
      'in \\d+d', 'in Nd', 'g'),
    'in \\d+ Days', 'in N Days', 'gi')`;

const IDENTITY = `COALESCE("dedupeKey", ${NORMALISED_TITLE})`;

async function main() {
  const apply = process.argv.includes('--apply');
  const list = RECURRING.map((t) => `'${t}'`).join(',');

  const before = await prisma.notification.count();

  const stale: { id: string }[] = await prisma.$queryRawUnsafe(`
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (
               PARTITION BY "userId", type, ${IDENTITY}
               ORDER BY "createdAt" DESC, id DESC
             ) AS rn
      FROM notifications
      WHERE type::text IN (${list})
    ) ranked
    WHERE rn > 1`);

  console.log(`notification rows           : ${before}`);
  console.log(`stale duplicate restatements: ${stale.length}`);

  if (stale.length > 0) {
    const summary: { type: string; n: number }[] = await prisma.$queryRawUnsafe(
      `SELECT type::text AS type, COUNT(*)::int AS n FROM notifications
       WHERE id = ANY($1::text[]) GROUP BY 1 ORDER BY n DESC`,
      stale.map((s) => s.id),
    );
    console.log('\nby type:');
    summary.forEach((s) => console.log(`  ${s.type.padEnd(24)} ${s.n}`));
  }

  if (stale.length === 0) {
    console.log('\nNothing to prune.');
    return;
  }
  if (!apply) {
    console.log(`\nDry run. Re-run with --apply to delete ${stale.length} rows (${before - stale.length} would remain).`);
    return;
  }

  // Chunked: a single IN () with tens of thousands of ids exceeds the parameter limit.
  let deleted = 0;
  for (let i = 0; i < stale.length; i += 1000) {
    const chunk = stale.slice(i, i + 1000).map((s) => s.id);
    const r = await prisma.notification.deleteMany({ where: { id: { in: chunk } } });
    deleted += r.count;
  }
  console.log(`\nDeleted ${deleted}. Remaining: ${await prisma.notification.count()}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
