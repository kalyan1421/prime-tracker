import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required. Set it in Render service environment variables.');
    }

    // PgBouncer in transaction mode (Supabase port 6543) doesn't support
    // prepared statements. Prisma requires pgbouncer=true to fall back to
    // simple query protocol. Auto-append if the URL targets port 6543 and
    // the flag isn't already present.
    const url = (() => {
      try {
        const u = new URL(databaseUrl);
        if (u.port === '6543' && !u.searchParams.has('pgbouncer')) {
          u.searchParams.set('pgbouncer', 'true');
          return u.toString();
        }
      } catch {
        // malformed URL — let Prisma surface the error
      }
      return databaseUrl;
    })();

    super({
      datasources: { db: { url } },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
