import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { MilestonesService } from './milestones.service';
import { MilestoneDepsService } from './milestone-deps.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';
import { DecideSlipProposalDto } from './dto/slip-proposal.dto';
import { SignOffPhotoDto, ForceCompleteMilestoneDto } from './dto/photo-signoff.dto';

@ApiTags('Milestones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
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

  // ─────── C3/C4: slip proposals ───────
  //
  // Declared ABOVE `@Get(':id')` — Nest matches in declaration order and would otherwise
  // read 'slip-proposals' as a milestone id.
  //
  // There is no explicit "propose" route: a proposal is raised by the act that causes it,
  // `PUT /milestones/:id` moving `dueDate` later. A separate propose endpoint would let a
  // date move with no proposal, which is the exact hole this closes.

  @Get('slip-proposals')
  @RequirePermissions('milestone:view')
  @ApiOperation({
    summary: 'Slip cascades awaiting review (the PM queue)',
    description:
      'Defaults to PENDING. Pass ?status=APPROVED|REJECTED|SUPERSEDED|STALE for decided '
      + 'ones, and ?projectId= to scope to one project.',
  })
  listSlipProposals(
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
  ) {
    return this.deps.listProposals({ projectId, status });
  }

  @Get('slip-proposals/:proposalId')
  @RequirePermissions('milestone:view')
  @ApiOperation({ summary: 'One slip cascade, with every milestone and draw date it would move' })
  getSlipProposal(@Param('proposalId') proposalId: string) {
    return this.deps.findProposal(proposalId);
  }

  @Post('slip-proposals/:proposalId/decide')
  @RequirePermissions('milestone:edit')
  @ApiOperation({
    summary: 'Approve or reject a slip cascade',
    description:
      'Approving applies every milestone shift AND every linked lender draw date in one '
      + 'transaction. Rejecting changes nothing. 409 if the schedule moved since the '
      + 'cascade was computed — recompute and review it again.',
  })
  decideSlipProposal(
    @Param('proposalId') proposalId: string,
    @Body() body: DecideSlipProposalDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.deps.decideProposal(proposalId, body.approve, userId, body.note);
  }

  @Post('slip-proposals/:proposalId/recompute')
  @RequirePermissions('milestone:edit')
  @ApiOperation({
    summary: 'Rebuild a stale cascade against the current schedule',
    description:
      'Supersedes the old proposal and returns a fresh PENDING one, or null when there is '
      + 'nothing left to move.',
  })
  recomputeSlipProposal(
    @Param('proposalId') proposalId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.deps.recomputeProposal(proposalId, userId);
  }

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
  @ApiOperation({
    summary: 'Update milestone (auto-sets completedAt on first completion only)',
    description:
      'Moving dueDate later raises a PENDING MilestoneSlipProposal for the dependent '
      + 'cascade and any linked lender draw dates. Only THIS milestone\'s date is written; '
      + 'nothing downstream moves until the proposal is approved. '
      + 'Setting status=COMPLETED is refused (409) while any photo on the milestone is '
      + 'awaiting sign-off, or when every photo was rejected — see POST :id/force-complete.',
  })
  update(
    @Param('id') id: string,
    @Body() body: UpdateMilestoneDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.update(id, body as any, userId);
  }

  @Post(':id/force-complete')
  // BOTH permissions, deliberately. Uploading and completing are `milestone:edit` (PM,
  // Construction); signing evidence off is `draw:approve` (Founder, Executive, Finance).
  // Requiring both lands the override on Founder/Super Admin — the same override class as
  // the unit status state machine — so the person whose photos are waiting cannot wave
  // their own work through.
  @RequirePermissions('milestone:edit', 'draw:approve')
  @ApiOperation({
    summary: 'Complete a milestone past the photo sign-off gate, with a recorded reason',
    description:
      'For when evidence is on file but the approver is not available. The reason is '
      + 'mandatory and is stamped on the milestone next to completedAt. If the gate would '
      + 'have passed anyway, the milestone completes with no override recorded.',
  })
  forceComplete(
    @Param('id') id: string,
    @Body() body: ForceCompleteMilestoneDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.forceComplete(id, userId, body.reason);
  }

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
      include: {
        uploadedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  // C6 — the sign-off. `draw:approve`, NOT `milestone:edit`: the photo is the evidence a
  // lender draw is paid against, and this is already the permission for "that evidence is
  // good enough to draw money on". It is held by Founder/Executive/Finance and by neither
  // Construction nor PM — the people who upload — which is the separation the sign-off is
  // for. The service refuses a self-sign-off on top, for the Founder who holds both.
  @Post('photos/:photoId/sign-off')
  @RequirePermissions('draw:approve')
  @ApiOperation({
    summary: 'Approve or reject one milestone photo as evidence',
    description:
      'Body: { approve: boolean, note?: string }. A note is mandatory when rejecting. '
      + 'A verdict is final — upload a replacement photo rather than re-reviewing this one. '
      + 'You cannot sign off a photo you uploaded yourself.',
  })
  signOffPhoto(
    @Param('photoId') photoId: string,
    @Body() body: SignOffPhotoDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.signOffPhoto(photoId, userId, body.approve, body.note);
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
  @ApiOperation({
    summary: 'Delete a milestone photo (only while it is still awaiting sign-off)',
  })
  deletePhoto(@Param('photoId') photoId: string) {
    return this.service.deletePhoto(photoId);
  }
}
