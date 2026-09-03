import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { InteriorService } from './interior.service';

const mockPrisma: any = {
  interiorProject: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  building: { findUnique: jest.fn() },
  document: { findFirst: jest.fn() },
  snagItem: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  actual: { create: jest.fn() },
  interiorInvoice: { create: jest.fn(), findFirst: jest.fn() },
  $transaction: jest.fn((cb: any) => cb(mockPrisma)),
};

const mockBus = { emit: jest.fn() };

// findById signs snag photos through the storage driver. Resolving to a fixed string keeps
// the assertions about phase/gate behaviour independent of the signer.
const mockStorage = { signedUrl: jest.fn().mockResolvedValue('https://signed.example/photo') };

function makeService() {
  return new InteriorService(mockPrisma as any, mockBus as any, mockStorage as any);
}

/** Convenience: stub findById's underlying findFirst with a project at a given phase. */
function stubProject(overrides: Record<string, any> = {}) {
  mockPrisma.interiorProject.findFirst.mockResolvedValue({
    id: 'ip1',
    phase: 'DESIGN',
    status: 'IN_PROGRESS',
    unitId: null,
    buildingId: 'b1',
    unit: null,
    contractType: 'PER_SQFT',
    ratePerSqft: null,
    area: null,
    // findById includes snags; the handover gate reads them off the loaded project.
    snags: [],
    ...overrides,
  });
}

/** A snag as findById loads it — only id + status matter to the handover gate. */
function snag(status: string, id = `s-${status}`) {
  return { id, status };
}

