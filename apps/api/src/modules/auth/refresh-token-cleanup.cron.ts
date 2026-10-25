import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Daily purge of refresh-token rows that can no longer do anything.
 *
 * Nothing ever deleted from this table: every sign-in and every 15-minute rotation added
 * a row, so it grew without bound and kept a week-by-week history of everyone's sessions.
 *
 * Only EXPIRED rows go, revoked or not. A revoked row that has not yet expired is kept on
 * purpose — it is what reuse detection matches against (AuthService.refreshTokens): if a
 * stolen copy of a rotated token turns up, the row is how the server recognises it and
 * ends the user's sessions. Once past expiresAt (7 days at most) the token is dead either
 * way, so the row is just history.
 */
@Injectable()
export class RefreshTokenCleanupCron {
  private readonly logger = new Logger(RefreshTokenCleanupCron.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'refresh-token-cleanup' })
  async run(): Promise<number> {
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    this.logger.log(`Refresh-token cleanup: deleted ${count} expired rows`);
    return count;
  }
}
