import ExcelJS from 'exceljs';
import { SaleImportService, normalizeSaleOverrides } from './sale-import.service';

const mockPrisma: any = {
  unit: { findMany: jest.fn() },
  broker: { findMany: jest.fn() },
  sale: { findMany: jest.fn() },
};

const mockSales: any = {
  backfillSale: jest.fn(),
  findDuplicateHistoricalSale: jest.fn(),
};

function makeService() {
  return new SaleImportService(mockPrisma as any, mockSales as any);
}

/** Builds a real .xlsx buffer with the two sheets, row objects keyed by column label. */
async function buildFile(sheets: {
  sales?: Record<string, any>[];
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
  fill('Sales', sheets.sales);
  fill('Commission Installments', sheets.commissions);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

const BASE_UNITS = [
  { id: 'u300', unitNumber: '300', building: { name: 'Building A' } },
  { id: 'u701', unitNumber: '701', building: { name: 'Building A' } },
];

describe('SaleImportService.buildTemplate', () => {
  it('produces a workbook with both required sheets', async () => {
    const service = makeService();
    const buffer = await service.buildTemplate();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    expect(wb.getWorksheet('Sales')).toBeTruthy();
    expect(wb.getWorksheet('Commission Installments')).toBeTruthy();
  });
});

describe('SaleImportService.previewImport', () => {
  let service: SaleImportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.unit.findMany.mockResolvedValue(BASE_UNITS);
    mockPrisma.broker.findMany.mockResolvedValue([{ id: 'b1', name: 'Tester' }]);
    mockPrisma.sale.findMany.mockResolvedValue([]);
    mockSales.findDuplicateHistoricalSale.mockResolvedValue(null);
  });

  it('marks a fully valid row ready', async () => {
    const file = await buildFile({
      sales: [{
        'Unit Number': '300', Buyer: 'Historical Buyer LLC', 'Purchase Price': 500000,
        'Closing Date': new Date('2022-06-30'),
      }],
    });
    const preview = await service.previewImport(file, 'p1');
    expect(preview.summary).toEqual({ total: 1, ready: 1, errors: 0, duplicates: 0 });
    expect(preview.sales[0].data.unitId).toBe('u300');
  });

  it('flags a unit that does not resolve in this project', async () => {
    const file = await buildFile({
      sales: [{ 'Unit Number': '9999', Buyer: 'Nobody', 'Purchase Price': 1000, 'Closing Date': new Date('2022-01-01') }],
    });
    const preview = await service.previewImport(file, 'p1');
    expect(preview.sales[0].status).toBe('error');
    expect(preview.sales[0].errors[0]).toMatch(/was not found in this project/);
  });

  it('names the unit\'s real building when the row\'s Building label does not match', async () => {
    // Unit 300 exists, but under "Building A" — a row claiming a different label (e.g. a
    // project-qualified name like "Project X - Building A") should not read as "not found",
    // since the unit is right there and RentHistoryImportPage's "create missing units" flow
    // keys off that exact phrase to decide what to offer creating.
    const file = await buildFile({
      sales: [{
        'Unit Number': '300', Building: 'Some Other Building', Buyer: 'Buyer',
        'Purchase Price': 1000, 'Closing Date': new Date('2022-01-01'),
      }],
    });
    const preview = await service.previewImport(file, 'p1');
    expect(preview.sales[0].status).toBe('error');
    expect(preview.sales[0].errors[0]).toMatch(/exists in this project, but under building "Building A"/);
    expect(preview.sales[0].errors[0]).not.toMatch(/was not found in this project/);
  });

  it('refuses a future closing date', async () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const file = await buildFile({
      sales: [{ 'Unit Number': '300', Buyer: 'Buyer', 'Purchase Price': 1000, 'Closing Date': future }],
    });
    const preview = await service.previewImport(file, 'p1');
    expect(preview.sales[0].status).toBe('error');
    expect(preview.sales[0].errors.join(' ')).toMatch(/has not closed yet/);
  });

  it('requires Buyer, Purchase Price, and Closing Date', async () => {
    const file = await buildFile({ sales: [{ 'Unit Number': '300' }] });
    const preview = await service.previewImport(file, 'p1');
    const errs = preview.sales[0].errors.join(' ');
    expect(errs).toMatch(/Buyer is required/);
    expect(errs).toMatch(/Purchase Price is required/);
    expect(errs).toMatch(/Closing Date is required/);
  });

  it('composes Deposit and Second Payment into the payments array', async () => {
    const file = await buildFile({
      sales: [{
        'Unit Number': '300', Buyer: 'Buyer', 'Purchase Price': 500000, 'Closing Date': new Date('2022-06-30'),
        'Deposit Amount': 50000, 'Deposit Date': new Date('2022-01-15'),
        'Second Payment Amount': 20000,
      }],
    });
    const preview = await service.previewImport(file, 'p1');
    expect(preview.sales[0].data.payments).toEqual([
      { label: 'Deposit', amount: 50000, paidAt: '2022-01-15' },
      { label: 'Second Payment', amount: 20000, paidAt: undefined },
    ]);
  });

  describe('Commission Installments join (Unit Number + Buyer)', () => {
    it('requires a Broker Name on the sale row before accepting an installment', async () => {
      const file = await buildFile({
        sales: [{ 'Unit Number': '300', Buyer: 'Buyer', 'Purchase Price': 500000, 'Closing Date': new Date('2022-06-30') }],
        commissions: [{ 'Unit Number': '300', Buyer: 'Buyer', 'Installment Number': 1, Amount: 5000 }],
      });
      const preview = await service.previewImport(file, 'p1');
      expect(preview.sales[0].status).toBe('error');
      expect(preview.sales[0].errors.join(' ')).toMatch(/no Broker Name was set/);
    });

    it('attaches installments when a broker resolves', async () => {
      const file = await buildFile({
        sales: [{ 'Unit Number': '300', Buyer: 'Buyer', 'Broker Name': 'Tester', 'Purchase Price': 500000, 'Closing Date': new Date('2022-06-30') }],
        commissions: [
          { 'Unit Number': '300', Buyer: 'Buyer', 'Installment Number': 1, Amount: 5000, 'Paid Date': new Date('2022-06-30') },
          { 'Unit Number': '300', Buyer: 'Buyer', 'Installment Number': 2, Amount: 5000 },
        ],
      });
      const preview = await service.previewImport(file, 'p1');
      expect(preview.sales[0].data.brokerId).toBe('b1');
      expect(preview.sales[0].data.commissionInstallments).toHaveLength(2);
      expect(preview.sales[0].status).toBe('ready');
    });

    it('orphans a commission row that matches no sale', async () => {
      const file = await buildFile({
        sales: [{ 'Unit Number': '300', Buyer: 'Buyer', 'Purchase Price': 500000, 'Closing Date': new Date('2022-06-30') }],
        commissions: [{ 'Unit Number': '300', Buyer: 'Someone Else', 'Installment Number': 1, Amount: 5000 }],
      });
      const preview = await service.previewImport(file, 'p1');
      expect(preview.orphaned).toHaveLength(1);
      expect(preview.orphaned[0].error).toMatch(/No Sales row matches/);
    });
  });
});

