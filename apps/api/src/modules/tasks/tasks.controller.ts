import {
    Controller, Get, Post, Put, Delete, Body, Param, Query,
    UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';

const UPLOADS_DIR = join(process.cwd(), 'uploads', 'tasks');

function ensureUploadDir() {
    if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Reads require the baseline project:view (every role has it); writes require task:edit,
// which read-only roles (VIEWER, LEGAL) lack — previously this controller had NO
// PermissionsGuard, so any authenticated user could CRUD tasks on any project.
@Controller('tasks')
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
export class TasksController {
    constructor(private readonly tasksService: TasksService) { }

    @Get()
    @RequirePermissions('project:view')
    findAll(
        @Query('projectId') projectId?: string,
        @Query('buildingId') buildingId?: string,
        @Query('unitId') unitId?: string,
        @Query('assignedTo') assignedTo?: string,
        @Query('status') status?: string,
        @Query('priority') priority?: string,
        @Query('search') search?: string,
    ) {
        return this.tasksService.findAll({
            projectId,
            buildingId,
            unitId,
            assignedTo,
            status: status as any,
            priority: priority as any,
            search,
        });
    }

    @Get(':id')
    @RequirePermissions('project:view')
    findOne(@Param('id') id: string) {
        return this.tasksService.findById(id);
    }

    @Post()
    @RequirePermissions('task:edit')
    create(@Body() body: any, @CurrentUser('sub') userId: string) {
        return this.tasksService.create(body, userId);
    }

    @Put(':id')
    @RequirePermissions('task:edit')
    update(
        @Param('id') id: string,
        @Body() body: any,
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

    @Get(':id/comments')
    @RequirePermissions('project:view')
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

    @Post(':id/attachments')
    @RequirePermissions('task:edit')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: diskStorage({
                destination: (_req, _file, cb) => {
                    ensureUploadDir();
                    cb(null, UPLOADS_DIR);
                },
                filename: (_req, file, cb) => {
                    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
                    cb(null, `${unique}${extname(file.originalname)}`);
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
