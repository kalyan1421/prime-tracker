import ExcelJS from 'exceljs';
import { LeaseImportService } from './lease-import.service';

const mockPrisma: any = {
  unit: { findMany: jest.fn() },
  broker: { findMany: jest.fn() },
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
  });

  it('marks a fully valid row ready', async () => {
    const file = await buildFile({
      tenancies: [{
        'Unit Number': '300', 'Tenant Name': 'Brasstap', 'Lease Start': new Date('2019-01-01'),
        'Lease End': new Date('2022-01-01'), 'Termination Date': new Date('2022-01-01'), 'Monthly Rent': 3000,
      }],
    });
    const preview = await service.previewImport(file, 'p1');
    expect(preview.summary).toEqual({ total: 1, ready: 1, errors: 0 });
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
      expect(row701.rentAutoSplit).toBe(false); // it carried the explicit total
      expect(row702.rentAutoSplit).toBe(true);
      expect(row702.data.monthlyRent).toBeCloseTo(12500 * (1000 / 4000), 2);
      expect(row702.status).toBe('ready');
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
    expect(preview.summary).toEqual({ total: 1, ready: 1, errors: 0 });
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