describe('SaleImportService.previewImport — per-row corrections (R11)', () => {
  let service: SaleImportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.unit.findMany.mockResolvedValue(BASE_UNITS);
    mockPrisma.broker.findMany.mockResolvedValue([{ id: 'b1', name: 'Tester' }]);
    mockPrisma.sale.findMany.mockResolvedValue([]);
    mockSales.findDuplicateHistoricalSale.mockResolvedValue(null);
  });

  it('clears a blocked row when the missing Closing Date is supplied', async () => {
    const file = await buildFile({
      sales: [{ 'Unit Number': '300', Buyer: 'Historical Buyer LLC', 'Purchase Price': 500000 }],
    });
    const before = await service.previewImport(file, 'p1');
    expect(before.summary).toEqual({ total: 1, ready: 0, errors: 1, duplicates: 0 });

    const after = await service.previewImport(file, 'p1', { 2: { closingDate: '2022-06-30' } });
    expect(after.summary).toEqual({ total: 1, ready: 1, errors: 0, duplicates: 0 });
    expect(after.sales[0].data.closingDate).toBe('2022-06-30');
    expect(after.sales[0].edited).toEqual(['closingDate']);
  });

  it('validates a typed-in date by the same rules as the file\'s own cells', async () => {
    const file = await buildFile({
      sales: [{ 'Unit Number': '300', Buyer: 'B', 'Purchase Price': 1000 }],
    });
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const preview = await service.previewImport(file, 'p1', { 2: { closingDate: future } });
    expect(preview.sales[0].status).toBe('error');
    expect(preview.sales[0].errors.join(' ')).toContain('has not closed yet');
  });

  it('reports an unparseable typed-in value instead of treating it as blank', async () => {
    const file = await buildFile({
      sales: [{ 'Unit Number': '300', Buyer: 'B', 'Closing Date': new Date('2022-01-01') }],
    });
    const preview = await service.previewImport(file, 'p1', { 2: { purchasePrice: 'abc' } });
    expect(preview.sales[0].errors.join(' ')).toContain('isn\'t a number');
  });

  it('accepts a formatted price and re-resolves a corrected unit number', async () => {
    const file = await buildFile({
      sales: [{ 'Unit Number': '9999', Buyer: 'B', 'Closing Date': new Date('2022-01-01') }],
    });
    const preview = await service.previewImport(file, 'p1', {
      2: { unitNumber: '701', purchasePrice: '$1,250,000' },
    });
    expect(preview.summary.ready).toBe(1);
    expect(preview.sales[0].data.unitId).toBe('u701');
    expect(preview.sales[0].data.salePrice).toBe(1250000);
  });

  it('re-joins a commission row when the Buyer is corrected', async () => {
    const file = await buildFile({
      sales: [{
        'Unit Number': '300', Buyer: 'Typo Byer', 'Purchase Price': 1000,
        'Closing Date': new Date('2022-01-01'), 'Broker Name': 'Tester',
      }],
      commissions: [{ 'Unit Number': '300', Buyer: 'Real Buyer LLC', 'Installment Number': 1, Amount: 5000 }],
    });
    const before = await service.previewImport(file, 'p1');
    expect(before.orphaned).toHaveLength(1);

    const after = await service.previewImport(file, 'p1', { 2: { buyer: 'Real Buyer LLC' } });
    expect(after.orphaned).toHaveLength(0);
    expect(after.sales[0].data.commissionInstallments).toEqual([{ amount: 5000, paidAt: undefined }]);
  });

  it('clears a field when the correction is blank', async () => {
    const file = await buildFile({
      sales: [{
        'Unit Number': '300', Buyer: 'B', 'Purchase Price': 1000,
        'Closing Date': new Date('2022-01-01'), 'Broker Name': 'Ghost Broker',
      }],
    });
    const before = await service.previewImport(file, 'p1');
    expect(before.sales[0].errors.join(' ')).toContain('was not found');

    const after = await service.previewImport(file, 'p1', { 2: { brokerName: '' } });
    expect(after.summary.ready).toBe(1);
    expect(after.sales[0].data.brokerId).toBeNull();
  });
});

