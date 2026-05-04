import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const demoUsers = [
  { id: 'demo-user-super_admin', email: 'demo-super_admin@primedevelopers.com', name: 'Demo Super Admin', role: 'SUPER_ADMIN' as const },
  { id: 'demo-user-founder', email: 'demo-founder@primedevelopers.com', name: 'Demo Founder', role: 'FOUNDER' as const },
  { id: 'demo-user-executive', email: 'demo-executive@primedevelopers.com', name: 'Demo Executive', role: 'EXECUTIVE' as const },
  { id: 'demo-user-finance', email: 'demo-finance@primedevelopers.com', name: 'Demo Finance', role: 'FINANCE' as const },
  { id: 'demo-user-accounting', email: 'demo-accounting@primedevelopers.com', name: 'Demo Accounting', role: 'ACCOUNTING' as const },
  { id: 'demo-user-ar_ap', email: 'demo-ar_ap@primedevelopers.com', name: 'Demo AR/AP', role: 'AR_AP' as const },
  { id: 'demo-user-project_manager', email: 'demo-project_manager@primedevelopers.com', name: 'Demo PM', role: 'PROJECT_MANAGER' as const },
  { id: 'demo-user-construction', email: 'demo-construction@primedevelopers.com', name: 'Demo Construction', role: 'CONSTRUCTION' as const },
  { id: 'demo-user-sales', email: 'demo-sales@primedevelopers.com', name: 'Demo Sales', role: 'SALES' as const },
  { id: 'demo-user-marketing', email: 'demo-marketing@primedevelopers.com', name: 'Demo Marketing', role: 'MARKETING' as const },
  { id: 'demo-user-legal', email: 'demo-legal@primedevelopers.com', name: 'Demo Legal', role: 'LEGAL' as const },
  { id: 'demo-user-viewer', email: 'demo-viewer@primedevelopers.com', name: 'Demo Viewer', role: 'VIEWER' as const },
];

async function main() {
  for (const du of demoUsers) {
    await prisma.user.upsert({
      where: { email: du.email },
      update: { id: du.id, name: du.name, role: du.role, isActive: true },
      create: { id: du.id, email: du.email, name: du.name, role: du.role, isActive: true },
    });
    console.log(`✓ ${du.role.padEnd(20)} ${du.email}`);
  }

  // Clean up old dev-* users (no FK references — verified)
  const removed = await prisma.user.deleteMany({
    where: { email: { startsWith: 'dev-' } },
  });
  console.log(`\n🧹 Removed ${removed.count} old dev-* users`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
