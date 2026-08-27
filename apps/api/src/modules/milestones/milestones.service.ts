import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { EventBus } from '../../common/events/event-bus.service';
import { MilestoneDepsService } from './milestone-deps.service';
import { StorageService } from '../../common/storage/storage.service';

/** The shape the completion gate reads off a milestone's photos. */
interface ReviewablePhoto {
  reviewStatus: string;
}

@Injectable()
export class MilestonesService {
  constructor(
    private prisma: PrismaService,
    private bus: EventBus,
    private deps: MilestoneDepsService,
    private storage: StorageService,
  ) {}

  private async enrichPhotos<T extends { photos: Array<{ storagePath: string }> }>(item: T) {
    const photos = await Promise.all(
      item.photos.map(async (p) => ({
        ...p,
        url: await this.storage.signedUrl(p.storagePath, 3600).catch(() => ''),
      })),
    );
    return { ...item, photos };
  }

  async findByProject(projectId: string) {
    const milestones = await this.prisma.milestone.findMany({
      where: { projectId },
      include: {
        owner: { select: { id: true, name: true } },
        dependsOn: { select: { id: true, title: true, status: true } },
        photos: { orderBy: { uploadedAt: 'desc' }, take: 5 },
        _count: { select: { photos: true, dependents: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });
    return Promise.all(milestones.map((m) => this.enrichPhotos(m)));
  }

  async findById(id: string) {
    const m = await this.prisma.milestone.findUnique({
      where: { id },
      include: {
        owner: true,
        dependsOn: { select: { id: true, title: true, status: true, dueDate: true } },
        dependents: { select: { id: true, title: true, status: true, dueDate: true } },
        photos: { include: { uploadedBy: { select: { id: true, name: true } } }, orderBy: { uploadedAt: 'desc' } },
        linkedDrawSchedule: true,
      },
    });
    if (!m) throw new NotFoundException('Milestone not found');
    return this.enrichPhotos(m);
  }

  async create(data: Prisma.MilestoneUncheckedCreateInput) {
    // class-validator's @IsDateString() accepts a bare "YYYY-MM-DD" date, but Prisma's
    // DateTime column needs a full ISO-8601 datetime — pass a Date object so Prisma
    // serializes it correctly instead of erroring "premature end of input".
    if (typeof data.dueDate === 'string') data.dueDate = new Date(data.dueDate);
    return this.prisma.milestone.create({ data });
  }

  /**
   * `userId` is who to record as having proposed any resulting slip cascade. Optional
   * because non-HTTP callers (seeds, imports) exist — a missing actor must never stop the
   * review gate being raised. See MilestoneSlipProposal.requestedById.
   */
  async update(id: string, data: Prisma.MilestoneUncheckedUpdateInput, userId?: string) {
    return this.applyUpdate(id, data, userId, false);
  }

  private async applyUpdate(
    id: string,
    data: Prisma.MilestoneUncheckedUpdateInput,
    userId: string | undefined,
    bypassPhotoSignoff: boolean,
  ) {
    const existing = await this.findById(id);
    const wasCompleted = existing.status === 'COMPLETED';
    if (typeof data.dueDate === 'string') data.dueDate = new Date(data.dueDate);

    // Dependency gate — canStart()'s own contract: "a milestone can move from
    // NOT_STARTED only when its dependency is COMPLETED". This was only ever exposed
    // as a read-only GET /milestones/:id/can-start the frontend never called, so a
    // blocked milestone could be marked COMPLETED directly — including auto-drafting
    // a lender draw request (see the milestone.completed handler below) for work whose
    // prerequisite never actually finished. Enforced here, at the one place every
    // status write goes through.
    if (existing.status === 'NOT_STARTED' && data.status && data.status !== 'NOT_STARTED') {
      const gate = await this.deps.canStart(id);
      if (!gate.allowed) {
        throw new ConflictException(gate.reason ?? 'Blocked by an incomplete dependency');
      }
    }

    // C6 — the sign-off gate. Only on the transition INTO COMPLETED: editing the title of
    // an already-complete milestone is not a re-completion, and re-gating it would strand
    // every milestone completed before this feature existed.
    if (data.status === 'COMPLETED' && !wasCompleted && !bypassPhotoSignoff) {
      this.assertPhotosSignedOff(existing.title, existing.photos);
    }

    // Auto-stamp completedAt the first time a milestone is marked COMPLETED.
    if (data.status === 'COMPLETED' && !existing.completedAt && !data.completedAt) {
      data.completedAt = new Date();
    }

    // Slippage detection: a non-completed milestone whose due date moves later
    // should propose the same delta onto its dependents — for review, not applied.
    let daysSlipped = 0;
    const oldDate = existing.dueDate;
    let newDate = oldDate;
    if (data.dueDate && existing.status !== 'COMPLETED') {
      newDate = new Date(data.dueDate as Date);
      daysSlipped = Math.floor(
        (newDate.getTime() - oldDate.getTime()) / (1000 * 60 * 60 * 24),
      );
    }

    const updated = await this.prisma.milestone.update({ where: { id }, data });

    // Fire-and-forget post-write side effects — wrapped in setImmediate via EventBus
    if (data.status === 'COMPLETED' && !wasCompleted) {
      this.bus.emit({
        type: 'milestone.completed',
        milestoneId: id,
        projectId: existing.projectId,
        completedAt: updated.completedAt ?? new Date(),
      });
    }
    if (daysSlipped > 0) {
      // C3 — PROPOSE the cascade; do not apply it. The edited milestone's own date is
      // already written above (that was the PM's direct act); everything downstream of it,
      // plus any lender draw date, waits for a PM to approve on the proposal.
      //
      // Fire and forget — don't block the response. A failure here leaves the schedule
      // untouched, which is the safe direction: the old code's failure mode was a
      // half-applied cascade.
      this.deps
        .proposeSlippage({
          milestoneId: id,
          projectId: existing.projectId,
          oldDueDate: oldDate,
          newDueDate: newDate,
          daysSlipped,
          requestedById: userId ?? null,
        })
        .catch(() => {});
    }
    return updated;
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.milestone.delete({ where: { id } });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // C6 — photo sign-off
  //
  // Client decision 2026-08-14: "Uploading a photo today is purely evidence[;] milestone
  // photos require a sign-off before that phase counts as complete."
  //
  // The rule, in full:
  //
  //   no photos at all  -> completes freely
  //   any photo PENDING -> refused
  //   photos, none APPROVED (i.e. all rejected) -> refused
  //   otherwise (>=1 APPROVED, 0 PENDING, any number REJECTED) -> completes
  //
  // Zero photos completes freely because most milestones have nothing to photograph —
  // "permit submitted", "LOI signed", "loan closed". Demanding a photo on those would
  // only teach people to upload a picture of a desk. This gate is about photos that have
  // been taken not being taken on trust; WHICH milestones must carry photographic
  // evidence at all is a per-milestone policy question for Prime, not something to infer.
  //
  // Rejected photos do not block on their own, but they never satisfy the gate either.
  // Ignoring them outright would make a rejection WEAKER than a pending review — the
  // reviewer's "no" would unblock the milestone, which inverts what they said. Blocking
  // on them outright would strand the ordinary case of three shots where the reviewer
  // keeps the good one and rejects two blurry duplicates. Requiring at least one APPROVED
  // gets both: the good shot carries the milestone, and an all-rejected milestone — where
  // nothing on file vouches for the work — stays shut.
  // ═══════════════════════════════════════════════════════════════════════════

  private assertPhotosSignedOff(title: string, photos: ReviewablePhoto[]) {
    if (photos.length === 0) return;

    const pending = photos.filter((p) => p.reviewStatus === 'PENDING').length;
    if (pending > 0) {
      const s = pending === 1 ? '' : 's';
      throw new ConflictException(
        `Cannot complete "${title}": ${pending} photo${s} still awaiting sign-off. ` +
          `Have an approver review ${pending === 1 ? 'it' : 'them'} — an uploaded photo ` +
          `counts as evidence only once somebody has signed it off — or complete anyway ` +
          `with POST /milestones/:id/force-complete and a reason, which is recorded on ` +
          `the milestone.`,
      );
    }

    const approved = photos.filter((p) => p.reviewStatus === 'APPROVED').length;
    if (approved === 0) {
      const n = photos.length;
      const s = n === 1 ? '' : 's';
      throw new ConflictException(
        `Cannot complete "${title}": all ${n} photo${s} on this milestone ${n === 1 ? 'was' : 'were'} ` +
          `rejected at sign-off, so nothing on file vouches for the work. Upload replacement ` +
          `evidence and have it approved, or complete anyway with ` +
          `POST /milestones/:id/force-complete and a reason, which is recorded on the milestone.`,
      );
    }
  }

  /**
   * Record a reviewer's verdict on one photo.
   *
   * The reviewer may not be the uploader. Permissions already keep the two apart for most
   * roles (uploading is `milestone:edit` — PM and Construction; signing off is
   * `draw:approve` — Founder/Executive/Finance), but a Founder holds both, and a sign-off
   * you can give yourself is not a sign-off.
   *
   * A verdict is final. Changing your mind about evidence after the fact is how an
   * approved photo quietly becomes a rejected one under a milestone that already
   * completed on it — re-shoot and upload a replacement instead.
   */
  async signOffPhoto(photoId: string, reviewerId: string, approve: boolean, note?: string) {
    const photo = await this.prisma.milestonePhoto.findUnique({ where: { id: photoId } });
    if (!photo) throw new NotFoundException('Milestone photo not found');

    if (photo.uploadedById === reviewerId) {
      throw new ForbiddenException(
        'You uploaded this photo, so you cannot sign it off — the point of the sign-off is ' +
          'that a second person judged the evidence.',
      );
    }

    if (photo.reviewStatus !== 'PENDING') {
      throw new ConflictException(
        `This photo was already ${photo.reviewStatus.toLowerCase()} at sign-off. Upload a ` +
          `replacement photo if the evidence needs to change.`,
      );
    }

    const trimmed = note?.trim();
    if (!approve && !trimmed) {
      throw new BadRequestException(
        'A note is required to reject a photo — it has to say what the evidence fails to ' +
          'show, or the uploader has nothing to act on.',
      );
    }

    return this.prisma.milestonePhoto.update({
      where: { id: photoId },
      data: {
        reviewStatus: approve ? 'APPROVED' : 'REJECTED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewNote: trimmed || null,
      },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Remove a photo — allowed only while it is still PENDING.
   *
   * A mis-upload should be removable. A decided one should not: deleting an APPROVED photo
   * strips the evidence a completion rests on, and deleting a REJECTED one erases the
   * reviewer's verdict, which is the one thing an uploader has an incentive to erase.
   */
  async deletePhoto(photoId: string) {
    const photo = await this.prisma.milestonePhoto.findUnique({ where: { id: photoId } });
    if (!photo) throw new NotFoundException('Milestone photo not found');
    if (photo.reviewStatus !== 'PENDING') {
      throw new ConflictException(
        `This photo was ${photo.reviewStatus.toLowerCase()} at sign-off and is part of the ` +
          `milestone's record — it cannot be deleted. Upload a replacement photo instead.`,
      );
    }
    return this.prisma.milestonePhoto.delete({ where: { id: photoId } });
  }

  /**
   * Complete a milestone past the photo sign-off gate, on the record.
   *
   * Every other gate in this codebase is overridable with a mandatory recorded reason
   * (building/unit force-delete, sale cancellation, interior handover with open snags),
   * and this one earns it more than most: milestone completion feeds the draw schedule, so
   * an approver on a plane can freeze a lender draw over a photo of finished work. Absolute
   * would not make the evidence better — it would make people delete the photos instead,
   * which is the one outcome that destroys the record entirely.
   *
   * Restricted at the route to holders of BOTH `milestone:edit` and `draw:approve`
   * (Founder / Super Admin), so the override is exercised by the approver class rather
   * than by the person whose photos are waiting.
   *
   * When the gate would have let the milestone through anyway, this completes it WITHOUT
   * stamping an override: a recorded "forced past 0 pending photos" is a false record.
   */
  async forceComplete(id: string, userId: string, reason: string) {
    const trimmed = reason?.trim();
    if (!trimmed) {
      throw new BadRequestException(
        'A reason is required to complete a milestone past the photo sign-off gate',
      );
    }

    const existing = await this.findById(id);
    if (existing.status === 'COMPLETED') {
      throw new BadRequestException('This milestone is already complete');
    }

    let blocked = false;
    try {
      this.assertPhotosSignedOff(existing.title, existing.photos);
    } catch {
      blocked = true;
    }

    const override: Prisma.MilestoneUncheckedUpdateInput = blocked
      ? {
          signoffOverrideById: userId,
          signoffOverrideAt: new Date(),
          signoffOverrideReason: trimmed,
        }
      : {};

    return this.applyUpdate(id, { status: 'COMPLETED', ...override }, userId, true);
  }
}
