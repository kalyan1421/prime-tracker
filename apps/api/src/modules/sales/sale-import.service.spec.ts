import ExcelJS from 'exceljs';
import { SaleImportService } from './sale-import.service';

const mockPrisma: any = {
  unit: { findMany: jest.fn() },
  broker: { findMany: jest.fn() },
};

const mockSales: any = {
  backfillSale: jest.fn(),
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
  });

  it('marks a fully valid row ready', async () => {
    const file = await buildFile({
      sales: [{
        'Unit Number': '300', Buyer: 'Historical Buyer LLC', 'Purchase Price': 500000,
        'Closing Date': new Date('2022-06-30'),
      }],
    });
    const preview = await service.previewImport(file, 'p1');
    expect(preview.summary).toEqual({ total: 1, ready: 1, errors: 0 });
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
