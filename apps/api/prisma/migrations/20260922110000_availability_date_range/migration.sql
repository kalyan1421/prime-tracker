-- Date-RANGE availability rules: one row covering an inclusive run of days.
--
-- Set alongside `date` (the range start). Blocking a week previously meant creating seven
-- one-off rows and remembering to remove all seven; a holiday shutdown is one decision and
-- should be one row.
--
-- NULL endDate keeps the existing meaning: `date` alone is a single day.
ALTER TABLE "visit_availability" ADD COLUMN     "endDate" DATE;
