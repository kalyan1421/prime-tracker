import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

/**
 * Refuse to run unless a human asked for it on this command line, and never in production.
 *
 * This script gives twelve accounts — a SUPER_ADMIN among them — a password printed in
 * the repo. It used to run unconditionally, and it is chained into `pnpm db:seed`, so
 * pointing that at a real database (one wrong DATABASE_URL) created a known-password
 * super admin on it.
 *
 * ALLOW_DEMO_SEED is read before PrismaClient exists, i.e. from the shell only, so it
 * cannot be switched on once in a .env file and forgotten — it has to be typed for the
 * run that needs it:
 *
 *   ALLOW_DEMO_SEED=true pnpm --filter api exec ts-node prisma/seed-demo-users.ts
 */
function assertDemoSeedAllowed(): void {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed demo users: NODE_ENV=production. These accounts have a published password.');
    process.exit(1);
  }
  if (process.env.ALLOW_DEMO_SEED !== 'true') {
    console.error(
      'Refusing to seed demo users: they include a SUPER_ADMIN with a published password.\n' +
      'For a local database only, re-run with ALLOW_DEMO_SEED=true set on the command line.',
    );
    process.exit(1);
  }
}

assertDemoSeedAllowed();

const prisma = new PrismaClient();

// PrismaClient loads apps/api/.env into process.env for anything the shell did not set,
// so a NODE_ENV=production that lives only in that file becomes visible here, not above.
// Check again before any row is written.
assertDemoSeedAllowed();

const DEV_PASSWORD = 'Prime@123';

const demoUsers = [
  { id: 'demo-user-super_admin',     email: 'superadmin@prime.dev',    name: 'Demo Super Admin',   role: 'SUPER_ADMIN'     as const },
  { id: 'demo-user-founder',         email: 'founder@prime.dev',        name: 'Demo Founder',       role: 'FOUNDER'         as const },
  { id: 'demo-user-executive',       email: 'executive@prime.dev',      name: 'Demo Executive',     role: 'EXECUTIVE'       as const },
  { id: 'demo-user-finance',         email: 'finance@prime.dev',        name: 'Demo Finance',       role: 'FINANCE'         as const },
  { id: 'demo-user-accounting',      email: 'accounting@prime.dev',     name: 'Demo Accounting',    role: 'ACCOUNTING'      as const },
  { id: 'demo-user-ar_ap',           email: 'arap@prime.dev',           name: 'Demo AR/AP',         role: 'AR_AP'           as const },
  { id: 'demo-user-project_manager', email: 'pm@prime.dev',             name: 'Demo PM',            role: 'PROJECT_MANAGER' as const },
  { id: 'demo-user-construction',    email: 'construction@prime.dev',   name: 'Demo Construction',  role: 'CONSTRUCTION'    as const },
  { id: 'demo-user-sales',           email: 'sales@prime.dev',          name: 'Demo Sales',         role: 'SALES'           as const },
  { id: 'demo-user-marketing',       email: 'marketing@prime.dev',      name: 'Demo Marketing',     role: 'MARKETING'       as const },
  { id: 'demo-user-legal',           email: 'legal@prime.dev',          name: 'Demo Legal',         role: 'LEGAL'           as const },
  { id: 'demo-user-viewer',          email: 'viewer@prime.dev',         name: 'Demo Viewer',        role: 'VIEWER'          as const },
];

async function main() {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);

  for (const du of demoUsers) {
    await prisma.user.upsert({
      where: { id: du.id },
      update: { email: du.email, name: du.name, role: du.role, isActive: true, passwordHash },
      create: { id: du.id, email: du.email, name: du.name, role: du.role, isActive: true, passwordHash },
    });
    console.log(`✓ ${du.role.padEnd(20)} ${du.email}`);
  }

  console.log(`\n🔑 All users set with password: ${DEV_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
