-- New notification fired when a draw is submitted for internal approval, so
-- approvers (Super Admin/Founder/Executive/Finance) are alerted immediately
-- instead of only finding out after the fact via DRAW_REQUEST_APPROVED/_FUNDED.
ALTER TYPE "NotificationType" ADD VALUE 'DRAW_REQUEST_SUBMITTED';
