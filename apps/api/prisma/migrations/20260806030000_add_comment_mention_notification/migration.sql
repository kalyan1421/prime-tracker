-- @mention notifications on comments.
-- Postgres cannot add an enum value inside a transaction that then USES it, but adding
-- alone is fine; Prisma runs each migration in its own transaction.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COMMENT_MENTION';
