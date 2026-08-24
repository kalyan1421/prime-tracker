import { Injectable, BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesService, BackfillSaleInput } from './sales.service';
import {
  addColumnarSheet, assertHeaderMatches, cellText, cellDateIso, cellNumber, resolveUnit, resolveBroker, joinKey,
} from '../../common/utils/xlsx-import';

const SHEET_SALES = 'Sales';
const SHEET_COMMISSIONS = 'Commission Installments';

/**
 * Column layout for the Sales sheet — finalized 2026-08-22 against the client's real
 * historical-sales column list (Sl No, Unit No, Sqft, Seller, Buyer, Purchase Price, PSF,
 * Deposit + date, Second Payment + date, Sale Agreement executed date). "Sl No" is not
 * imported — spreadsheet reference only. Closing Date was added beyond the client's list:
 * backfillSale needs it specifically (it's what flips the unit SOLD and ends any tenancy),
 * distinct from the sale-agreement date.
 */
const SALE_COLUMNS = [
  { key: 'unitNumber', label: 'Unit Number', note: 'Required. Must match a unit already in this project.' },
  { key: 'building', label: 'Building', note: 'Optional — only needed if the unit number exists in more than one building in this project.' },
  { key: 'sqft', label: 'Sqft', note: 'Optional — informational, cross-checked against the unit\'s own recorded sqft, not overwritten.' },
  { key: 'seller', label: 'Seller', note: 'Optional, free text — Prime Tracker has no structured owning-entity/LLC field.' },
  { key: 'buyer', label: 'Buyer', note: 'Required.' },
  { key: 'purchasePrice', label: 'Purchase Price', note: 'Required.' },
  { key: 'pricePsf', label: 'Price PSF', note: 'Optional — informational only, not stored.' },
  { key: 'depositAmount', label: 'Deposit Amount', note: 'Optional.' },
  { key: 'depositDate', label: 'Deposit Date', note: 'Optional — when the deposit was collected. Defaults to the Closing Date if left blank while an amount is given.' },
  { key: 'secondPaymentAmount', label: 'Second Payment Amount', note: 'Optional, if there was one.' },
  { key: 'secondPaymentDate', label: 'Second Payment Date', note: 'Optional.' },
  { key: 'agreementDate', label: 'Sale Agreement / Executed Date', note: 'Optional — when the sale agreement was signed.' },
  { key: 'closingDate', label: 'Closing Date', note: 'Required. The date the sale actually closed. Must be in the past — this is what flips the unit to SOLD.' },
  { key: 'brokerName', label: 'Broker Name', note: 'Optional. Must exactly match an existing broker\'s name.' },
  { key: 'notes', label: 'Notes', note: 'Optional — free text.' },
] as const;

const COMMISSION_COLUMNS = [
  { key: 'unitNumber', label: 'Unit Number', note: 'Required. Must match a Unit Number on the Sales sheet.' },
  { key: 'buyer', label: 'Buyer', note: 'Required. Must match the Buyer on that same Sales row — this is how a row here is matched to the right sale.' },
  { key: 'installmentNumber', label: 'Installment Number', note: 'Required, e.g. 1 for the first payment, 2 for the second.' },
  { key: 'amount', label: 'Amount', note: 'Required.' },
  { key: 'paidAt', label: 'Paid Date', note: 'Optional — leave blank if this installment has not been paid yet.' },
] as const;

export interface SalePreviewRow {
  rowNumber: number;
  status: 'ready' | 'error';
  errors: string[];
  unitNumber: string;
  /** Raw Building label from the sheet, not resolved — surfaced so a row whose unit
   * doesn't exist yet can offer creating both the building and the unit, pre-filled with
   * what the sheet already said, instead of asking the user to retype it. */
  building: string;
  buyer: string;
  /** Sheet's own Sqft, same reasoning as building — pre-fills the "create this unit" form. */
  sqft?: number;
  data: BackfillSaleInput & { unitId: string | null };
}

export interface OrphanedCommissionRow {
  sheet: 'Commission Installments';
  rowNumber: number;
  unitNumber: string;
  buyer: string;
  error: string;
}

export interface SaleImportPreview {
  sales: SalePreviewRow[];
  orphaned: OrphanedCommissionRow[];
  summary: { total: number; ready: number; errors: number };
}

