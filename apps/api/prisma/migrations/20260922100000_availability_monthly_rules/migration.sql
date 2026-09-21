-- Monthly availability rules, alongside the existing weekly and one-off kinds.
--
-- A month with no such day (the 31st of February) simply produces no slots. Sliding it to
-- the nearest real date would put the host somewhere they never agreed to be, so the rule
-- just does not apply that month.
--
-- Exactly one of (dayOfWeek, dayOfMonth, date) is set. Enforced in the service rather than
-- a DB CHECK: three nullable columns make for an awkward constraint to evolve, and there
-- is a single write path.
ALTER TABLE "visit_availability" ADD COLUMN     "dayOfMonth" INTEGER;

CREATE INDEX "visit_availability_hostId_dayOfMonth_idx" ON "visit_availability"("hostId", "dayOfMonth");
