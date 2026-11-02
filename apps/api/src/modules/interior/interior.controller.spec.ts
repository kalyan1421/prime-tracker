import { ForbiddenException } from '@nestjs/common';
import { InteriorController } from './interior.controller';

/**
 * The total budget is money. The PATCH / POST routes only need interior:edit, so the
 * controller adds the finance check for a body that actually carries the field — and ONLY
 * then, so a non-finance editor can still rename a fit-out or move its dates.
 */
describe('InteriorController — total budget gate', () => {
  const service = { create: jest.fn().mockResolvedValue({ id: 'ip1' }), update: jest.fn().mockResolvedValue({ id: 'ip1' }) };
  const controller = new InteriorController(service as any, {} as any, {} as any);
  const EDITOR = ['interior:view', 'interior:edit'];
  const FINANCE_EDITOR = [...EDITOR, 'interior:finance'];

  beforeEach(() => jest.clearAllMocks());

  it('refuses to set the budget on update without finance, and writes nothing', () => {
    expect(() => controller.update('ip1', { totalBudget: 100_000 } as any, 'u1', EDITOR)).toThrow(ForbiddenException);
    expect(service.update).not.toHaveBeenCalled();
  });

  it('refuses to CLEAR it without finance too (null is a change, not an absence)', () => {
    expect(() => controller.update('ip1', { totalBudget: null } as any, 'u1', EDITOR)).toThrow(ForbiddenException);
    expect(service.update).not.toHaveBeenCalled();
  });

  it('refuses it on create without finance', () => {
    expect(() => controller.create({ name: 'x', unitId: 'u', totalBudget: 5 } as any, 'u1', EDITOR)).toThrow(ForbiddenException);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('lets finance set it, passing the actor through for the activity log', async () => {
    await controller.update('ip1', { totalBudget: 100_000 } as any, 'u1', FINANCE_EDITOR);
    expect(service.update).toHaveBeenCalledWith('ip1', { totalBudget: 100_000 }, 'u1');
    await controller.create({ name: 'x', unitId: 'u', totalBudget: 5 } as any, 'u1', FINANCE_EDITOR);
    expect(service.create).toHaveBeenCalledWith({ name: 'x', unitId: 'u', totalBudget: 5 }, 'u1');
  });

  it('leaves every other edit alone for a non-finance editor', async () => {
    await controller.update('ip1', { name: 'Renamed', targetEnd: '2027-01-01' } as any, 'u1', EDITOR);
    expect(service.update).toHaveBeenCalledWith('ip1', { name: 'Renamed', targetEnd: '2027-01-01' }, 'u1');
    await controller.create({ name: 'x', unitId: 'u' } as any, 'u1', EDITOR);
    expect(service.create).toHaveBeenCalled();
  });

  it('treats a missing permission list as no permissions', () => {
    expect(() => controller.update('ip1', { totalBudget: 1 } as any, 'u1', undefined)).toThrow(ForbiddenException);
  });
});
