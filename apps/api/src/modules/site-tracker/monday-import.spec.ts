import ExcelJS from 'exceljs';
import { parseMondayRows, parseUnitLabel, parseTimeline } from './monday-export.parser';
import { SiteTrackerImportService } from './site-tracker-import.service';

describe('parseUnitLabel — the board\'s free-text row names (audit §3.1)', () => {
  it.each([
    ['1 - Unit 103', { kind: 'units', buildingNo: '1', units: ['103'] }],
    ['8 - Units 805, 807, 809, 811, 813, 815', { kind: 'units', buildingNo: '8', units: ['805', '807', '809', '811', '813', '815'] }],
    ['10 - Unit 1003-9', { kind: 'units', buildingNo: '10', units: ['1003', '1004', '1005', '1006', '1007', '1008', '1009'] }],
    ['7 - Unit 701, 2, 3, 4, 5, 6', { kind: 'units', buildingNo: '7', units: ['701', '702', '703', '704', '705', '706'] }],
    ['6 - Unit 607,9,11,13', { kind: 'units', buildingNo: '6', units: ['607', '609', '611', '613'] }],
    ['UNITS 402,403,404', { kind: 'units', units: ['402', '403', '404'] }],
    ['UNIT 501, 503', { kind: 'units', units: ['501', '503'] }],
    ['unit 345', { kind: 'units', units: ['345'] }],
  ])('%s', (label, expected) => {
    expect(parseUnitLabel(label)).toMatchObject(expected);
  });

  it('recognises a whole-building row', () => {
    expect(parseUnitLabel('BUILDING 7')).toEqual({ kind: 'building', buildingNo: '7', units: [] });
    expect(parseUnitLabel('Building 2')).toMatchObject({ kind: 'building' });
  });

  it('refuses to invent a unit number', () => {
    expect(parseUnitLabel('PARTY HALL').kind).toBe('other');
    expect(parseUnitLabel('Extra space Indian Bazaar').kind).toBe('other');
  });

  it('reads monday\'s timeline export', () => {
    expect(parseTimeline('2026-08-19 - 2026-08-21')).toEqual({ start: '2026-08-19', end: '2026-08-21' });
    expect(parseTimeline('')).toEqual({});
  });
});

/** The board as monday's "Export board to Excel" lays it out. */
const BOARD: string[][] = [
  ['Site Tracker'],
  [],
  ['CENTRO PLAZA'],
  ['Name', 'Subitems', 'BLOCKER', 'PRIORITY', 'Latest Updates', 'Next Actions', 'TENANT / BUSINESS', 'Person', 'Timeline'],
  ['1 - Unit 103', '01 - Contracts, 02 - Rough Plumbing', 'NO', 'HIGH', 'Mechanical unit expected tomorrow.', 'Complete the mechanical install.', 'MUGDHA', 'Victor', ''],
  ['Subitems', 'Name', 'Owner', 'Status', 'Inspection Status', 'Inspection Date', 'Timeline'],
  ['', '01 - Contracts', '', 'Done', '', '', ''],
  ['', '04 - Rough Plumbing', '', 'Working on it', 'Passed', '2026-08-24', '2026-08-19 - 2026-08-21'],
  ['8 - Units 805, 807, 809', '', 'YES', 'MEDIUM', 'Waiting on the window supplier.', '', 'LUXYN SUITES', 'Victor, andrew@theprimedeveloper.com', ''],
  ['Extra space Indian Bazaar', '', 'NO', 'LOW', '', '', '', '', ''],
  [],
  ['PRIME LEANDER'],
  ['Name', 'Subitems', 'BLOCKER', 'PRIORITY', 'Latest Updates', 'Next Actions', 'TENANT / BUSINESS', 'Person', 'Timeline'],
  ['BUILDING 2', '', 'NO', 'DONE', 'Storefront in progress.', '', 'SHELL', '', ''],
  ['UNIT 345', '', 'NO', 'HIGH', 'Plumbing complete; framing next.', '', 'INTERIOR FINISHOUT', 'Ghost Person', ''],
];

