-- The approved total budget for a fit-out, entered when the work is started. Nullable: every
-- existing fit-out starts without one and the app prompts for it (banner) until it is set.
ALTER TABLE "interior_projects" ADD COLUMN "totalBudget" DECIMAL(14,2);
ALTER TABLE "interior_projects" ADD COLUMN "totalBudgetSetAt" TIMESTAMP(3);