describe('normalizeSaleOverrides', () => {
  it('passes through a well-formed payload', () => {
    expect(normalizeSaleOverrides({ 7: { closingDate: '2022-01-01', purchasePrice: 500 } }))
      .toEqual({ 7: { closingDate: '2022-01-01', purchasePrice: 500 } });
    expect(normalizeSaleOverrides(null)).toEqual({});
  });

  it('refuses a field that is not correctable, rather than ignoring it', () => {
    expect(() => normalizeSaleOverrides({ 7: { unitId: 'u1' } })).toThrow(/not a correctable field/);
  });

  it('refuses a non-row key and a non-object payload', () => {
    expect(() => normalizeSaleOverrides({ abc: { buyer: 'X' } })).toThrow(/row number/);
    expect(() => normalizeSaleOverrides([{ buyer: 'X' }])).toThrow(/keyed by row number/);
  });
});

describe('SaleImportService.commitImport', () => {
  let service: SaleImportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('imports valid rows and reports a failure without aborting the batch', async () => {
    mockSales.backfillSale
      .mockResolvedValueOnce({ id: 's1' })
      .mockRejectedValueOnce(new Error('This sale has not closed yet'))
      .mockResolvedValueOnce({ id: 's3' });

    const result = await service.commitImport(
      [
        { unitId: 'u1', buyer: 'A', salePrice: 1000, closingDate: '2022-01-01' } as any,
        { unitId: 'u2', buyer: 'B', salePrice: 1000, closingDate: '2022-01-01' } as any,
        { unitId: 'u3', buyer: 'C', salePrice: 1000, closingDate: '2022-01-01' } as any,
      ],
      'user-1',
    );

    expect(result.imported).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.results[1]).toMatchObject({ success: false, error: 'This sale has not closed yet' });
    expect(mockSales.backfillSale).toHaveBeenCalledTimes(3);
  });

  it('refuses a row missing required fields without calling backfillSale', async () => {
    const result = await service.commitImport([{ unitId: null, buyer: 'A' } as any], 'user-1');
    expect(result.failed).toBe(1);
    expect(mockSales.backfillSale).not.toHaveBeenCalled();
  });
});

/**
 * The bug these cover: the rent importer has compared rows against what is already stored
 * since it was written, and this one never did. A re-uploaded sheet came back entirely
 * green and wrote every previously-imported row again, so one unit ended up carrying three
 * identical sales. A sale has no date range, so there is no DB exclusion constraint
 * underneath to catch what the preview lets through — these are the whole guard.
 */
