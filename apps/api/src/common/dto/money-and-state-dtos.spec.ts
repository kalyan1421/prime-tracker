import { ValidationPipe } from '@nestjs/common';
import { CreateCashFlowEntryDto, UpdateCashFlowEntryDto } from '../../modules/cashflow/dto/cashflow-entry.dto';
import {
  AddSalePaymentDto, ApplyPaymentTemplateDto, LogSalePaymentDto, UpdateSalePaymentDto,
} from '../../modules/sales/dto/sale-payment.dto';
import { SaleImportCommitDto } from '../../modules/sales/dto/sale-import-commit.dto';
import { LeaseImportCommitDto } from '../../modules/leases/dto/lease-import-commit.dto';
import { CreateUpdateBoardPostDto, AddUpdateBoardAttachmentDto } from '../../modules/update-board/dto/update-board.dto';
import { AttachMilestonePhotoDto, SetMilestoneDependencyDto } from '../../modules/milestones/dto/milestone-photo.dto';
import { SetApprovedBudgetDto } from '../../modules/projects/dto/approved-budget.dto';
import { AttachDrawDocumentDto } from '../../modules/draws/dto/draw-workflow.dto';
import { UpdateInteriorProjectDto } from '../../modules/interior/dto/interior-project.dto';
import { ConvertLeadDto } from '../../modules/leads/dto/lead.dto';
import { MAX_IMPORT_COMMIT_ROWS } from './import-commit.dto';

