import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Skip if packages already exist
  const existing = await prisma.interiorPackageTemplate.count({ where: { deletedAt: null } });
  if (existing >= 2) {
    console.log(`${existing} package template(s) already exist — skipping.`);
    return;
  }

  // ── Package 1: Standard Fit-Out ──────────────────────────────────────────
  const standard = await prisma.interiorPackageTemplate.create({
    data: {
      name: 'Standard Fit-Out',
      description:
        'Warm-shell to ready-to-occupy finish. Vitrified flooring, gypsum ceiling, drywall partitions, and standard MEP. Suitable for commercial/retail tenants.',
      defaultRatePerSqft: 1800,
      items: {
        create: [
          { description: 'Vitrified tile flooring',        category: 'Flooring',  quantity: 1, unit: 'sqft', unitPrice: 300, sequence: 1 },
          { description: 'Gypsum false ceiling with LED',  category: 'Ceiling',   quantity: 1, unit: 'sqft', unitPrice: 250, sequence: 2 },
          { description: 'Drywall partitions & paint',     category: 'Walls',     quantity: 1, unit: 'sqft', unitPrice: 200, sequence: 3 },
          { description: 'Electrical points & DB wiring',  category: 'MEP',       quantity: 1, unit: 'sqft', unitPrice: 400, sequence: 4 },
          { description: 'Plumbing & sanitary fixtures',   category: 'MEP',       quantity: 1, unit: 'ls',   unitPrice: 85000, sequence: 5 },
          { description: 'Basic reception counter',        category: 'Joinery',   quantity: 1, unit: 'ea',  unitPrice: 45000, sequence: 6 },
          { description: 'Tenant signage & logo wall',     category: 'Signage',   quantity: 1, unit: 'ea',  unitPrice: 18000, sequence: 7 },
        ],
      },
    },
    include: { items: true },
  });

  // ── Package 2: Premium Fit-Out ───────────────────────────────────────────
  const premium = await prisma.interiorPackageTemplate.create({
    data: {
      name: 'Premium Fit-Out',
      description:
        'High-specification finish with imported marble, architectural lighting, full-height glass partitions, complete MEP with HVAC zoning, and custom joinery. For flagship stores and Grade-A offices.',
      defaultRatePerSqft: 3500,
      items: {
        create: [
          { description: 'Imported marble / engineered wood flooring', category: 'Flooring',  quantity: 1, unit: 'sqft', unitPrice: 750,    sequence: 1 },
          { description: 'Feature ceiling with architectural lighting', category: 'Ceiling',   quantity: 1, unit: 'sqft', unitPrice: 600,    sequence: 2 },
          { description: 'Full-height glass partition system',          category: 'Walls',     quantity: 1, unit: 'sqft', unitPrice: 650,    sequence: 3 },
          { description: 'Complete MEP with HVAC & BMS integration',   category: 'MEP',       quantity: 1, unit: 'sqft', unitPrice: 900,    sequence: 4 },
          { description: 'Custom built-in joinery & millwork',         category: 'Joinery',   quantity: 1, unit: 'sqft', unitPrice: 450,    sequence: 5 },
          { description: 'Designer furniture supply & installation',   category: 'Furniture', quantity: 1, unit: 'set',  unitPrice: 350000, sequence: 6 },
          { description: 'Premium signage, wayfinding & branding',     category: 'Signage',   quantity: 1, unit: 'ls',  unitPrice: 65000,  sequence: 7 },
        ],
      },
    },
    include: { items: true },
  });

  console.log(`✓ Created "${standard.name}" — ${standard.items.length} BOQ items, ₹${standard.defaultRatePerSqft}/sqft`);
  console.log(`✓ Created "${premium.name}" — ${premium.items.length} BOQ items, ₹${premium.defaultRatePerSqft}/sqft`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
