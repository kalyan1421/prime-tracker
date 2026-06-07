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
import { CurrentUser } from '../../common/decorators/index';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';

const UPLOADS_DIR = join(process.cwd(), 'uploads', 'tasks');

function ensureUploadDir() {
    if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
}

@Controller('tasks')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
export class TasksController {
    constructor(private readonly tasksService: TasksService) { }

    @Get()
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
    findOne(@Param('id') id: string) {
        return this.tasksService.findById(id);
    }

    @Post()
    create(@Body() body: any, @CurrentUser('sub') userId: string) {
        return this.tasksService.create(body, userId);
    }

    @Put(':id')
    update(
        @Param('id') id: string,
        @Body() body: any,
        @CurrentUser('sub') userId: string,
        @CurrentUser('role') role: string,
    ) {
        return this.tasksService.update(id, body, userId, role);
    }

    @Delete(':id')
    remove(
        @Param('id') id: string,
        @CurrentUser('sub') userId: string,
        @CurrentUser('role') role: string,
    ) {
        return this.tasksService.delete(id, userId, role);
    }

    // ---- Comments ----

    @Get(':id/comments')
    getComments(@Param('id') id: string) {
        return this.tasksService.getComments(id);
    }

    @Post(':id/comments')
    addComment(
        @Param('id') id: string,
        @Body('content') content: string,
        @CurrentUser('sub') userId: string,
    ) {
        if (!content?.trim()) throw new BadRequestException('Comment content is required');
        return this.tasksService.addComment(id, userId, content.trim());
    }

    @Delete(':id/comments/:commentId')
    deleteComment(
        @Param('commentId') commentId: string,
        @CurrentUser('sub') userId: string,
        @CurrentUser('role') role: string,
    ) {
        return this.tasksService.deleteComment(commentId, userId, role);
    }

    // ---- Attachments ----

    @Post(':id/attachments')
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
    deleteAttachment(
        @Param('attachmentId') attachmentId: string,
        @CurrentUser('sub') userId: string,
        @CurrentUser('role') role: string,
    ) {
        return this.tasksService.deleteAttachment(attachmentId, userId, role);
    }
}
