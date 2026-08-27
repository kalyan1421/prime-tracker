import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MilestonesService } from './milestones.service';
import { MilestoneDepsService } from './milestone-deps.service';

/**
 * C6 — milestone photos require a sign-off before the phase counts as complete.
 *
 * The world is one milestone and its photos, held in memory, so a test reads as "this
 * milestone has two photos, one approved" rather than as a chain of mockResolvedValueOnce.
 */
interface FakePhoto {
  id: string;
  milestoneId: string;
  storagePath: string;
  uploadedById: string;
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedById: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
}

const photo = (id: string, over: Partial<FakePhoto> = {}): FakePhoto => ({
  id,
  milestoneId: 'm1',
  storagePath: `site/${id}.jpg`,
  uploadedById: 'pm-1',
  reviewStatus: 'PENDING',
  reviewedById: null,
  reviewedAt: null,
  reviewNote: null,
  ...over,
});

function makeWorld(photos: FakePhoto[] = [], milestoneOver: Record<string, any> = {}) {
  const milestone: any = {
    id: 'm1',
    projectId: 'p1',
    title: 'Foundation pour',
    status: 'IN_PROGRESS',
    dueDate: new Date('2026-03-01T00:00:00.000Z'),
    completedAt: null,
    signoffOverrideById: null,
    signoffOverrideAt: null,
    signoffOverrideReason: null,
    ...milestoneOver,
  };
  const store = new Map(photos.map((p) => [p.id, { ...p }]));

  const prisma: any = {
    milestone: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.id === milestone.id ? { ...milestone, photos: [...store.values()] } : null,
        ),
      ),
      update: jest.fn(({ where, data }: any) => {
        if (where.id !== milestone.id) return Promise.resolve(null);
        Object.assign(milestone, data);
        return Promise.resolve({ ...milestone });
      }),
      findMany: jest.fn(() => Promise.resolve([])),
      findFirst: jest.fn(() => Promise.resolve(null)),
      delete: jest.fn(() => Promise.resolve(milestone)),
    },
    milestonePhoto: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(store.get(where.id) ?? null)),
      update: jest.fn(({ where, data }: any) => {
        const row = store.get(where.id)!;
        Object.assign(row, data);
        return Promise.resolve({ ...row });
      }),
      delete: jest.fn(({ where }: any) => {
        const row = store.get(where.id)!;
        store.delete(where.id);
        return Promise.resolve(row);
      }),
    },
  };

  const bus = { emit: jest.fn() };
  const deps = {
    proposeSlippage: jest.fn().mockResolvedValue(null),
    // Default: nothing blocks — most tests here aren't about the dependency gate.
    canStart: jest.fn().mockResolvedValue({ allowed: true }),
  };
  const storage = { signedUrl: jest.fn().mockResolvedValue('') };
  const service = new MilestonesService(
    prisma,
    bus as any,
    deps as unknown as MilestoneDepsService,
    storage as any,
  );

  return { service, prisma, bus, deps, milestone, store };
}

/** The refusal, or `null` when the call succeeded. */
async function refusal(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (e: any) {
    return e;
  }
}

