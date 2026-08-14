import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBus } from '../../common/events/event-bus.service';
import { AuditService } from '../../common/utils/audit.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Terminal statuses a proposal can never leave. */
const TERMINAL_STATUSES = ['APPROVED', 'REJECTED', 'SUPERSEDED', 'STALE'] as const;

/** One milestone (and optionally its lender draw) as it would be moved. */
export interface SlipCascadeEntry {
  milestoneId: string;
  isTrigger: boolean;
  depth: number;
  currentDueDate: Date;
  proposedDueDate: Date;
  drawScheduleId: string | null;
  currentDrawDate: Date | null;
  proposedDrawDate: Date | null;
}

/**
 * Milestone dependency + slippage logic.
 *
 *   - setDependency():  attach Milestone B → depends on A. Cycles rejected.
 *   - canStart():       enforce: a milestone can move from NOT_STARTED only
 *                        when its dependency is COMPLETED.
 *   - proposeSlippage(): when a milestone's due date moves, compute the transitive
 *                        cascade and PERSIST it for a PM to approve. Writes nothing
 *                        to the schedule.
 *   - decideProposal():  approve (apply every shift, and every linked lender draw date,
 *                        in one transaction) or reject (discard, change nothing).
 *
 * Why a gate at all — client decision 2026-08-14: "PM review the cascade first". The
 * previous propagateSlippage() wrote every dependent's new date transitively and
 * immediately, so moving one date silently rewrote a whole phase of the schedule and
 * told nobody. Once C4 puts the LENDER'S draw date in that same cascade, applying it
 * unreviewed stops being a schedule problem and becomes an external-commitment problem.
 *
 * The tree walk itself is unchanged and still cheap: dependency graphs in real estate
 * are shallow (typically 5–10 milestones deep, single chain per phase).
 */
@Injectable()
export class MilestoneDepsService {
  constructor(
    private prisma: PrismaService,
    private bus: EventBus,
    private audit: AuditService,
  ) {}

  /** Set or change a dependency. Refuses to create a cycle. */
  async setDependency(milestoneId: string, dependsOnId: string | null) {
    if (dependsOnId === milestoneId) {
      throw new BadRequestException('A milestone cannot depend on itself');
    }
    if (dependsOnId) {
      // Walk dependsOn chain to detect cycles. Cap at 100 hops as a safety net.
      let current: string | null = dependsOnId;
      const seen = new Set<string>();
      for (let hops = 0; hops < 100 && current; hops++) {
        if (current === milestoneId) {
          throw new BadRequestException('This dependency would create a cycle');
        }
        if (seen.has(current)) break; // already-existing cycle — stop walking
        seen.add(current);
        const next: { dependsOnId: string | null } | null = await this.prisma.milestone.findUnique({
          where: { id: current },
          select: { dependsOnId: true },
        });
        current = next?.dependsOnId ?? null;
      }
    }
    return this.prisma.milestone.update({
      where: { id: milestoneId },
      data: { dependsOnId },
    });
  }

