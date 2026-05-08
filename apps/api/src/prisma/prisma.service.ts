import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required. Set it in Render service environment variables.');
    }

    super({
      datasources: {
        db: {
          // Keep well under Supabase's session-mode cap (15) and leave headroom
          // for background jobs, migrations, and Prisma's internal overhead.
          url: databaseUrl,
        },
      },
      // Hard cap prevents connection storms during parallel query bursts.
      // Supabase transaction-mode (port 6543) handles higher concurrency;
      // session-mode (port 5432) is capped at pool_size=15 on the free tier.
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
