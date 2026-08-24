import ExcelJS from 'exceljs';
import { LeaseImportService, matchProjectLabel } from './lease-import.service';

const round2 = (n: number) => Math.round(n * 100) / 100;

const mockPrisma: any = {
  unit: { findMany: jest.fn() },
  broker: { findMany: jest.fn() },
  project: { findMany: jest.fn() },
  lease: { findMany: jest.fn() },
};

const mockLeases: any = {
  backfillTenancy: jest.fn(),
};

function makeService() {
  return new LeaseImportService(mockPrisma as any, mockLeases as any);
}

/** Builds a real .xlsx buffer with the three sheets, row objects keyed by column label. */
async function buildFile(sheets: {
  tenancies?: Record<string, any>[];
  ledgerExceptions?: Record<string, any>[];
  commissions?: Record<string, any>[];
}) {
  const service = makeService();
  const template = await service.buildTemplate();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(template as any);

  const fill = (sheetName: string, rows: Record<string, any>[] | undefined) => {
    if (!rows) return;
    const ws = wb.getWorksheet(sheetName)!;
    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell, col) => { headers[col] = String(cell.value); });
    rows.forEach((row, i) => {
      const r = ws.getRow(i + 2);
      headers.forEach((h, col) => {
        if (h && row[h] !== undefined) r.getCell(col).value = row[h];
      });
    });
  };
  fill('Tenancies', sheets.tenancies);
  fill('Ledger Exceptions', sheets.ledgerExceptions);
  fill('Commission Installments', sheets.commissions);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

const BASE_UNITS = [
  { id: 'u300', unitNumber: '300', building: { name: 'Building A' } },
  { id: 'u701', unitNumber: '701', building: { name: 'Building A' } },
  { id: 'u702', unitNumber: '702', building: { name: 'Building A' } },
];

describe('LeaseImportService.buildTemplate', () => {
  it('produces a workbook with all three required sheets', async () => {
    const service = makeService();
    const buffer = await service.buildTemplate();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    expect(wb.getWorksheet('Tenancies')).toBeTruthy();
    expect(wb.getWorksheet('Ledger Exceptions')).toBeTruthy();
    expect(wb.getWorksheet('Commission Installments')).toBeTruthy();
  });
});

