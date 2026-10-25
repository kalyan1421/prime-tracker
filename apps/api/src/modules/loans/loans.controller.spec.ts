import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import { LoansController } from './loans.controller';
import { PERMISSIONS_KEY } from '../../common/decorators/index';

/**
 * PATCH /loans/draws/:drawId/status — the deprecated route that let draw:edit approve or
 * fund a draw. The state-machine rules themselves are pinned in draws.service.spec.ts; this
 * pins the wiring: the route hands the caller's real draw:approve to transitionTo, and no
 * longer writes the status itself.
 */
function make() {
  const draws = {
    transitionTo: jest.fn().mockResolvedValue({}),
    findById: jest.fn().mockResolvedValue({ id: 'd1', status: 'SUBMITTED' }),
  };
  const loans = {};
  const controller = new LoansController(loans as any, draws as any, {} as any);
  return { controller, draws, loans };
}

describe('LoansController — legacy draw status route', () => {
  it('passes canApprove=false for a draw:edit-only caller (a PROJECT_MANAGER)', async () => {
    const { controller, draws } = make();
    await controller.updateDrawStatus('d1', { status: 'FUNDED' } as any, 'pm-1', ['draw:view', 'draw:edit']);
    expect(draws.transitionTo).toHaveBeenCalledWith('d1', 'FUNDED', 'pm-1', expect.objectContaining({ canApprove: false }));
  });

  it('passes canApprove=true, the amount and the reason for an approver', async () => {
    const { controller, draws } = make();
    await controller.updateDrawStatus(
      'd1', { status: 'APPROVED', approvedAmount: 100, rejectionReason: undefined } as any, 'f-1',
      ['draw:edit', 'draw:approve'],
    );
    expect(draws.transitionTo).toHaveBeenCalledWith('d1', 'APPROVED', 'f-1', { canApprove: true, approvedAmount: 100, rejectionReason: undefined });
  });

  it('surfaces the state machine\'s refusal instead of writing anything', async () => {
    const { controller, draws } = make();
    draws.transitionTo.mockRejectedValue(new ForbiddenException('Missing permissions: draw:approve'));
    await expect(controller.updateDrawStatus('d1', { status: 'APPROVED' } as any, 'pm-1', ['draw:edit']))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(draws.findById).not.toHaveBeenCalled();
  });

  it('returns the draw, with loan financials only for a caller who may see them', async () => {
    const { controller, draws } = make();
    await controller.updateDrawStatus('d1', { status: 'SUBMITTED' } as any, 'pm-1', ['draw:edit']);
    expect(draws.findById).toHaveBeenLastCalledWith('d1', false);
    await controller.updateDrawStatus('d1', { status: 'SUBMITTED' } as any, 'f-1', ['draw:edit', 'loan:view']);
    expect(draws.findById).toHaveBeenLastCalledWith('d1', true);
  });

  it('names draw and schedule ids so the guard resolves them — not as a loan\'s :id', () => {
    const reflector = new Reflector();
    const proto = LoansController.prototype as any;
    const path = (h: string) => reflector.get(PATH_METADATA, proto[h]);
    expect(path('updateDraw')).toBe('draws/:drawId');
    expect(path('updateDrawStatus')).toBe('draws/:drawId/status');
    expect(path('deleteDraw')).toBe('draws/:drawId');
    expect(path('deleteDrawScheduleLine')).toBe('schedule/:scheduleId');
    // Unchanged: still draw:edit at the door — the approval check is per target status.
    expect(reflector.get(PERMISSIONS_KEY, proto.updateDrawStatus)).toEqual(['draw:edit']);
  });
});
