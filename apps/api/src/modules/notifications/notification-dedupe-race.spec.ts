import { NotificationType } from '@prisma/client';
import { NotificationsService } from './notifications.service';

/**
 * The pending-alert dedupe is a read followed by a write, so two concurrent runs could
 * both read "nothing pending" and both insert. The partial unique index
 * notifications_pending_dedupe_key (20261024010000) now refuses the loser with P2002, and
 * the service must read that as "already sent" — no error, and no second push or email.
 */
const uniqueViolation = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

function makeService() {
  const prisma: any = {
    notificationPreference: { findMany: jest.fn().mockResolvedValue([]) },
    notification: {
      findMany: jest.fn().mockResolvedValue([]), // nothing pending at read time
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
    },
    user: {
      findMany: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(where.id.in.map((id: string) => ({ id, email: `${id}@x.test`, name: id })))),
    },
  };
  const config = { get: jest.fn((_k: string, d?: string) => d) };
  const gateway: any = { emitToUser: jest.fn() };
  const service = new NotificationsService(prisma, config as any, gateway);
  const mailer = { sendMail: jest.fn().mockResolvedValue(undefined) };
  (service as any).mailer = mailer;
  return { service, prisma, gateway, mailer };
}

const sendOverdue = (service: NotificationsService, userIds: string[]) =>
  service.send({
    userIds,
    type: NotificationType.RENT_OVERDUE, // RECURRING and ACTION tier → emails by default
    title: 'Rent overdue (30d)',
    body: 'B',
    dedupeKey: 'rentInvoice:inv-1',
  });

describe('NotificationsService — losing the dedupe race', () => {
  it('normal path: one createMany, everyone pushed and emailed', async () => {
    const { service, prisma, gateway, mailer } = makeService();
    await sendOverdue(service, ['u1', 'u2']);
    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(gateway.emitToUser).toHaveBeenCalledTimes(2);
    expect(mailer.sendMail).toHaveBeenCalledTimes(2);
  });

  it('a P2002 from the batch falls back per recipient and skips the ones already pending', async () => {
    const { service, prisma, gateway, mailer } = makeService();
    prisma.notification.createMany.mockRejectedValueOnce(uniqueViolation());
    // u1's copy was inserted by the concurrent run; u2's was not.
    prisma.notification.create.mockImplementation(({ data }: any) =>
      data.userId === 'u1' ? Promise.reject(uniqueViolation()) : Promise.resolve({ id: 'n2', ...data }));

    await expect(sendOverdue(service, ['u1', 'u2'])).resolves.toBeUndefined();

    expect(prisma.notification.create).toHaveBeenCalledTimes(2);
    expect(gateway.emitToUser).toHaveBeenCalledTimes(1);
    expect(gateway.emitToUser).toHaveBeenCalledWith('u2', 'notification', expect.anything());
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    expect(mailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'u2@x.test' }));
  });

  it('nothing is pushed or emailed when every recipient already had it', async () => {
    const { service, prisma, gateway, mailer } = makeService();
    prisma.notification.createMany.mockRejectedValueOnce(uniqueViolation());
    prisma.notification.create.mockRejectedValue(uniqueViolation());

    await sendOverdue(service, ['u1']);
    expect(gateway.emitToUser).not.toHaveBeenCalled();
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('any other database error still surfaces', async () => {
    const { service, prisma } = makeService();
    prisma.notification.createMany.mockRejectedValueOnce(Object.assign(new Error('connection lost'), { code: 'P1001' }));
    await expect(sendOverdue(service, ['u1'])).rejects.toThrow('connection lost');
  });

  it('an EVENT type never stores a dedupeKey, so the pending-alert index never applies to it', async () => {
    const { service, prisma } = makeService();
    await service.send({
      userIds: ['u1'],
      type: NotificationType.COMMENT_MENTION,
      title: 'Mentioned',
      body: 'B',
      dedupeKey: 'comment:c1',
    });
    expect(prisma.notification.createMany.mock.calls[0][0].data[0].dedupeKey).toBeUndefined();
  });

  it('logs a failed email by user id, never by address', async () => {
    const { service, mailer } = makeService();
    mailer.sendMail.mockRejectedValueOnce(new Error('SMTP 550'));
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await sendOverdue(service, ['u1']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('user u1'));
    expect(warn.mock.calls[0][0]).not.toContain('@');
  });
});
