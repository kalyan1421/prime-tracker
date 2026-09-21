-- Discussion ABOUT a lead, separate from lead_activities which records what was DONE to it.
--
-- A separate table rather than another LeadActivity type on purpose: merging conversation
-- into the structured activity timeline was tried on this project and reversed. The
-- activity log is evidence (a call happened, a status changed); this is discussion.
-- CreateTable
CREATE TABLE "lead_comments" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    -- Set on edit so the UI can mark a changed message rather than silently presenting it
    -- as the original.
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_comments_pkey" PRIMARY KEY ("id")
);

-- The thread is always read newest-or-oldest-first for one lead.
CREATE INDEX "lead_comments_leadId_createdAt_idx" ON "lead_comments"("leadId", "createdAt");

-- Deleting a lead takes its discussion with it; an author is never deleted out from under
-- their own messages (users are deactivated, not removed).
ALTER TABLE "lead_comments" ADD CONSTRAINT "lead_comments_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_comments" ADD CONSTRAINT "lead_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