export interface SaleImportCommitResult {
  imported: number;
  failed: number;
  results: Array<{ buyer: string; unitId: string | null; success: boolean; saleId?: string; error?: string }>;
}

@Injectable()
export class SaleImportService {
  constructor(
    private prisma: PrismaService,
    private sales: SalesService,
  ) {}

  // ─────── Template ───────

  async buildTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    addColumnarSheet(wb, SHEET_SALES, SALE_COLUMNS);
    addColumnarSheet(wb, SHEET_COMMISSIONS, COMMISSION_COLUMNS);
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  // ─────── Preview (parse + validate, no writes) ───────

  async previewImport(fileBuffer: Buffer, projectId: string): Promise<SaleImportPreview> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(fileBuffer as any);
    } catch {
      throw new BadRequestException('Could not read this file — is it a .xlsx file built from the template?');
    }

    const saleSheet = wb.getWorksheet(SHEET_SALES);
    if (!saleSheet) {
      throw new BadRequestException(`This file has no "${SHEET_SALES}" sheet — use the downloaded template.`);
    }

    assertHeaderMatches(saleSheet, SHEET_SALES, SALE_COLUMNS);

    type RawSale = {
      rowNumber: number;
      unitNumber: string;
      building: string;
      sqft?: number;
      seller: string;
      buyer: string;
      purchasePrice?: number;
      depositAmount?: number;
      depositDate?: string;
      secondPaymentAmount?: number;
      secondPaymentDate?: string;
      agreementDate?: string;
      closingDate?: string;
      brokerName: string;
      notes: string;
      errors: string[];
    };
    const raw: RawSale[] = [];
    saleSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header
      const get = (key: string) => row.getCell(SALE_COLUMNS.findIndex((c) => c.key === key) + 1);
      const unitNumber = cellText(get('unitNumber'));
      const buyer = cellText(get('buyer'));
      if (!unitNumber && !buyer) return; // blank row — skip silently
      raw.push({
        rowNumber,
        unitNumber,
        building: cellText(get('building')),
        sqft: cellNumber(get('sqft')),
        seller: cellText(get('seller')),
        buyer,
        purchasePrice: cellNumber(get('purchasePrice')),
        depositAmount: cellNumber(get('depositAmount')),
        depositDate: cellDateIso(get('depositDate')),
        secondPaymentAmount: cellNumber(get('secondPaymentAmount')),
        secondPaymentDate: cellDateIso(get('secondPaymentDate')),
        agreementDate: cellDateIso(get('agreementDate')),
        closingDate: cellDateIso(get('closingDate')),
        brokerName: cellText(get('brokerName')),
        notes: cellText(get('notes')),
        errors: [],
      });
    });

    const units = await this.prisma.unit.findMany({
      where: { deletedAt: null, building: { projectId, deletedAt: null } },
      select: { id: true, unitNumber: true, building: { select: { name: true } } },
    });
    const brokers = await this.prisma.broker.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });

    const today = new Date(); today.setUTCHours(0, 0, 0, 0);

    const sales: SalePreviewRow[] = raw.map((r) => {
      const errors = [...r.errors];

      if (!r.unitNumber) errors.push('Unit Number is required.');
      if (!r.buyer) errors.push('Buyer is required.');
      if (r.purchasePrice == null) errors.push('Purchase Price is required.');
      if (!r.closingDate) errors.push('Closing Date is required and must be a valid date.');

      const unitResolved = resolveUnit(units, r.unitNumber, r.building);
      if (unitResolved.error) errors.push(unitResolved.error);
      const unitId = unitResolved.unitId;

      const brokerResolved = resolveBroker(brokers, r.brokerName);
      if (brokerResolved.error) errors.push(brokerResolved.error);
      const brokerId = brokerResolved.brokerId;

      if (r.closingDate) {
        const closingDate = new Date(r.closingDate);
        if (closingDate > today) errors.push('Closing Date is in the future — this sale has not closed yet.');
      }

      const payments: { label: string; amount: number; paidAt?: string }[] = [];
      if (r.depositAmount != null) payments.push({ label: 'Deposit', amount: r.depositAmount, paidAt: r.depositDate });
      if (r.secondPaymentAmount != null) payments.push({ label: 'Second Payment', amount: r.secondPaymentAmount, paidAt: r.secondPaymentDate });

      return {
        rowNumber: r.rowNumber,
        status: errors.length ? 'error' : 'ready',
        errors,
        unitNumber: r.unitNumber,
        building: r.building,
        buyer: r.buyer,
        sqft: r.sqft,
        data: {
          unitId,
          seller: r.seller || undefined,
          buyer: r.buyer,
          salePrice: r.purchasePrice ?? 0,
          contractDate: r.agreementDate,
          closingDate: r.closingDate ?? '',
          notes: r.notes || undefined,
          brokerId,
          payments: payments.length ? payments : undefined,
        },
      };
    });

    // ---- Join Commission Installments by (Unit Number, Buyer) ----
    const rowsByKey = new Map<string, SalePreviewRow[]>();
    for (const s of sales) {
      const k = joinKey(s.unitNumber, s.buyer);
      const list = rowsByKey.get(k) ?? [];
      list.push(s);
      rowsByKey.set(k, list);
    }

    const orphaned: OrphanedCommissionRow[] = [];
    const commissionSheet = wb.getWorksheet(SHEET_COMMISSIONS);
    if (commissionSheet) {
      assertHeaderMatches(commissionSheet, SHEET_COMMISSIONS, COMMISSION_COLUMNS);
      commissionSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const get = (key: string) => row.getCell(COMMISSION_COLUMNS.findIndex((c) => c.key === key) + 1);
        const unitNumber = cellText(get('unitNumber'));
        const buyer = cellText(get('buyer'));
        if (!unitNumber && !buyer) return;
        const amount = cellNumber(get('amount'));
        const paidAt = cellDateIso(get('paidAt'));
        const matches = rowsByKey.get(joinKey(unitNumber, buyer)) ?? [];
        if (matches.length !== 1) {
          orphaned.push({
            sheet: SHEET_COMMISSIONS, rowNumber, unitNumber, buyer,
            error: matches.length === 0
              ? 'No Sales row matches this Unit Number + Buyer.'
              : 'More than one Sales row matches this Unit Number + Buyer — ambiguous.',
          });
          return;
        }
        const target = matches[0];
        if (amount == null) {
          orphaned.push({ sheet: SHEET_COMMISSIONS, rowNumber, unitNumber, buyer, error: 'Amount is required.' });
          return;
        }
        if (!target.data.brokerId) {
          target.errors.push(`Commission installment given (row ${rowNumber}) but no Broker Name was set on this sale.`);
          target.status = 'error';
          return;
        }
        target.data.commissionInstallments = [...(target.data.commissionInstallments ?? []), { amount, paidAt }];
      });
    }

    return {
      sales,
      orphaned,
      summary: {
        total: sales.length,
        ready: sales.filter((s) => s.status === 'ready').length,
        errors: sales.filter((s) => s.status === 'error').length,
      },
    };
  }

  // ─────── Commit (real writes) ───────

  /**
   * Each row is committed by calling the EXISTING backfillSale() — composition, not a
   * bypass, mirroring LeaseImportService.commitImport exactly. A broken row is caught and
   * reported; it never blocks the rest of the batch.
   *
   * Import ORDER matters when a rent-history import and a sale-history import are run in
   * the same sitting for overlapping units: backfillSale ends any tenancy already on
   * record at the closing date, so a unit's historical lease should be imported before its
   * historical sale (client-confirmed Q5 — a warning is sufficient, not hard enforcement;
   * the UI surfaces this, this method does not police it).
   */
  async commitImport(rows: (BackfillSaleInput & { unitId: string | null })[], userId?: string): Promise<SaleImportCommitResult> {
    const results: SaleImportCommitResult['results'] = [];
    for (const row of rows) {
      if (!row.unitId || !row.buyer || !row.closingDate || row.salePrice == null) {
        results.push({
          buyer: row.buyer, unitId: row.unitId ?? null, success: false,
          error: 'Row is missing required fields — it must be re-previewed before committing.',
        });
        continue;
      }
      try {
        const sale = await this.sales.backfillSale({ ...row, unitId: row.unitId }, userId);
        results.push({ buyer: row.buyer, unitId: row.unitId, success: true, saleId: sale.id });
      } catch (e: any) {
        results.push({ buyer: row.buyer, unitId: row.unitId, success: false, error: e?.message ?? 'Unknown error' });
      }
    }
    return {
      imported: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }
}