describe('LeaseImportService.previewImport', () => {
  let service: LeaseImportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.unit.findMany.mockResolvedValue(BASE_UNITS);
    mockPrisma.broker.findMany.mockResolvedValue([{ id: 'b1', name: 'Tester' }]);
    mockPrisma.project.findMany.mockResolvedValue([{ id: 'p1', name: 'RRC Bldg 1-8' }]);
    mockPrisma.lease.findMany.mockResolvedValue([]);
  });

  it('marks a fully valid row ready', async () => {
    const file = await buildFile({
      tenancies: [{
        'Unit Number': '300', 'Tenant Name': 'Brasstap', 'Lease Start': new Date('2019-01-01'),
        'Lease End': new Date('2022-01-01'), 'Termination Date': new Date('2022-01-01'), 'Monthly Rent': 3000,
      }],
    });
    const preview = await service.previewImport(file, 'p1');
    expect(preview.summary).toEqual({ total: 1, ready: 1, errors: 0, duplicates: 0, skippedOtherProject: 0 });
    expect(preview.tenancies[0].data.unitId).toBe('u300');
  });

  it('flags a unit that does not resolve in this project', async () => {
    const file = await buildFile({
      tenancies: [{
        'Unit Number': '9999', 'Tenant Name': 'Nobody', 'Lease Start': new Date('2019-01-01'),
        'Lease End': new Date('2022-01-01'), 'Termination Date': new Date('2022-01-01'), 'Monthly Rent': 3000,
      }],
    });
    const preview = await service.previewImport(file, 'p1');
    expect(preview.tenancies[0].status).toBe('error');
    expect(preview.tenancies[0].errors[0]).toMatch(/was not found in this project/);
  });

  it('refuses a future termination date, mirroring backfillTenancy', async () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const file = await buildFile({
      tenancies: [{
        'Unit Number': '300', 'Tenant Name': 'Brasstap', 'Lease Start': new Date('2019-01-01'),
        'Lease End': future, 'Termination Date': future, 'Monthly Rent': 3000,
      }],
    });
    const preview = await service.previewImport(file, 'p1');
    expect(preview.tenancies[0].status).toBe('error');
    expect(preview.tenancies[0].errors.join(' ')).toMatch(/has not ended yet/);
  });

  it('catches two rows for the same unit overlapping within the same file', async () => {
    const file = await buildFile({
      tenancies: [
        { 'Unit Number': '300', 'Tenant Name': 'Tenant A', 'Lease Start': new Date('2019-01-01'), 'Lease End': new Date('2021-01-01'), 'Termination Date': new Date('2021-01-01'), 'Monthly Rent': 3000 },
        { 'Unit Number': '300', 'Tenant Name': 'Tenant B', 'Lease Start': new Date('2020-06-01'), 'Lease End': new Date('2022-01-01'), 'Termination Date': new Date('2022-01-01'), 'Monthly Rent': 3200 },
      ],
    });
    const preview = await service.previewImport(file, 'p1');
    expect(preview.tenancies[1].status).toBe('error');
    expect(preview.tenancies[1].errors.join(' ')).toMatch(/Overlaps another row/);
  });

  describe('R8 — combined deal proportional rent split', () => {
    it('splits a group total by sqft when one row carries the total and others are blank', async () => {
      const file = await buildFile({
        tenancies: [
          { 'Unit Number': '701', 'Tenant Name': 'Malabar Gold', Sqft: 3000, 'Lease Start': new Date('2024-11-14'), 'Lease End': new Date('2029-11-14'), 'Termination Date': new Date('2025-01-01'), 'Monthly Rent': 12500, 'Combined Deal Reference': 'DEAL-1' },
          { 'Unit Number': '702', 'Tenant Name': 'Malabar Gold', Sqft: 1000, 'Lease Start': new Date('2024-11-14'), 'Lease End': new Date('2029-11-14'), 'Termination Date': new Date('2025-01-01'), 'Combined Deal Reference': 'DEAL-1' },
        ],
      });
      const preview = await service.previewImport(file, 'p1');
      const [row701, row702] = preview.tenancies;
      // BOTH rows are split: the 12,500 entered on row701 is the whole deal's rent, not
      // unit 701's. Leaving it whole and only splitting row702 billed the group 15,625.
      expect(row701.rentAutoSplit).toBe(true);
      expect(row702.rentAutoSplit).toBe(true);
      expect(row701.data.monthlyRent).toBeCloseTo(12500 * (3000 / 4000), 2);
      expect(row702.data.monthlyRent).toBeCloseTo(12500 * (1000 / 4000), 2);
      expect(row701.data.monthlyRent! + row702.data.monthlyRent!).toBeCloseTo(12500, 2);
      expect(row702.status).toBe('ready');
    });

    const DEAL = (unit: string, over: Record<string, any> = {}) => ({
      'Unit Number': unit, 'Tenant Name': 'We Fun', 'Lease Start': new Date('2024-01-01'),
      'Lease End': new Date('2029-01-01'), 'Termination Date': new Date('2025-01-01'),
      'Combined Deal Reference': 'DEAL-EVEN', ...over,
    });

    it('divides evenly when the sheet gives no per-unit Sqft at all', async () => {
      const preview = await service.previewImport(await buildFile({
        tenancies: [DEAL('300', { 'Monthly Rent': 9000 }), DEAL('701'), DEAL('702')],
      }), 'p1');
      expect(preview.summary.ready).toBe(3);
      expect(preview.tenancies.map((t) => t.data.monthlyRent)).toEqual([3000, 3000, 3000]);
      expect(preview.tenancies.every((t) => t.rentSplitBasis === 'even')).toBe(true);
      expect(preview.tenancies[0].warnings.join(' ')).toMatch(/divided equally across 3 units/);
    });

    /** One row carrying sqft is NOT enough: proportional would hand it 100% of the deal
     * and leave the others on zero. Real case — RRC2-B11-1105-1107. */
    it('divides evenly when only SOME rows carry Sqft', async () => {
      const preview = await service.previewImport(await buildFile({
        tenancies: [DEAL('300', { 'Monthly Rent': 9000, Sqft: 4009 }), DEAL('701'), DEAL('702')],
      }), 'p1');
      expect(preview.tenancies.map((t) => t.data.monthlyRent)).toEqual([3000, 3000, 3000]);
      expect(preview.tenancies[0].rentSplitBasis).toBe('even');
    });

    it('prefers proportional whenever every row has a usable Sqft', async () => {
      const preview = await service.previewImport(await buildFile({
        tenancies: [DEAL('300', { 'Monthly Rent': 9000, Sqft: 2000 }), DEAL('701', { Sqft: 1000 })],
      }), 'p1');
      expect(preview.tenancies.map((t) => t.data.monthlyRent)).toEqual([6000, 3000]);
      expect(preview.tenancies.every((t) => t.rentSplitBasis === 'sqft')).toBe(true);
      expect(preview.tenancies[0].warnings).toEqual([]);
    });

    it('treats a zero Sqft as unusable rather than allocating that unit nothing', async () => {
      const preview = await service.previewImport(await buildFile({
        tenancies: [DEAL('300', { 'Monthly Rent': 9000, Sqft: 3000 }), DEAL('701', { Sqft: 0 })],
      }), 'p1');
      expect(preview.tenancies.map((t) => t.data.monthlyRent)).toEqual([4500, 4500]);
      expect(preview.tenancies[0].rentSplitBasis).toBe('even');
    });

    it('never loses or invents a cent — an unevenly divisible total still sums exactly', async () => {
      const preview = await service.previewImport(await buildFile({
        tenancies: [DEAL('300', { 'Monthly Rent': 1000 }), DEAL('701'), DEAL('702')],
      }), 'p1');
      const shares = preview.tenancies.map((t) => t.data.monthlyRent!);
      expect(shares).toEqual([333.33, 333.33, 333.34]);
      expect(round2(shares.reduce((a, b) => a + b, 0))).toBe(1000);
    });

    /** A reused reference would otherwise split one tenant's rent across another's units. */
    it('refuses a Combined Deal Reference shared by two different tenants', async () => {
      const preview = await service.previewImport(await buildFile({
        tenancies: [DEAL('300', { 'Monthly Rent': 9000 }), DEAL('701', { 'Tenant Name': 'Someone Else' })],
      }), 'p1');
      expect(preview.tenancies.every((t) => t.status === 'error')).toBe(true);
      expect(preview.tenancies[0].errors.join(' ')).toMatch(/shared by more than one tenant/);
    });

    it('errors every blank row when the group has no unambiguous total', async () => {
      const file = await buildFile({
        tenancies: [
          { 'Unit Number': '701', 'Tenant Name': 'X', Sqft: 3000, 'Lease Start': new Date('2024-01-01'), 'Lease End': new Date('2029-01-01'), 'Termination Date': new Date('2025-01-01'), 'Combined Deal Reference': 'DEAL-2' },
          { 'Unit Number': '702', 'Tenant Name': 'X', Sqft: 1000, 'Lease Start': new Date('2024-01-01'), 'Lease End': new Date('2029-01-01'), 'Termination Date': new Date('2025-01-01'), 'Combined Deal Reference': 'DEAL-2' },
        ],
      });
      const preview = await service.previewImport(file, 'p1');
      expect(preview.tenancies.every((t) => t.status === 'error')).toBe(true);
    });
  });

  describe('column layout is checked before anything is parsed (2026-08-25)', () => {
    const GOOD = {
      'Unit Number': '300', 'Tenant Name': 'Brasstap', 'Lease Start': new Date('2019-01-01'),
      'Lease End': new Date('2022-01-01'), 'Termination Date': new Date('2022-01-01'), 'Monthly Rent': 3000,
    };
    async function mutateSheet(fn: (ws: ExcelJS.Worksheet) => void) {
      const file = await buildFile({ tenancies: [GOOD] });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(file as any);
      fn(wb.getWorksheet('Tenancies')!);
      return Buffer.from(await wb.xlsx.writeBuffer());
    }

    /** Rent PSF's own note says it is not stored, so people delete it. Everything after
     * then shifts one column left and is read from the wrong field. */
    it('refuses a sheet with a column deleted, naming the column and position', async () => {
      const file = await mutateSheet((ws) => ws.spliceColumns(12, 1));   // Rent PSF
      await expect(service.previewImport(file, 'p1')).rejects.toThrow(/column 12 should be "Rent PSF" but reads "Rent Start Date"/);
    });

    it('refuses a sheet with a column inserted, instead of silently parsing nothing', async () => {
      const file = await mutateSheet((ws) => ws.spliceColumns(1, 0, ['Project', 'Centro Plaza']));
      await expect(service.previewImport(file, 'p1')).rejects.toThrow(/column 1 should be "Unit Number" but reads "Project"/);
    });

    it('allows trailing columns to be missing — dropping the last one shifts nothing', async () => {
      const file = await mutateSheet((ws) => ws.spliceColumns(18, 1));   // Notes
      const preview = await service.previewImport(file, 'p1');
      expect(preview.tenancies[0].status).toBe('ready');
    });

    it('allows extra columns past the layout — that is where Project lives', async () => {
      const file = await mutateSheet((ws) => { ws.getRow(1).getCell(19).value = 'Project'; });
      const preview = await service.previewImport(file, 'p1');
      expect(preview.tenancies[0].status).toBe('ready');
    });

    it('ignores case and spacing differences in the headers', async () => {
      const file = await mutateSheet((ws) => { ws.getRow(1).getCell(1).value = '  unit   number '; });
      const preview = await service.previewImport(file, 'p1');
      expect(preview.tenancies[0].status).toBe('ready');
    });

    it('checks the auxiliary sheets too', async () => {
      const file = await buildFile({ tenancies: [GOOD] });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(file as any);
      wb.getWorksheet('Commission Installments')!.getRow(1).getCell(2).value = 'Buyer';
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      await expect(service.previewImport(buf, 'p1')).rejects.toThrow(/column 2 should be "Tenant Name" but reads "Buyer"/);
    });
  });

  describe('optional "Project" column — multi-project workbooks (2026-08-25)', () => {
    /** buildFile() only fills columns the template already has. A client-built workbook
     * bolts "Project" on past the end of that layout (column 19), which is exactly what
     * the header-text lookup has to find. */
    async function buildFileWithProjectColumn(rows: Record<string, any>[], projects: (string | undefined)[]) {
      const file = await buildFile({ tenancies: rows });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(file as any);
      const ws = wb.getWorksheet('Tenancies')!;
      const col = 19;
      ws.getRow(1).getCell(col).value = 'Project';
      projects.forEach((p, i) => { if (p !== undefined) ws.getRow(i + 2).getCell(col).value = p; });
      return Buffer.from(await wb.xlsx.writeBuffer());
    }

    const READY_300 = {
      'Unit Number': '300', 'Tenant Name': 'Tenant A', 'Lease Start': new Date('2019-01-01'),
      'Lease End': new Date('2022-01-01'), 'Termination Date': new Date('2022-01-01'), 'Monthly Rent': 3000,
    };
    const READY_701 = {
      'Unit Number': '701', 'Tenant Name': 'Tenant B', 'Lease Start': new Date('2019-01-01'),
      'Lease End': new Date('2022-01-01'), 'Termination Date': new Date('2022-01-01'), 'Monthly Rent': 4000,
    };

    it('reports the distinct project labels it found', async () => {
      const file = await buildFileWithProjectColumn([READY_300, READY_701], ['RRC', 'Centro Plaza']);
      const preview = await service.previewImport(file, 'p1');
      expect(preview.projectLabels).toEqual(['RRC', 'Centro Plaza']);
    });

    it('leaves a single-project workbook (and the template itself) completely alone', async () => {
      const sameLabel = await buildFileWithProjectColumn([READY_300, READY_701], ['RRC', 'RRC']);
      expect((await service.previewImport(sameLabel, 'p1')).summary.ready).toBe(2);

      const noColumn = await buildFile({ tenancies: [READY_300, READY_701] });
      const preview = await service.previewImport(noColumn, 'p1');
      expect(preview.projectLabels).toEqual([]);
      expect(preview.matchedProjectLabel).toBeNull();
      expect(preview.summary.ready).toBe(2);
      // The project is never even looked up when there is nothing to disambiguate.
      expect(mockPrisma.project.findMany).not.toHaveBeenCalled();
    });

    /** The bug this exists for: unit numbers repeat across projects, so a row belonging
     * to another project resolves against a same-numbered unit HERE and reads as ready.
     * The user is never asked which project — the one they uploaded from is the answer. */
    it('imports only the rows whose label matches this project, without asking', async () => {
      const file = await buildFileWithProjectColumn([READY_300, READY_701], ['RRC', 'Centro Plaza']);
      const preview = await service.previewImport(file, 'p1');
      expect(preview.matchedProjectLabel).toBe('RRC');
      expect(preview.summary.ready).toBe(1);
      expect(preview.tenancies[0].status).toBe('ready');
      expect(preview.tenancies[0].otherProject).toBeNull();
      expect(preview.tenancies[1].status).toBe('error');
      expect(preview.tenancies[1].otherProject).toBe('Centro Plaza');
      expect(preview.tenancies[1].errors.join(' ')).toMatch(/is for project "Centro Plaza" — this import is adding to "RRC Bldg 1-8"/);
    });

    /** Unit numbers repeat across projects, so a row carried for ANOTHER project very
     * often resolves against a same-numbered unit HERE. It is never written, so letting
     * it claim that unit's occupancy made legitimate rows fail as overlapping it — three
     * real Centro Plaza rows were blocked this way by RRC rows. */
    it('does not let another project\'s row occupy a unit in this one', async () => {
      const file = await buildFileWithProjectColumn(
        [
          { ...READY_300, 'Tenant Name': 'Foreign Tenant' },                 // other project
          { ...READY_300, 'Tenant Name': 'Our Tenant' },                     // same unit, ours
        ],
        ['Centro Plaza', 'RRC'],
      );
      const preview = await service.previewImport(file, 'p1');   // project is "RRC Bldg 1-8"
      expect(preview.tenancies[0].otherProject).toBe('Centro Plaza');
      expect(preview.tenancies[0].data.unitId).toBeNull();       // never resolved
      expect(preview.tenancies[0].errors).toHaveLength(1);       // only "belongs elsewhere"
      expect(preview.tenancies[1].status).toBe('ready');         // ours is NOT blocked
      expect(preview.tenancies[1].errors).toEqual([]);
    });

    it('picks the more specific of two overlapping labels', async () => {
      mockPrisma.project.findMany.mockResolvedValue([{ id: 'p1', name: 'RRC Phase 2 Bldg 9-12' }]);
      const file = await buildFileWithProjectColumn([READY_300, READY_701], ['RRC', 'RRC Phase II']);
      const preview = await service.previewImport(file, 'p1');
      expect(preview.matchedProjectLabel).toBe('RRC Phase II');
      expect(preview.tenancies[0].otherProject).toBe('RRC');
      expect(preview.tenancies[1].otherProject).toBeNull();
    });

    /** A naming mismatch we cannot read is not a reason to refuse the file — the rows
     * still import, and the UI warns instead of blocking. */
    it('imports everything and flags no match when no label resembles this project', async () => {
      mockPrisma.project.findMany.mockResolvedValue([{ id: 'p1', name: 'Somewhere Else' }]);
      const file = await buildFileWithProjectColumn([READY_300, READY_701], ['RRC', 'Centro Plaza']);
      const preview = await service.previewImport(file, 'p1');
      expect(preview.matchedProjectLabel).toBeNull();
      expect(preview.summary.ready).toBe(2);
      expect(preview.tenancies.every((t) => t.otherProject === null)).toBe(true);
    });
  });

  describe('matchProjectLabel', () => {
    it('matches a short sheet label against the app\'s longer project name', () => {
      expect(matchProjectLabel(['RRC', 'Centro Plaza'], 'RRC Bldg 1-8')).toBe('RRC');
      expect(matchProjectLabel(['RRC', 'Centro Plaza'], 'Centro Plaza')).toBe('Centro Plaza');
    });

    it('reads roman-numeral phases as their digits', () => {
      expect(matchProjectLabel(['RRC Phase II'], 'RRC Phase 2 Bldg 9-12')).toBe('RRC Phase II');
    });

    it('prefers the longest match so the two RRC projects stay apart', () => {
      expect(matchProjectLabel(['RRC', 'RRC Phase II'], 'RRC Phase 2 Bldg 9-12')).toBe('RRC Phase II');
      expect(matchProjectLabel(['RRC', 'RRC Phase II'], 'RRC Bldg 1-8')).toBe('RRC');
    });

    /** Live data, 2026-08-24: a project named plainly "RRC" exists alongside the phase-2
     * one. Longest-match alone handed it the "RRC Phase II" rows, because "rrcphase2"
     * contains "rrc" — an exact match has to win first. */
    it('gives an exactly-named project its own label, not a longer one that contains it', () => {
      expect(matchProjectLabel(['RRC', 'RRC Phase II'], 'RRC')).toBe('RRC');
      expect(matchProjectLabel(['RRC', 'RRC Phase II'], 'RRC Bldg 1-8')).toBe('RRC');
      expect(matchProjectLabel(['RRC', 'RRC Phase II'], 'RRC Phase 2 Bldg 9-12')).toBe('RRC Phase II');
    });

    it('accepts a label MORE specific than the project name, but only when unambiguous', () => {
      expect(matchProjectLabel(['Centro Plaza'], 'Centro')).toBe('Centro Plaza');
      // Two labels both contain "RRC" — guessing either would file rows under the wrong
      // project, so this reports no match and the caller warns instead of filtering.
      expect(matchProjectLabel(['RRC Phase II', 'RRC Phase III'], 'RRC')).toBeNull();
    });

    /** Containment alone is blind to the qualifier that separates two projects: importing
     * into "Centro Plaza II", "centroplaza2" contains "centroplaza", so the phase-I rows
     * were claimed AND the banner said the filter had worked. */
    it('will not claim a label that another project names more convincingly', () => {
      expect(matchProjectLabel(['Centro Plaza', 'RRC'], 'Centro Plaza II', ['Centro Plaza'])).toBeNull();
      // With no such rival there is nothing better, so it still matches.
      expect(matchProjectLabel(['Centro Plaza', 'RRC'], 'Centro Plaza II', ['RRC Bldg 1-8'])).toBe('Centro Plaza');
    });

    it('is not contested by a project whose own best label is a different one', () => {
      // "RRC Phase 2 Bldg 9-12" contains "RRC", but its own best label is "RRC Phase II",
      // so it makes no claim on the bare "RRC" rows.
      expect(matchProjectLabel(['RRC', 'RRC Phase II'], 'RRC Bldg 1-8', ['RRC Phase 2 Bldg 9-12'])).toBe('RRC');
      expect(matchProjectLabel(['RRC', 'RRC Phase II'], 'RRC Phase 2 Bldg 9-12', ['RRC Bldg 1-8'])).toBe('RRC Phase II');
    });

    it('refuses when two projects are named alike enough to both claim one label', () => {
      // The duplicate RRC projects seen in live data on 2026-08-24.
      expect(matchProjectLabel(['RRC', 'Centro Plaza'], 'RRC Bldg 1-8', ['RRC'])).toBeNull();
    });

    it('returns null rather than guessing when nothing resembles the project', () => {
      expect(matchProjectLabel(['POW Lewisville', 'Prime Leander'], 'Centro Plaza')).toBeNull();
      expect(matchProjectLabel([], 'Centro Plaza')).toBeNull();
    });
  });

  describe('leases already on the unit (2026-08-25)', () => {
    const ROW = (over: Record<string, any> = {}) => ({
      'Unit Number': '300', 'Tenant Name': 'Sangam Chettinad Restaurant',
      'Lease Start': new Date('2024-04-30'), 'Lease End': new Date('2034-12-31'),
      'Monthly Rent': 3000, ...over,
    });
    const EXISTING = (over: Record<string, any> = {}) => ({
      unitId: 'u300', tenantName: 'Sangam Chettinad Restaurant', tenantBrand: 'Sangam Chettinad',
      status: 'ACTIVE', monthlyRent: 3000, leaseStart: new Date('2024-04-30'),
      leaseEnd: new Date('2034-12-31'), terminationDate: null, ...over,
    });

    /** The failure this exists for: previously the preview only compared rows to each
     * other, so a second upload of the same file showed every row green and then failed
     * one by one at commit against lease_unit_no_overlap. */
    it('marks a row already imported as a duplicate, not an error', async () => {
      mockPrisma.lease.findMany.mockResolvedValue([EXISTING()]);
      const preview = await service.previewImport(await buildFile({ tenancies: [ROW()] }), 'p1');
      expect(preview.tenancies[0].status).toBe('duplicate');
      expect(preview.tenancies[0].errors).toEqual([]);
      expect(preview.summary).toEqual({ total: 1, ready: 0, errors: 0, duplicates: 1, skippedOtherProject: 0 });
    });

    /** Real data: unit 203 is "JB Sree Ventures" trading as "Brickerz Club". Matching on
     * tenantName alone reported a repeat of the same tenancy as a clash with a stranger. */
    it('recognises the same party by trading name as well as legal name', async () => {
      mockPrisma.lease.findMany.mockResolvedValue([
        EXISTING({ tenantName: 'JB Sree Ventures', tenantBrand: 'Brickerz Club' }),
      ]);
      const preview = await service.previewImport(
        await buildFile({ tenancies: [ROW({ 'Tenant Name': 'Brickerz Club' })] }), 'p1');
      expect(preview.tenancies[0].status).toBe('duplicate');
    });

    it('reports a genuine clash with a different tenant, naming both its names', async () => {
      mockPrisma.lease.findMany.mockResolvedValue([
        EXISTING({ tenantName: 'Someone Else Ltd', tenantBrand: 'Other Brand' }),
      ]);
      const preview = await service.previewImport(await buildFile({ tenancies: [ROW()] }), 'p1');
      expect(preview.tenancies[0].status).toBe('error');
      expect(preview.tenancies[0].errors.join(' '))
        .toMatch(/Overlaps a lease already on this unit: Someone Else Ltd \(trading as Other Brand\), 2024-04-30 to 2034-12-31, active/);
    });

    /** The DB constraint uses '[)' bounds, so a lease may start the day another ends. */
    it('allows same-day turnover against an existing lease', async () => {
      mockPrisma.lease.findMany.mockResolvedValue([
        EXISTING({ tenantName: 'Previous Tenant', tenantBrand: null, leaseEnd: new Date('2024-04-30') }),
      ]);
      const preview = await service.previewImport(await buildFile({ tenancies: [ROW()] }), 'p1');
      expect(preview.tenancies[0].status).toBe('ready');
    });

    it('ranges an early-terminated lease over its move-out date, not its contracted end', async () => {
      mockPrisma.lease.findMany.mockResolvedValue([
        EXISTING({ tenantName: 'Left Early', tenantBrand: null, terminationDate: new Date('2024-01-31') }),
      ]);
      const preview = await service.previewImport(await buildFile({ tenancies: [ROW()] }), 'p1');
      expect(preview.tenancies[0].status).toBe('ready');
    });

    it('still reports a row that is both a repeat AND otherwise broken as an error', async () => {
      mockPrisma.lease.findMany.mockResolvedValue([EXISTING()]);
      const preview = await service.previewImport(
        await buildFile({ tenancies: [ROW({ 'Broker Name': 'Nobody' })] }), 'p1');
      expect(preview.tenancies[0].status).toBe('error');
    });

    /** The trap behind the five combined deals still wrong in live data: the lead row is
     * skipped as a duplicate, so its stored rent is never corrected and the group keeps
     * billing the difference. Skipping quietly is what made it invisible. */
    it('warns when a duplicate is stored at a different rent than this file splits to', async () => {
      mockPrisma.lease.findMany.mockResolvedValue([EXISTING({ monthlyRent: 7557.33 })]);
      const preview = await service.previewImport(await buildFile({ tenancies: [ROW()] }), 'p1');
      expect(preview.tenancies[0].status).toBe('duplicate');
      expect(preview.tenancies[0].warnings.join(' '))
        .toMatch(/Already imported at 7,557.33\/mo, but this file splits it to 3,000.00\/mo/);
    });

    it('stays quiet when the duplicate already holds the right rent', async () => {
      mockPrisma.lease.findMany.mockResolvedValue([EXISTING({ monthlyRent: 3000 })]);
      const preview = await service.previewImport(await buildFile({ tenancies: [ROW()] }), 'p1');
      expect(preview.tenancies[0].status).toBe('duplicate');
      expect(preview.tenancies[0].warnings).toEqual([]);
    });

    /** One tenant, two units — a combined deal, entered as one row per unit. Overlap is
     * per UNIT, so this must never be read as the same tenancy twice. */
    it('lets one tenant hold two units at the same time', async () => {
      mockPrisma.lease.findMany.mockResolvedValue([]);
      const preview = await service.previewImport(await buildFile({
        tenancies: [
          ROW({ 'Unit Number': '701', 'Tenant Name': 'We Fun', 'Sqft': 1000, 'Combined Deal Reference': 'CEN-701-702' }),
          ROW({ 'Unit Number': '702', 'Tenant Name': 'We Fun', 'Sqft': 1000, 'Monthly Rent': null, 'Combined Deal Reference': 'CEN-701-702' }),
        ],
      }), 'p1');
      expect(preview.summary).toEqual({ total: 2, ready: 2, errors: 0, duplicates: 0, skippedOtherProject: 0 });
      // The group total is split by sqft across the two units, not counted twice.
      expect(preview.tenancies.map((t) => t.data.monthlyRent)).toEqual([1500, 1500]);
      expect(preview.tenancies.reduce((sum, t) => sum + (t.data.monthlyRent ?? 0), 0)).toBe(3000);
    });

    it('still catches the same tenant twice on the SAME unit', async () => {
      mockPrisma.lease.findMany.mockResolvedValue([]);
      const preview = await service.previewImport(await buildFile({
        tenancies: [ROW({ 'Tenant Name': 'We Fun' }), ROW({ 'Tenant Name': 'We Fun' })],
      }), 'p1');
      expect(preview.tenancies[1].status).toBe('error');
      expect(preview.tenancies[1].errors.join(' ')).toMatch(/Overlaps another row for the same unit/);
    });
  });

  describe('preview-entered fixes on the TEMPLATE path (2026-08-25)', () => {
    /** These three levers existed only on the generic-mapping path. The client's own
     * workbook is a template upload, so a template row with a commission and no broker
     * had no way out at all — 10 rows of the 2026-08-25 file. */
    const NO_BROKER = {
      'Unit Number': '300', 'Tenant Name': 'Brasstap', 'Lease Start': new Date('2019-01-01'),
      'Lease End': new Date('2022-01-01'), 'Termination Date': new Date('2022-01-01'), 'Monthly Rent': 3000,
    };

    it('accepts a sheet-wide default broker for a row carrying commission', async () => {
      const file = await buildFile({
        tenancies: [NO_BROKER],
        commissions: [{ 'Unit Number': '300', 'Tenant Name': 'Brasstap', 'Installment Number': 1, Amount: 5000 }],
      });
      expect((await service.previewImport(file, 'p1')).tenancies[0].errors.join(' '))
        .toMatch(/no Broker Name was set/);

      const fixed = await service.previewImport(file, 'p1', { defaultBrokerId: 'b1' });
      expect(fixed.tenancies[0].status).toBe('ready');
      expect(fixed.tenancies[0].data.brokerId).toBe('b1');
      expect(fixed.tenancies[0].data.commissionInstallments).toHaveLength(1);
    });

    it('accepts a broker chosen for one specific row', async () => {
      const file = await buildFile({
        tenancies: [NO_BROKER],
        commissions: [{ 'Unit Number': '300', 'Tenant Name': 'Brasstap', 'Installment Number': 1, Amount: 5000 }],
      });
      const fixed = await service.previewImport(file, 'p1', { rowOverrides: { 2: { brokerId: 'b1' } } });
      expect(fixed.tenancies[0].status).toBe('ready');
      expect(fixed.tenancies[0].data.brokerId).toBe('b1');
    });

    it('ignores a broker id that is not a real broker', async () => {
      const file = await buildFile({
        tenancies: [NO_BROKER],
        commissions: [{ 'Unit Number': '300', 'Tenant Name': 'Brasstap', 'Installment Number': 1, Amount: 5000 }],
      });
      const preview = await service.previewImport(file, 'p1', { defaultBrokerId: 'not-a-broker' });
      expect(preview.tenancies[0].status).toBe('error');
      expect(preview.tenancies[0].errors.join(' ')).toMatch(/no Broker Name was set/);
    });

    it('never overrides a broker the row already named itself', async () => {
      const file = await buildFile({
        tenancies: [{ ...NO_BROKER, 'Broker Name': 'Tester' }],
        commissions: [{ 'Unit Number': '300', 'Tenant Name': 'Brasstap', 'Installment Number': 1, Amount: 5000 }],
      });
      const preview = await service.previewImport(file, 'p1', { defaultBrokerId: 'b-other' });
      expect(preview.tenancies[0].status).toBe('ready');
      expect(preview.tenancies[0].data.brokerId).toBe('b1');   // the sheet's own broker
    });

    /** Six rows of the client's file name "Joyce Poe, Linc Realty", which matches no
     * broker record. Picking the right broker in the preview has to be able to correct
     * that, or the only route is creating a broker by that exact string. */
    it('lets a per-row broker correct a Broker Name that did not resolve', async () => {
      const file = await buildFile({ tenancies: [{ ...NO_BROKER, 'Broker Name': 'Joyce Poe, Linc Realty' }] });
      const before = await service.previewImport(file, 'p1');
      expect(before.tenancies[0].status).toBe('error');
      expect(before.tenancies[0].errors.join(' ')).toMatch(/Broker "Joyce Poe, Linc Realty" was not found/);

      const fixed = await service.previewImport(file, 'p1', { rowOverrides: { 2: { brokerId: 'b1' } } });
      expect(fixed.tenancies[0].status).toBe('ready');
      expect(fixed.tenancies[0].data.brokerId).toBe('b1');
    });

    it('does NOT let a sheet-wide default silently replace an unresolved Broker Name', async () => {
      const file = await buildFile({ tenancies: [{ ...NO_BROKER, 'Broker Name': 'Joyce Poe, Linc Realty' }] });
      const preview = await service.previewImport(file, 'p1', { defaultBrokerId: 'b1' });
      expect(preview.tenancies[0].status).toBe('error');
      expect(preview.tenancies[0].errors.join(' ')).toMatch(/was not found/);
    });

    it('fills a Lease End the source never recorded', async () => {
      const file = await buildFile({
        tenancies: [{ ...NO_BROKER, 'Lease End': null }],
      });
      expect((await service.previewImport(file, 'p1')).tenancies[0].errors.join(' ')).toMatch(/Lease End is required/);

      const fixed = await service.previewImport(file, 'p1', { rowOverrides: { 2: { leaseEnd: '2022-01-01' } } });
      expect(fixed.tenancies[0].status).toBe('ready');
      expect(fixed.tenancies[0].data.leaseEnd).toBe('2022-01-01');
    });

    it('replaces a free-text Termination Reason with a real one', async () => {
      const file = await buildFile({
        tenancies: [{ ...NO_BROKER, 'Termination Reason': 'Vacated / business sold - unit re-let' }],
      });
      expect((await service.previewImport(file, 'p1')).tenancies[0].errors.join(' ')).toMatch(/Termination Reason/);

      const fixed = await service.previewImport(file, 'p1', { rowOverrides: { 2: { terminationReason: 'early_termination' } } });
      expect(fixed.tenancies[0].status).toBe('ready');
      expect(fixed.tenancies[0].data.terminationReason).toBe('EARLY_TERMINATION');
    });

    /** An override is "as if the sheet said it" — so it is validated, never trusted. */
    it('still refuses a hand-entered value that breaks the same rules a parsed one would', async () => {
      const file = await buildFile({ tenancies: [{ ...NO_BROKER, 'Lease End': null }] });
      const preview = await service.previewImport(file, 'p1', { rowOverrides: { 2: { leaseEnd: '2018-01-01' } } });
      expect(preview.tenancies[0].status).toBe('error');
      expect(preview.tenancies[0].errors.join(' ')).toMatch(/Lease End cannot be before Lease Start/);
    });

    it('leaves values the sheet DID provide alone, and ignores an empty override', async () => {
      const file = await buildFile({ tenancies: [NO_BROKER] });
      const preview = await service.previewImport(file, 'p1', {
        rowOverrides: { 2: { leaseEnd: '', monthlyRent: undefined } as any },
      });
      expect(preview.tenancies[0].status).toBe('ready');
      expect(preview.tenancies[0].data.leaseEnd).toBe('2022-01-01');
      expect(preview.tenancies[0].data.monthlyRent).toBe(3000);
    });

    it('only touches the row it names', async () => {
      const file = await buildFile({
        tenancies: [{ ...NO_BROKER, 'Lease End': null }, { ...NO_BROKER, 'Unit Number': '701', 'Lease End': null }],
      });
      const preview = await service.previewImport(file, 'p1', { rowOverrides: { 2: { leaseEnd: '2022-01-01' } } });
      expect(preview.tenancies[0].status).toBe('ready');
      expect(preview.tenancies[1].status).toBe('error');
    });

    /** A hand-entered rent is just another figure, so a combined deal splits it as usual. */
    it('splits a combined deal from a hand-entered total', async () => {
      const file = await buildFile({
        tenancies: [
          { ...NO_BROKER, Sqft: 3000, 'Monthly Rent': null, 'Combined Deal Reference': 'D1' },
          { ...NO_BROKER, 'Unit Number': '701', Sqft: 1000, 'Monthly Rent': null, 'Combined Deal Reference': 'D1' },
        ],
      });
      const preview = await service.previewImport(file, 'p1', { rowOverrides: { 2: { monthlyRent: 8000 } } });
      expect(preview.tenancies.map((t) => t.data.monthlyRent)).toEqual([6000, 2000]);
      expect(preview.summary.ready).toBe(2);
    });
  });

  describe('unit numbers are matched case-insensitively (2026-08-25)', () => {
    /** Building names were already compared case-insensitively; unit numbers were not.
     * A sheet writing "e2" failed to find the unit recorded as "E2", reported it missing,
     * and the preview then offered to create it — a second record for one space. */
    it('matches a unit whose recorded number differs only in case or spacing', async () => {
      mockPrisma.unit.findMany.mockResolvedValue([
        { id: 'uE2', unitNumber: 'E2', building: { name: 'B' } },
      ]);
      const file = await buildFile({
        tenancies: [{
          'Unit Number': ' e2 ', 'Tenant Name': 'Case Co', 'Lease Start': new Date('2019-01-01'),
          'Lease End': new Date('2022-01-01'), 'Termination Date': new Date('2022-01-01'), 'Monthly Rent': 3000,
        }],
      });
      const preview = await service.previewImport(file, 'p1');
      expect(preview.tenancies[0].status).toBe('ready');
      expect(preview.tenancies[0].data.unitId).toBe('uE2');
    });

    it('still reports a genuinely different unit number as missing', async () => {
      mockPrisma.unit.findMany.mockResolvedValue([
        { id: 'uE2', unitNumber: 'E2', building: { name: 'B' } },
      ]);
      const file = await buildFile({
        tenancies: [{
          'Unit Number': 'E20', 'Tenant Name': 'Other Co', 'Lease Start': new Date('2019-01-01'),
          'Lease End': new Date('2022-01-01'), 'Termination Date': new Date('2022-01-01'), 'Monthly Rent': 3000,
        }],
      });
      const preview = await service.previewImport(file, 'p1');
      expect(preview.tenancies[0].errors.join(' ')).toMatch(/was not found in this project/);
    });
  });

  describe('building label on every preview row (parity with SalePreviewRow)', () => {
    it('surfaces the sheet\'s raw Building label, resolved or not', async () => {
      const file = await buildFile({
        tenancies: [
          { 'Unit Number': '300', 'Building': 'Building A', 'Tenant Name': 'Tenant A', 'Lease Start': new Date('2019-01-01'), 'Lease End': new Date('2022-01-01'), 'Termination Date': new Date('2022-01-01'), 'Monthly Rent': 3000 },
          { 'Unit Number': '9999', 'Building': 'Building Z', 'Tenant Name': 'Tenant B', 'Lease Start': new Date('2019-01-01'), 'Lease End': new Date('2022-01-01'), 'Termination Date': new Date('2022-01-01'), 'Monthly Rent': 3000 },
        ],
      });
      const preview = await service.previewImport(file, 'p1');
      // The unresolved row is the one that needs it — that label is what the "create
      // this building" step offers, so it must survive even when nothing matched.
      expect(preview.tenancies.map((t) => t.building)).toEqual(['Building A', 'Building Z']);
    });
  });

  describe('Ledger Exceptions join (Unit Number + Tenant Name)', () => {
    it('attaches a collections override to the matching tenancy row', async () => {
      const file = await buildFile({
        tenancies: [{ 'Unit Number': '300', 'Tenant Name': 'Brasstap', 'Lease Start': new Date('2019-01-01'), 'Lease End': new Date('2022-01-01'), 'Termination Date': new Date('2022-01-01'), 'Monthly Rent': 3000 }],
        ledgerExceptions: [{ 'Unit Number': '300', 'Tenant Name': 'Brasstap', Month: '2019-03', 'Amount Collected': 1500 }],
      });
      const preview = await service.previewImport(file, 'p1');
      expect(preview.tenancies[0].data.collections).toEqual({ '2019-03': 1500 });
      expect(preview.orphaned).toHaveLength(0);
    });

    it('orphans an exception row that matches no tenancy', async () => {
      const file = await buildFile({
        tenancies: [{ 'Unit Number': '300', 'Tenant Name': 'Brasstap', 'Lease Start': new Date('2019-01-01'), 'Lease End': new Date('2022-01-01'), 'Termination Date': new Date('2022-01-01'), 'Monthly Rent': 3000 }],
        ledgerExceptions: [{ 'Unit Number': '300', 'Tenant Name': 'Someone Else', Month: '2019-03', 'Amount Collected': 1500 }],
      });
      const preview = await service.previewImport(file, 'p1');
      expect(preview.orphaned).toHaveLength(1);
      expect(preview.orphaned[0].error).toMatch(/No Tenancies row matches/);
    });
  });

  describe('Commission Installments join', () => {
    it('requires a Broker Name on the tenancy row before accepting an installment', async () => {
      const file = await buildFile({
        tenancies: [{ 'Unit Number': '300', 'Tenant Name': 'Brasstap', 'Lease Start': new Date('2019-01-01'), 'Lease End': new Date('2022-01-01'), 'Termination Date': new Date('2022-01-01'), 'Monthly Rent': 3000 }],
        commissions: [{ 'Unit Number': '300', 'Tenant Name': 'Brasstap', 'Installment Number': 1, Amount: 500 }],
      });
      const preview = await service.previewImport(file, 'p1');
      expect(preview.tenancies[0].status).toBe('error');
      expect(preview.tenancies[0].errors.join(' ')).toMatch(/no Broker Name was set/);
    });

    it('attaches installments when a broker resolves', async () => {
      const file = await buildFile({
        tenancies: [{ 'Unit Number': '300', 'Tenant Name': 'Brasstap', 'Broker Name': 'Tester', 'Lease Start': new Date('2019-01-01'), 'Lease End': new Date('2022-01-01'), 'Termination Date': new Date('2022-01-01'), 'Monthly Rent': 3000 }],
        commissions: [
          { 'Unit Number': '300', 'Tenant Name': 'Brasstap', 'Installment Number': 1, Amount: 500, 'Paid Date': new Date('2019-01-15') },
          { 'Unit Number': '300', 'Tenant Name': 'Brasstap', 'Installment Number': 2, Amount: 500 },
        ],
      });
      const preview = await service.previewImport(file, 'p1');
      expect(preview.tenancies[0].data.brokerId).toBe('b1');
      expect(preview.tenancies[0].data.commissionInstallments).toHaveLength(2);
      expect(preview.tenancies[0].status).toBe('ready');
    });
  });
});

