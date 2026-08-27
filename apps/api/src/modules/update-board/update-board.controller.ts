import {
    Controller, Get, Post, Put, Delete, Body, Param, Query,
    UseGuards, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { UpdateBoardService } from './update-board.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { ApiOperation } from '@nestjs/swagger';

// Deliberately NOT project-scoped: no ProjectAccessGuard here. The board is org-wide by
// design — every internal role sees every post regardless of project membership or
// staffing. `updateBoard:view` is the read gate; `updateBoard:create` (every role but
// CLIENT/VIEWER) gates the routes that CREATE something new (a post, a comment, an
// attachment). PUT/DELETE on existing content gate on the broader `updateBoard:view`
// instead — because the REAL authorization there (creator, or SUPER_ADMIN/FOUNDER) lives
// in the service's assertCanManage, and gating on `updateBoard:create` would 403 a post's
// creator who later moved to a role without that permission (e.g. demoted) before the
// service's ownership check ever ran. That reasoning only holds for content someone
// already owns, though — it doesn't extend to POSTing a brand-new comment/attachment,
// which is why those two routes require `updateBoard:create` like the top-level post does.
// See docs/client-discovery/UPDATE_BOARD_DESIGN.md §8.
@Controller('update-board')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class UpdateBoardController {
    constructor(private readonly updateBoardService: UpdateBoardService) { }

    @Get()
    @RequirePermissions('updateBoard:view')
    findAll(
        @Query('projectId') projectId?: string,
        @Query('buildingId') buildingId?: string,
        @Query('unitId') unitId?: string,
        @Query('assignedTo') assignedTo?: string,
        @Query('status') status?: string,
        @Query('priority') priority?: string,
        @Query('search') search?: string,
        @Query('pinned') pinned?: string,
        @CurrentUser('sub') userId?: string,
        @CurrentUser('role') role?: string,
    ) {
        return this.updateBoardService.findAll({
            projectId,
            buildingId,
            unitId,
            assignedTo,
            status,
            priority,
            search,
            pinned: pinned === undefined ? undefined : pinned === 'true',
        }, { userId: userId!, role: role! });
    }

    @Get(':id')
    @RequirePermissions('updateBoard:view')
    findOne(
        @Param('id') id: string,
        @CurrentUser('sub') userId: string,
        @CurrentUser('role') role: string,
    ) {
        return this.updateBoardService.findById(id, { userId, role });
    }

    @Post()
    @RequirePermissions('updateBoard:create')
    create(
        @Body() body: any,
        @CurrentUser('sub') userId: string,
        @CurrentUser('role') role: string,
    ) {
        return this.updateBoardService.create(body, userId, role);
    }

    @Put(':id')
    @RequirePermissions('updateBoard:view')
    update(
        @Param('id') id: string,
        @Body() body: any,
        @CurrentUser('sub') userId: string,
        @CurrentUser('role') role: string,
    ) {
        return this.updateBoardService.update(id, body, userId, role);
    }

    @Delete(':id')
    @RequirePermissions('updateBoard:view')
    remove(
        @Param('id') id: string,
        @CurrentUser('sub') userId: string,
        @CurrentUser('role') role: string,
    ) {
        return this.updateBoardService.delete(id, userId, role);
    }

    // ---- Comments (the "chat") ----

    @Get(':id/comments')
    @RequirePermissions('updateBoard:view')
    getComments(
        @Param('id') id: string,
        @CurrentUser('sub') userId: string,
        @CurrentUser('role') role: string,
    ) {
        return this.updateBoardService.getComments(id, { userId, role });
    }

    @Post(':id/comments')
    @RequirePermissions('updateBoard:create')
    addComment(
        @Param('id') id: string,
        @Body('content') content: string,
        @CurrentUser('sub') userId: string,
        @CurrentUser('role') role: string,
    ) {
        if (!content?.trim()) throw new BadRequestException('Comment content is required');
        return this.updateBoardService.addComment(id, userId, role, content.trim());
    }

    @Delete(':id/comments/:commentId')
    @RequirePermissions('updateBoard:view')
    deleteComment(
        @Param('commentId') commentId: string,
        @CurrentUser('sub') userId: string,
        @CurrentUser('role') role: string,
    ) {
        return this.updateBoardService.deleteComment(commentId, userId, role);
    }

    // ---- Attachments ----
    // Upload goes via the shared /documents/upload-file endpoint (usePresignedUpload on the
    // frontend); this just records the resulting storagePath against the post.

    @Post(':id/attachments')
    @RequirePermissions('updateBoard:create')
    @ApiOperation({ summary: 'Attach a document/image (upload via /documents/upload-file first)' })
    addAttachment(
        @Param('id') postId: string,
        @Body() body: { storagePath: string; fileName: string; mimeType?: string },
        @CurrentUser('sub') userId: string,
        @CurrentUser('role') role: string,
    ) {
        return this.updateBoardService.addAttachment(postId, userId, role, body);
    }

    @Delete(':id/attachments/:attachmentId')
    @RequirePermissions('updateBoard:view')
    deleteAttachment(
        @Param('attachmentId') attachmentId: string,
        @CurrentUser('sub') userId: string,
        @CurrentUser('role') role: string,
    ) {
        return this.updateBoardService.deleteAttachment(attachmentId, userId, role);
    }
}