describe('SaleImportService.previewImport — already-imported rows', () => {
  let service: SaleImportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.unit.findMany.mockResolvedValue(BASE_UNITS);
    mockPrisma.broker.findMany.mockResolvedValue([{ id: 'b1', name: 'Tester' }]);
    mockPrisma.sale.findMany.mockResolvedValue([]);
  });

  const ROW = {
    'Unit Number': '300', Buyer: 'Reig Venture LLC', 'Purchase Price': 1908450,
    'Closing Date': new Date('2024-01-07'),
  };

  it('marks a sale already on the unit as duplicate, not ready', async () => {
    mockPrisma.sale.findMany.mockResolvedValue([
      { unitId: 'u300', buyer: 'Reig Venture LLC', salePrice: 1908450, closingDate: new Date('2024-01-07') },
    ]);
    const preview = await service.previewImport(await buildFile({ sales: [ROW] }), 'p1');
    expect(preview.sales[0].status).toBe('duplicate');
    expect(preview.summary).toEqual({ total: 1, ready: 0, errors: 0, duplicates: 1 });
  });

  it('ignores capitalisation on the buyer — the same name retyped is the same sale', async () => {
    mockPrisma.sale.findMany.mockResolvedValue([
      { unitId: 'u300', buyer: '  reig venture llc ', salePrice: 1908450, closingDate: new Date('2024-01-07') },
    ]);
    const preview = await service.previewImport(await buildFile({ sales: [ROW] }), 'p1');
    expect(preview.sales[0].status).toBe('duplicate');
  });

  it('warns when the stored price disagrees, rather than skipping in silence', async () => {
    mockPrisma.sale.findMany.mockResolvedValue([
      { unitId: 'u300', buyer: 'Reig Venture LLC', salePrice: 1500000, closingDate: new Date('2024-01-07') },
    ]);
    const preview = await service.previewImport(await buildFile({ sales: [ROW] }), 'p1');
    expect(preview.sales[0].status).toBe('duplicate');
    expect(preview.sales[0].warnings.join(' ')).toMatch(/Already imported at .*1,500,000/);
  });

  it('does not treat a different buyer or a different closing date as a duplicate', async () => {
    mockPrisma.sale.findMany.mockResolvedValue([
      { unitId: 'u300', buyer: 'Someone Else', salePrice: 1, closingDate: new Date('2024-01-07') },
      { unitId: 'u300', buyer: 'Reig Venture LLC', salePrice: 1, closingDate: new Date('2023-01-07') },
    ]);
    const preview = await service.previewImport(await buildFile({ sales: [ROW] }), 'p1');
    expect(preview.sales[0].status).toBe('ready');
  });

  it('catches the same sale listed twice within one file', async () => {
    const preview = await service.previewImport(await buildFile({ sales: [ROW, { ...ROW }] }), 'p1');
    expect(preview.sales[0].status).toBe('ready');
    expect(preview.sales[1].status).toBe('error');
    expect(preview.sales[1].errors.join(' ')).toMatch(/Same sale as row 2 in this file/);
  });

  it('keeps a broken row an error even when it is also already imported', async () => {
    mockPrisma.sale.findMany.mockResolvedValue([
      { unitId: 'u300', buyer: 'Reig Venture LLC', salePrice: 1908450, closingDate: new Date('2024-01-07') },
    ]);
    const preview = await service.previewImport(
      await buildFile({ sales: [{ ...ROW, 'Purchase Price': undefined }] }),
      'p1',
    );
    expect(preview.sales[0].status).toBe('error');
  });
});

describe('SaleImportService.commitImport — idempotency', () => {
  let service: SaleImportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockSales.findDuplicateHistoricalSale.mockResolvedValue(null);
  });

  it('skips a row already stored instead of writing it again', async () => {
    // The preview is advisory: the client posts back rows it was handed earlier, and the
    // "create the missing units and re-check" button hands back a preview in which the
    // already-imported rows are green again. Only the write path can be sure.
    mockSales.findDuplicateHistoricalSale
      .mockResolvedValueOnce({ id: 'existing-1', buyer: 'A' })
      .mockResolvedValueOnce(null);
    mockSales.backfillSale.mockResolvedValue({ id: 's2' });

    const result = await service.commitImport(
      [
        { unitId: 'u1', buyer: 'A', salePrice: 1000, closingDate: '2022-01-01' } as any,
        { unitId: 'u2', buyer: 'B', salePrice: 1000, closingDate: '2022-01-01' } as any,
      ],
      'user-1',
    );

    expect(result).toMatchObject({ imported: 1, skipped: 1, failed: 0 });
    expect(result.results[0]).toMatchObject({ skipped: true, saleId: 'existing-1' });
    expect(mockSales.backfillSale).toHaveBeenCalledTimes(1);
  });

  it('counts a skip apart from a failure — it is a no-op, not something to investigate', async () => {
    mockSales.findDuplicateHistoricalSale.mockResolvedValue({ id: 'existing-1', buyer: 'A' });
    const result = await service.commitImport(
      [{ unitId: 'u1', buyer: 'A', salePrice: 1000, closingDate: '2022-01-01' } as any],
      'user-1',
    );
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockSales.backfillSale).not.toHaveBeenCalled();
  });
});
