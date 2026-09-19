import {
    Controller, Get, Post, Put, Delete, Body, Param, Query, Res,
    UseGuards, UseInterceptors, UploadedFile, BadRequestException, NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { basename, extname, join, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { ApiOperation } from '@nestjs/swagger';
import { AddTaskUpdatePhotoDto, CreateTaskUpdateDto } from './dto/task-update.dto';
import { CreateTaskDto, UpdateTaskDto } from './dto/create-task.dto';

const UPLOADS_DIR = join(process.cwd(), 'uploads', 'tasks');

function ensureUploadDir() {
    if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Reads require task:view, writes task:edit.
//
// Reads used to require the baseline project:view, on the reasoning that every role holds
// it. But task:view exists, is granted to ten roles, and is deliberately WITHHELD from
// VIEWER and LEGAL — and audit.service.ts gates the Activity Log's "Tasks & Updates" area
// on it, so those two roles were correctly filtered out of task events on the activity
// feed and could still read every task, update, comment and attachment in the portfolio
// through these routes. The permission was decorative on the module it names. Enforcing it
// here is what makes the per-role grant mean what it says; App.tsx and the sidebar gate the
// Tasks page on the same permission so neither role is left staring at a 403.
@Controller('tasks')
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
export class TasksController {
    constructor(private readonly tasksService: TasksService) { }

    @Get()
    @RequirePermissions('task:view')
    findAll(
        @Query('projectId') projectId?: string,
        @Query('buildingId') buildingId?: string,
        @Query('unitId') unitId?: string,
        @Query('assignedTo') assignedTo?: string,
        @Query('status') status?: string,
        @Query('priority') priority?: string,
        @Query('search') search?: string,
        @Query('kind') kind?: string,
        @CurrentUser('sub') userId?: string,
        @CurrentUser('role') role?: string,
        @CurrentUser('roles') roles?: string[],
    ) {
        return this.tasksService.findAll({
            projectId,
            buildingId,
            unitId,
            assignedTo,
            status: status as any,
            priority: priority as any,
            search,
            kind,
            viewer: userId && role ? { userId, role, roles } : undefined,
        });
    }

    @Get(':id')
    @RequirePermissions('task:view')
    findOne(@Param('id') id: string) {
        return this.tasksService.findById(id);
    }

    @Post()
    @RequirePermissions('task:edit')
    create(@Body() body: CreateTaskDto, @CurrentUser('sub') userId: string) {
        return this.tasksService.create(body, userId);
    }

    @Put(':id')
    @RequirePermissions('task:edit')
    update(
        @Param('id') id: string,
        @Body() body: UpdateTaskDto,
        @CurrentUser('sub') userId: string,
        @CurrentUser('role') role: string,
    ) {
        return this.tasksService.update(id, body, userId, role);
    }

    @Delete(':id')
    @RequirePermissions('task:edit')
    remove(
        @Param('id') id: string,
        @CurrentUser('sub') userId: string,
        @CurrentUser('role') role: string,
    ) {
        return this.tasksService.delete(id, userId, role);
    }

    // ---- Comments ----

    @Get(':id/updates')
    @RequirePermissions('task:view')
    @ApiOperation({ summary: 'Day-wise progress updates on an item, newest day first' })
    getUpdates(@Param('id') id: string) {
        return this.tasksService.getUpdates(id);
    }

    @Post(':id/updates')
    @RequirePermissions('task:edit')
    @ApiOperation({ summary: 'Post a dated progress update; @mentions notify those named' })
    addUpdate(
        @Param('id') id: string,
        @CurrentUser('sub') userId: string,
        @Body() body: CreateTaskUpdateDto,
    ) {
        return this.tasksService.addUpdate(id, userId, body);
    }

    @Post('updates/:updateId/photos')
    @RequirePermissions('task:edit')
    @ApiOperation({ summary: 'Attach a photo to an update (upload via the presigned URL first)' })
    addUpdatePhoto(@Param('updateId') updateId: string, @Body() body: AddTaskUpdatePhotoDto) {
        return this.tasksService.addUpdatePhoto(updateId, body);
    }

    @Delete('updates/:updateId')
    @RequirePermissions('task:edit')
    @ApiOperation({ summary: 'Delete an update (author or Project Manager)' })
    deleteUpdate(
        @Param('updateId') updateId: string,
        @CurrentUser('sub') userId: string,
        @CurrentUser('role') userRole: string,
    ) {
        return this.tasksService.deleteUpdate(updateId, userId, userRole);
    }

    @Get(':id/comments')
    @RequirePermissions('task:view')
    getComments(@Param('id') id: string) {
        return this.tasksService.getComments(id);
    }

    @Post(':id/comments')
    @RequirePermissions('task:edit')
    addComment(
        @Param('id') id: string,
        @Body('content') content: string,
        @CurrentUser('sub') userId: string,
    ) {
        if (!content?.trim()) throw new BadRequestException('Comment content is required');
        return this.tasksService.addComment(id, userId, content.trim());
    }

    @Delete(':id/comments/:commentId')
    @RequirePermissions('task:edit')
    deleteComment(
        @Param('commentId') commentId: string,
        @CurrentUser('sub') userId: string,
        @CurrentUser('role') role: string,
    ) {
        return this.tasksService.deleteComment(commentId, userId, role);
    }

    // ---- Attachments ----

    /**
     * Stream an attachment back to an authenticated, project-scoped caller.
     *
     * These files used to be reachable at `/uploads/tasks/<name>` via
     * `app.useStaticAssets()` in main.ts, which sits OUTSIDE the `api` global prefix and
     * outside every guard (the only global guard is ThrottlerGuard). Anyone holding a URL
     * — a logged-out attacker, a former employee, anything that leaked a Referer — could
     * fetch a task's contract or lien waiver with no token at all.
     *
     * That mount was also never routed in front of the app: nginx proxies only `/api/` and
     * `/socket.io/`, and Vite's dev proxy only `/api`, so `/uploads/...` fell through to
     * the SPA's `try_files ... /index.html` and the Download button saved the app's own
     * HTML page under the attachment's filename. Serving the bytes from here fixes both at
     * once, because `/api/` is the one path both environments already forward.
     *
     * Declared above `@Delete(':id/attachments/:attachmentId')` for the usual Nest
     * declaration-order reason, and `attachmentId` is resolved to its project by
     * ProjectAccessGuard (see the `taskAttachment` entry in project-access.service.ts).
     */
    @Get('attachments/:attachmentId/download')
    @RequirePermissions('task:view')
    @ApiOperation({ summary: 'Download a task attachment' })
    async downloadAttachment(
        @Param('attachmentId') attachmentId: string,
        @Res() res: Response,
    ) {
        const attachment = await this.tasksService.findAttachment(attachmentId);

        // The stored fileUrl is ours, not user input — but take only its basename and
        // re-check that the result is still inside UPLOADS_DIR, so a legacy or
        // hand-edited row can never address a file elsewhere on the box.
        const filePath = resolve(UPLOADS_DIR, basename(attachment.fileUrl));
        if (!filePath.startsWith(resolve(UPLOADS_DIR) + '/') || !existsSync(filePath)) {
            throw new NotFoundException('Attachment file is no longer available');
        }

        // Always an attachment, never inline: uploads keep the caller's extension with no
        // allowlist, so an `.html` or `.svg` rendered inline would execute on the API's own
        // origin. `download` sets Content-Disposition for us.
        res.download(filePath, attachment.fileName);
    }

    @Post(':id/attachments')
    @RequirePermissions('task:edit')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: diskStorage({
                destination: (_req, _file, cb) => {
                    ensureUploadDir();
                    cb(null, UPLOADS_DIR);
                },
                // randomUUID, not Date.now()+Math.random(): Math.random() is not a CSPRNG
                // and the timestamp narrows the search space, which mattered while these
                // files were served unauthenticated. They are behind a guard now, so the
                // name is no longer load-bearing — but a guessable one should not be what
                // is protecting them either way.
                filename: (_req, file, cb) => {
                    cb(null, `${randomUUID()}${extname(file.originalname)}`);
                },
            }),
            limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
        }),
    )
    async uploadAttachment(
        @Param('id') taskId: string,
        @UploadedFile() file: Express.Multer.File,
        @CurrentUser('sub') userId: string,
    ) {
        if (!file) throw new BadRequestException('File is required');
        const fileUrl = `/uploads/tasks/${file.filename}`;
        return this.tasksService.addAttachment(taskId, userId, {
            fileName: file.originalname,
            fileUrl,
            fileSize: file.size,
            mimeType: file.mimetype,
        });
    }

    @Delete(':id/attachments/:attachmentId')
    @RequirePermissions('task:edit')
    deleteAttachment(
        @Param('attachmentId') attachmentId: string,
        @CurrentUser('sub') userId: string,
        @CurrentUser('role') role: string,
    ) {
        return this.tasksService.deleteAttachment(attachmentId, userId, role);
    }
}