describe('InteriorService', () => {
  let service: InteriorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  describe('update — cancellation reversal', () => {
    it('emits interior.cancelled when status is set to CANCELLED (so TI installments revert)', async () => {
      stubProject({ status: 'IN_PROGRESS' });
      mockPrisma.interiorProject.update.mockResolvedValue({ id: 'ip1', status: 'CANCELLED' });
      await service.update('ip1', { status: 'CANCELLED' });
      expect(mockBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'interior.cancelled', interiorProjectId: 'ip1' }),
      );
    });

    it('does not emit interior.cancelled on a normal status update', async () => {
      stubProject({ status: 'IN_PROGRESS' });
      mockPrisma.interiorProject.update.mockResolvedValue({ id: 'ip1' });
      await service.update('ip1', { name: 'Renamed' });
      expect(mockBus.emit).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'interior.cancelled' }),
      );
    });
  });

  describe('createPackageTemplate — validation', () => {
    it('rejects a negative defaultRatePerSqft', async () => {
      await expect(
        service.createPackageTemplate({ name: 'Bad', defaultRatePerSqft: -5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a negative item unitPrice', async () => {
      await expect(
        service.createPackageTemplate({ name: 'Bad', items: [{ description: 'x', unitPrice: -1 }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('create — anchor validation', () => {
    it('rejects when neither unit nor building is given', async () => {
      await expect(service.create({ name: 'Fit-out' } as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when BOTH unit and building are given', async () => {
      await expect(
        service.create({ name: 'Fit-out', unitId: 'u1', buildingId: 'b1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a blank name', async () => {
      await expect(service.create({ name: '   ', unitId: 'u1' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('create — multiple concurrent projects per unit are allowed', () => {
    // Client decision 2026-07-29: reversed the earlier "one active project per unit"
    // rule. Distinct from the discovery-doc "no parallel execution" gate, which is
    // about fit-out vs. shell CONSTRUCTION timing and lives in advancePhase() —
    // covered separately by the 'advancePhase — soft parallel gate' suite below.
    it('does not reject a second project on a unit that already has an active one', async () => {
      // findFirst here is InteriorProject.findFirst — if a stray "already exists"
      // check were reintroduced it would resolve this and reject the create.
      mockPrisma.interiorProject.findFirst.mockResolvedValue({ id: 'ip-existing', name: 'Phase 1 fit-out' });
      mockPrisma.interiorProject.create.mockResolvedValue({ id: 'ip2' });

      await expect(
        service.create({ name: 'Phase 2 fit-out', unitId: 'u1' }),
      ).resolves.toEqual(expect.objectContaining({ id: 'ip2' }));
      expect(mockPrisma.interiorProject.create).toHaveBeenCalled();
    });
  });

  describe('create — per-sqft contract value', () => {
    it('computes contractValue = ratePerSqft × area for a PER_SQFT contract', async () => {
      mockPrisma.interiorProject.create.mockResolvedValue({ id: 'ip1' });
      await service.create({ name: 'Fit-out', unitId: 'u1', ratePerSqft: 5, area: 1000 });
      expect(mockPrisma.interiorProject.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ contractValue: 5000 }) }),
      );
    });

    it('honors an explicit contractValue over the computed one', async () => {
      mockPrisma.interiorProject.create.mockResolvedValue({ id: 'ip1' });
      await service.create({ name: 'Fit-out', unitId: 'u1', ratePerSqft: 5, area: 1000, contractValue: 9999 });
      expect(mockPrisma.interiorProject.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ contractValue: 9999 }) }),
      );
    });
  });

  describe('findById', () => {
    it('throws NotFound when the project does not exist', async () => {
      mockPrisma.interiorProject.findFirst.mockResolvedValue(null);
      await expect(service.findById('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('advancePhase — linear order', () => {
    it('rejects skipping a phase (DESIGN → CITY_APPROVAL)', async () => {
      stubProject({ phase: 'DESIGN' });
      await expect(service.advancePhase('ip1', 'CITY_APPROVAL', 'u')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows a legal single-step move with no gate (DESIGN → CLIENT_APPROVAL)', async () => {
      stubProject({ phase: 'DESIGN' });
      mockPrisma.interiorProject.update.mockResolvedValue({ id: 'ip1', phase: 'CLIENT_APPROVAL' });
      await service.advancePhase('ip1', 'CLIENT_APPROVAL', 'u');
      expect(mockPrisma.interiorProject.update).toHaveBeenCalled();
      expect(mockBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'interior.phaseChanged', from: 'DESIGN', to: 'CLIENT_APPROVAL' }),
      );
    });
  });

  describe('advancePhase — soft parallel gate', () => {
    it('blocks entering PROCUREMENT when the shell is not complete', async () => {
      stubProject({ phase: 'CITY_APPROVAL', buildingId: 'b1' });
      mockPrisma.building.findUnique.mockResolvedValue({ phase: 'CONSTRUCTION' });
      await expect(service.advancePhase('ip1', 'PROCUREMENT', 'u')).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.interiorProject.update).not.toHaveBeenCalled();
    });

    it('allows entering PROCUREMENT once the shell is complete', async () => {
      stubProject({ phase: 'CITY_APPROVAL', buildingId: 'b1' });
      mockPrisma.building.findUnique.mockResolvedValue({ phase: 'STABILIZED' });
      mockPrisma.interiorProject.update.mockResolvedValue({ id: 'ip1', phase: 'PROCUREMENT' });
      await service.advancePhase('ip1', 'PROCUREMENT', 'u');
      expect(mockPrisma.interiorProject.update).toHaveBeenCalled();
    });

    it('resolves shell phase via the unit when anchored to a unit', async () => {
      stubProject({ phase: 'CITY_APPROVAL', buildingId: null, unit: { buildingId: 'b9' } });
      mockPrisma.building.findUnique.mockResolvedValue({ phase: 'LEASE_UP' });
      mockPrisma.interiorProject.update.mockResolvedValue({ id: 'ip1', phase: 'PROCUREMENT' });
      await service.advancePhase('ip1', 'PROCUREMENT', 'u');
      expect(mockPrisma.building.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'b9' } }),
      );
      expect(mockPrisma.interiorProject.update).toHaveBeenCalled();
    });
  });

  describe('advancePhase — document gates', () => {
    it('blocks EXECUTION without a CITY_APPROVAL document', async () => {
      stubProject({ phase: 'PROCUREMENT', buildingId: 'b1' });
      mockPrisma.building.findUnique.mockResolvedValue({ phase: 'STABILIZED' }); // shell ok
      mockPrisma.document.findFirst.mockResolvedValue(null); // no city-approval doc
      await expect(service.advancePhase('ip1', 'EXECUTION', 'u')).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows EXECUTION when the CITY_APPROVAL document is on file', async () => {
      stubProject({ phase: 'PROCUREMENT', buildingId: 'b1' });
      mockPrisma.building.findUnique.mockResolvedValue({ phase: 'STABILIZED' });
      mockPrisma.document.findFirst.mockResolvedValue({ id: 'doc1' });
      mockPrisma.interiorProject.update.mockResolvedValue({ id: 'ip1', phase: 'EXECUTION' });
      await service.advancePhase('ip1', 'EXECUTION', 'u');
      expect(mockPrisma.document.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ category: 'CITY_APPROVAL' }) }),
      );
      expect(mockPrisma.interiorProject.update).toHaveBeenCalled();
    });

    it('blocks HANDOVER without a HANDOVER_CERTIFICATE document', async () => {
      stubProject({ phase: 'SNAGGING', buildingId: 'b1' });
      mockPrisma.document.findFirst.mockResolvedValue(null);
      await expect(service.advancePhase('ip1', 'HANDOVER', 'u')).rejects.toBeInstanceOf(ConflictException);
    });

    it('on HANDOVER: stamps handoverAt, marks COMPLETED, and emits handedOver', async () => {
      const at = new Date('2026-06-02T00:00:00Z');
      stubProject({ phase: 'SNAGGING', buildingId: 'b1', unitId: 'u1' });
      mockPrisma.document.findFirst.mockResolvedValue({ id: 'cert1' });
      mockPrisma.interiorProject.update.mockResolvedValue({ id: 'ip1', phase: 'HANDOVER', handoverAt: at });
      await service.advancePhase('ip1', 'HANDOVER', 'u');
      expect(mockPrisma.interiorProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ phase: 'HANDOVER', status: 'COMPLETED' }),
        }),
      );
      expect(mockBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'interior.handedOver' }));
    });
  });

  // ─────── C5: an "after" photo is required to resolve a snag ───────

  describe('resolveSnag — proof of fix required', () => {
    it('refuses to resolve without an after photo', async () => {
      mockPrisma.snagItem.findUnique.mockResolvedValue({
        id: 's1', status: 'OPEN', photoPath: 'before.jpg', afterPhotoPath: null,
      });
      await expect(service.resolveSnag('s1')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.resolveSnag('s1', { afterPhotoPath: '  ' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockPrisma.snagItem.update).not.toHaveBeenCalled();
    });

    it('resolves when an after photo is supplied', async () => {
      mockPrisma.snagItem.findUnique.mockResolvedValue({
        id: 's1', status: 'OPEN', photoPath: 'before.jpg', afterPhotoPath: null,
      });
      mockPrisma.snagItem.update.mockImplementation((args: any) => Promise.resolve(args.data));
      await service.resolveSnag('s1', { afterPhotoPath: 'after.jpg' });
      expect(mockPrisma.snagItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 's1' },
          data: expect.objectContaining({ status: 'RESOLVED', afterPhotoPath: 'after.jpg' }),
        }),
      );
    });

    it('leaves the BEFORE photo intact — the pair is the evidence', async () => {
      mockPrisma.snagItem.findUnique.mockResolvedValue({
        id: 's1', status: 'OPEN', photoPath: 'before.jpg', afterPhotoPath: null,
      });
      mockPrisma.snagItem.update.mockImplementation((args: any) => Promise.resolve(args.data));
      await service.resolveSnag('s1', { afterPhotoPath: 'after.jpg' });
      const { data } = mockPrisma.snagItem.update.mock.calls[0][0];
      expect(data).not.toHaveProperty('photoPath');
    });

    it('accepts an after photo already on the record (idempotent re-resolve)', async () => {
      mockPrisma.snagItem.findUnique.mockResolvedValue({
        id: 's1', status: 'RESOLVED', photoPath: 'before.jpg', afterPhotoPath: 'after.jpg',
      });
      mockPrisma.snagItem.update.mockImplementation((args: any) => Promise.resolve(args.data));
      await expect(service.resolveSnag('s1')).resolves.toEqual(
        expect.objectContaining({ afterPhotoPath: 'after.jpg' }),
      );
    });

    it('throws NotFound for an unknown snag', async () => {
      mockPrisma.snagItem.findUnique.mockResolvedValue(null);
      await expect(service.resolveSnag('nope', { afterPhotoPath: 'a.jpg' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateSnag — the same proof gate, and the reopen decision', () => {
    it('refuses status=RESOLVED without an after photo (no back door around resolveSnag)', async () => {
      mockPrisma.snagItem.findUnique.mockResolvedValue({
        id: 's1', status: 'OPEN', photoPath: 'before.jpg', afterPhotoPath: null,
      });
      await expect(service.updateSnag('s1', { status: 'RESOLVED' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockPrisma.snagItem.update).not.toHaveBeenCalled();
    });

    it('allows status=RESOLVED when the after photo comes with it', async () => {
      mockPrisma.snagItem.findUnique.mockResolvedValue({
        id: 's1', status: 'IN_PROGRESS', photoPath: 'before.jpg', afterPhotoPath: null,
      });
      mockPrisma.snagItem.update.mockImplementation((args: any) => Promise.resolve(args.data));
      await service.updateSnag('s1', { status: 'RESOLVED', afterPhotoPath: 'after.jpg' });
      expect(mockPrisma.snagItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'RESOLVED', afterPhotoPath: 'after.jpg' }),
        }),
      );
    });

    // Decision: reopening RETIRES the proof-of-fix photo. A photo captioned "proof of fix"
    // on an item that demonstrably is not fixed is a false record, and keeping it would let
    // the next resolve satisfy the gate with a stale image instead of new work. The before
    // shot is never touched, and only the pointer is cleared — the object still exists.
    it('clears the after photo (and resolvedAt) when a resolved snag is reopened', async () => {
      mockPrisma.snagItem.findUnique.mockResolvedValue({
        id: 's1', status: 'RESOLVED', photoPath: 'before.jpg', afterPhotoPath: 'after.jpg',
      });
      mockPrisma.snagItem.update.mockImplementation((args: any) => Promise.resolve(args.data));
      await service.updateSnag('s1', { status: 'OPEN' });
      expect(mockPrisma.snagItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'OPEN', afterPhotoPath: null, resolvedAt: null }),
        }),
      );
      const { data } = mockPrisma.snagItem.update.mock.calls[0][0];
      expect(data).not.toHaveProperty('photoPath'); // the "before" shot survives a reopen too
    });

    it('also clears it when reopened to IN_PROGRESS, not just OPEN', async () => {
      mockPrisma.snagItem.findUnique.mockResolvedValue({
        id: 's1', status: 'RESOLVED', photoPath: 'before.jpg', afterPhotoPath: 'after.jpg',
      });
      mockPrisma.snagItem.update.mockImplementation((args: any) => Promise.resolve(args.data));
      await service.updateSnag('s1', { status: 'IN_PROGRESS' });
      expect(mockPrisma.snagItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ afterPhotoPath: null, resolvedAt: null }),
        }),
      );
    });

    it('so a re-fix needs its OWN proof — re-resolving after a reopen is refused', async () => {
      mockPrisma.snagItem.findUnique.mockResolvedValue({
        id: 's1', status: 'OPEN', photoPath: 'before.jpg', afterPhotoPath: null, // cleared by reopen
      });
      await expect(service.resolveSnag('s1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not touch status/photos on a plain field edit', async () => {
      mockPrisma.snagItem.findUnique.mockResolvedValue({
        id: 's1', status: 'RESOLVED', photoPath: 'before.jpg', afterPhotoPath: 'after.jpg',
      });
      mockPrisma.snagItem.update.mockImplementation((args: any) => Promise.resolve(args.data));
      await service.updateSnag('s1', { room: 'Kitchen' });
      const { data } = mockPrisma.snagItem.update.mock.calls[0][0];
      expect(data).toEqual({ room: 'Kitchen' });
    });
  });

  // ─────── C1: open snags block handover ───────

  describe('advancePhase — open snags block HANDOVER', () => {
    /** SNAGGING → HANDOVER with the certificate on file; only snags are in question. */
    function stubReadyForHandover(snags: Array<{ id: string; status: string }>) {
      stubProject({ phase: 'SNAGGING', buildingId: 'b1', unitId: 'u1', snags });
      mockPrisma.document.findFirst.mockResolvedValue({ id: 'cert1' });
      mockPrisma.interiorProject.update.mockResolvedValue({ id: 'ip1', phase: 'HANDOVER' });
    }

    it('blocks handover while a snag is OPEN', async () => {
      stubReadyForHandover([snag('OPEN')]);
      await expect(service.advancePhase('ip1', 'HANDOVER', 'u')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockPrisma.interiorProject.update).not.toHaveBeenCalled();
    });

    it('counts IN_PROGRESS as still open — work started is not work finished', async () => {
      stubReadyForHandover([snag('IN_PROGRESS')]);
      await expect(service.advancePhase('ip1', 'HANDOVER', 'u')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('names the open count and the way out in the refusal', async () => {
      stubReadyForHandover([snag('OPEN', 's1'), snag('IN_PROGRESS', 's2'), snag('RESOLVED', 's3')]);
      await expect(service.advancePhase('ip1', 'HANDOVER', 'u')).rejects.toThrow(
        /2 punch-list items still open/,
      );
      await expect(service.advancePhase('ip1', 'HANDOVER', 'u')).rejects.toThrow(/forceReason/);
    });

    it('uses the singular for exactly one open item', async () => {
      stubReadyForHandover([snag('OPEN')]);
      await expect(service.advancePhase('ip1', 'HANDOVER', 'u')).rejects.toThrow(
        /1 punch-list item still open/,
      );
    });

    it('allows handover once every snag is RESOLVED', async () => {
      stubReadyForHandover([snag('RESOLVED', 's1'), snag('RESOLVED', 's2')]);
      await service.advancePhase('ip1', 'HANDOVER', 'u');
      expect(mockPrisma.interiorProject.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ phase: 'HANDOVER' }) }),
      );
    });

    it('allows handover on a project with no snags at all', async () => {
      stubReadyForHandover([]);
      await service.advancePhase('ip1', 'HANDOVER', 'u');
      expect(mockPrisma.interiorProject.update).toHaveBeenCalled();
      expect(mockBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'interior.handedOver' }),
      );
    });

    it('does not gate any phase other than HANDOVER on snags', async () => {
      stubProject({ phase: 'EXECUTION', buildingId: 'b1', snags: [snag('OPEN')] });
      mockPrisma.interiorProject.update.mockResolvedValue({ id: 'ip1', phase: 'SNAGGING' });
      await service.advancePhase('ip1', 'SNAGGING', 'u');
      expect(mockPrisma.interiorProject.update).toHaveBeenCalled();
    });
  });

  describe('advancePhase — the forced-handover escape hatch', () => {
    function stubReadyForHandover(snags: Array<{ id: string; status: string }>) {
      stubProject({ phase: 'SNAGGING', buildingId: 'b1', unitId: 'u1', snags });
      mockPrisma.document.findFirst.mockResolvedValue({ id: 'cert1' });
      mockPrisma.interiorProject.update.mockResolvedValue({ id: 'ip1', phase: 'HANDOVER' });
    }

    it('rejects force without a reason (the reason IS the control)', async () => {
      stubReadyForHandover([snag('OPEN')]);
      await expect(
        service.advancePhase('ip1', 'HANDOVER', 'u', { force: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.advancePhase('ip1', 'HANDOVER', 'u', { force: true, forceReason: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.interiorProject.update).not.toHaveBeenCalled();
    });

    it('hands over with force + reason, and records the reason on the project', async () => {
      stubReadyForHandover([snag('OPEN', 's1'), snag('OPEN', 's2')]);
      await service.advancePhase('ip1', 'HANDOVER', 'u', {
        force: true,
        forceReason: 'Cosmetic scuff; contractor demobilised, buyer accepted in writing',
      });
      expect(mockPrisma.interiorProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phase: 'HANDOVER',
            status: 'COMPLETED',
            handoverNotes:
              'Handover forced with 2 open snags: Cosmetic scuff; contractor demobilised, buyer accepted in writing',
          }),
        }),
      );
      expect(mockBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'interior.handedOver' }),
      );
    });

    it('keeps the sign-off notes, with the forced stamp leading so it cannot be buried', async () => {
      stubReadyForHandover([snag('OPEN')]);
      await service.advancePhase('ip1', 'HANDOVER', 'u', {
        force: true,
        forceReason: 'Door handle on order',
        handoverSignedBy: 'A. Buyer',
        handoverNotes: 'Keys handed over on site',
      });
      expect(mockPrisma.interiorProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            handoverSignedBy: 'A. Buyer',
            handoverNotes:
              'Handover forced with 1 open snag: Door handle on order\nKeys handed over on site',
          }),
        }),
      );
    });

    it('does not stamp anything when nothing was actually forced', async () => {
      stubReadyForHandover([snag('RESOLVED')]);
      await service.advancePhase('ip1', 'HANDOVER', 'u', {
        force: true,
        forceReason: 'unused',
        handoverNotes: 'Clean handover',
      });
      expect(mockPrisma.interiorProject.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ handoverNotes: 'Clean handover' }) }),
      );
    });

    it('cannot force past the HANDOVER_CERTIFICATE document gate (regression)', async () => {
      stubProject({ phase: 'SNAGGING', buildingId: 'b1', snags: [] });
      mockPrisma.document.findFirst.mockResolvedValue(null);
      await expect(
        service.advancePhase('ip1', 'HANDOVER', 'u', { force: true, forceReason: 'in a hurry' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.interiorProject.update).not.toHaveBeenCalled();
    });

    it('cannot force past the CITY_APPROVAL document gate either (regression)', async () => {
      stubProject({ phase: 'PROCUREMENT', buildingId: 'b1', snags: [] });
      mockPrisma.building.findUnique.mockResolvedValue({ phase: 'STABILIZED' });
      mockPrisma.document.findFirst.mockResolvedValue(null);
      await expect(
        service.advancePhase('ip1', 'EXECUTION', 'u', { force: true, forceReason: 'in a hurry' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('cannot force past the shell-complete gate either (regression)', async () => {
      stubProject({ phase: 'CITY_APPROVAL', buildingId: 'b1', snags: [] });
      mockPrisma.building.findUnique.mockResolvedValue({ phase: 'CONSTRUCTION' });
      await expect(
        service.advancePhase('ip1', 'PROCUREMENT', 'u', { force: true, forceReason: 'in a hurry' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('addInvoice — pairs an Actual in one transaction', () => {
    it('creates an Actual (tagged to the project) and links it via InteriorInvoice.actualId', async () => {
      mockPrisma.interiorProject.findFirst.mockResolvedValue({
        id: 'ip1',
        building: { projectId: 'pr1' },
        unit: null,
      });
      mockPrisma.actual.create.mockResolvedValue({ id: 'act1' });
      mockPrisma.interiorInvoice.create.mockImplementation((args: any) => Promise.resolve(args.data));

      await service.addInvoice('ip1', { vendorId: 'v1', amount: 2500, invoiceNo: 'INV-9' });

      expect(mockPrisma.actual.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ projectId: 'pr1', category: 'OTHER', amount: 2500 }) }),
      );
      expect(mockPrisma.interiorInvoice.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ actualId: 'act1', vendorId: 'v1' }) }),
      );
    });

    it('rejects a non-positive invoice amount', async () => {
      await expect(service.addInvoice('ip1', { vendorId: 'v1', amount: 0 })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a duplicate invoiceNo for the same interior project (idempotency)', async () => {
      mockPrisma.interiorProject.findFirst.mockResolvedValue({ id: 'ip1', building: { projectId: 'pr1' }, unit: null });
      mockPrisma.interiorInvoice.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(
        service.addInvoice('ip1', { vendorId: 'v1', amount: 2500, invoiceNo: 'INV-9' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.actual.create).not.toHaveBeenCalled();
    });

    it('resolves the project via the unit when not building-anchored', async () => {
      mockPrisma.interiorProject.findFirst.mockResolvedValue({
        id: 'ip1',
        building: null,
        unit: { building: { projectId: 'pr9' } },
      });
      mockPrisma.actual.create.mockResolvedValue({ id: 'act2' });
      mockPrisma.interiorInvoice.create.mockImplementation((args: any) => Promise.resolve(args.data));
      await service.addInvoice('ip1', { vendorId: 'v1', amount: 100 });
      expect(mockPrisma.actual.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ projectId: 'pr9' }) }),
      );
    });
  });
});