describe('parseMondayRows', () => {
  it('reads groups, items and the subitems under them', () => {
    const { groups, warnings } = parseMondayRows(BOARD);
    expect(warnings).toEqual([]);
    expect(groups.map((g) => g.name)).toEqual(['CENTRO PLAZA', 'PRIME LEANDER']);
    const [u103, luxyn, bazaar] = groups[0].items;
    expect(u103).toMatchObject({ name: '1 - Unit 103', blocker: 'NO', priority: 'HIGH', tenant: 'MUGDHA', persons: ['Victor'], row: 5 });
    expect(u103.subitems).toEqual([
      expect.objectContaining({ name: '01 - Contracts', status: 'Done' }),
      expect.objectContaining({ name: '04 - Rough Plumbing', inspectionStatus: 'Passed', inspectionDate: '2026-08-24', timeline: '2026-08-19 - 2026-08-21' }),
    ]);
    // The row after the subitems is the next ITEM, not a third subitem.
    expect(luxyn).toMatchObject({ name: '8 - Units 805, 807, 809', blocker: 'YES', persons: ['Victor', 'andrew@theprimedeveloper.com'] });
    expect(luxyn.subitems).toEqual([]);
    expect(bazaar.name).toBe('Extra space Indian Bazaar');
    expect(groups[1].items.map((i) => i.name)).toEqual(['BUILDING 2', 'UNIT 345']);
  });

  it('tells the next item from a subitem when both share the name column', () => {
    const rows = [
      ['RRC'],
      ['Building-unit', 'BLOCKER', 'PRIORITY', 'TENANT / BUSINESS', 'Person'],
      ['UNIT 102', 'NO', 'HIGH', 'Ojas', 'Victor'],
      ['Subitem', 'Owner', 'Status', 'Inspection Status'],
      ['01 - Contracts', '', 'Done', ''],
      ['UNIT 1116', '', '', '', ''], // every item-only column empty — named like a unit
      ['UNIT 1201', 'NO', 'LOW', '', ''],
    ];
    const { groups } = parseMondayRows(rows);
    expect(groups[0].items.map((i) => i.name)).toEqual(['UNIT 102', 'UNIT 1116', 'UNIT 1201']);
    expect(groups[0].items[0].subitems.map((s) => s.name)).toEqual(['01 - Contracts']);
  });

  it('says so when the file is not a board export', () => {
    expect(parseMondayRows([['Unit Number', 'Building', 'Sqft'], ['805', 'B8', '1057']]).warnings[0])
      .toMatch(/Export board to Excel/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
async function boardXlsx(rows: string[][] = BOARD) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Site Tracker');
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('SiteTrackerImportService', () => {
  const unit = (id: string, unitNumber: string, buildingId: string, buildingName: string, over: any = {}) => ({
    id, unitNumber, buildingId, trackedWithId: null, blockerStatus: null, sitePriority: null,
    building: { name: buildingName, projectId: 'p-centro' },
    _count: { constructionStages: 0, siteAssignees: 0, trackedUnits: 0 }, ...over,
  });
  const tx: any = {
    unit: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    unitConstructionStage: { createMany: jest.fn() },
    unitAssignee: { createMany: jest.fn() },
    dailyLog: { create: jest.fn() },
  };
  const prisma: any = {
    project: { findMany: jest.fn() },
    unit: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
    customOption: { findMany: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const svc = () => new SiteTrackerImportService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.project.findMany.mockResolvedValue([
      { id: 'p-centro', name: 'Centro Plaza' },
      { id: 'p-leander', name: 'Prime Leander' },
      { id: 'p-lewis', name: 'Prime Lewisville' },
    ]);
    prisma.unit.findMany.mockResolvedValue([
      unit('u103', '103', 'b1', 'Centro Plaza - Building 1'),
      unit('u805', '805', 'b8', 'Centro Plaza - Building 8'),
      unit('u807', '807', 'b8', 'Centro Plaza - Building 8'),
      // 809 is already tracked on its own — it must not be swallowed into the job.
      unit('u809', '809', 'b8', 'Centro Plaza - Building 8', { _count: { constructionStages: 18, siteAssignees: 0, trackedUnits: 0 } }),
      unit('u345', '345', 'bL', 'Prime Leander - Building 3', { building: { name: 'Prime Leander - Building 3', projectId: 'p-leander' } }),
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'victor', name: 'Victor R', email: 'victor@theprimedeveloper.com' },
      { id: 'andrew', name: 'Andrew A', email: 'andrew@theprimedeveloper.com' },
    ]);
    prisma.customOption.findMany.mockResolvedValue([{ value: 'contracts', label: 'Contracts' }]);
    tx.unit.findUnique.mockResolvedValue({
      trackedWithId: null, blockerStatus: null, sitePriority: null,
      _count: { constructionStages: 0, siteAssignees: 0, trackedUnits: 0 },
    });
  });

  it('previews without writing, matching properties by name', async () => {
    const out = await svc().run(await boardXlsx(), { apply: false, userId: 'f1' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(out.groups).toEqual([
      expect.objectContaining({ name: 'CENTRO PLAZA', projectId: 'p-centro' }),
      expect.objectContaining({ name: 'PRIME LEANDER', projectId: 'p-leander' }),
    ]);
    const byLabel = Object.fromEntries(out.rows.map((r) => [r.label, r]));
    expect(byLabel['1 - Unit 103']).toMatchObject({ status: 'ready', units: [{ id: 'u103', unitNumber: '103' }], stages: 2, priority: 'HIGH', owners: ['Victor R'] });
    expect(byLabel['8 - Units 805, 807, 809']).toMatchObject({
      status: 'ready', blocker: 'YES', owners: ['Victor R', 'Andrew A'],
      units: [{ id: 'u805', unitNumber: '805' }, { id: 'u807', unitNumber: '807' }],
    });
    expect(byLabel['8 - Units 805, 807, 809'].messages.join(' ')).toMatch(/809 is already on the tracker on its own/);
    expect(byLabel['Extra space Indian Bazaar']).toMatchObject({ status: 'unmatched' });
    expect(byLabel['BUILDING 2']).toMatchObject({ status: 'unmatched' });
    expect(byLabel['BUILDING 2'].messages[0]).toMatch(/whole-building row/);
    expect(byLabel['UNIT 345'].messages.join(' ')).toMatch(/No user matches Ghost Person/);
    expect(out.totals).toMatchObject({ ready: 3, unmatched: 2 });
  });

  it('asks which property a heading is when it cannot tell', async () => {
    const rows = BOARD.map((r) => (r[0] === 'CENTRO PLAZA' ? ['CP EAST'] : r));
    const out = await svc().run(await boardXlsx(rows), { apply: false, userId: 'f1' });
    expect(out.groups[0]).toMatchObject({ name: 'CP EAST', projectId: null });
    expect(out.rows[0].messages[0]).toMatch(/Choose which property/);
    // …and honours the choice when it is made.
    const chosen = await svc().run(await boardXlsx(rows), { apply: false, projectMap: { 'CP EAST': 'p-centro' }, userId: 'f1' });
    expect(chosen.rows[0].status).toBe('ready');
  });

  it('applies the ready rows: checklist, board fields, owners, job members and one update', async () => {
    const out = await svc().run(await boardXlsx(), { apply: true, userId: 'f1' });
    expect(out.totals.imported).toBe(3);

    const stageCall = tx.unitConstructionStage.createMany.mock.calls[0][0].data;
    expect(stageCall).toEqual([
      expect.objectContaining({ unitId: 'u103', sortOrder: 1, label: 'Contracts', stageValue: 'contracts', status: 'DONE', createdById: 'f1' }),
      expect.objectContaining({ label: 'Rough Plumbing', status: 'IN_PROGRESS', inspectionStatus: 'PASSED', startsOn: new Date('2026-08-19'), endsOn: new Date('2026-08-21') }),
    ]);
    expect(tx.unit.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['u807'] } }, data: { trackedWithId: 'u805' } });
    expect(tx.unit.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u805' },
      data: expect.objectContaining({ blockerStatus: 'YES', blockerReason: 'Waiting on the window supplier.', sitePriority: 'MEDIUM' }),
    }));
    const note = tx.dailyLog.create.mock.calls.find((c: any) => c[0].data.unitId === 'u103')[0].data.notes;
    expect(note).toMatch(/^From the monday Site Tracker/);
    expect(note).toContain('Tenant / business: MUGDHA');
  });

  it('seeds the typed Next action from monday\'s "Next Actions", stamped with the importer', async () => {
    await svc().run(await boardXlsx(), { apply: true, userId: 'f1' });
    const u103 = tx.unit.update.mock.calls.find((c: any) => c[0].where.id === 'u103')[0].data;
    expect(u103).toMatchObject({ siteNextAction: 'Complete the mechanical install.', siteNextActionById: 'f1' });
    expect(u103.siteNextActionAt).toBeInstanceOf(Date);
    // A blank monday cell writes nothing.
    const u805 = tx.unit.update.mock.calls.find((c: any) => c[0].where.id === 'u805')[0].data;
    expect(u805.siteNextAction).toBeUndefined();
  });

  it('skips, never merges, a row whose unit went onto the tracker after the preview', async () => {
    tx.unit.findUnique.mockResolvedValue({
      trackedWithId: null, blockerStatus: 'NO', sitePriority: null,
      _count: { constructionStages: 0, siteAssignees: 0, trackedUnits: 0 },
    });
    const out = await svc().run(await boardXlsx(), { apply: true, userId: 'f1' });
    expect(out.totals.imported).toBe(0);
    expect(out.totals.skipped).toBeGreaterThan(0);
    expect(tx.unitConstructionStage.createMany).not.toHaveBeenCalled();
  });

  it('refuses a file that is not a spreadsheet', async () => {
    await expect(svc().run(Buffer.from('not a workbook'), { apply: false, userId: 'f1' }))
      .rejects.toThrow(/Export board to Excel/);
  });
});

describe('SiteTrackerImportService — matching people', () => {
  it('prefers an exact email over a shared local part', async () => {
    const svc: any = new SiteTrackerImportService({} as any);
    const users = [
      { id: 'a', name: 'PM One', email: 'pm@primedevelopers.com' },
      { id: 'b', name: 'Demo PM', email: 'pm@prime.dev' },
      { id: 'v', name: 'Victor R', email: 'victor@theprimedeveloper.com' },
    ];
    expect(svc.matchUser('pm@prime.dev', users)?.id).toBe('b');
    expect(svc.matchUser('Victor', users)?.id).toBe('v');
    // Two people share "pm@" — a bare "pm" is ambiguous, so nobody is guessed.
    expect(svc.matchUser('pm', users)).toBeNull();
  });
});
