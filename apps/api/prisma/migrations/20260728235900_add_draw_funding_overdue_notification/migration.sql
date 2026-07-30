-- Draw-funding-overdue alerts were previously filed under BUDGET_VARIANCE (see the
-- admission in draw-event-handlers.service.ts), which meant a user who muted budget
-- alerts also silently muted funding alerts. Give them their own type.
--
-- Kept in its own migration: ALTER TYPE ... ADD VALUE must not share a transaction
-- with statements that use the new value.
ALTER TYPE "NotificationType" ADD VALUE 'DRAW_FUNDING_OVERDUE';