describe('MilestonesService — photo sign-off (C6)', () => {
  describe('signOffPhoto', () => {
    it('records the approval against a reviewer who is NOT the uploader', async () => {
      const { service, store } = makeWorld([photo('ph1', { uploadedById: 'pm-1' })]);

      const result: any = await service.signOffPhoto('ph1', 'finance-1', true);

      expect(result.reviewStatus).toBe('APPROVED');
      expect(result.reviewedById).toBe('finance-1');
      expect(result.reviewedAt).toBeInstanceOf(Date);
      // The uploader is untouched — the two are different people and that is the point.
      expect(store.get('ph1')!.uploadedById).toBe('pm-1');
    });

    it('refuses a self sign-off by the uploader', async () => {
      const { service } = makeWorld([photo('ph1', { uploadedById: 'founder-1' })]);

      const err = await refusal(() => service.signOffPhoto('ph1', 'founder-1', true));

      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.message).toContain('cannot sign it off');
    });

    it('rejects a photo, with the note that tells the uploader what to re-shoot', async () => {
      const { service, store } = makeWorld([photo('ph1')]);

      await service.signOffPhoto('ph1', 'finance-1', false, '  Shows the wrong elevation  ');

      expect(store.get('ph1')).toMatchObject({
        reviewStatus: 'REJECTED',
        reviewedById: 'finance-1',
        reviewNote: 'Shows the wrong elevation',
      });
    });

    it('refuses a rejection with no note', async () => {
      const { service } = makeWorld([photo('ph1')]);

      const err = await refusal(() => service.signOffPhoto('ph1', 'finance-1', false, '   '));

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('note is required to reject');
    });

    it('refuses to re-review a photo that already has a verdict', async () => {
      const { service } = makeWorld([
        photo('ph1', { reviewStatus: 'APPROVED', reviewedById: 'finance-1', reviewedAt: new Date() }),
      ]);

      const err = await refusal(() => service.signOffPhoto('ph1', 'exec-1', false, 'changed my mind'));

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toContain('already approved');
    });

    it('404s on an unknown photo', async () => {
      const { service } = makeWorld([]);
      await expect(service.signOffPhoto('nope', 'finance-1', true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('the completion gate', () => {
    it('blocks completion while photos are awaiting sign-off, naming the count', async () => {
      const { service, milestone } = makeWorld([photo('ph1'), photo('ph2')]);

      const err = await refusal(() => service.update('m1', { status: 'COMPLETED' } as any, 'pm-1'));

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toContain('Cannot complete "Foundation pour"');
      expect(err.message).toContain('2 photos still awaiting sign-off');
      expect(err.message).toContain('force-complete');
      expect(milestone.status).toBe('IN_PROGRESS');
    });

    it('says "1 photo" and "review it" for a single pending photo', async () => {
      const { service } = makeWorld([photo('ph1')]);

      const err = await refusal(() => service.update('m1', { status: 'COMPLETED' } as any, 'pm-1'));

      expect(err.message).toContain('1 photo still awaiting sign-off');
      expect(err.message).toContain('review it');
    });

    it('allows completion once every photo is signed off', async () => {
      const { service, milestone, bus } = makeWorld([
        photo('ph1', { reviewStatus: 'APPROVED', reviewedById: 'finance-1', reviewedAt: new Date() }),
      ]);

      await service.update('m1', { status: 'COMPLETED' } as any, 'pm-1');

      expect(milestone.status).toBe('COMPLETED');
      expect(milestone.completedAt).toBeInstanceOf(Date);
      expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'milestone.completed' }));
    });

    // The decision, pinned: an administrative milestone ("permit submitted") has nothing to
    // photograph, and demanding evidence there would only produce a photo of a desk.
    it('completes a milestone with NO photos at all', async () => {
      const { service, milestone } = makeWorld([]);

      await service.update('m1', { status: 'COMPLETED' } as any, 'pm-1');

      expect(milestone.status).toBe('COMPLETED');
    });

    // A rejection must never be WEAKER than a pending review — otherwise the reviewer's
    // "no" would unblock the milestone.
    it('blocks completion when every photo was rejected', async () => {
      const { service, milestone } = makeWorld([
        photo('ph1', { reviewStatus: 'REJECTED', reviewNote: 'blurry', reviewedAt: new Date() }),
        photo('ph2', { reviewStatus: 'REJECTED', reviewNote: 'wrong unit', reviewedAt: new Date() }),
      ]);

      const err = await refusal(() => service.update('m1', { status: 'COMPLETED' } as any, 'pm-1'));

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toContain('all 2 photos on this milestone were rejected');
      expect(milestone.status).toBe('IN_PROGRESS');
    });

    // ...but a rejected duplicate alongside a good shot must not strand the milestone.
    it('completes on one approved photo even with rejected ones beside it', async () => {
      const { service, milestone } = makeWorld([
        photo('ph1', { reviewStatus: 'APPROVED', reviewedAt: new Date() }),
        photo('ph2', { reviewStatus: 'REJECTED', reviewNote: 'blurry', reviewedAt: new Date() }),
      ]);

      await service.update('m1', { status: 'COMPLETED' } as any, 'pm-1');

      expect(milestone.status).toBe('COMPLETED');
    });

    it('does not gate a move to a non-COMPLETED status', async () => {
      const { service, milestone } = makeWorld([photo('ph1'), photo('ph2')]);

      await service.update('m1', { status: 'IN_PROGRESS' } as any, 'pm-1');

      expect(milestone.status).toBe('IN_PROGRESS');
    });

    it('does not re-gate an edit to an already-COMPLETED milestone', async () => {
      const { service, milestone } = makeWorld([photo('ph1')], {
        status: 'COMPLETED',
        completedAt: new Date('2026-02-01T00:00:00.000Z'),
      });

      await service.update('m1', { status: 'COMPLETED', title: 'Foundation pour (rev B)' } as any, 'pm-1');

      expect(milestone.title).toBe('Foundation pour (rev B)');
    });
  });

  describe('the dependency gate', () => {
    // canStart() existed as a read-only GET the frontend never called — a blocked
    // milestone could be moved straight to COMPLETED (or any other status) with
    // nothing checking its dependency. Wired into applyUpdate() so every status
    // write goes through it.
    it('refuses to move a NOT_STARTED milestone past its unfinished dependency', async () => {
      const { service, deps, milestone } = makeWorld([], { status: 'NOT_STARTED' });
      deps.canStart.mockResolvedValue({ allowed: false, reason: 'Blocked by "Foundation" (status: IN_PROGRESS)' });

      const err = await refusal(() => service.update('m1', { status: 'COMPLETED' } as any, 'pm-1'));

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toContain('Blocked by "Foundation"');
      expect(milestone.status).toBe('NOT_STARTED');
      expect(deps.canStart).toHaveBeenCalledWith('m1');
    });

    it('allows the move once the dependency has actually completed', async () => {
      const { service, deps, milestone } = makeWorld([], { status: 'NOT_STARTED' });
      deps.canStart.mockResolvedValue({ allowed: true });

      await service.update('m1', { status: 'IN_PROGRESS' } as any, 'pm-1');

      expect(milestone.status).toBe('IN_PROGRESS');
    });

    it('does not check the gate for a milestone that was never NOT_STARTED', async () => {
      // Default world status is IN_PROGRESS — moving between two non-NOT_STARTED
      // statuses (or completing normally) is not what canStart() was built to police.
      const { service, deps, milestone } = makeWorld([photo('ph1', { reviewStatus: 'APPROVED', reviewedAt: new Date() })]);

      await service.update('m1', { status: 'COMPLETED' } as any, 'pm-1');

      expect(milestone.status).toBe('COMPLETED');
      expect(deps.canStart).not.toHaveBeenCalled();
    });

    it('does not check the gate on an edit that leaves status untouched', async () => {
      const { service, deps, milestone } = makeWorld([], { status: 'NOT_STARTED' });

      await service.update('m1', { title: 'Renamed' } as any, 'pm-1');

      expect(milestone.title).toBe('Renamed');
      expect(deps.canStart).not.toHaveBeenCalled();
    });
  });

  describe('forceComplete — the override, on the record', () => {
    it('refuses without a reason', async () => {
      const { service, milestone } = makeWorld([photo('ph1')]);

      const err = await refusal(() => service.forceComplete('m1', 'founder-1', '   '));

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('reason is required');
      expect(milestone.status).toBe('IN_PROGRESS');
    });

    it('completes past pending photos and stamps who, when and why', async () => {
      const { service, milestone } = makeWorld([photo('ph1'), photo('ph2')]);

      await service.forceComplete('m1', 'founder-1', '  Approver on site, work verified in person  ');

      expect(milestone.status).toBe('COMPLETED');
      expect(milestone.completedAt).toBeInstanceOf(Date);
      expect(milestone.signoffOverrideById).toBe('founder-1');
      expect(milestone.signoffOverrideAt).toBeInstanceOf(Date);
      expect(milestone.signoffOverrideReason).toBe('Approver on site, work verified in person');
    });

    it('also overrides the all-rejected case', async () => {
      const { service, milestone } = makeWorld([
        photo('ph1', { reviewStatus: 'REJECTED', reviewNote: 'blurry', reviewedAt: new Date() }),
      ]);

      await service.forceComplete('m1', 'founder-1', 'Physically inspected');

      expect(milestone.status).toBe('COMPLETED');
      expect(milestone.signoffOverrideReason).toBe('Physically inspected');
    });

    // A recorded "forced past 0 pending photos" would be a false audit record.
    it('records NO override when the gate would have passed anyway', async () => {
      const { service, milestone } = makeWorld([
        photo('ph1', { reviewStatus: 'APPROVED', reviewedAt: new Date() }),
      ]);

      await service.forceComplete('m1', 'founder-1', 'belt and braces');

      expect(milestone.status).toBe('COMPLETED');
      expect(milestone.signoffOverrideById).toBeNull();
      expect(milestone.signoffOverrideReason).toBeNull();
    });

    it('refuses on an already-complete milestone', async () => {
      const { service } = makeWorld([], { status: 'COMPLETED', completedAt: new Date() });

      const err = await refusal(() => service.forceComplete('m1', 'founder-1', 'again'));

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('already complete');
    });
  });

  describe('deletePhoto', () => {
    it('deletes a photo that is still awaiting sign-off', async () => {
      const { service, store } = makeWorld([photo('ph1')]);

      await service.deletePhoto('ph1');

      expect(store.has('ph1')).toBe(false);
    });

    it('refuses to delete a photo that carries a verdict', async () => {
      const { service, store } = makeWorld([
        photo('ph1', { reviewStatus: 'REJECTED', reviewNote: 'blurry', reviewedAt: new Date() }),
      ]);

      const err = await refusal(() => service.deletePhoto('ph1'));

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toContain('cannot be deleted');
      expect(store.has('ph1')).toBe(true);
    });
  });
});

/**
 * Regression: the dependency gate this feature sits next to. The photo gate must not have
 * changed what "Blocked by" answers.
 */
describe('MilestoneDepsService.canStart — still refuses on an unfinished dependency', () => {
  function depsWith(dependsOn: { id: string; title: string; status: string } | null) {
    const prisma: any = {
      milestone: {
        findUnique: jest.fn(() => Promise.resolve({ id: 'm2', dependsOn })),
      },
    };
    return new MilestoneDepsService(prisma, { emit: jest.fn() } as any, { log: jest.fn() } as any);
  }

  it('blocks while the dependency is not COMPLETED, naming it', async () => {
    const deps = depsWith({ id: 'm1', title: 'Foundation pour', status: 'IN_PROGRESS' });

    await expect(deps.canStart('m2')).resolves.toEqual({
      allowed: false,
      reason: 'Blocked by "Foundation pour" (status: IN_PROGRESS)',
    });
  });

  it('allows once the dependency is COMPLETED', async () => {
    const deps = depsWith({ id: 'm1', title: 'Foundation pour', status: 'COMPLETED' });
    await expect(deps.canStart('m2')).resolves.toEqual({ allowed: true });
  });

  it('allows when there is no dependency at all', async () => {
    const deps = depsWith(null);
    await expect(deps.canStart('m2')).resolves.toEqual({ allowed: true });
  });
});
