import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UnitsService } from './units.service';

const mockPrisma: any = {
  unit: { findUnique: jest.fn(), update: jest.fn() },
  user: { findMany: jest.fn() },
  customOption: { findFirst: jest.fn() },
  unitAssignee: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
  $transaction: jest.fn((arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg))),
};

const mockCustomOptions = {
  getSystemDefaults: () => ({
    site_priority: [{ value: 'LOW' }, { value: 'MEDIUM' }, { value: 'HIGH' }],
    work_type: [{ value: 'SHELL' }, { value: 'INTERIOR_FINISHOUT' }, { value: 'PERMIT' }],
  }),
};

function makeService() {
  const svc = new UnitsService(
    mockPrisma as any,
    { listProjectScope: async () => undefined } as any,
    { decryptLoan: (l: any) => l, decryptLoans: (l: any[]) => l ?? [] } as any,
    { record: jest.fn() } as any,
    mockCustomOptions as any,
  );
  // findById re-reads the row with a large include; the Site Tracker assertions are all
  // about what was WRITTEN, so stub the read-back rather than model that whole shape.
  jest.spyOn(svc, 'findById').mockResolvedValue({ id: 'u1' } as any);
  return svc;
}

/** The unit as it exists before the call under test. */
function existing(over: Record<string, unknown> = {}) {
  mockPrisma.unit.findUnique.mockResolvedValue({
    id: 'u1', deletedAt: null, blockerStatus: null, blockerReason: null, ...over,
  });
}

const writtenData = () => mockPrisma.unit.update.mock.calls[0][0].data;

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.customOption.findFirst.mockResolvedValue(null);
});

