import { AuditService } from './audit.service';

/**
 * The Activity Log's permission boundary.
 *
 * This feed is open to everyone with `updateBoard:view` — far wider than the `audit:view`
 * that guards the rest of the audit module — and it earns that width in two ways that
 * are easy to undo by accident. These tests pin both:
 *
 *  1. Entities the viewer cannot read are excluded IN THE QUERY, so the rows never load
 *     and `total` is not a count of things they are not allowed to see.
 *  2. `oldValues` / `newValues` are never selected. Those blobs hold asking prices, loan
 *     principals and lender names.
 */
const mockPrisma: any = {
  auditEvent: { findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
  user: { findMany: jest.fn() },
  // Subject resolution reaches one delegate per entity type present on the page.
  unit: { findMany: jest.fn() },
  sale: { findMany: jest.fn() },
  lease: { findMany: jest.fn() },
  campaign: { findMany: jest.fn() },
  lead: { findMany: jest.fn() },
  unitConstructionStage: { findMany: jest.fn() },
};

const make = () => new AuditService(mockPrisma as any);
const viewer = (permissions: string[]) => ({ permissions });

const CONSTRUCTION = [
  'updateBoard:view', 'unit:view', 'building:view', 'project:view',
  'checklist:view', 'dailylog:view', 'milestone:view', 'draw:view', 'task:view', 'document:view',
];
const FINANCE = ['updateBoard:view', 'budget:view', 'loan:view', 'actual:view', 'financial:view'];

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.auditEvent.findMany.mockResolvedValue([]);
  mockPrisma.auditEvent.count.mockResolvedValue(0);
  mockPrisma.auditEvent.groupBy.mockResolvedValue([]);
  mockPrisma.user.findMany.mockResolvedValue([]);
  for (const d of ['unit', 'sale', 'lease', 'campaign', 'lead', 'unitConstructionStage']) {
    mockPrisma[d].findMany.mockResolvedValue([]);
  }
});

const BUILDING = { name: 'B-ALPHA', project: { id: 'p1', name: 'QA Fixtures' } };
const event = (over: any = {}) => ({
  id: 'e1', action: 'UPDATE', entity: 'Units', entityId: 'u1',
  createdAt: new Date('2026-08-27T10:00:00Z'),
  user: { id: 'user-1', name: 'Asha', email: 'asha@prime.dev' },
  ...over,
});

const argsOf = () => mockPrisma.auditEvent.findMany.mock.calls[0][0];