/** Builds a raw .xlsx buffer with ARBITRARY headers (not our template) — this is what a
 * client's own spreadsheet looks like to the generic column-mapping path (R9). */
async function buildGenericFile(headers: string[], rows: string[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(r));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe('LeaseImportService.analyzeGenericFile (R9)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('suggests a mapping for an arbitrary row-per-record sheet without touching the DB', async () => {
    const service = makeService();
    const file = await buildGenericFile(
      ['Unit no', 'Tenant', 'Sqft', 'Leased Date'],
      [['300', 'Acme Corp', '1200', '2019-01-01']],
    );
    const result = await service.analyzeGenericFile(file);
    expect(result.orientation).toBe('rows');
    expect(result.supported).toBe(true);
    expect(result.fields.map((f) => f.suggestedField)).toEqual(['unitNumber', 'tenantName', 'sqft', 'leaseStart']);
    expect(mockPrisma.unit.findMany).not.toHaveBeenCalled();
  });

  it('rejects a file that is not a readable spreadsheet', async () => {
    const service = makeService();
    await expect(service.analyzeGenericFile(Buffer.from('not a spreadsheet'))).rejects.toThrow(/Could not read this file/);
  });
});

describe('LeaseImportService.previewMappedImport (R9)', () => {
  let service: LeaseImportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.unit.findMany.mockResolvedValue(BASE_UNITS);
    mockPrisma.broker.findMany.mockResolvedValue([]);
    mockPrisma.lease.findMany.mockResolvedValue([]);
  });

  it('parses via the confirmed mapping and runs the same validation previewImport uses', async () => {
    const file = await buildGenericFile(
      ['Unit no', 'Tenant', 'Start', 'End', 'Moved Out', 'Rent'],
      [['300', 'Brasstap', '2019-01-01', '2022-01-01', '2022-01-01', '3000']],
    );
    const mapping = {
      orientation: 'rows' as const,
      columns: [
        { columnIndex: 0, field: 'unitNumber' },
        { columnIndex: 1, field: 'tenantName' },
        { columnIndex: 2, field: 'leaseStart' },
        { columnIndex: 3, field: 'leaseEnd' },
        { columnIndex: 4, field: 'terminationDate' },
        { columnIndex: 5, field: 'monthlyRent' },
      ],
    };
    const preview = await service.previewMappedImport(file, 'p1', mapping);
    expect(preview.summary).toEqual({ total: 1, ready: 1, errors: 0, duplicates: 0, skippedOtherProject: 0 });
    expect(preview.tenancies[0].data.unitId).toBe('u300');
    expect(preview.orphaned).toHaveLength(0);
  });

  it('splits a combined PSF/Total column via the mapping and still validates correctly', async () => {
    const file = await buildGenericFile(
      ['Unit no', 'Tenant', 'Start', 'End', 'Moved Out', 'Rent(PSF/Month)'],
      [['300', 'Brasstap', '2019-01-01', '2022-01-01', '2022-01-01', '$2.50/$3000']],
    );
    const mapping = {
      orientation: 'rows' as const,
      columns: [
        { columnIndex: 0, field: 'unitNumber' },
        { columnIndex: 1, field: 'tenantName' },
        { columnIndex: 2, field: 'leaseStart' },
        { columnIndex: 3, field: 'leaseEnd' },
        { columnIndex: 4, field: 'terminationDate' },
        { columnIndex: 5, field: 'rentPsf', splitPart: 'psf' as const },
        { columnIndex: 5, field: 'monthlyRent', splitPart: 'total' as const },
      ],
    };
    const preview = await service.previewMappedImport(file, 'p1', mapping);
    expect(preview.tenancies[0].status).toBe('ready');
    expect(preview.tenancies[0].data.monthlyRent).toBe(3000);
  });

  it('flags a row still missing required fields after mapping, same as the template path', async () => {
    const file = await buildGenericFile(['Unit no', 'Tenant'], [['300', 'Brasstap']]);
    const mapping = { orientation: 'rows' as const, columns: [{ columnIndex: 0, field: 'unitNumber' }, { columnIndex: 1, field: 'tenantName' }] };
    const preview = await service.previewMappedImport(file, 'p1', mapping);
    expect(preview.tenancies[0].status).toBe('error');
    expect(preview.tenancies[0].errors.join(' ')).toMatch(/Lease Start is required/);
  });

  describe('R9 field-gap audit (2026-08-23)', () => {
    it('derives Lease End from a "10years"-style duration when Lease End is not mapped', async () => {
      const file = await buildGenericFile(
        ['Unit no', 'Tenant', 'Leased Date', 'Lease Term', 'Moved Out', 'Rent'],
        [['300', 'Brasstap', '2019-01-01', '10years', '2022-01-01', '3000']],
      );
      const mapping = {
        orientation: 'rows' as const,
        columns: [
          { columnIndex: 0, field: 'unitNumber' },
          { columnIndex: 1, field: 'tenantName' },
          { columnIndex: 2, field: 'leaseStart' },
          { columnIndex: 3, field: 'leaseTermMonths' },
          { columnIndex: 4, field: 'terminationDate' },
          { columnIndex: 5, field: 'monthlyRent' },
        ],
      };
      const preview = await service.previewMappedImport(file, 'p1', mapping);
      expect(preview.tenancies[0].data.leaseEnd).toBe('2029-01-01');
      expect(preview.tenancies[0].status).toBe('ready');
    });

    it('takes an explicitly-mapped Lease End over a derived one', async () => {
      const file = await buildGenericFile(
        ['Unit no', 'Tenant', 'Leased Date', 'Lease End', 'Lease Term', 'Moved Out', 'Rent'],
        [['300', 'Brasstap', '2019-01-01', '2021-01-01', '10years', '2020-01-01', '3000']],
      );
      const mapping = {
        orientation: 'rows' as const,
        columns: [
          { columnIndex: 0, field: 'unitNumber' },
          { columnIndex: 1, field: 'tenantName' },
          { columnIndex: 2, field: 'leaseStart' },
          { columnIndex: 3, field: 'leaseEnd' },
          { columnIndex: 4, field: 'leaseTermMonths' },
          { columnIndex: 5, field: 'terminationDate' },
          { columnIndex: 6, field: 'monthlyRent' },
        ],
      };
      const preview = await service.previewMappedImport(file, 'p1', mapping);
      expect(preview.tenancies[0].data.leaseEnd).toBe('2021-01-01');
    });

    it('errors a row with commission installments mapped but no Broker Name mapped', async () => {
      const file = await buildGenericFile(
        ['Unit no', 'Tenant', 'Start', 'End', 'Moved Out', 'Rent', '1st Commission'],
        [['300', 'Brasstap', '2019-01-01', '2022-01-01', '2022-01-01', '3000', '5000']],
      );
      const mapping = {
        orientation: 'rows' as const,
        columns: [
          { columnIndex: 0, field: 'unitNumber' },
          { columnIndex: 1, field: 'tenantName' },
          { columnIndex: 2, field: 'leaseStart' },
          { columnIndex: 3, field: 'leaseEnd' },
          { columnIndex: 4, field: 'terminationDate' },
          { columnIndex: 5, field: 'monthlyRent' },
          { columnIndex: 6, field: 'commissionInstallment1' },
        ],
      };
      const preview = await service.previewMappedImport(file, 'p1', mapping);
      expect(preview.tenancies[0].status).toBe('error');
      expect(preview.tenancies[0].errors.join(' ')).toMatch(/no Broker Name was set/);
    });

    it('attaches commission installments when a Broker Name is also mapped and resolves', async () => {
      mockPrisma.broker.findMany.mockResolvedValue([{ id: 'b1', name: 'Tester' }]);
      const file = await buildGenericFile(
        ['Unit no', 'Tenant', 'Start', 'End', 'Moved Out', 'Rent', 'Broker', '1st Commission', '2nd Commission'],
        [['300', 'Brasstap', '2019-01-01', '2022-01-01', '2022-01-01', '3000', 'Tester', '5000', '2500']],
      );
      const mapping = {
        orientation: 'rows' as const,
        columns: [
          { columnIndex: 0, field: 'unitNumber' },
          { columnIndex: 1, field: 'tenantName' },
          { columnIndex: 2, field: 'leaseStart' },
          { columnIndex: 3, field: 'leaseEnd' },
          { columnIndex: 4, field: 'terminationDate' },
          { columnIndex: 5, field: 'monthlyRent' },
          { columnIndex: 6, field: 'brokerName' },
          { columnIndex: 7, field: 'commissionInstallment1' },
          { columnIndex: 8, field: 'commissionInstallment2' },
        ],
      };
      const preview = await service.previewMappedImport(file, 'p1', mapping);
      expect(preview.tenancies[0].status).toBe('ready');
      expect(preview.tenancies[0].data.commissionInstallments).toEqual([{ amount: 5000 }, { amount: 2500 }]);
    });

    it('takes the first email/phone out of a multi-value cell', async () => {
      const file = await buildGenericFile(
        ['Unit no', 'Tenant', 'Start', 'End', 'Moved Out', 'Rent', 'Email id', 'Contact no'],
        [['300', 'Brasstap', '2019-01-01', '2022-01-01', '2022-01-01', '3000', 'a@x.com\nb@y.com', '555-0001\n555-0002']],
      );
      const mapping = {
        orientation: 'rows' as const,
        columns: [
          { columnIndex: 0, field: 'unitNumber' },
          { columnIndex: 1, field: 'tenantName' },
          { columnIndex: 2, field: 'leaseStart' },
          { columnIndex: 3, field: 'leaseEnd' },
          { columnIndex: 4, field: 'terminationDate' },
          { columnIndex: 5, field: 'monthlyRent' },
          { columnIndex: 6, field: 'tenantEmail' },
          { columnIndex: 7, field: 'tenantPhone' },
        ],
      };
      const preview = await service.previewMappedImport(file, 'p1', mapping);
      expect(preview.tenancies[0].data.tenantEmail).toBe('a@x.com');
      expect(preview.tenancies[0].data.tenantPhone).toBe('555-0001');
    });

    it('passes landlordEntity, escalationPct, NNN and TI through to the row data', async () => {
      const file = await buildGenericFile(
        ['Unit no', 'Tenant', 'Start', 'End', 'Moved Out', 'Rent', 'LLC NAME (LANDLORD)', 'Annual Increase', 'NNN Total', 'TI Total'],
        [['300', 'Brasstap', '2019-01-01', '2022-01-01', '2022-01-01', '3000', 'Texas Hazelwood OP 2 LLC', '3', '2540.02', '182400']],
      );
      const mapping = {
        orientation: 'rows' as const,
        columns: [
          { columnIndex: 0, field: 'unitNumber' },
          { columnIndex: 1, field: 'tenantName' },
          { columnIndex: 2, field: 'leaseStart' },
          { columnIndex: 3, field: 'leaseEnd' },
          { columnIndex: 4, field: 'terminationDate' },
          { columnIndex: 5, field: 'monthlyRent' },
          { columnIndex: 6, field: 'landlordEntity' },
          { columnIndex: 7, field: 'escalationPct' },
          { columnIndex: 8, field: 'nnnTotalAmount' },
          { columnIndex: 9, field: 'tiAllowance' },
        ],
      };
      const preview = await service.previewMappedImport(file, 'p1', mapping);
      const data = preview.tenancies[0].data;
      expect(data.landlordEntity).toBe('Texas Hazelwood OP 2 LLC');
      expect(data.escalationPct).toBe(3);
      expect(data.nnnTotalAmount).toBe(2540.02);
      expect(data.tiAllowance).toBe(182400);
    });
  });

  describe('R9.2 — active tenancies and a default broker (2026-08-24)', () => {
    it('surfaces the mapped Sqft on the row itself, so a missing unit can be created with it pre-filled', async () => {
      const file = await buildGenericFile(
        ['Unit no', 'Tenant', 'Start', 'End', 'Moved Out', 'Rent', 'Sqft'],
        [['999', 'Brasstap', '2019-01-01', '2022-01-01', '2022-01-01', '3000', '1500']],
      );
      const mapping = {
        orientation: 'rows' as const,
        columns: [
          { columnIndex: 0, field: 'unitNumber' },
          { columnIndex: 1, field: 'tenantName' },
          { columnIndex: 2, field: 'leaseStart' },
          { columnIndex: 3, field: 'leaseEnd' },
          { columnIndex: 4, field: 'terminationDate' },
          { columnIndex: 5, field: 'monthlyRent' },
          { columnIndex: 6, field: 'sqft' },
        ],
      };
      const preview = await service.previewMappedImport(file, 'p1', mapping);
      // Unit 999 doesn't resolve (BASE_UNITS has no such unit) — sqft should still surface.
      expect(preview.tenancies[0].status).toBe('error');
      expect(preview.tenancies[0].sqft).toBe(1500);
    });

    it('treats a blank Termination Date as still-active, not an error', async () => {
      const file = await buildGenericFile(
        ['Unit no', 'Tenant', 'Start', 'End', 'Rent'],
        [['300', 'Brasstap', '2019-01-01', '2029-01-01', '3000']],
      );
      const mapping = {
        orientation: 'rows' as const,
        columns: [
          { columnIndex: 0, field: 'unitNumber' },
          { columnIndex: 1, field: 'tenantName' },
          { columnIndex: 2, field: 'leaseStart' },
          { columnIndex: 3, field: 'leaseEnd' },
          { columnIndex: 4, field: 'monthlyRent' },
        ],
      };
      const preview = await service.previewMappedImport(file, 'p1', mapping);
      expect(preview.tenancies[0].status).toBe('ready');
      expect(preview.tenancies[0].willBeActive).toBe(true);
      expect(preview.tenancies[0].data.terminationDate).toBeUndefined();
    });

    it('still requires Lease End for an active row — a contracted term is not optional', async () => {
      const file = await buildGenericFile(
        ['Unit no', 'Tenant', 'Start', 'Rent'],
        [['300', 'Brasstap', '2019-01-01', '3000']],
      );
      const mapping = {
        orientation: 'rows' as const,
        columns: [
          { columnIndex: 0, field: 'unitNumber' },
          { columnIndex: 1, field: 'tenantName' },
          { columnIndex: 2, field: 'leaseStart' },
          { columnIndex: 3, field: 'monthlyRent' },
        ],
      };
      const preview = await service.previewMappedImport(file, 'p1', mapping);
      expect(preview.tenancies[0].status).toBe('error');
      expect(preview.tenancies[0].errors.join(' ')).toMatch(/Lease End is required/);
    });

    it('catches an in-file overlap for an active row using Lease End, since there is no move-out date to range over', async () => {
      const file = await buildGenericFile(
        ['Unit no', 'Tenant', 'Start', 'End', 'Rent'],
        [
          ['300', 'Tenant A', '2019-01-01', '2029-01-01', '3000'],
          ['300', 'Tenant B', '2020-01-01', '2030-01-01', '3200'],
        ],
      );
      const mapping = {
        orientation: 'rows' as const,
        columns: [
          { columnIndex: 0, field: 'unitNumber' },
          { columnIndex: 1, field: 'tenantName' },
          { columnIndex: 2, field: 'leaseStart' },
          { columnIndex: 3, field: 'leaseEnd' },
          { columnIndex: 4, field: 'monthlyRent' },
        ],
      };
      const preview = await service.previewMappedImport(file, 'p1', mapping);
      expect(preview.tenancies[1].status).toBe('error');
      expect(preview.tenancies[1].errors.join(' ')).toMatch(/Overlaps another row/);
    });

    it('falls back to a sheet-wide default broker only for a row with commission and no broker of its own', async () => {
      mockPrisma.broker.findMany.mockResolvedValue([{ id: 'b-default', name: 'Default Co' }]);
      const file = await buildGenericFile(
        ['Unit no', 'Tenant', 'Start', 'End', 'Moved Out', 'Rent', '1st Commission'],
        [['300', 'Brasstap', '2019-01-01', '2022-01-01', '2022-01-01', '3000', '5000']],
      );
      const mapping = {
        orientation: 'rows' as const,
        columns: [
          { columnIndex: 0, field: 'unitNumber' },
          { columnIndex: 1, field: 'tenantName' },
          { columnIndex: 2, field: 'leaseStart' },
          { columnIndex: 3, field: 'leaseEnd' },
          { columnIndex: 4, field: 'terminationDate' },
          { columnIndex: 5, field: 'monthlyRent' },
          { columnIndex: 6, field: 'commissionInstallment1' },
        ],
      };
      const preview = await service.previewMappedImport(file, 'p1', mapping, 'b-default');
      expect(preview.tenancies[0].status).toBe('ready');
      expect(preview.tenancies[0].data.brokerId).toBe('b-default');
    });

    it('never overrides a row that already resolved its own broker', async () => {
      mockPrisma.broker.findMany.mockResolvedValue([
        { id: 'b-row', name: 'Tester' }, { id: 'b-default', name: 'Default Co' },
      ]);
      const file = await buildGenericFile(
        ['Unit no', 'Tenant', 'Start', 'End', 'Moved Out', 'Rent', 'Broker', '1st Commission'],
        [['300', 'Brasstap', '2019-01-01', '2022-01-01', '2022-01-01', '3000', 'Tester', '5000']],
      );
      const mapping = {
        orientation: 'rows' as const,
        columns: [
          { columnIndex: 0, field: 'unitNumber' },
          { columnIndex: 1, field: 'tenantName' },
          { columnIndex: 2, field: 'leaseStart' },
          { columnIndex: 3, field: 'leaseEnd' },
          { columnIndex: 4, field: 'terminationDate' },
          { columnIndex: 5, field: 'monthlyRent' },
          { columnIndex: 6, field: 'brokerName' },
          { columnIndex: 7, field: 'commissionInstallment1' },
        ],
      };
      const preview = await service.previewMappedImport(file, 'p1', mapping, 'b-default');
      expect(preview.tenancies[0].data.brokerId).toBe('b-row');
    });

    it('ignores a defaultBrokerId that does not resolve to a real broker', async () => {
      mockPrisma.broker.findMany.mockResolvedValue([{ id: 'b-real', name: 'Real Broker' }]);
      const file = await buildGenericFile(
        ['Unit no', 'Tenant', 'Start', 'End', 'Moved Out', 'Rent', '1st Commission'],
        [['300', 'Brasstap', '2019-01-01', '2022-01-01', '2022-01-01', '3000', '5000']],
      );
      const mapping = {
        orientation: 'rows' as const,
        columns: [
          { columnIndex: 0, field: 'unitNumber' },
          { columnIndex: 1, field: 'tenantName' },
          { columnIndex: 2, field: 'leaseStart' },
          { columnIndex: 3, field: 'leaseEnd' },
          { columnIndex: 4, field: 'terminationDate' },
          { columnIndex: 5, field: 'monthlyRent' },
          { columnIndex: 6, field: 'commissionInstallment1' },
        ],
      };
      const preview = await service.previewMappedImport(file, 'p1', mapping, 'not-a-real-id');
      expect(preview.tenancies[0].status).toBe('error');
      expect(preview.tenancies[0].errors.join(' ')).toMatch(/no Broker Name was set/);
    });

    it('fixes one row via rowBrokerOverrides without needing a sheet-wide default', async () => {
      mockPrisma.broker.findMany.mockResolvedValue([{ id: 'b-row', name: 'Row Broker' }]);
      const file = await buildGenericFile(
        ['Unit no', 'Tenant', 'Start', 'End', 'Moved Out', 'Rent', '1st Commission'],
        [
          ['300', 'Brasstap', '2019-01-01', '2022-01-01', '2022-01-01', '3000', '5000'],
          ['402', 'Other Tenant', '2019-01-01', '2022-01-01', '2022-01-01', '3200', '600'],
        ],
      );
      const mapping = {
        orientation: 'rows' as const,
        columns: [
          { columnIndex: 0, field: 'unitNumber' },
          { columnIndex: 1, field: 'tenantName' },
          { columnIndex: 2, field: 'leaseStart' },
          { columnIndex: 3, field: 'leaseEnd' },
          { columnIndex: 4, field: 'terminationDate' },
          { columnIndex: 5, field: 'monthlyRent' },
          { columnIndex: 6, field: 'commissionInstallment1' },
        ],
      };
      // Row 2 gets the fix; row 3 (unitNumber 402, not in BASE_UNITS, no override given
      // for it) still correctly errors on its OWN missing broker — proves the override
      // is keyed by row, not applied blanket-wide to every row with commission.
      const preview = await service.previewMappedImport(file, 'p1', mapping, undefined, { 2: 'b-row' });
      expect(preview.tenancies[0].status).toBe('ready');
      expect(preview.tenancies[0].data.brokerId).toBe('b-row');
      expect(preview.tenancies[1].data.brokerId).toBeNull();
      expect(preview.tenancies[1].errors.join(' ')).toMatch(/no Broker Name was set/);
    });

    it('lets a row keep its own resolved broker over a row override', async () => {
      mockPrisma.broker.findMany.mockResolvedValue([
        { id: 'b-own', name: 'Own Broker' }, { id: 'b-override', name: 'Override Broker' },
      ]);
      const file = await buildGenericFile(
        ['Unit no', 'Tenant', 'Start', 'End', 'Moved Out', 'Rent', 'Broker', '1st Commission'],
        [['300', 'Brasstap', '2019-01-01', '2022-01-01', '2022-01-01', '3000', 'Own Broker', '5000']],
      );
      const mapping = {
        orientation: 'rows' as const,
        columns: [
          { columnIndex: 0, field: 'unitNumber' },
          { columnIndex: 1, field: 'tenantName' },
          { columnIndex: 2, field: 'leaseStart' },
          { columnIndex: 3, field: 'leaseEnd' },
          { columnIndex: 4, field: 'terminationDate' },
          { columnIndex: 5, field: 'monthlyRent' },
          { columnIndex: 6, field: 'brokerName' },
          { columnIndex: 7, field: 'commissionInstallment1' },
        ],
      };
      const preview = await service.previewMappedImport(file, 'p1', mapping, undefined, { 2: 'b-override' });
      expect(preview.tenancies[0].data.brokerId).toBe('b-own');
    });
  });
});

