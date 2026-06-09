-- Add the top-down "Approved Budget" control total to projects.
-- Detailed budget lines are tracked bottom-up against this value.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "approvedBudget" DECIMAL(14,2);
