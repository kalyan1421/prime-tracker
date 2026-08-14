-- R27 notifications: the request has to reach a Founder, and the decision has to reach
-- the person who asked. A gate nobody is told about is a gate nobody passes through.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'HISTORY_DELETION_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'HISTORY_DELETION_DECIDED';

-- CANCELLED joins the status vocabulary: the requester can withdraw their own request.
-- The decision CHECK only constrains non-PENDING rows to carry a decider, and a
-- cancellation is decided by the requester, so it satisfies the constraint unchanged.
