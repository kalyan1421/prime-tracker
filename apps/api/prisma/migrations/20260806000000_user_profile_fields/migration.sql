-- Directory fields for the profile section. Purely descriptive: unlike role/roles/
-- isActive these carry no authorization meaning, which is why self-service is allowed
-- to write them.
ALTER TABLE "users" ADD COLUMN "phone" TEXT;
ALTER TABLE "users" ADD COLUMN "jobTitle" TEXT;
