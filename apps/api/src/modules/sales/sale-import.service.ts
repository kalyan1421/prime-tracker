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

/**
 * Fields a reviewer may retype in the preview UI instead of fixing the spreadsheet and
 * re-uploading (R11). Keyed by the sheet's own row number, which is stable across
 * re-previews of the same file, so an edit made against one preview lands on the same row
 * in the next one.
 *
 * Overrides are applied to the PARSED row before validation runs, deliberately: there is
 * then exactly one validation path, and a typed-in closing date is checked for being in
 * the future, a typed-in unit number is resolved against the project, and a typed-in
 * buyer re-joins the Commission Installments sheet, all by the same code that handles
 * values read from cells. Nothing here writes; the commit step is unchanged.
 */
const OVERRIDE_TEXT_FIELDS = ['unitNumber', 'building', 'buyer', 'seller', 'brokerName', 'notes'] as const;
const OVERRIDE_NUMBER_FIELDS = ['purchasePrice', 'depositAmount', 'secondPaymentAmount'] as const;
const OVERRIDE_DATE_FIELDS = ['closingDate', 'agreementDate', 'depositDate', 'secondPaymentDate'] as const;

export type SaleOverrideField =
  | (typeof OVERRIDE_TEXT_FIELDS)[number]
  | (typeof OVERRIDE_NUMBER_FIELDS)[number]
  | (typeof OVERRIDE_DATE_FIELDS)[number];

/** Every value arrives as a string (the UI's inputs are strings); '' clears the field. */
export type SaleRowOverride = Partial<Record<SaleOverrideField, string | number | null>>;
export type SaleImportOverrides = Record<number, SaleRowOverride>;

const OVERRIDE_LABELS: Record<SaleOverrideField, string> = Object.fromEntries(
  SALE_COLUMNS.map((c) => [c.key, c.label]),
) as Record<SaleOverrideField, string>;

const ALL_OVERRIDE_FIELDS: SaleOverrideField[] = [
  ...OVERRIDE_TEXT_FIELDS, ...OVERRIDE_NUMBER_FIELDS, ...OVERRIDE_DATE_FIELDS,
];

/**
 * Rejects a malformed overrides payload up front rather than letting a stray key silently
 * do nothing (or, worse, a stray field name quietly overwrite something adjacent). A
 * client bug should be loud here — this is a financial import.
 */
export function normalizeSaleOverrides(input: unknown): SaleImportOverrides {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('overrides must be an object keyed by row number');
  }
  const out: SaleImportOverrides = {};
  for (const [rowKey, value] of Object.entries(input as Record<string, unknown>)) {
    const rowNumber = Number(rowKey);
    if (!Number.isInteger(rowNumber) || rowNumber < 2) {
      throw new BadRequestException(`overrides key "${rowKey}" is not a sheet row number`);
    }
    if (value == null) continue;
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(`overrides for row ${rowNumber} must be an object of field values`);
    }
    const row: SaleRowOverride = {};
    for (const [field, raw] of Object.entries(value as Record<string, unknown>)) {
      if (!ALL_OVERRIDE_FIELDS.includes(field as SaleOverrideField)) {
        throw new BadRequestException(`"${field}" is not a correctable field on row ${rowNumber}`);
      }
      if (raw == null) { row[field as SaleOverrideField] = ''; continue; }
      if (typeof raw !== 'string' && typeof raw !== 'number') {
        throw new BadRequestException(`overrides.${rowNumber}.${field} must be text or a number`);
      }
      row[field as SaleOverrideField] = raw;
    }
    if (Object.keys(row).length > 0) out[rowNumber] = row;
  }
  return out;
}

/** Same UTC re-anchoring as cellDateIso — a bare date string must not shift a day. */
function overrideDateIso(value: string): string | undefined {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const [y, m, d] = /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10).split('-').map(Number)
    : [parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()];
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

export interface SalePreviewRow {
  rowNumber: number;
  /**
   * `duplicate` — this exact sale is already stored, which is what re-uploading a sheet
   * that has grown by a few rows looks like. It is deliberately NOT an error: the row is
   * fine, there is simply nothing to do with it, and calling it an error would push people
   * to "fix" rows that are already correct. It is excluded from the commit.
   */
  status: 'ready' | 'error' | 'duplicate';
  errors: string[];
  /** Non-blocking notes — e.g. the stored price disagrees with the sheet's. */
  warnings: string[];
  unitNumber: string;
  /** Raw Building label from the sheet, not resolved — surfaced so a row whose unit
   * doesn't exist yet can offer creating both the building and the unit, pre-filled with
   * what the sheet already said, instead of asking the user to retype it. */
  building: string;
  buyer: string;
  /** Sheet's own Sqft, same reasoning as building — pre-fills the "create this unit" form. */
  sqft?: number;
  /** Field keys on this row whose value came from a correction typed into the review UI
   * rather than from the file — the UI marks them so nobody mistakes a hand-entered
   * closing date for one the spreadsheet actually contained. */
  edited: SaleOverrideField[];
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
  summary: { total: number; ready: number; errors: number; duplicates: number };
}

export interface SaleImportCommitResult {
  imported: number;
  failed: number;
  /** Rows the commit itself found already stored — see commitImport. */
  skipped: number;
  results: Array<{
    buyer: string;
    unitId: string | null;
    success: boolean;
    skipped?: boolean;
    saleId?: string;
    error?: string;
  }>;
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