  /** Check whether a milestone is allowed to start (not blocked by dependency). */
  async canStart(milestoneId: string): Promise<{ allowed: boolean; reason?: string }> {
    const m = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: { dependsOn: { select: { id: true, title: true, status: true } } },
    });
    if (!m) throw new NotFoundException('Milestone not found');
    if (!m.dependsOn) return { allowed: true };
    if (m.dependsOn.status !== 'COMPLETED') {
      return {
        allowed: false,
        reason: `Blocked by "${m.dependsOn.title}" (status: ${m.dependsOn.status})`,
      };
    }
    return { allowed: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // C3 / C4 — slip cascade, proposed rather than applied
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Walk the dependent tree and work out what WOULD move, without writing anything.
   *
   * The trigger milestone is included as `isTrigger` even though its own due date is
   * already written by the caller: it may fund a lender draw, and that date has not moved
   * and must be part of what the PM reviews (C4).
   *
   * COMPLETED milestones terminate the walk — a finished milestone does not move, and
   * nothing downstream of it is waiting on the slipped work either.
   *
   * A milestone reached twice is recorded once. Milestone carries a single `dependsOnId`,
   * so that can only happen via a cycle already in the data — setDependency() rejects new
   * ones but does not repair old ones, and an unbounded walk would hang the request. A
   * DrawSchedule two milestones in the cascade both point at is deduplicated for a real
   * reason: shifting it twice would double the delta on a lender-facing date.
   */
  async computeCascade(milestoneId: string, daysSlipped: number): Promise<SlipCascadeEntry[]> {
    if (daysSlipped <= 0) return [];
    const shift = (d: Date) => new Date(d.getTime() + daysSlipped * DAY_MS);

    const trigger = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
      select: { id: true, dueDate: true, linkedDrawScheduleId: true },
    });
    if (!trigger) throw new NotFoundException('Milestone not found');

    const entries: SlipCascadeEntry[] = [];
    // Draw schedules already claimed by an earlier entry. First writer wins; the delta is
    // identical either way, so which milestone "owns" the shift only affects presentation.
    const claimedDraws = new Set<string>();
    const visited = new Set<string>([milestoneId]);

    const drawFor = async (scheduleId: string | null) => {
      if (!scheduleId || claimedDraws.has(scheduleId)) {
        return { drawScheduleId: null, currentDrawDate: null, proposedDrawDate: null };
      }
      const schedule = await this.prisma.drawSchedule.findUnique({
        where: { id: scheduleId },
        select: { id: true, plannedDate: true },
      });
      // A dangling link is not a reason to block the whole review.
      if (!schedule) return { drawScheduleId: null, currentDrawDate: null, proposedDrawDate: null };
      claimedDraws.add(scheduleId);
      return {
        drawScheduleId: schedule.id,
        currentDrawDate: schedule.plannedDate,
        proposedDrawDate: shift(schedule.plannedDate),
      };
    };

    entries.push({
      milestoneId: trigger.id,
      isTrigger: true,
      depth: 0,
      // Already written by the caller — recorded equal so apply() writes no due date for it.
      currentDueDate: trigger.dueDate,
      proposedDueDate: trigger.dueDate,
      ...(await drawFor(trigger.linkedDrawScheduleId)),
    });

    let frontier = [milestoneId];
    let depth = 1;
    while (frontier.length) {
      const dependents = await this.prisma.milestone.findMany({
        where: { dependsOnId: { in: frontier }, status: { notIn: ['COMPLETED'] } },
        select: { id: true, dueDate: true, linkedDrawScheduleId: true },
      });
      const next: string[] = [];
      for (const d of dependents) {
        if (visited.has(d.id)) continue;
        visited.add(d.id);
        entries.push({
          milestoneId: d.id,
          isTrigger: false,
          depth,
          currentDueDate: d.dueDate,
          proposedDueDate: shift(d.dueDate),
          ...(await drawFor(d.linkedDrawScheduleId)),
        });
        next.push(d.id);
      }
      frontier = next;
      depth++;
    }
    return entries;
  }

  /**
   * Persist the cascade as a PENDING proposal. Writes NOTHING to milestones or draw
   * schedules — that is the whole point of the gate.
   *
   * Returns null when there is nothing to review: no dependents and no lender draw to
   * move. A proposal with no effect would be an approval request for a no-op, which is
   * exactly the kind of notification that trains people to stop reading them.
   *
   * SUPERSEDING: a second slip on the same milestone while one is pending closes the
   * first as SUPERSEDED and links it forward. Two applyable proposals over the same
   * sub-tree would shift it twice — the second one's baseline dates were captured before
   * the first was applied, so approving both would move everything by the sum of the
   * deltas even though only the later date is real. Only ONE pending proposal per trigger
   * milestone can exist at a time.
   */
  async proposeSlippage(params: {
    milestoneId: string;
    projectId: string;
    oldDueDate: Date;
    newDueDate: Date;
    daysSlipped: number;
    requestedById?: string | null;
  }) {
    const { milestoneId, projectId, oldDueDate, newDueDate, daysSlipped } = params;
    if (daysSlipped <= 0) return null;

    const entries = await this.computeCascade(milestoneId, daysSlipped);
    const movesSomething = entries.some(
      (e) => e.proposedDueDate.getTime() !== e.currentDueDate.getTime() || e.drawScheduleId,
    );
    if (!movesSomething) return null;

    const superseded = await this.prisma.milestoneSlipProposal.findMany({
      where: { milestoneId, status: 'PENDING' },
      select: { id: true },
    });

    const proposal = await this.prisma.$transaction(async (tx) => {
      const created = await tx.milestoneSlipProposal.create({
        data: {
          projectId,
          milestoneId,
          oldDueDate,
          newDueDate,
          daysSlipped,
          requestedById: params.requestedById ?? null,
          items: {
            create: entries.map((e) => ({
              milestoneId: e.milestoneId,
              isTrigger: e.isTrigger,
              depth: e.depth,
              currentDueDate: e.currentDueDate,
              proposedDueDate: e.proposedDueDate,
              drawScheduleId: e.drawScheduleId,
              currentDrawDate: e.currentDrawDate,
              proposedDrawDate: e.proposedDrawDate,
            })),
          },
        },
        include: { items: true },
      });
      if (superseded.length) {
        await tx.milestoneSlipProposal.updateMany({
          where: { id: { in: superseded.map((s) => s.id) }, status: 'PENDING' },
          data: {
            status: 'SUPERSEDED',
            // No decidedById: nobody decided this, a newer slip arrived. The CHECK
            // constraint exempts SUPERSEDED from naming a decider for exactly that reason.
            decidedAt: new Date(),
            supersededById: created.id,
            decisionNote: 'Replaced by a newer slip on the same milestone.',
          },
        });
      }
      return created;
    });

    await this.audit.log({
      userId: params.requestedById ?? undefined,
      action: 'MILESTONE_SLIP_PROPOSED',
      entity: 'Milestone',
      entityId: milestoneId,
      newValues: {
        proposalId: proposal.id,
        daysSlipped,
        dependentsAffected: entries.filter((e) => !e.isTrigger).length,
        drawSchedulesAffected: entries.filter((e) => e.drawScheduleId).length,
        supersededProposalIds: superseded.map((s) => s.id),
      },
    });

    this.bus.emit({
      type: 'milestone.slipProposed',
      proposalId: proposal.id,
      milestoneId,
      projectId,
      daysSlipped,
      affectedCount: entries.filter((e) => !e.isTrigger).length,
      drawCount: entries.filter((e) => e.drawScheduleId).length,
      requestedById: params.requestedById ?? null,
    });

    return proposal;
  }

  /**
   * Approve (apply everything) or reject (apply nothing).
   *
   * STALENESS — validate and refuse; never recompute, never apply blind.
   *
   * A proposal computed on Monday may reference milestones whose dates changed by
   * Wednesday. Each item carries the date it observed at proposal time, and approval
   * re-reads the live rows and compares. On any drift the proposal is closed STALE and the
   * call fails.
   *
   * Why not apply anyway: the stored dates are absolute, not deltas, so writing them would
   * silently revert whatever Tuesday's edit did.
   *
   * Why not silently recompute: the PM approved A SPECIFIC SET OF DATES that they read on
   * screen — including a lender's draw date. Recomputing changes the very thing under
   * review, so the approval would attach to numbers nobody saw. That is precisely the
   * failure the gate exists to prevent, in a subtler form.
   *
   * STALE is terminal rather than a state the same row recovers from: recovery means
   * "compute a fresh cascade against today's schedule", which is a new proposal with a new
   * set of dates and a new decision — see recompute().
   */
  async decideProposal(proposalId: string, approve: boolean, userId: string, note?: string) {
    const proposal = await this.prisma.milestoneSlipProposal.findUnique({
      where: { id: proposalId },
      include: { items: true },
    });
    if (!proposal) throw new NotFoundException('Slip proposal not found');
    if (proposal.status !== 'PENDING') {
      throw new BadRequestException(
        `This proposal was already ${proposal.status.toLowerCase()}`,
      );
    }

    if (!approve) {
      const rejected = await this.prisma.milestoneSlipProposal.update({
        where: { id: proposalId },
        data: {
          status: 'REJECTED',
          decidedById: userId,
          decidedAt: new Date(),
          decisionNote: note?.trim() || null,
        },
        include: { items: true },
      });
      await this.audit.log({
        userId,
        action: 'MILESTONE_SLIP_REJECTED',
        entity: 'Milestone',
        entityId: proposal.milestoneId,
        newValues: { proposalId, decisionNote: rejected.decisionNote },
      });
      // Deliberately NO milestone.slipped: nothing moved.
      return rejected;
    }

    const drift = await this.detectDrift(proposal.items);
    if (drift.length) {
      await this.prisma.milestoneSlipProposal.update({
        where: { id: proposalId },
        data: {
          status: 'STALE',
          decidedAt: new Date(),
          decisionNote:
            'The schedule moved after this cascade was computed; it was not applied.',
        },
      });
      throw new ConflictException({
        message:
          'The schedule changed after this cascade was computed, so it was not applied. '
          + 'Recompute it against the current dates and review it again.',
        proposalId,
        drift,
      });
    }

    const applied = await this.prisma.$transaction(async (tx) => {
      for (const item of proposal.items) {
        if (item.proposedDueDate.getTime() !== item.currentDueDate.getTime()) {
          await tx.milestone.update({
            where: { id: item.milestoneId },
            data: { dueDate: item.proposedDueDate },
          });
        }
        // C4 — the lender's date moves in the SAME transaction as the milestone dates.
        // A half-applied cascade would leave the draw schedule disagreeing with the
        // construction schedule it is supposed to fund.
        if (item.drawScheduleId && item.proposedDrawDate) {
          await tx.drawSchedule.update({
            where: { id: item.drawScheduleId },
            data: { plannedDate: item.proposedDrawDate },
          });
        }
      }
      return tx.milestoneSlipProposal.update({
        where: { id: proposalId },
        data: {
          status: 'APPROVED',
          decidedById: userId,
          decidedAt: new Date(),
          decisionNote: note?.trim() || null,
        },
        include: { items: true },
      });
    });

    await this.audit.log({
      userId,
      action: 'MILESTONE_SLIP_APPROVED',
      entity: 'Milestone',
      entityId: proposal.milestoneId,
      newValues: {
        proposalId,
        daysSlipped: proposal.daysSlipped,
        milestonesMoved: proposal.items.filter(
          (i) => i.proposedDueDate.getTime() !== i.currentDueDate.getTime(),
        ).length,
        drawSchedulesMoved: proposal.items.filter((i) => i.drawScheduleId).length,
        decisionNote: applied.decisionNote,
      },
    });

    // 'milestone.slipped' fires HERE — on application, not on proposal. The exception feed
    // reads this event, and a dashboard showing dates that have not moved is worse than
    // one showing nothing.
    for (const item of proposal.items) {
      if (item.proposedDueDate.getTime() === item.currentDueDate.getTime()) continue;
      this.bus.emit({
        type: 'milestone.slipped',
        milestoneId: item.milestoneId,
        oldDueDate: item.currentDueDate,
        newDueDate: item.proposedDueDate,
        daysSlipped: proposal.daysSlipped,
      });
    }

    return applied;
  }

  /**
   * Everything in this proposal that no longer matches the live schedule.
   *
   * A milestone that has since been COMPLETED counts as drift too: the cascade skips
   * completed milestones by design, so one that finished after the proposal was computed
   * would not be in a cascade computed today, and moving its date now would push a
   * finished piece of work into the future.
   */
  private async detectDrift(
    items: Array<{
      milestoneId: string;
      currentDueDate: Date;
      drawScheduleId: string | null;
      currentDrawDate: Date | null;
    }>,
  ) {
    const drift: Array<{ milestoneId: string; reason: string }> = [];

    const milestones = await this.prisma.milestone.findMany({
      where: { id: { in: items.map((i) => i.milestoneId) } },
      select: { id: true, dueDate: true, status: true, title: true },
    });
    const byId = new Map(milestones.map((m) => [m.id, m]));

    const scheduleIds = items.map((i) => i.drawScheduleId).filter((s): s is string => !!s);
    const schedules = scheduleIds.length
      ? await this.prisma.drawSchedule.findMany({
          where: { id: { in: scheduleIds } },
          select: { id: true, plannedDate: true },
        })
      : [];
    const scheduleById = new Map(schedules.map((s) => [s.id, s]));

    for (const item of items) {
      const live = byId.get(item.milestoneId);
      if (!live) {
        drift.push({ milestoneId: item.milestoneId, reason: 'The milestone no longer exists' });
        continue;
      }
      if (live.dueDate.getTime() !== item.currentDueDate.getTime()) {
        drift.push({
          milestoneId: item.milestoneId,
          reason: `"${live.title}" is now due ${live.dueDate.toISOString().slice(0, 10)}, not `
            + `${item.currentDueDate.toISOString().slice(0, 10)}`,
        });
        continue;
      }
      if (live.status === 'COMPLETED') {
        drift.push({
          milestoneId: item.milestoneId,
          reason: `"${live.title}" has been completed since this cascade was computed`,
        });
        continue;
      }
      if (item.drawScheduleId) {
        const schedule = scheduleById.get(item.drawScheduleId);
        if (!schedule) {
          drift.push({
            milestoneId: item.milestoneId,
            reason: `The draw schedule "${live.title}" funds no longer exists`,
          });
        } else if (schedule.plannedDate.getTime() !== (item.currentDrawDate?.getTime() ?? NaN)) {
          drift.push({
            milestoneId: item.milestoneId,
            reason: `The lender draw date for "${live.title}" has been changed since this `
              + 'cascade was computed',
          });
        }
      }
    }
    return drift;
  }

  /**
   * Rebuild a proposal against today's schedule, superseding the old one.
   *
   * The recovery path out of STALE, and the only way a cascade is ever recomputed —
   * deliberately an explicit act by a person, because the result is a different set of
   * dates that has to be reviewed on its own terms. Approval never does this implicitly.
   */
  async recomputeProposal(proposalId: string, userId: string) {
    const old = await this.prisma.milestoneSlipProposal.findUnique({ where: { id: proposalId } });
    if (!old) throw new NotFoundException('Slip proposal not found');
    if (old.status === 'APPROVED' || old.status === 'REJECTED') {
      throw new BadRequestException(`This proposal was already ${old.status.toLowerCase()}`);
    }

    const fresh = await this.proposeSlippage({
      milestoneId: old.milestoneId,
      projectId: old.projectId,
      oldDueDate: old.oldDueDate,
      newDueDate: old.newDueDate,
      daysSlipped: old.daysSlipped,
      requestedById: userId,
    });

    if (!fresh) {
      // The cascade has emptied out — everything downstream was completed or re-dated in
      // the meantime. Nothing to review, so close the old one rather than leave it hanging.
      await this.prisma.milestoneSlipProposal.updateMany({
        where: { id: proposalId, status: { notIn: [...TERMINAL_STATUSES] } },
        data: {
          status: 'STALE',
          decidedAt: new Date(),
          decisionNote: 'Recomputed against the current schedule: nothing left to move.',
        },
      });
      return null;
    }

    // proposeSlippage() only supersedes rows that are still PENDING. A STALE one is
    // already closed, so link it forward here instead of leaving a dead end.
    if (old.status === 'STALE' || old.status === 'SUPERSEDED') {
      await this.prisma.milestoneSlipProposal.update({
        where: { id: proposalId },
        data: { supersededById: fresh.id },
      });
    }
    return fresh;
  }

  /** One proposal with everything a reviewer needs to read it. */
  async findProposal(proposalId: string) {
    const proposal = await this.prisma.milestoneSlipProposal.findUnique({
      where: { id: proposalId },
      include: {
        milestone: { select: { id: true, title: true, phase: true, status: true } },
        requestedBy: { select: { id: true, name: true, email: true } },
        decidedBy: { select: { id: true, name: true } },
        items: {
          orderBy: [{ depth: 'asc' }, { proposedDueDate: 'asc' }],
          include: {
            milestone: { select: { id: true, title: true, phase: true, status: true } },
            drawSchedule: {
              select: { id: true, drawNumber: true, plannedAmount: true, loanId: true },
            },
          },
        },
      },
    });
    if (!proposal) throw new NotFoundException('Slip proposal not found');
    return proposal;
  }

  /** The review queue. Defaults to what is actually waiting on someone. */
  async listProposals(params: { projectId?: string; status?: string }) {
    return this.prisma.milestoneSlipProposal.findMany({
      where: {
        ...(params.projectId ? { projectId: params.projectId } : {}),
        status: params.status || 'PENDING',
      },
      orderBy: { requestedAt: 'asc' },
      include: {
        milestone: { select: { id: true, title: true, phase: true } },
        requestedBy: { select: { id: true, name: true } },
        decidedBy: { select: { id: true, name: true } },
        items: {
          orderBy: [{ depth: 'asc' }],
          include: {
            milestone: { select: { id: true, title: true, phase: true, status: true } },
            drawSchedule: { select: { id: true, drawNumber: true, loanId: true } },
          },
        },
      },
    });
  }

  /**
   * Compute project end-date impact: latest dueDate across all non-completed
   * milestones for the project (rough but useful proxy).
   */
  async projectExpectedEnd(projectId: string): Promise<Date | null> {
    const m = await this.prisma.milestone.findFirst({
      where: { projectId, status: { notIn: ['COMPLETED'] } },
      orderBy: { dueDate: 'desc' },
      select: { dueDate: true },
    });
    return m?.dueDate ?? null;
  }
}
