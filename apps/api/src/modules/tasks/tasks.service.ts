import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, UserRole } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveMentions } from '../comments/mentions';
import { StorageService } from '../../common/storage/storage.service';
import { ProjectAccessService } from '../../common/access/project-access.service';

/** Work-item kinds. See the note on Task.kind for why they share one table. */
export const TASK_KINDS = ['TASK', 'CONSTRUCTION'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** Who may edit or delete someone else's item. */
const TASK_MANAGER_ROLES = ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'PROJECT_MANAGER'];

/** Everything a board row needs, in one shape so list and detail cannot drift. */
const TASK_INCLUDE = {
    project: { select: { id: true, name: true } },
    building: { select: { id: true, name: true } },
    unit: { select: { id: true, unitNumber: true } },
    units: {
        include: {
            unit: { select: { id: true, unitNumber: true, buildingId: true, status: true } },
        },
    },
    buildings: {
        include: { building: { select: { id: true, name: true } } },
    },
    assignedUser: { select: { id: true, name: true, avatarUrl: true } },
    assignees: {
        include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    },
    createdByUser: { select: { id: true, name: true } },
    _count: { select: { comments: true, attachments: true, updates: true } },
} satisfies Prisma.TaskInclude;

@Injectable()
export class TasksService {
    private readonly logger = new Logger(TasksService.name);

    constructor(
        private prisma: PrismaService,
        private notifications: NotificationsService,
        private storage: StorageService,
        private access: ProjectAccessService,
    ) { }

    /**
     * Swap bucket keys for signed URLs. A storagePath is not displayable on its own, so
     * returning the raw rows would render every photo as a broken image. Mirrors
     * DailyLogsService.enrichPhotos, including the swallow: one unsignable photo must
     * not take the whole update list down with it.
     */
    private async signPhotos<T extends { photos: Array<{ storagePath: string }> }>(update: T) {
        const photos = await Promise.all(
            update.photos.map(async (p) => ({
                ...p,
                url: await this.storage.signedUrl(p.storagePath, 3600).catch(() => ''),
            })),
        );
        return { ...update, photos };
    }

    // ---- Task CRUD ----

