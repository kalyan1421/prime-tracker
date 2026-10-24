import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DrawsService } from './draws.service';
import { actionReaching, APPROVAL_ACTIONS, DRAW_TRANSITIONS } from './draw-state-machine';

/**
 * The legacy PATCH /loans/draws/:id/status route, now driven through the state machine.
 *
 * Before the 24 Oct 2026 audit fix that route wrote `status` straight onto the row behind
 * nothing but draw:edit — which PROJECT_MANAGER holds — so a PM could take a draft to
 * APPROVED with any approvedAmount, or to FUNDED, which posts an Actual. transitionTo is
 * what it calls now; these tests pin that it can only do what /draws/:id/* can.
 *
 * The world is one draw and its documents, held in memory.
 */
const ALL_DOCS = ['LIEN_WAIVER', 'INSPECTION_REPORT', 'SWORN_STATEMENT', 'VENDOR_INVOICE'];

function makeWorld(status: string, docTypes: string[] = ALL_DOCS) {
  const draw: any = {
    id: 'd1', loanId: 'loan-1', projectId: 'p1', status,
    amount: 50000, approvedAmount: null, loan: null, approvals: [], documents: [],
  };
  const approvals: any[] = [];
  const prisma: any = {
    drawRequest: {
      findUnique: jest.fn(async () => ({ ...draw })),
      update: jest.fn(async ({ data }: any) => Object.assign(draw, data)),
    },
    drawApproval: { create: jest.fn(async ({ data }: any) => { approvals.push(data); return data; }) },
    drawDocument: { findMany: jest.fn(async () => docTypes.map((documentType) => ({ documentType }))) },
    $transaction: jest.fn(async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma))),
  };
  const bus = { emit: jest.fn() };
  const service = new DrawsService(prisma, bus as any, { decryptLoan: (l: any) => l } as any);
  return { draw, approvals, prisma, bus, service };
}

const EDIT_ONLY = { canApprove: false };
const APPROVER = { canApprove: true };

describe('draw state machine helpers', () => {
  it('finds the single action that reaches a status, or none', () => {
    expect(actionReaching('DRAFT', 'SUBMITTED')).toBe('submit');
    expect(actionReaching('SUBMITTED', 'APPROVED')).toBe('approveInternal');
    expect(actionReaching('APPROVED', 'FUNDED')).toBe('markFunded');
    expect(actionReaching('SUBMITTED', 'DRAFT')).toBe('returnForInfo');
    expect(actionReaching('REJECTED', 'DRAFT')).toBe('revise');
    // The jumps the legacy route used to allow.
    expect(actionReaching('DRAFT', 'APPROVED')).toBeNull();
    expect(actionReaching('DRAFT', 'FUNDED')).toBeNull();
    expect(actionReaching('FUNDED', 'DRAFT')).toBeNull();
  });

  it('reaches every (from, to) pair by at most one action, so a target status is unambiguous', () => {
    for (const edges of Object.values(DRAW_TRANSITIONS)) {
      const targets = Object.values(edges).map((t) => t!.to);
      expect(new Set(targets).size).toBe(targets.length);
    }
  });

  it('treats approve, fund and reject as the approval steps', () => {
    expect([...APPROVAL_ACTIONS].sort()).toEqual(['approveInternal', 'markFunded', 'reject']);
  });
});

