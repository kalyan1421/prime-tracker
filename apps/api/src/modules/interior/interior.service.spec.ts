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
  actual: { create: jest.fn() },
  interiorInvoice: { create: jest.fn(), findFirst: jest.fn() },
  $transaction: jest.fn((cb: any) => cb(mockPrisma)),
};

const mockBus = { emit: jest.fn() };

function makeService() {
  return new InteriorService(mockPrisma as any, mockBus as any);
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
    ...overrides,
  });
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
