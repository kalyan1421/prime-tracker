-- Global Update Board: org-wide chat/announcement feed, not project-scoped.
-- See docs/client-discovery/UPDATE_BOARD_DESIGN.md.

-- CreateTable
CREATE TABLE "update_board_posts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "dueDate" TIMESTAMP(3),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "projectId" TEXT,
    "buildingId" TEXT,
    "unitId" TEXT,
    "links" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "update_board_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "update_board_assignments" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "update_board_assignments_pkey" PRIMARY KEY ("postId","userId")
);

-- CreateTable
CREATE TABLE "update_board_attachments" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "update_board_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "update_board_comments" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "update_board_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "update_board_posts_projectId_idx" ON "update_board_posts"("projectId");

-- CreateIndex
CREATE INDEX "update_board_posts_buildingId_idx" ON "update_board_posts"("buildingId");

-- CreateIndex
CREATE INDEX "update_board_posts_unitId_idx" ON "update_board_posts"("unitId");

-- CreateIndex
CREATE INDEX "update_board_posts_status_idx" ON "update_board_posts"("status");

-- CreateIndex
CREATE INDEX "update_board_posts_pinned_createdAt_idx" ON "update_board_posts"("pinned", "createdAt");

-- CreateIndex
CREATE INDEX "update_board_posts_deletedAt_idx" ON "update_board_posts"("deletedAt");

-- CreateIndex
CREATE INDEX "update_board_assignments_userId_idx" ON "update_board_assignments"("userId");

-- CreateIndex
CREATE INDEX "update_board_attachments_postId_idx" ON "update_board_attachments"("postId");

-- CreateIndex
CREATE INDEX "update_board_comments_postId_createdAt_idx" ON "update_board_comments"("postId", "createdAt");

-- AddForeignKey
ALTER TABLE "update_board_posts" ADD CONSTRAINT "update_board_posts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "update_board_posts" ADD CONSTRAINT "update_board_posts_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "update_board_posts" ADD CONSTRAINT "update_board_posts_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "update_board_posts" ADD CONSTRAINT "update_board_posts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "update_board_assignments" ADD CONSTRAINT "update_board_assignments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "update_board_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "update_board_assignments" ADD CONSTRAINT "update_board_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "update_board_attachments" ADD CONSTRAINT "update_board_attachments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "update_board_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "update_board_attachments" ADD CONSTRAINT "update_board_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "update_board_comments" ADD CONSTRAINT "update_board_comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "update_board_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "update_board_comments" ADD CONSTRAINT "update_board_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