/**
 * The money-moving and state-changing bodies that used to be inline `@Body()` types or
 * `any` — which the global ValidationPipe skips, because their metatype is Object. Run
 * through the pipe exactly as main.ts configures it, including the implicit conversion.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const accept = (Dto: any, body: unknown) => pipe.transform(body, { type: 'body', metatype: Dto });
const rejects = async (Dto: any, body: unknown): Promise<string> => {
  try {
    await accept(Dto, body);
  } catch (err: any) {
    const detail = err?.response?.message;
    return Array.isArray(detail) ? detail.join(' | ') : String(detail);
  }
  throw new Error('expected the pipe to reject the body');
};

describe('cash flow entries', () => {
  const valid = { projectId: 'p1', month: '2026-10-01', entryType: 'INFLOW', category: 'RENTAL_INCOME', amount: 1200, notes: '', isActual: true };

  it('accepts what the Founder Reports form sends', async () => {
    await expect(accept(CreateCashFlowEntryDto, valid)).resolves.toBeTruthy();
  });

  it('refuses the NaN that Number("abc") used to write into the column', async () => {
    expect(await rejects(CreateCashFlowEntryDto, { ...valid, amount: 'abc' })).toMatch(/amount/);
    expect(await rejects(UpdateCashFlowEntryDto, { amount: Number.NaN })).toMatch(/amount/);
  });

  it('refuses an empty month (was an Invalid Date → 500) and an unknown entry type', async () => {
    expect(await rejects(CreateCashFlowEntryDto, { ...valid, month: '' })).toMatch(/month/);
    expect(await rejects(CreateCashFlowEntryDto, { ...valid, entryType: 'SIDEWAYS' })).toMatch(/entryType/);
  });

  it('refuses keys the service never asked for', async () => {
    expect(await rejects(UpdateCashFlowEntryDto, { projectId: 'p2' })).toMatch(/projectId should not exist/);
  });
});

describe('sale payments', () => {
  it('accepts what the payment panel and the sale form send', async () => {
    await expect(accept(AddSalePaymentDto, { label: 'Deposit', amount: 5000, trigger: 'FIXED_DATE', dueDate: '2026-11-01T00:00:00.000Z' })).resolves.toBeTruthy();
    await expect(accept(AddSalePaymentDto, { label: 'Deposit', amount: 5000, trigger: 'FIXED_DATE', dueDate: null, sequence: 1 })).resolves.toBeTruthy();
    await expect(accept(UpdateSalePaymentDto, { label: 'Deposit', amount: 5500, dueDate: '2026-11-01' })).resolves.toBeTruthy();
  });

  it('refuses a non-positive or non-numeric amount', async () => {
    expect(await rejects(LogSalePaymentDto, { amount: 0 })).toMatch(/amount/);
    expect(await rejects(LogSalePaymentDto, { amount: 'lots' })).toMatch(/amount/);
    expect(await rejects(AddSalePaymentDto, { label: 'x', amount: -5 })).toMatch(/amount/);
  });

  it('refuses a template key that is not a template — including Object prototype names', async () => {
    await expect(accept(ApplyPaymentTemplateDto, { template: '10-40-50' })).resolves.toBeTruthy();
    expect(await rejects(ApplyPaymentTemplateDto, { template: 'constructor' })).toMatch(/template/);
  });
});

describe('import commits', () => {
  const saleRow = {
    unitId: 'u1', buyer: 'ARV Solutions', salePrice: 412000.0000001, contractDate: '2021-03-01', closingDate: '2021-04-15',
    brokerId: null, payments: [{ label: 'Deposit', amount: 10000, paidAt: '2021-03-02' }],
    commissionInstallments: [{ amount: 1200 }],
  };

  it('accepts a previewed row as the preview emits it, float noise and all', async () => {
    await expect(accept(SaleImportCommitDto, { rows: [saleRow] })).resolves.toBeTruthy();
    await expect(accept(LeaseImportCommitDto, {
      rows: [{ unitId: 'u1', tenantName: 'T', leaseStart: '2020-01-01', leaseEnd: '2025-01-01', monthlyRent: 4200.5, collections: { '2024-03': 4200 } }],
    })).resolves.toBeTruthy();
  });

  it(`caps a commit at ${MAX_IMPORT_COMMIT_ROWS} rows`, async () => {
    const rows = Array.from({ length: MAX_IMPORT_COMMIT_ROWS + 1 }, () => saleRow);
    expect(await rejects(SaleImportCommitDto, { rows })).toMatch(/rows must contain no more than 1000 elements/);
  });

  it('refuses an empty commit, a NaN price and a key the preview never emits', async () => {
    expect(await rejects(SaleImportCommitDto, { rows: [] })).toMatch(/rows/);
    expect(await rejects(SaleImportCommitDto, { rows: [{ ...saleRow, salePrice: 'n/a' }] })).toMatch(/salePrice/);
    expect(await rejects(SaleImportCommitDto, { rows: [{ ...saleRow, status: 'CLOSED' }] })).toMatch(/status should not exist/);
    expect(await rejects(LeaseImportCommitDto, { rows: [{ unitId: 'u1', collections: { '2024-03': 'lots' } }] })).toMatch(/collections/);
  });
});

describe('update board', () => {
  const post = { title: 'Slab poured', status: 'TODO', priority: 'MEDIUM', pinned: false, restricted: false, assigneeIds: [], links: [] };

  it('accepts what the post form sends', async () => {
    await expect(accept(CreateUpdateBoardPostDto, { ...post, links: [{ url: ' https://example.com/x ', label: 'Spec' }] })).resolves.toBeTruthy();
  });

  it('refuses a javascript: or data: link, which the web app renders as an href', async () => {
    expect(await rejects(CreateUpdateBoardPostDto, { ...post, links: [{ url: 'javascript:alert(1)', label: 'x' }] })).toMatch(/http/);
    expect(await rejects(CreateUpdateBoardPostDto, { ...post, links: [{ url: 'data:text/html,<b>', label: 'x' }] })).toMatch(/http/);
  });

  it('refuses an attachment key that is not one of ours', async () => {
    expect(await rejects(AddUpdateBoardAttachmentDto, { storagePath: '../x.pdf', fileName: 'x.pdf' })).toMatch(/storagePath/);
  });
});

describe('storage keys on photo and document routes', () => {
  it.each([
    [AttachMilestonePhotoDto, { storagePath: 'https://evil.example/x.jpg' }],
    [AttachMilestonePhotoDto, { storagePath: '/etc/passwd' }],
    [AttachMilestonePhotoDto, { storagePath: 'p1/../../x.jpg' }],
    [AttachDrawDocumentDto, { documentType: 'LIEN_WAIVER', storagePath: '../x.pdf', filename: 'x.pdf' }],
  ])('refuses %p %p', async (Dto, body) => {
    expect(await rejects(Dto, body)).toMatch(/storagePath/);
  });

  it('accepts a key from the upload endpoint', async () => {
    await expect(accept(AttachMilestonePhotoDto, { storagePath: 'p1/photo/site-abc.jpg', caption: 'North wall' })).resolves.toBeTruthy();
  });

  it('refuses a draw document body that tries to set uploadedById itself', async () => {
    expect(await rejects(AttachDrawDocumentDto, {
      documentType: 'LIEN_WAIVER', storagePath: 'p1/draws/x.pdf', filename: 'x.pdf', uploadedById: 'someone-else',
    })).toMatch(/uploadedById should not exist/);
  });
});

describe('explicit-null clears', () => {
  it('approved budget: a number or an explicit null, never an empty body', async () => {
    await expect(accept(SetApprovedBudgetDto, { approvedBudget: 2500000 })).resolves.toBeTruthy();
    await expect(accept(SetApprovedBudgetDto, { approvedBudget: null })).resolves.toBeTruthy();
    expect(await rejects(SetApprovedBudgetDto, {})).toMatch(/approvedBudget/);
    expect(await rejects(SetApprovedBudgetDto, { approvedBudget: -1 })).toMatch(/approvedBudget/);
  });

  it('milestone dependency: an id or an explicit null', async () => {
    await expect(accept(SetMilestoneDependencyDto, { dependsOnId: null })).resolves.toBeTruthy();
    expect(await rejects(SetMilestoneDependencyDto, {})).toMatch(/dependsOnId/);
  });

  it('interior: the edit form clears PM and TI with null, and NaN is refused', async () => {
    await expect(accept(UpdateInteriorProjectDto, { name: 'Fit-out', pmId: null, tiAllowance: null, priority: null })).resolves.toBeTruthy();
    expect(await rejects(UpdateInteriorProjectDto, { tiAllowance: Number.NaN })).toMatch(/tiAllowance/);
    expect(await rejects(UpdateInteriorProjectDto, { status: 'DONE-ISH' })).toMatch(/status/);
  });

  it('lead convert: parseFloat("") is NaN and is refused', async () => {
    expect(await rejects(ConvertLeadDto, { unitId: 'u1', buyer: 'B', salePrice: Number.NaN })).toMatch(/salePrice/);
  });
});