describe('DrawsService.transitionTo — draw:edit alone cannot approve or fund', () => {
  it('refuses APPROVED without draw:approve, and writes nothing', async () => {
    const w = makeWorld('SUBMITTED');
    await expect(w.service.transitionTo('d1', 'APPROVED', 'pm-1', { ...EDIT_ONLY, approvedAmount: 1 }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(w.prisma.drawRequest.update).not.toHaveBeenCalled();
    expect(w.draw.status).toBe('SUBMITTED');
  });

  it('refuses FUNDED without draw:approve, and posts no Actual', async () => {
    const w = makeWorld('APPROVED');
    await expect(w.service.transitionTo('d1', 'FUNDED', 'pm-1', EDIT_ONLY))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(w.bus.emit).not.toHaveBeenCalled();
    expect(w.draw.status).toBe('APPROVED');
  });

  it('refuses REJECTED without draw:approve — it is an approval step on /draws/:id too', async () => {
    const w = makeWorld('SUBMITTED');
    await expect(w.service.transitionTo('d1', 'REJECTED', 'pm-1', { ...EDIT_ONLY, rejectionReason: 'x' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a jump the machine has no edge for, even for an approver', async () => {
    const w = makeWorld('DRAFT');
    await expect(w.service.transitionTo('d1', 'FUNDED', 'founder-1', APPROVER))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(w.service.transitionTo('d1', 'APPROVED', 'founder-1', APPROVER))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(w.prisma.drawRequest.update).not.toHaveBeenCalled();
  });

  it('cannot reopen a funded draw', async () => {
    const w = makeWorld('FUNDED');
    await expect(w.service.transitionTo('d1', 'DRAFT', 'pm-1', EDIT_ONLY)).rejects.toBeInstanceOf(BadRequestException);
    await expect(w.service.transitionTo('d1', 'CANCELLED', 'pm-1', EDIT_ONLY)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DrawsService.transitionTo — the permitted moves run the machine\'s own methods', () => {
  it('approves with draw:approve, recording the amount, the approver and an approval-log row', async () => {
    const w = makeWorld('SUBMITTED');
    await w.service.transitionTo('d1', 'APPROVED', 'founder-1', { ...APPROVER, approvedAmount: 42000 });
    expect(w.draw).toMatchObject({ status: 'APPROVED', approvedAmount: 42000, approvedById: 'founder-1' });
    expect(w.draw.approvedDate).toBeInstanceOf(Date);
    expect(w.approvals).toEqual([expect.objectContaining({ step: 'INTERNAL_FOUNDER', action: 'APPROVED', actorId: 'founder-1' })]);
    expect(w.bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'drawRequest.approved' }));
  });

  it('still enforces the document gate on approval — the legacy route used to skip it', async () => {
    const w = makeWorld('SUBMITTED', ['SWORN_STATEMENT', 'VENDOR_INVOICE']);
    await expect(w.service.transitionTo('d1', 'APPROVED', 'founder-1', APPROVER))
      .rejects.toThrow(/Missing required documents.*LIEN_WAIVER/);
    expect(w.draw.status).toBe('SUBMITTED');
  });

  it('funds with draw:approve and emits the event that posts the Actual, at the approved amount', async () => {
    const w = makeWorld('APPROVED');
    w.draw.approvedAmount = 42000;
    await w.service.transitionTo('d1', 'FUNDED', 'founder-1', APPROVER);
    expect(w.draw.status).toBe('FUNDED');
    expect(w.bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'drawRequest.funded', drawId: 'd1', amount: 42000 }));
  });

  it('lets draw:edit submit a draft, through the submit document gate', async () => {
    const w = makeWorld('DRAFT', ['SWORN_STATEMENT', 'VENDOR_INVOICE']);
    await w.service.transitionTo('d1', 'SUBMITTED', 'pm-1', EDIT_ONLY);
    expect(w.draw.status).toBe('SUBMITTED');

    const bare = makeWorld('DRAFT', []);
    await expect(bare.service.transitionTo('d1', 'SUBMITTED', 'pm-1', EDIT_ONLY)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets draw:edit cancel, and revise a rejected draw back to draft', async () => {
    const w = makeWorld('SUBMITTED');
    await w.service.transitionTo('d1', 'CANCELLED', 'pm-1', EDIT_ONLY);
    expect(w.draw.status).toBe('CANCELLED');

    const r = makeWorld('REJECTED');
    await r.service.transitionTo('d1', 'DRAFT', 'pm-1', EDIT_ONLY);
    expect(r.draw.status).toBe('DRAFT');
  });

  it('rejects with draw:approve and keeps the reason; a blank reason is refused', async () => {
    const w = makeWorld('SUBMITTED');
    await expect(w.service.transitionTo('d1', 'REJECTED', 'founder-1', APPROVER)).rejects.toBeInstanceOf(BadRequestException);
    await w.service.transitionTo('d1', 'REJECTED', 'founder-1', { ...APPROVER, rejectionReason: 'Lien waiver unsigned' });
    expect(w.draw).toMatchObject({ status: 'REJECTED', rejectionReason: 'Lien waiver unsigned' });
  });
});
