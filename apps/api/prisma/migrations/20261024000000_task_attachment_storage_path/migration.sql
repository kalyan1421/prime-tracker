-- Task attachments move onto the storage driver (S3), like every other upload.
--
-- They were written to the API host's local disk by multer diskStorage: no upload
-- allowlist, no copy anywhere but that one box, and invisible to a second instance.
-- New attachments record their bucket key here. Existing rows keep NULL and are still
-- served from uploads/tasks/ by TasksController.downloadAttachment, so nothing that is
-- downloadable today stops being downloadable.
ALTER TABLE "task_attachments" ADD COLUMN "storagePath" TEXT;
