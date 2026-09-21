-- Site-visit scheduling notification triggers.
-- See docs/client-discovery/LEADS_BOARD_AND_SITE_VISIT_SPEC.md §9.
--
-- Kept in its own migration, separate from the tables that use them: ALTER TYPE ... ADD
-- VALUE and the DDL that would reference the new values do not belong in one transaction.
--
-- Every value added here MUST also exist in the Prisma enum AND in NOTIFICATION_TIERS.
-- A value that lives in the DB but not the enum is invisible to Object.values(
-- NotificationType), so it never reaches getPreferences() and users can never mute it.
-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SITE_VISIT_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'SITE_VISIT_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE 'SITE_VISIT_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'SITE_VISIT_RESCHEDULED';
ALTER TYPE "NotificationType" ADD VALUE 'SITE_VISIT_TOMORROW';
ALTER TYPE "NotificationType" ADD VALUE 'SITE_VISIT_MISSED';
