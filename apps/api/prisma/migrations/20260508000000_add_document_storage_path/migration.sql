-- Add storagePath column to documents table (Supabase Storage key)
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "storagePath" TEXT;
