import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

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
      where: { email: du.email },
      update: { id: du.id, name: du.name, role: du.role, isActive: true, passwordHash },
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