describe('LeaseImportService.commitImport', () => {
  let service: LeaseImportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('imports valid rows and reports a failure without aborting the batch', async () => {
    mockLeases.backfillTenancy
      .mockResolvedValueOnce({ lease: { id: 'l1' } })
      .mockRejectedValueOnce(new Error('Overlaps another lease on this unit'))
      .mockResolvedValueOnce({ lease: { id: 'l3' } });

    const result = await service.commitImport(
      [
        { unitId: 'u1', tenantName: 'A', leaseStart: '2019-01-01', leaseEnd: '2020-01-01', terminationDate: '2020-01-01', monthlyRent: 1000 },
        { unitId: 'u2', tenantName: 'B', leaseStart: '2019-01-01', leaseEnd: '2020-01-01', terminationDate: '2020-01-01', monthlyRent: 1000 },
        { unitId: 'u3', tenantName: 'C', leaseStart: '2019-01-01', leaseEnd: '2020-01-01', terminationDate: '2020-01-01', monthlyRent: 1000 },
      ],
      'user-1',
    );

    expect(result.imported).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.results[1]).toMatchObject({ success: false, error: 'Overlaps another lease on this unit' });
    expect(mockLeases.backfillTenancy).toHaveBeenCalledTimes(3);
  });

  it('refuses a row missing required fields without calling backfillTenancy', async () => {
    const result = await service.commitImport(
      [{ unitId: null, tenantName: 'A' } as any],
      'user-1',
    );
    expect(result.failed).toBe(1);
    expect(mockLeases.backfillTenancy).not.toHaveBeenCalled();
  });

  it('R9.2: commits a row with no terminationDate — it is not a missing required field, it is an active tenancy', async () => {
    mockLeases.backfillTenancy.mockResolvedValueOnce({ lease: { id: 'l1' } });
    const result = await service.commitImport(
      [{ unitId: 'u1', tenantName: 'A', leaseStart: '2019-01-01', leaseEnd: '2029-01-01', monthlyRent: 1000 }],
      'user-1',
    );
    expect(result.imported).toBe(1);
    expect(mockLeases.backfillTenancy).toHaveBeenCalledWith(
      expect.objectContaining({ terminationDate: undefined }),
      'user-1',
    );
  });
});
