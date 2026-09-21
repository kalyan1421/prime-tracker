-- @mentions in a lead discussion thread.
--
-- Its own type, not a reuse of COMMENT_MENTION: that one covers Task/Unit/Project comments
-- and UPDATE_BOARD_COMMENT_MENTION covers the board. Muting one surface's mentions must
-- not mute the others. All three resolve names with the SAME resolveMentions() parser.
--
-- Separate migration from the table below: ALTER TYPE ... ADD VALUE and DDL that could
-- reference the new value do not belong in one transaction.
-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LEAD_COMMENT_MENTION';