    async findAll(params: {
        projectId?: string;
        buildingId?: string;
        unitId?: string;
        assignedTo?: string;
        status?: string;
        priority?: string;
        search?: string;
        kind?: string;
        viewer?: { userId: string; role: string; roles?: string[] };
    } = {}) {
        const { projectId, buildingId, unitId, assignedTo, status, priority, search, kind, viewer } = params;
        const where: Prisma.TaskWhereInput = {};

        if (projectId) where.projectId = projectId;
        else {
            // Scoped field roles (Sales/Marketing/PM/Construction) only see tasks in
            // their member projects — mirrors LeadsService.findAll.
            const scopeIds = await this.access.listProjectScope(viewer, projectId);
            if (scopeIds) where.projectId = { in: scopeIds };
        }
        // All three of these go through their join table, never the legacy scalar. The
        // scalar is null on any item covering more than one — so filtering on it would
        // hide exactly the multi-building, multi-unit and multi-person items that the
        // join tables exist for.
        if (buildingId) where.buildings = { some: { buildingId } };
        if (unitId) where.units = { some: { unitId } };
        // Absent = every kind. The board asks for CONSTRUCTION, the tasks page for TASK;
        // defaulting to one of them here would silently hide the other from any caller
        // that forgot to ask.
        if (kind) where.kind = kind;
        if (assignedTo) where.assignees = { some: { userId: assignedTo } };
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
            include: TASK_INCLUDE,
            orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        });
    }

    async findById(id: string) {
        const task = await this.prisma.task.findUnique({
            where: { id },
            include: {
                ...TASK_INCLUDE,
                comments: {
                    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
                    orderBy: { createdAt: 'asc' },
                },
                attachments: {
                    include: { uploadedBy: { select: { id: true, name: true } } },
                    orderBy: { createdAt: 'asc' },
                },
                updates: {
                    include: {
                        author: { select: { id: true, name: true, avatarUrl: true } },
                        photos: true,
                    },
                    // Newest day first — a board is read to answer "what happened last".
                    orderBy: [{ updateDate: 'desc' }, { createdAt: 'desc' }],
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
        unitIds?: string[];
        kind?: string;
        title: string;
        description?: string;
        status?: string;
        priority?: string;
        dueDate?: string;
        assignedTo?: string;
        buildingIds?: string[];
        assigneeIds?: string[];
    }, createdBy: string) {
        const unitIds = await this.resolveUnitIds(data.unitIds, data.unitId, data.buildingId);
        const buildingIds = await this.resolveBuildingIds(data.buildingIds, data.buildingId, unitIds);
        const assigneeIds = await this.resolveAssigneeIds(data.assigneeIds, data.assignedTo);

        const task = await this.prisma.task.create({
            data: {
                projectId: data.projectId,
                // Same mirror rule as unitId: the scalar holds a value only when there is
                // exactly one, because a silently-chosen "primary" is what makes a mirror
                // start lying.
                buildingId: buildingIds.length === 1 ? buildingIds[0] : null,
                // The scalar stays a MIRROR of the join table, and only when the item
                // covers exactly one unit. A multi-unit item leaves it null rather than
                // picking a winner, because a silently-chosen "primary" unit is what
                // makes a mirror start lying.
                unitId: unitIds.length === 1 ? unitIds[0] : null,
                kind: this.resolveKind(data.kind),
                title: data.title,
                description: data.description,
                status: data.status ?? 'TODO',
                priority: data.priority ?? 'MEDIUM',
                dueDate: data.dueDate ? new Date(data.dueDate) : null,
                assignedTo: assigneeIds.length === 1 ? assigneeIds[0] : null,
                createdBy,
                units: unitIds.length ? { create: unitIds.map((unitId) => ({ unitId })) } : undefined,
                buildings: buildingIds.length
                    ? { create: buildingIds.map((buildingId) => ({ buildingId })) }
                    : undefined,
                assignees: assigneeIds.length
                    ? { create: assigneeIds.map((userId) => ({ userId })) }
                    : undefined,
            },
            include: TASK_INCLUDE,
        });

        await this.notifyAssigned(task.id, assigneeIds, task, createdBy);
        return task;
    }

    /**
     * Normalise the two ways a caller can name units, and refuse the combinations that
     * would produce an item nobody can make sense of.
     *
     * `unitIds` wins over the legacy scalar when both are sent — a caller that knows
     * about the join table is the one to believe.
     */
    /**
     * Validate the discriminator.
     *
     * The controller takes `@Body() body: any`, so the DTO never runs on this field —
     * without this, `kind: "ANYTHING"` persists happily and the row then matches
     * NEITHER `kind=CONSTRUCTION` (the board) nor `kind=TASK` (the tasks page). It is
     * silently lost rather than visibly wrong, which is the worse failure.
     */
    private resolveKind(kind: string | undefined): TaskKind {
        if (kind === undefined || kind === null || kind === '') return 'TASK';
        if (!(TASK_KINDS as readonly string[]).includes(kind)) {
            throw new BadRequestException(
                `Unknown work item kind '${kind}'. Expected one of: ${TASK_KINDS.join(', ')}.`,
            );
        }
        return kind as TaskKind;
    }

    private async resolveUnitIds(
        unitIds: string[] | undefined,
        unitId: string | undefined,
        buildingId: string | undefined,
    ): Promise<string[]> {
        const ids = [...new Set((unitIds?.length ? unitIds : unitId ? [unitId] : []).filter(Boolean))];
        if (ids.length === 0) return [];

        const units = await this.prisma.unit.findMany({
            where: { id: { in: ids }, deletedAt: null },
            select: { id: true, buildingId: true, unitNumber: true },
        });
        if (units.length !== ids.length) {
            throw new BadRequestException('One or more of those units does not exist');
        }

        // The "all units must share one building" rule was removed on 2026-08-14 at the
        // client's request. It had been an assumption, not a requirement — and site work
        // genuinely spans buildings: one contractor doing the same job across B1 and B2
        // is one item, not two. The buildings a unit belongs to are folded into the
        // item's building set by resolveBuildingIds, so the board still groups cleanly.
        return ids;
    }

    /**
     * The buildings an item covers.
     *
     * Union of what the caller named and whatever the chosen units belong to — picking
     * units in B2 while the building list says only B1 is not an error, it is an
     * incompletely-filled form, and silently dropping B2 would make the board hide the
     * item from half the people looking for it.
     */
    private async resolveBuildingIds(
        buildingIds: string[] | undefined,
        buildingId: string | undefined,
        unitIds: string[],
    ): Promise<string[]> {
        const named = [...new Set(
            (buildingIds?.length ? buildingIds : buildingId ? [buildingId] : []).filter(Boolean),
        )];

        if (named.length) {
            const found = await this.prisma.building.findMany({
                where: { id: { in: named }, deletedAt: null },
                select: { id: true },
            });
            if (found.length !== named.length) {
                throw new BadRequestException('One or more of those buildings does not exist');
            }
        }

        if (unitIds.length) {
            const units = await this.prisma.unit.findMany({
                where: { id: { in: unitIds } },
                select: { buildingId: true },
            });
            for (const u of units) if (u.buildingId) named.push(u.buildingId);
        }
        return [...new Set(named)];
    }

    /**
     * The people holding an item.
     *
     * Same union-and-validate shape as the buildings: `assignedTo` is the legacy scalar
     * and loses to the list when both arrive, because a caller that knows about the join
     * table is the one to believe.
     */
    private async resolveAssigneeIds(
        assigneeIds: string[] | undefined,
        assignedTo: string | null | undefined,
    ): Promise<string[]> {
        const ids = [...new Set(
            (assigneeIds?.length ? assigneeIds : assignedTo ? [assignedTo] : []).filter(Boolean),
        )] as string[];
        if (ids.length === 0) return [];

        const users = await this.prisma.user.findMany({
            where: { id: { in: ids }, isActive: true },
            select: { id: true },
        });
        if (users.length !== ids.length) {
            throw new BadRequestException('One or more of those people does not exist, or is inactive');
        }
        return ids;
    }

    /**
     * Tell the people now holding this item.
     *
     * Two rules, both learned the hard way:
     *
     *  - Only people NEWLY added hear about it. `notifiedAt` on the join row is what
     *    makes that true across edits: a form that posts every field on every save would
     *    otherwise re-notify the whole crew every time somebody fixed a typo in the title.
     *  - Tagging yourself is not news, so the actor is skipped.
     *
     * Never fatal: a notification failure must not cost someone the item they just saved.
     * Same rule AuditService follows.
     */
    private async notifyAssigned(
        taskId: string,
        assigneeIds: string[],
        task: { title: string; projectId: string; kind?: string },
        actorId: string,
    ) {
        const recipients = assigneeIds.filter((id) => id !== actorId);
        if (recipients.length === 0) return;
        try {
            // Only rows never notified. This is the query that stops an edit re-alerting
            // everybody already on the item.
            const fresh = await this.prisma.taskAssignment.findMany({
                where: { taskId, userId: { in: recipients }, notifiedAt: null },
                select: { userId: true },
            });
            if (fresh.length === 0) return;

            const actor = await this.prisma.user.findUnique({
                where: { id: actorId },
                select: { name: true },
            });
            await this.notifications.send({
                userIds: fresh.map((f) => f.userId),
                type: 'TASK_ASSIGNED' as any,
                title: `${actor?.name || 'Someone'} tagged you: ${task.title}`,
                body: task.title,
                // 'board' is the slug in ProjectDetailPage's TAB_MAP. Getting this wrong
                // produces a notification whose link lands on a blank tab.
                link: `/projects/${task.projectId}/${task.kind === 'CONSTRUCTION' ? 'board' : 'tasks'}`,
            });
            await this.prisma.taskAssignment.updateMany({
                where: { taskId, userId: { in: fresh.map((f) => f.userId) } },
                data: { notifiedAt: new Date() },
            });
        } catch (err) {
            this.logger.warn(`Task assignment notification failed: ${err}`);
        }
    }

    async update(id: string, data: {
        title?: string;
        description?: string;
        status?: string;
        priority?: string;
        dueDate?: string | null;
        assignedTo?: string | null;
        assigneeIds?: string[];
        buildingId?: string | null;
        buildingIds?: string[];
        unitId?: string | null;
        unitIds?: string[];
        kind?: string;
    }, userId: string, userRole: string) {
        const task = await this.findById(id);
        if (task.createdBy !== userId && !TASK_MANAGER_ROLES.includes(userRole)) {
            throw new ForbiddenException('Only the task creator or a Project Manager can edit this task');
        }

        const { unitIds, buildingIds, assigneeIds, ...rest } = data;
        // Same guard on the edit path: `rest` is spread straight into the update, so an
        // unvalidated kind here would lose an existing item just as surely.
        if (rest.kind !== undefined) rest.kind = this.resolveKind(rest.kind);
        // Only re-link when the caller actually said something about units. An omitted
        // field must leave the existing links alone, or every edit of a title would
        // silently strip a multi-unit item back to nothing.
        const relinking = unitIds !== undefined || rest.unitId !== undefined;
        const nextUnitIds = relinking
            ? await this.resolveUnitIds(
                unitIds,
                rest.unitId ?? undefined,
                (rest.buildingId ?? task.buildingId) || undefined,
            )
            : null;

        // Same "only when the caller said something" rule for buildings and people. An
        // omitted field must leave existing links alone, or editing a title would strip
        // a multi-building item back to nothing.
        const rebuilding = buildingIds !== undefined || rest.buildingId !== undefined;
        const nextBuildingIds = rebuilding
            ? await this.resolveBuildingIds(
                buildingIds,
                rest.buildingId ?? undefined,
                nextUnitIds ?? (task as any).units?.map((tu: any) => tu.unitId) ?? [],
            )
            : null;

        const reassigning = assigneeIds !== undefined || rest.assignedTo !== undefined;
        const nextAssigneeIds = reassigning
            ? await this.resolveAssigneeIds(assigneeIds, rest.assignedTo)
            : null;

        const updated = await this.prisma.$transaction(async (tx) => {
            if (nextUnitIds) {
                // Replace wholesale. deleteMany+createMany rather than a diff: the set is
                // small, and a diff here would be more code for the same result.
                await tx.taskUnit.deleteMany({ where: { taskId: id } });
                if (nextUnitIds.length) {
                    await tx.taskUnit.createMany({
                        data: nextUnitIds.map((unitId) => ({ taskId: id, unitId })),
                    });
                }
            }
            if (nextBuildingIds) {
                await tx.taskBuilding.deleteMany({ where: { taskId: id } });
                if (nextBuildingIds.length) {
                    await tx.taskBuilding.createMany({
                        data: nextBuildingIds.map((buildingId) => ({ taskId: id, buildingId })),
                    });
                }
            }
            if (nextAssigneeIds) {
                // Removals go, additions arrive, and anybody who was already on the item
                // KEEPS their row — deleting and recreating would reset notifiedAt and
                // re-alert them on every save.
                await tx.taskAssignment.deleteMany({
                    where: { taskId: id, userId: { notIn: nextAssigneeIds.length ? nextAssigneeIds : ['__none__'] } },
                });
                if (nextAssigneeIds.length) {
                    await tx.taskAssignment.createMany({
                        data: nextAssigneeIds.map((userId) => ({ taskId: id, userId })),
                        skipDuplicates: true,
                    });
                }
            }
            return tx.task.update({
                where: { id },
                data: {
                    ...rest,
                    // Keep the legacy scalars in step with the join tables. Writing them
                    // from the resolved set — never from the raw input — is what stops the
                    // two disagreeing.
                    ...(nextUnitIds ? { unitId: nextUnitIds.length === 1 ? nextUnitIds[0] : null } : {}),
                    ...(nextBuildingIds
                        ? { buildingId: nextBuildingIds.length === 1 ? nextBuildingIds[0] : null }
                        : {}),
                    ...(nextAssigneeIds
                        ? { assignedTo: nextAssigneeIds.length === 1 ? nextAssigneeIds[0] : null }
                        : {}),
                    dueDate: rest.dueDate === null ? null : rest.dueDate ? new Date(rest.dueDate) : undefined,
                },
                include: TASK_INCLUDE,
            });
        });

        // notifyAssigned filters on `notifiedAt IS NULL` itself, so it is safe to call on
        // every save: only somebody newly added hears about it. That is a stronger rule
        // than comparing against the stored scalar, which could not see the difference
        // between "added Priya" and "added Priya and Ravi".
        if (nextAssigneeIds?.length) {
            await this.notifyAssigned(id, nextAssigneeIds, updated, userId);
        }
        return updated;
    }

    async delete(id: string, userId: string, userRole: string) {
        const task = await this.findById(id);
        if (task.createdBy !== userId && !['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'PROJECT_MANAGER'].includes(userRole)) {
            throw new ForbiddenException('Only the task creator or a Project Manager can delete this task');
        }
        return this.prisma.task.delete({ where: { id } });
    }

    // ---- Updates (the board's day-wise progress column) ----

    async getUpdates(taskId: string) {
        await this.findById(taskId);
        const rows = await this.prisma.taskUpdate.findMany({
            where: { taskId },
            include: {
                author: { select: { id: true, name: true, avatarUrl: true } },
                photos: true,
            },
            orderBy: [{ updateDate: 'desc' }, { createdAt: 'desc' }],
        });
        return Promise.all(rows.map((r) => this.signPhotos(r)));
    }

    async addUpdate(taskId: string, authorId: string, input: {
        content: string;
        updateDate?: string;
    }) {
        const task = await this.findById(taskId);
        const content = input.content?.trim();
        if (!content) throw new BadRequestException('An update needs some text');

        const updateDate = input.updateDate ? new Date(input.updateDate) : new Date();
        if (Number.isNaN(updateDate.getTime())) {
            throw new BadRequestException('A valid update date is required');
        }
        // Reporting tomorrow's progress is always a typo. Backdating is not — the whole
        // reason updateDate exists is that site notes get written up late.
        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);
        if (updateDate > endOfToday) {
            throw new BadRequestException('An update cannot be dated in the future');
        }

        const update = await this.prisma.taskUpdate.create({
            data: { taskId, authorId, content, updateDate },
            include: {
                author: { select: { id: true, name: true, avatarUrl: true } },
                photos: true,
            },
        });

        await this.notifyMentions(task, content, authorId);
        return update;
    }

    async deleteUpdate(updateId: string, userId: string, userRole: string) {
        const update = await this.prisma.taskUpdate.findUnique({ where: { id: updateId } });
        if (!update) throw new NotFoundException('Update not found');
        if (update.authorId !== userId && !TASK_MANAGER_ROLES.includes(userRole)) {
            throw new ForbiddenException('Only the author or a Project Manager can delete an update');
        }
        return this.prisma.taskUpdate.delete({ where: { id: updateId } });
    }

    async addUpdatePhoto(updateId: string, input: { storagePath: string; caption?: string }) {
        const update = await this.prisma.taskUpdate.findUnique({ where: { id: updateId } });
        if (!update) throw new NotFoundException('Update not found');
        if (!input.storagePath) throw new BadRequestException('storagePath is required');
        // Must be a relative bucket key from our own presigned-upload flow — not an
        // absolute path, a traversal, or an external URL. Same guard as DailyLogsService:
        // this value is fed straight to the storage signer.
        const path = input.storagePath;
        if (path.startsWith('/') || path.includes('..') || /^[a-z]+:\/\//i.test(path)) {
            throw new BadRequestException('Invalid storagePath');
        }
        return this.prisma.taskUpdatePhoto.create({
            data: { taskUpdateId: updateId, storagePath: path, caption: input.caption },
        });
    }

    /**
     * Notify anyone named in an update or comment.
     *
     * Reuses resolveMentions and COMMENT_MENTION from the comments module rather than
     * growing a second mention parser — one of them would inevitably drift, and users
     * would find that @-ing someone works in one place and not another.
     */
    private async notifyMentions(
        task: { id: string; title: string; projectId: string; kind?: string },
        content: string,
        authorId: string,
    ) {
        try {
            // Active users only — naming a deactivated account should not resurrect it
            // as a recipient.
            const users = await this.prisma.user.findMany({
                where: { isActive: true },
                select: { id: true, name: true, email: true },
            });
            const mentioned = resolveMentions(content, users).filter((id) => id !== authorId);
            if (mentioned.length === 0) return;

            const author = users.find((u) => u.id === authorId);
            await this.notifications.send({
                userIds: mentioned,
                type: 'COMMENT_MENTION' as any,
                title: `${author?.name || 'Someone'} mentioned you on ${task.title}`,
                body: content.slice(0, 240),
                link: `/projects/${task.projectId}/${task.kind === 'CONSTRUCTION' ? 'board' : 'tasks'}`,
            });
        } catch (err) {
            this.logger.warn(`Task mention notification failed: ${err}`);
        }
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
        const task = await this.findById(taskId);
        const comment = await this.prisma.taskComment.create({
            data: { taskId, userId, content },
            include: { user: { select: { id: true, name: true, avatarUrl: true } } },
        });
        // Task comments had no mention wiring either — @-ing someone here reached nobody.
        await this.notifyMentions(task, content, userId);
        return comment;
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
