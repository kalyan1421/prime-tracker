-- Update Board Phase 5 — "Leadership Only" restriction. See UPDATE_BOARD_DESIGN.md §8.
-- AlterTable
ALTER TABLE "update_board_posts" ADD COLUMN     "restricted" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "update_board_posts_restricted_idx" ON "update_board_posts"("restricted");