  async previewImport(fileBuffer: Buffer, projectId: string, overrides: SaleImportOverrides = {}): Promise<SaleImportPreview> {
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
      edited: SaleOverrideField[];
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
        edited: [],
      });
    });

    for (const r of raw) {
      const override = overrides[r.rowNumber];
      if (!override) continue;
      for (const [field, rawValue] of Object.entries(override) as [SaleOverrideField, string | number | null][]) {
        const text = rawValue == null ? '' : String(rawValue).trim();
        const label = OVERRIDE_LABELS[field];
        if ((OVERRIDE_TEXT_FIELDS as readonly string[]).includes(field)) {
          (r as any)[field] = text;
        } else if ((OVERRIDE_NUMBER_FIELDS as readonly string[]).includes(field)) {
          if (!text) { (r as any)[field] = undefined; }
          else {
            const n = Number(text.replace(/[$,\s]/g, ''));
            if (Number.isNaN(n)) { r.errors.push(`${label} "${text}" you entered isn't a number.`); continue; }
            (r as any)[field] = n;
          }
        } else {
          if (!text) { (r as any)[field] = undefined; }
          else {
            const iso = overrideDateIso(text);
            if (!iso) { r.errors.push(`${label} "${text}" you entered isn't a valid date.`); continue; }
            (r as any)[field] = iso;
          }
        }
        r.edited.push(field);
      }
    }

    const units = await this.prisma.unit.findMany({
      where: { deletedAt: null, building: { projectId, deletedAt: null } },
      select: { id: true, unitNumber: true, building: { select: { name: true } } },
    });
    const brokers = await this.prisma.broker.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });
    // Sales ALREADY on this project's units — the check the rent importer has had since
    // it was written, and this one never got. Without it a re-uploaded sheet came back
    // entirely green and wrote every previously-imported row a second time; a unit that
    // was imported three times carried three identical sales, and only one of them was
    // reachable by any delete UI. A sale has no date range, so unlike a lease there is no
    // DB exclusion constraint underneath to catch what the preview misses.
    const existingSales = await this.prisma.sale.findMany({
      where: {
        deletedAt: null,
        unitId: { not: null },
        unit: { deletedAt: null, building: { projectId, deletedAt: null } },
      },
      select: { unitId: true, buyer: true, salePrice: true, closingDate: true },
    });
    const existingByUnit = new Map<string, typeof existingSales>();
    for (const s of existingSales) {
      if (!s.unitId) continue;
      const list = existingByUnit.get(s.unitId) ?? [];
      list.push(s);
      existingByUnit.set(s.unitId, list);
    }

    const today = new Date(); today.setUTCHours(0, 0, 0, 0);

    // Same identity within THIS file, caught before the DB ever sees it. A combined-deal
    // sheet that lists one sale once per sub-unit is the common way this happens.
    const seenInFile = new Map<string, number>();

    const sales: SalePreviewRow[] = raw.map((r) => {
      const errors = [...r.errors];
      const warnings: string[] = [];

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

      // ---- Already imported? ----
      // Identity is (unit, buyer, closing day) — the same tuple backfillSale refuses at
      // the write. Matching the two keeps the preview honest: what it calls a duplicate is
      // exactly what the commit would decline, not a near-miss heuristic of its own.
      let duplicateOfExisting = false;
      if (unitId && r.closingDate && r.buyer) {
        const key = `${unitId}|${r.buyer.trim().toLowerCase()}|${r.closingDate}`;
        const firstSeenAt = seenInFile.get(key);
        if (firstSeenAt != null) {
          errors.push(`Same sale as row ${firstSeenAt} in this file — remove one of them.`);
        } else {
          seenInFile.set(key, r.rowNumber);
        }

        const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
        const match = (existingByUnit.get(unitId) ?? []).find(
          (s) => day(s.closingDate) === r.closingDate
            && !!s.buyer && s.buyer.trim().toLowerCase() === r.buyer.trim().toLowerCase(),
        );
        if (match) {
          duplicateOfExisting = true;
          // Skipping is normally the end of it — but not when the stored price differs
          // from what the sheet now says. Silently skipping would leave the wrong number
          // in the books with nothing to show it was ever questioned.
          if (r.purchasePrice != null && Number(match.salePrice) !== r.purchasePrice) {
            warnings.push(
              `Already imported at ${Number(match.salePrice).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}, `
              + `but this file says ${r.purchasePrice.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}. `
              + 'An import never updates an existing sale — correct it by hand if the file is right.',
            );
          }
        }
      }

      return {
        rowNumber: r.rowNumber,
        // A duplicate only counts as such when nothing ELSE is wrong with the row —
        // otherwise a row with real problems would be quietly filed as "already done".
        status: errors.length ? 'error' : (duplicateOfExisting ? 'duplicate' : 'ready'),
        errors,
        warnings,
        unitNumber: r.unitNumber,
        building: r.building,
        buyer: r.buyer,
        sqft: r.sqft,
        edited: r.edited,
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
        duplicates: sales.filter((s) => s.status === 'duplicate').length,
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
   *
   * Already-stored rows are SKIPPED, not failed. The preview marks them, but the rows
   * posted here are whatever the client held from an earlier preview — and the way this
   * duplicated data in the first place was a preview going stale between being generated
   * and being committed (create the missing units, re-check the file, and every row that
   * was already imported comes back green again). Re-checking at the write makes the
   * commit idempotent whatever the client sends, which is the only place that guarantee
   * can be made. A skip is a no-op, so it is reported apart from real failures rather than
   * as an error somebody has to go and investigate.
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
      const closingDate = new Date(row.closingDate);
      if (!Number.isNaN(closingDate.getTime())) {
        const existing = await this.sales.findDuplicateHistoricalSale({
          unitId: row.unitId, buildingId: null, buyer: row.buyer, closingDate,
        });
        if (existing) {
          results.push({
            buyer: row.buyer, unitId: row.unitId, success: false, skipped: true,
            saleId: existing.id,
            error: 'Already recorded on this unit — skipped.',
          });
          continue;
        }
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
      failed: results.filter((r) => !r.success && !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
      results,
    };
  }
}
