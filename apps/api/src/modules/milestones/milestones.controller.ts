import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { MilestonesService } from './milestones.service';
import { MilestoneDepsService } from './milestone-deps.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';

@ApiTags('Milestones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('milestones')
export class MilestonesController {
  constructor(
    private service: MilestonesService,
    private deps: MilestoneDepsService,
    private prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermissions('milestone:view')
  @ApiOperation({ summary: 'List milestones by project (includes owner)' })
  findByProject(@Query('projectId') projectId: string) { return this.service.findByProject(projectId); }

  @Get(':id')
  @RequirePermissions('milestone:view')
  @ApiOperation({ summary: 'Get milestone by ID' })
  findById(@Param('id') id: string) { return this.service.findById(id); }

  @Post()
  @RequirePermissions('milestone:edit')
  @ApiOperation({ summary: 'Create milestone' })
  create(@Body() body: CreateMilestoneDto) { return this.service.create(body as any); }

  @Put(':id')
  @RequirePermissions('milestone:edit')
  @ApiOperation({ summary: 'Update milestone (auto-sets completedAt on first completion only)' })
  update(@Param('id') id: string, @Body() body: UpdateMilestoneDto) { return this.service.update(id, body as any); }

  @Delete(':id')
  @RequirePermissions('milestone:edit')
  @ApiOperation({ summary: 'Delete milestone' })
  delete(@Param('id') id: string) { return this.service.delete(id); }

  // ─────── Slice 7: Dependencies ───────

  @Patch(':id/depends-on')
  @RequirePermissions('milestone:edit')
  @ApiOperation({ summary: 'Set or clear a dependency. Pass dependsOnId=null to clear. Cycles are rejected.' })
  setDependency(@Param('id') id: string, @Body() body: { dependsOnId: string | null }) {
    return this.deps.setDependency(id, body.dependsOnId);
  }

  @Get(':id/can-start')
  @RequirePermissions('milestone:view')
  @ApiOperation({ summary: 'Check whether dependency chain allows this milestone to start' })
  canStart(@Param('id') id: string) {
    return this.deps.canStart(id);
  }

  // ─────── Slice 7: Photos ───────
  // Caller uploads to Supabase via the documents/presigned-upload route, then
  // POSTs the resulting storagePath here.

  @Get(':id/photos')
  @RequirePermissions('milestone:view')
  listPhotos(@Param('id') milestoneId: string) {
    return this.prisma.milestonePhoto.findMany({
      where: { milestoneId },
      include: { uploadedBy: { select: { id: true, name: true } } },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  @Post(':id/photos')
  @RequirePermissions('milestone:edit')
  attachPhoto(
    @Param('id') milestoneId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: { storagePath: string; caption?: string },
  ) {
    return this.prisma.milestonePhoto.create({
      data: { milestoneId, storagePath: body.storagePath, caption: body.caption, uploadedById: userId },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
  }

  @Delete('photos/:photoId')
  @RequirePermissions('milestone:edit')
  deletePhoto(@Param('photoId') photoId: string) {
    return this.prisma.milestonePhoto.delete({ where: { id: photoId } });
  }
}