describe('UnitsService.updateSiteTracker — blocker', () => {
  it('stamps blockerSince when a unit first becomes blocked', async () => {
    existing({ blockerStatus: 'NO' });
    await makeService().updateSiteTracker('u1', { blockerStatus: 'YES', blockerReason: 'City comments' });
    const data = writtenData();
    expect(data.blockerStatus).toBe('YES');
    expect(data.blockerReason).toBe('City comments');
    expect(data.blockerSince).toBeInstanceOf(Date);
  });

  it('refuses YES with no reason — an unexplained blocker is unactionable', async () => {
    existing({ blockerStatus: 'NO' });
    await expect(
      makeService().updateSiteTracker('u1', { blockerStatus: 'YES' }),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.unit.update).not.toHaveBeenCalled();
  });

  it('refuses YES when the reason is only whitespace', async () => {
    existing({ blockerStatus: 'NO' });
    await expect(
      makeService().updateSiteTracker('u1', { blockerStatus: 'YES', blockerReason: '   ' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts YES when the unit already carries a reason from before', async () => {
    existing({ blockerStatus: 'NO', blockerReason: 'Waiting on the city' });
    await makeService().updateSiteTracker('u1', { blockerStatus: 'YES' });
    expect(writtenData().blockerStatus).toBe('YES');
  });

  it('does NOT restart the clock when an already-blocked unit is re-flagged', async () => {
    // Blocker AGE is the number worth looking at. Resetting it on every edit of the reason
    // would quietly hide the oldest problems — which is the whole point of the field.
    existing({ blockerStatus: 'YES', blockerReason: 'Old reason' });
    await makeService().updateSiteTracker('u1', { blockerStatus: 'YES', blockerReason: 'Sharper reason' });
    const data = writtenData();
    expect(data).not.toHaveProperty('blockerSince');
    expect(data.blockerReason).toBe('Sharper reason');
  });

  it('clears blockerSince and the reason when a unit is unblocked', async () => {
    existing({ blockerStatus: 'YES', blockerReason: 'City comments' });
    await makeService().updateSiteTracker('u1', { blockerStatus: 'NO' });
    const data = writtenData();
    expect(data.blockerStatus).toBe('NO');
    expect(data.blockerSince).toBeNull();
    expect(data.blockerReason).toBeNull();
  });

  it('keeps a reason supplied in the same call that unblocks', async () => {
    existing({ blockerStatus: 'YES', blockerReason: 'City comments' });
    await makeService().updateSiteTracker('u1', {
      blockerStatus: 'NO', blockerReason: 'Resolved — permit approved',
    });
    expect(writtenData().blockerReason).toBe('Resolved — permit approved');
  });

  it('treats null as a real third state, distinct from NO', async () => {
    // "Nobody has assessed this unit" is not the same claim as "this unit is not blocked".
    existing({ blockerStatus: 'YES', blockerReason: 'x' });
    await makeService().updateSiteTracker('u1', { blockerStatus: null });
    const data = writtenData();
    expect(data.blockerStatus).toBeNull();
    expect(data.blockerSince).toBeNull();
  });
});

describe('UnitsService.updateSiteTracker — option validation', () => {
  it('rejects a site priority outside the option set', async () => {
    existing();
    await expect(
      makeService().updateSiteTracker('u1', { sitePriority: 'URGENT' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects DONE as a priority — completion is not a priority', async () => {
    // The source board's PRIORITY column carries a DONE value and marks LOW as its "done"
    // colour, so its own group battery reports the wrong number. Not ported.
    existing();
    await expect(
      makeService().updateSiteTracker('u1', { sitePriority: 'DONE' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a value an org added via CustomOption', async () => {
    existing();
    mockPrisma.customOption.findFirst.mockResolvedValue({ id: 'opt1' });
    await makeService().updateSiteTracker('u1', { sitePriority: 'CRITICAL' });
    expect(writtenData().sitePriority).toBe('CRITICAL');
  });

  it('rejects an unknown work type', async () => {
    existing();
    await expect(
      makeService().updateSiteTracker('u1', { workType: 'DEMOLITION' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows clearing a field with null without hitting validation', async () => {
    existing();
    await makeService().updateSiteTracker('u1', { workType: null, sitePriority: null });
    const data = writtenData();
    expect(data.workType).toBeNull();
    expect(data.sitePriority).toBeNull();
  });

  it('writes nothing when the payload is empty', async () => {
    existing();
    await makeService().updateSiteTracker('u1', {});
    expect(mockPrisma.unit.update).not.toHaveBeenCalled();
  });

  it('404s on a soft-deleted unit', async () => {
    existing({ deletedAt: new Date() });
    await expect(
      makeService().updateSiteTracker('u1', { sitePriority: 'HIGH' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('UnitsService.setAssignees', () => {
  it('replaces the whole set', async () => {
    existing();
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    mockPrisma.unitAssignee.findMany.mockResolvedValue([]);
    await makeService().setAssignees('u1', ['a', 'b'], 'actor');
    expect(mockPrisma.unitAssignee.deleteMany).toHaveBeenCalledWith({ where: { unitId: 'u1' } });
    expect(mockPrisma.unitAssignee.createMany).toHaveBeenCalledWith({
      data: [
        { unitId: 'u1', userId: 'a', assignedById: 'actor' },
        { unitId: 'u1', userId: 'b', assignedById: 'actor' },
      ],
    });
  });

  it('clears without a createMany when given an empty list', async () => {
    existing();
    mockPrisma.unitAssignee.findMany.mockResolvedValue([]);
    await makeService().setAssignees('u1', []);
    expect(mockPrisma.unitAssignee.deleteMany).toHaveBeenCalled();
    expect(mockPrisma.unitAssignee.createMany).not.toHaveBeenCalled();
  });

  it('de-duplicates a repeated id rather than failing on the composite key', async () => {
    existing();
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'a' }]);
    mockPrisma.unitAssignee.findMany.mockResolvedValue([]);
    await makeService().setAssignees('u1', ['a', 'a']);
    expect(mockPrisma.unitAssignee.createMany).toHaveBeenCalledWith({
      data: [{ unitId: 'u1', userId: 'a', assignedById: null }],
    });
  });

  it('rejects an inactive or unknown user, naming them', async () => {
    existing();
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'a' }]);
    await expect(makeService().setAssignees('u1', ['a', 'ghost'])).rejects.toThrow(/ghost/);
    expect(mockPrisma.unitAssignee.deleteMany).not.toHaveBeenCalled();
  });
});
