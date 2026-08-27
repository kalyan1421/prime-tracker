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
import { ApiOperation } from '@nestjs/swagger';
import { AddTaskUpdatePhotoDto, CreateTaskUpdateDto } from './dto/task-update.dto';
import { CreateTaskDto, UpdateTaskDto } from './dto/create-task.dto';

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
    @RequirePermissions('project:view')
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
    @RequirePermissions('project:view')
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
