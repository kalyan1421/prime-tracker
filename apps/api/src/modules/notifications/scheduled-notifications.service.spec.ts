import { ScheduledNotificationsService } from './scheduled-notifications.service';

const mockPrisma = {
  salePayment: { findMany: jest.fn(), updateMany: jest.fn() },
};
const mockNotifications = {
  notifyPaymentOverdue: jest.fn(),
  notifyPaymentDueSoon: jest.fn(),
};

function daysFromNow(n: number) {
  return new Date(Date.now() + n * 86_400_000);
}

describe('ScheduledNotificationsService.checkSalePayments', () => {
  let service: ScheduledNotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ScheduledNotificationsService(mockPrisma as any, mockNotifications as any);
  });

  it('flips past-due installments to OVERDUE and notifies; warns on those due within 7 days', async () => {
    const sale = { id: 's1', buyer: 'Acme', projectId: 'pr1', project: { name: 'Rio Ranch' } };
    mockPrisma.salePayment.findMany.mockResolvedValue([
      { id: 'late', saleId: 's1', label: 'Deposit', status: 'DUE', dueDate: daysFromNow(-5), effectiveDueDate: null, sale },
      { id: 'soon', saleId: 's1', label: 'Slab', status: 'SCHEDULED', dueDate: daysFromNow(3), effectiveDueDate: null, sale },
      { id: 'far', saleId: 's1', label: 'Handover', status: 'SCHEDULED', dueDate: daysFromNow(45), effectiveDueDate: null, sale },
    ]);
    mockPrisma.salePayment.updateMany.mockResolvedValue({ count: 1 });

    const res = await service.checkSalePayments();

    expect(res).toEqual({ overdue: 1, dueSoon: 1 });
    expect(mockPrisma.salePayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['late'] } }, data: { status: 'OVERDUE' } }),
    );
    expect(mockNotifications.notifyPaymentOverdue).toHaveBeenCalledTimes(1);
    expect(mockNotifications.notifyPaymentOverdue).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Deposit', projectId: 'pr1', daysOverdue: expect.any(Number) }),
    );
    expect(mockNotifications.notifyPaymentDueSoon).toHaveBeenCalledTimes(1);
    expect(mockNotifications.notifyPaymentDueSoon).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Slab' }),
    );
  });

  it('coalesces effectiveDueDate over dueDate when deciding overdue', async () => {
    const sale = { id: 's1', buyer: null, projectId: 'pr1', project: { name: 'P' } };
    mockPrisma.salePayment.findMany.mockResolvedValue([
      // dueDate is future, but the milestone-stamped effectiveDueDate is in the past → overdue
      { id: 'm1', saleId: 's1', label: 'Foundation', status: 'DUE', dueDate: daysFromNow(20), effectiveDueDate: daysFromNow(-2), sale },
    ]);
    mockPrisma.salePayment.updateMany.mockResolvedValue({ count: 1 });

    const res = await service.checkSalePayments();
    expect(res.overdue).toBe(1);
    expect(mockNotifications.notifyPaymentOverdue).toHaveBeenCalled();
  });
});