describe('AuditService.activityFeed — what the query asks for', () => {
  it('never selects the before/after value payloads', async () => {
    await make().activityFeed({}, viewer(CONSTRUCTION));
    const select = argsOf().select;
    expect(select.oldValues).toBeUndefined();
    expect(select.newValues).toBeUndefined();
    expect(select.metadata).toBeUndefined();
    expect(select.ipAddress).toBeUndefined();
  });

  it('uses an explicit select, so a field added to AuditEvent later cannot leak in', async () => {
    await make().activityFeed({}, viewer(CONSTRUCTION));
    expect(argsOf().select).toBeDefined();
    expect(argsOf().include).toBeUndefined();
  });

  it('restricts the query to entities the viewer can read', async () => {
    await make().activityFeed({}, viewer(CONSTRUCTION));
    const entities: string[] = argsOf().where.entity.in;
    expect(entities).toContain('Units');
    expect(entities).toContain('ConstructionChecklist');
    expect(entities).toContain('Draws');
    // The money and sales side is absent, not merely filtered out of the response.
    expect(entities).not.toContain('Budgets');
    expect(entities).not.toContain('Sales');
    expect(entities).not.toContain('Leases');
    expect(entities).not.toContain('User');
  });

  it('gives a different viewer a different entity set', async () => {
    await make().activityFeed({}, viewer(FINANCE));
    const entities: string[] = argsOf().where.entity.in;
    expect(entities).toContain('Budgets');
    expect(entities).toContain('Loans');
    expect(entities).not.toContain('ConstructionChecklist');
  });

  it('treats an unmapped entity as forbidden rather than public', async () => {
    // A new module's audit rows stay invisible until someone maps them. That failure
    // hides data; the opposite default would leak it.
    await make().activityFeed({}, viewer(['updateBoard:view', 'unit:view']));
    // Exactly the two mapped entities those two permissions unlock, and nothing else.
    const entities: string[] = argsOf().where.entity.in;
    expect(entities).toHaveLength(2);
    expect(entities).toEqual(expect.arrayContaining(['Units', 'UpdateBoard']));
  });

  it('excludes sign-in and MFA events — they are not business activity', async () => {
    await make().activityFeed({}, viewer(CONSTRUCTION));
    const excluded: string[] = argsOf().where.action.notIn;
    expect(excluded).toEqual(expect.arrayContaining(['LOGIN', 'LOGOUT', 'MFA_VERIFY']));
  });

  it('returns an empty page without querying when nothing is readable', async () => {
    const out = await make().activityFeed({}, viewer([]));
    expect(out).toEqual({ events: [], total: 0, page: 1, limit: 30, areas: [] });
    expect(mockPrisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it('narrows to one area when asked, still inside the permission set', async () => {
    await make().activityFeed({ area: 'Money' }, viewer(CONSTRUCTION));
    // Construction's only readable Money entity is Draws — asking for the area cannot
    // widen the set to budgets.
    expect(argsOf().where.entity.in).toEqual(['Draws']);
  });

  it('caps the page size so one call cannot pull the whole table', async () => {
    await make().activityFeed({ limit: 5000 }, viewer(CONSTRUCTION));
    expect(argsOf().take).toBe(100);
  });
});

describe('AuditService.activityFeed — what it returns', () => {
  it('renders a readable sentence and never a raw value', async () => {
    mockPrisma.auditEvent.findMany.mockResolvedValue([{
      id: 'e1', action: 'UPDATE', entity: 'Units', entityId: 'u1',
      createdAt: new Date('2026-08-27T10:00:00Z'),
      user: { id: 'user-1', name: 'Asha', email: 'asha@prime.dev' },
    }]);
    mockPrisma.auditEvent.count.mockResolvedValue(1);
    const out = await make().activityFeed({}, viewer(CONSTRUCTION));
    expect(out.events[0]).toMatchObject({
      actorName: 'Asha', summary: 'updated a unit', area: 'Units & Buildings',
    });
    expect(out.events[0]).not.toHaveProperty('oldValues');
    expect(out.events[0]).not.toHaveProperty('newValues');
  });

  it('falls back to the email, then to System, for an actor with no name', async () => {
    mockPrisma.auditEvent.findMany.mockResolvedValue([
      { id: 'e1', action: 'CREATE', entity: 'Units', entityId: null, createdAt: new Date(), user: { id: 'u', name: null, email: 'a@b.c' } },
      { id: 'e2', action: 'CREATE', entity: 'Units', entityId: null, createdAt: new Date(), user: null },
    ]);
    mockPrisma.auditEvent.count.mockResolvedValue(2);
    const out = await make().activityFeed({}, viewer(CONSTRUCTION));
    expect(out.events.map((e: any) => e.actorName)).toEqual(['a@b.c', 'System']);
  });

  it('offers only areas the viewer can read something in', async () => {
    const out = await make().activityFeed({}, viewer(CONSTRUCTION));
    expect(out.areas).toContain('Construction');
    expect(out.areas).not.toContain('Sales & Leads');
    expect(out.areas).not.toContain('Administration');
  });
});

describe('AuditService.activityActors', () => {
  it('scopes the people list to the entities the viewer can see', async () => {
    await make().activityActors(viewer(CONSTRUCTION));
    const where = mockPrisma.auditEvent.groupBy.mock.calls[0][0].where;
    expect(where.entity.in).not.toContain('Budgets');
    // Otherwise the filter would reveal that a colleague had been busy in a module the
    // viewer cannot read — the same leak the feed itself avoids.
    expect(where.userId).toEqual({ not: null });
  });

  it('returns nothing rather than everyone when no entity is readable', async () => {
    await expect(make().activityActors(viewer([]))).resolves.toEqual([]);
    expect(mockPrisma.auditEvent.groupBy).not.toHaveBeenCalled();
  });
});

/**
 * Naming what was touched.
 *
 * "updated a unit" is true and useless; the feed exists so someone can see WHICH unit, in
 * which building, on which project. These tests cover the two ways that quietly breaks:
 * a resolver whose `select` no longer matches the schema (which fails silently by design,
 * so nothing else would catch it), and an entity name that has no resolver at all.
 */
describe('AuditService.activityFeed — naming the record', () => {
  const CONSTRUCTION = ['updateBoard:view', 'unit:view', 'checklist:view'];
  const SALES = ['updateBoard:view', 'sales:view', 'lease:view', 'campaign:view', 'lead:view'];

  it('names the unit and its building and project, and links to it', async () => {
    mockPrisma.auditEvent.findMany.mockResolvedValue([event()]);
    mockPrisma.auditEvent.count.mockResolvedValue(1);
    mockPrisma.unit.findMany.mockResolvedValue([{ id: 'u1', unitNumber: 'A-101', building: BUILDING }]);

    const out = await make().activityFeed({}, viewer(CONSTRUCTION));
    expect(out.events[0]).toMatchObject({
      title: 'updated Unit A-101',
      subject: 'Unit A-101',
      subjectContext: 'B-ALPHA · QA Fixtures',
      href: '/projects/p1/units/u1',
    });
  });

  it('looks each entity type up once, not once per row', async () => {
    mockPrisma.auditEvent.findMany.mockResolvedValue([
      event({ id: 'a', entityId: 'u1' }), event({ id: 'b', entityId: 'u2' }), event({ id: 'c', entityId: 'u1' }),
    ]);
    mockPrisma.auditEvent.count.mockResolvedValue(3);
    await make().activityFeed({}, viewer(CONSTRUCTION));
    expect(mockPrisma.unit.findMany).toHaveBeenCalledTimes(1);
    // De-duplicated: u1 appears twice in the page but once in the query.
    expect(mockPrisma.unit.findMany.mock.calls[0][0].where.id.in.sort()).toEqual(['u1', 'u2']);
  });

  it('falls back to the generic wording when the record has since been deleted', async () => {
    mockPrisma.auditEvent.findMany.mockResolvedValue([event({ action: 'DELETE' })]);
    mockPrisma.auditEvent.count.mockResolvedValue(1);
    mockPrisma.unit.findMany.mockResolvedValue([]);   // id no longer in the table
    const out = await make().activityFeed({}, viewer(CONSTRUCTION));
    expect(out.events[0].title).toBe('deleted a unit');
    expect(out.events[0].subject).toBeNull();
    expect(out.events[0].href).toBeNull();
  });

  it('survives a resolver that no longer matches the schema', async () => {
    // This is not hypothetical: ConstructionChecklist selected a `building` relation that
    // UnitConstructionStage does not have, and every one of its rows silently lost its
    // name. The feed must still return, and the other entity types must still resolve.
    mockPrisma.auditEvent.findMany.mockResolvedValue([
      event({ id: 'a', entity: 'ConstructionChecklist', entityId: 's1' }),
      event({ id: 'b', entity: 'Units', entityId: 'u1' }),
    ]);
    mockPrisma.auditEvent.count.mockResolvedValue(2);
    mockPrisma.unitConstructionStage.findMany.mockRejectedValue(new Error('Unknown field `building`'));
    mockPrisma.unit.findMany.mockResolvedValue([{ id: 'u1', unitNumber: 'A-101', building: BUILDING }]);

    const out = await make().activityFeed({}, viewer(CONSTRUCTION));
    expect(out.events[0].subject).toBeNull();
    expect(out.events[0].title).toBe('updated a checklist step');
    expect(out.events[1].subject).toBe('Unit A-101');
  });

  it('does not select a building relation for a checklist stage', async () => {
    // The stage hangs off a unit only; asking for a building is what broke it before.
    mockPrisma.auditEvent.findMany.mockResolvedValue([event({ entity: 'ConstructionChecklist', entityId: 's1' })]);
    mockPrisma.auditEvent.count.mockResolvedValue(1);
    await make().activityFeed({}, viewer(CONSTRUCTION));
    const select = mockPrisma.unitConstructionStage.findMany.mock.calls[0][0].select;
    expect(select.unit).toBeDefined();
    expect(select.building).toBeUndefined();
  });

  it('resolves the singular Sale and Lease names, which are the rows that carry ids', async () => {
    mockPrisma.auditEvent.findMany.mockResolvedValue([
      event({ id: 'a', entity: 'Sale', entityId: 'sale1', action: 'UPDATE' }),
      event({ id: 'b', entity: 'Lease', entityId: 'lease1', action: 'UPDATE' }),
    ]);
    mockPrisma.auditEvent.count.mockResolvedValue(2);
    mockPrisma.sale.findMany.mockResolvedValue([
      { id: 'sale1', buyer: 'R. Kiran', projectId: 'p1', unit: { id: 'u1', unitNumber: '1214', building: BUILDING }, building: null },
    ]);
    mockPrisma.lease.findMany.mockResolvedValue([
      { id: 'lease1', tenantName: 'Acme Ltd', unit: { id: 'u2', unitNumber: 'A-101', building: BUILDING }, building: null },
    ]);
    const out = await make().activityFeed({}, viewer(SALES));
    expect(out.events[0].title).toBe('updated R. Kiran — Unit 1214');
    expect(out.events[1].title).toBe('updated Acme Ltd — Unit A-101');
  });

  it('names a campaign by its channel', async () => {
    mockPrisma.auditEvent.findMany.mockResolvedValue([event({ entity: 'Campaigns', entityId: 'c1', action: 'CREATE' })]);
    mockPrisma.auditEvent.count.mockResolvedValue(1);
    mockPrisma.campaign.findMany.mockResolvedValue([{ id: 'c1', name: 'Spring launch', channel: 'META' }]);
    const out = await make().activityFeed({}, viewer(SALES));
    expect(out.events[0]).toMatchObject({ title: 'created Spring launch', subjectContext: 'meta', href: '/campaigns' });
  });

  it('does not try to look up an event that carries no entityId', async () => {
    // The plural Sales/Leases/Documents rows are list-level operations with no id.
    mockPrisma.auditEvent.findMany.mockResolvedValue([event({ entity: 'Sale', entityId: null })]);
    mockPrisma.auditEvent.count.mockResolvedValue(1);
    const out = await make().activityFeed({}, viewer(SALES));
    expect(mockPrisma.sale.findMany).not.toHaveBeenCalled();
    expect(out.events[0].subject).toBeNull();
  });

  it('never selects a price, rent or amount when naming a record', async () => {
    mockPrisma.auditEvent.findMany.mockResolvedValue([
      event({ id: 'a', entity: 'Sale', entityId: 's1' }),
      event({ id: 'b', entity: 'Units', entityId: 'u1' }),
    ]);
    mockPrisma.auditEvent.count.mockResolvedValue(2);
    await make().activityFeed({}, viewer([...CONSTRUCTION, ...SALES]));
    const selects = [
      mockPrisma.sale.findMany.mock.calls[0][0].select,
      mockPrisma.unit.findMany.mock.calls[0][0].select,
    ];
    for (const sel of selects) {
      for (const banned of ['askingPrice', 'askingRent', 'salePrice', 'amount', 'principal']) {
        expect(sel[banned]).toBeUndefined();
      }
    }
  });
});
