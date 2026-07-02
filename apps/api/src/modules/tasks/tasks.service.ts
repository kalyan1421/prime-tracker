import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, UserRole } from '@prisma/client';

@Injectable()
export class TasksService {
    constructor(private prisma: PrismaService) { }

    // ---- Task CRUD ----

    async findAll(params: {
        projectId?: string;
        buildingId?: string;
        unitId?: string;
        assignedTo?: string;
        status?: string;
        priority?: string;
        search?: string;
    } = {}) {
        const { projectId, buildingId, unitId, assignedTo, status, priority, search } = params;
        const where: Prisma.TaskWhereInput = {};

        if (projectId) where.projectId = projectId;
        if (buildingId) where.buildingId = buildingId;
        if (unitId) where.unitId = unitId;
        if (assignedTo) where.assignedTo = assignedTo;
        if (status) where.status = status;
        if (priority) where.priority = priority;
        if (search) {
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
            ];
        }

        return this.prisma.task.findMany({
            where,
            include: {
                project: { select: { id: true, name: true } },
                building: { select: { id: true, name: true } },
                unit: { select: { id: true, unitNumber: true } },
                assignedUser: { select: { id: true, name: true, avatarUrl: true } },
                createdByUser: { select: { id: true, name: true } },
                _count: { select: { comments: true, attachments: true } },
            },
            orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        });
    }

    async findById(id: string) {
        const task = await this.prisma.task.findUnique({
            where: { id },
            include: {
                project: { select: { id: true, name: true } },
                building: { select: { id: true, name: true } },
                unit: { select: { id: true, unitNumber: true } },
                assignedUser: { select: { id: true, name: true, avatarUrl: true } },
                createdByUser: { select: { id: true, name: true } },
                comments: {
                    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
                    orderBy: { createdAt: 'asc' },
                },
                attachments: {
                    include: { uploadedBy: { select: { id: true, name: true } } },
                    orderBy: { createdAt: 'asc' },
                },
            },
        });
        if (!task) throw new NotFoundException('Task not found');
        return task;
    }

    async create(data: {
        projectId: string;
        buildingId?: string;
        unitId?: string;
        title: string;
        description?: string;
        status?: string;
        priority?: string;
        dueDate?: string;
        assignedTo?: string;
    }, createdBy: string) {
        return this.prisma.task.create({
            data: {
                projectId: data.projectId,
                buildingId: data.buildingId || null,
                unitId: data.unitId || null,
                title: data.title,
                description: data.description,
                status: data.status ?? 'TODO',
                priority: data.priority ?? 'MEDIUM',
                dueDate: data.dueDate ? new Date(data.dueDate) : null,
                assignedTo: data.assignedTo || null,
                createdBy,
            },
            include: {
                project: { select: { id: true, name: true } },
                building: { select: { id: true, name: true } },
                unit: { select: { id: true, unitNumber: true } },
                assignedUser: { select: { id: true, name: true, avatarUrl: true } },
                createdByUser: { select: { id: true, name: true } },
                _count: { select: { comments: true, attachments: true } },
            },
        });
    }

    async update(id: string, data: {
        title?: string;
        description?: string;
        status?: string;
        priority?: string;
        dueDate?: string | null;
        assignedTo?: string | null;
        buildingId?: string | null;
        unitId?: string | null;
    }, userId: string, userRole: string) {
        const task = await this.findById(id);
        if (task.createdBy !== userId && !['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'PROJECT_MANAGER'].includes(userRole)) {
            throw new ForbiddenException('Only the task creator or a Project Manager can edit this task');
        }
        return this.prisma.task.update({
            where: { id },
            data: {
                ...data,
                dueDate: data.dueDate === null ? null : data.dueDate ? new Date(data.dueDate) : undefined,
            },
            include: {
                project: { select: { id: true, name: true } },
                building: { select: { id: true, name: true } },
                unit: { select: { id: true, unitNumber: true } },
                assignedUser: { select: { id: true, name: true, avatarUrl: true } },
                createdByUser: { select: { id: true, name: true } },
                _count: { select: { comments: true, attachments: true } },
            },
        });
    }

    async delete(id: string, userId: string, userRole: string) {
        const task = await this.findById(id);
        if (task.createdBy !== userId && !['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'PROJECT_MANAGER'].includes(userRole)) {
            throw new ForbiddenException('Only the task creator or a Project Manager can delete this task');
        }
        return this.prisma.task.delete({ where: { id } });
    }

    // ---- Comments ----

    async getComments(taskId: string) {
        await this.findById(taskId);
        return this.prisma.taskComment.findMany({
            where: { taskId },
            include: { user: { select: { id: true, name: true, avatarUrl: true } } },
            orderBy: { createdAt: 'asc' },
        });
    }

    async addComment(taskId: string, userId: string, content: string) {
        await this.findById(taskId);
        return this.prisma.taskComment.create({
            data: { taskId, userId, content },
            include: { user: { select: { id: true, name: true, avatarUrl: true } } },
        });
    }

    async deleteComment(commentId: string, userId: string, userRole: string) {
        const comment = await this.prisma.taskComment.findUnique({ where: { id: commentId } });
        if (!comment) throw new NotFoundException('Comment not found');
        if (comment.userId !== userId && !['SUPER_ADMIN', 'FOUNDER'].includes(userRole)) {
            throw new ForbiddenException('Only the comment author or a Founder can delete this comment');
        }
        return this.prisma.taskComment.delete({ where: { id: commentId } });
    }

    // ---- Attachments ----

    async addAttachment(taskId: string, userId: string, fileData: {
        fileName: string;
        fileUrl: string;
        fileSize?: number;
        mimeType?: string;
    }) {
        await this.findById(taskId);
        return this.prisma.taskAttachment.create({
            data: {
                taskId,
                uploadedById: userId,
                fileName: fileData.fileName,
                fileUrl: fileData.fileUrl,
                fileSize: fileData.fileSize,
                mimeType: fileData.mimeType,
            },
            include: { uploadedBy: { select: { id: true, name: true } } },
        });
    }

    async deleteAttachment(attachmentId: string, userId: string, userRole: string) {
        const attachment = await this.prisma.taskAttachment.findUnique({ where: { id: attachmentId } });
        if (!attachment) throw new NotFoundException('Attachment not found');
        if (attachment.uploadedById !== userId && !['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'PROJECT_MANAGER'].includes(userRole)) {
            throw new ForbiddenException('Only the uploader or a Project Manager can delete attachments');
        }
        return this.prisma.taskAttachment.delete({ where: { id: attachmentId } });
    }
}
