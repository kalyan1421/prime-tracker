import { Injectable, BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { LeasesService, TERMINATION_REASONS } from './leases.service';
import {
  addColumnarSheet, cellText, cellDateIso, cellNumber, resolveUnit, resolveBroker, joinKey,
} from '../../common/utils/xlsx-import';
import {
  readRawGrid, analyzeGrid, applyMapping, textToDateIso, textToNumber,
  parseDurationMonths, addMonthsIso, extractFirstEmail, extractFirstToken,
  type AnalyzeResult, type ConfirmedMapping,
} from '../../common/utils/xlsx-mapping';

const SHEET_TENANCIES = 'Tenancies';
const SHEET_LEDGER_EXCEPTIONS = 'Ledger Exceptions';
const SHEET_COMMISSIONS = 'Commission Installments';

/**
 * Column layout for the Tenancies sheet, in order. Kept as one array so the template
 * writer and the parser can never silently disagree about which column means what.
 */
const TENANCY_COLUMNS = [
  { key: 'unitNumber', label: 'Unit Number', note: 'Required. Must match a unit already in this project.' },
  { key: 'building', label: 'Building', note: 'Optional — only needed if the unit number exists in more than one building in this project.' },
  { key: 'tenantName', label: 'Tenant Name', note: 'Required.' },
  { key: 'tenantLegalName', label: 'Tenant Legal Name', note: 'Optional — the signing entity, if different from the trading name.' },
  { key: 'tenantBrand', label: 'Tenant Brand', note: 'Optional — the doing-business-as / storefront name.' },
  { key: 'sqft', label: 'Sqft', note: 'Optional, but required for any row that is part of a Combined Deal (see that column) and needs its rent split automatically.' },
  { key: 'leaseStart', label: 'Lease Start', note: 'Required. Date the lease legally began.' },
  { key: 'leaseEnd', label: 'Lease End', note: 'Required. The CONTRACTED expiry date, even if the tenant left early.' },
  { key: 'terminationDate', label: 'Termination Date', note: 'The date the tenant actually moved out. Must be in the past. Leave blank if this tenant is still there — the row imports as an ACTIVE lease instead of a historical one.' },
  { key: 'terminationReason', label: 'Termination Reason', note: `Optional. One of: ${TERMINATION_REASONS.join(', ')}. Defaults to EXPIRED.` },
  { key: 'monthlyRent', label: 'Monthly Rent', note: 'Required, unless this row is part of a Combined Deal and its rent should be split automatically by Sqft from the total entered on one row of the group.' },
  { key: 'rentPsf', label: 'Rent PSF', note: 'Optional — informational only, not stored. Keep this in its own column; do not combine it with Monthly Rent in one cell.' },
  { key: 'rentStartDate', label: 'Rent Start Date', note: 'Optional. Only needed if rent commencement differed from Lease Start (a fit-out gap).' },
  { key: 'securityDeposit', label: 'Security Deposit', note: 'Optional — the agreed amount.' },
  { key: 'rentDueDay', label: 'Rent Due Day', note: 'Optional, 1-31. Defaults to the 1st.' },
  { key: 'brokerName', label: 'Broker Name', note: 'Optional. Must exactly match an existing broker\'s name.' },
  { key: 'combinedDealRef', label: 'Combined Deal Reference', note: 'Optional. Give two or more rows the SAME value here when one lease covered more than one physical unit — enter one row per unit, each with that unit\'s own Sqft.' },
  { key: 'notes', label: 'Notes', note: 'Optional — free text. Renewal option terms (e.g. "2x5yr options") go here; only actually-exercised renewals are tracked as real records.' },
] as const;

const LEDGER_EXCEPTION_COLUMNS = [
  { key: 'unitNumber', label: 'Unit Number', note: 'Required. Must match a Unit Number on the Tenancies sheet.' },
  { key: 'tenantName', label: 'Tenant Name', note: 'Required. Must match the Tenant Name on that same Tenancies row — this is how a row here is matched to the right tenancy.' },
  { key: 'month', label: 'Month', note: 'Required, format YYYY-MM. Only list months that differed from paid-in-full — everything else defaults to fully paid.' },
  { key: 'amountCollected', label: 'Amount Collected', note: 'Required. Enter 0 for a month nothing was collected — it will show as DUE, not silently paid.' },
] as const;

const COMMISSION_COLUMNS = [
  { key: 'unitNumber', label: 'Unit Number', note: 'Required. Must match a Unit Number on the Tenancies sheet.' },
  { key: 'tenantName', label: 'Tenant Name', note: 'Required. Must match the Tenant Name on that same Tenancies row.' },
  { key: 'installmentNumber', label: 'Installment Number', note: 'Required, e.g. 1 for the first payment, 2 for the second.' },
  { key: 'amount', label: 'Amount', note: 'Required.' },
  { key: 'paidAt', label: 'Paid Date', note: 'Optional — leave blank if this installment has not been paid yet.' },
] as const;

export interface TenancyPreviewRow {
  rowNumber: number;
  status: 'ready' | 'error';
  errors: string[];
  unitNumber: string;
  tenantName: string;
  rentAutoSplit: boolean;
  /** R9.2 — true when this row has no Termination Date and will be committed as an
   * ACTIVE lease (touching the unit's current status) instead of a historical one. */
  willBeActive: boolean;
  /** Unit metadata, not lease data — surfaced so a row whose unit doesn't exist yet can
   * pre-fill the "create this unit" form with the sqft the sheet already gave us,
   * instead of asking the user to type it in twice. */
  sqft?: number;
  data: {
    unitId: string | null;
    tenantName: string;
    tenantLegalName?: string | null;
    tenantBrand?: string | null;
    landlordEntity?: string | null;
    tenantEmail?: string | null;
    tenantPhone?: string | null;
    leaseStart?: string;
    leaseEnd?: string;
    terminationDate?: string;
    terminationReason?: string;
    monthlyRent?: number;
    rentStartDate?: string;
    securityDeposit?: number;
    rentPerSqft?: number;
    escalationPct?: number;
    nnnPerSqft?: number;
    nnnTotalAmount?: number;
    tiAllowance?: number;
    rentDueDay?: number;
    brokerId?: string | null;
    combinedDealRef?: string;
    notes?: string;
    collections?: Record<string, number>;
    commissionInstallments?: { amount: number; paidAt?: string }[];
  };
}

export interface OrphanedAuxRow {
  sheet: 'Ledger Exceptions' | 'Commission Installments';
  rowNumber: number;
  unitNumber: string;
  tenantName: string;
  error: string;
}

export interface ImportPreview {
  tenancies: TenancyPreviewRow[];
  orphaned: OrphanedAuxRow[];
  summary: { total: number; ready: number; errors: number };
}

export interface ImportCommitRowInput {
  unitId: string | null;
  tenantName: string;
  tenantLegalName?: string;
  tenantBrand?: string;
  landlordEntity?: string;
  tenantEmail?: string;
  tenantPhone?: string;
  leaseStart?: string;
  leaseEnd?: string;
  terminationDate?: string;
  terminationReason?: string;
  monthlyRent?: number;
  rentStartDate?: string;
  securityDeposit?: number;
  rentPerSqft?: number;
  escalationPct?: number;
  nnnPerSqft?: number;
  nnnTotalAmount?: number;
  tiAllowance?: number;
  rentDueDay?: number;
  brokerId?: string | null;
  combinedDealRef?: string;
  notes?: string;
  collections?: Record<string, number>;
  commissionInstallments?: { amount: number; paidAt?: string }[];
}

export interface ImportCommitResult {
  imported: number;
  failed: number;
  results: Array<{ tenantName: string; unitId: string | null; success: boolean; leaseId?: string; error?: string }>;
}

/** Shape both the template parser (Pass 1 of previewImport) and the generic column-mapping
 * parser (R9) produce, so validation downstream never has to know which path a row came from. */
interface RawTenancy {
  rowNumber: number;
  unitNumber: string;
  building: string;
  tenantName: string;
  tenantLegalName: string;
  tenantBrand: string;
  landlordEntity?: string;
  tenantEmail?: string;
  tenantPhone?: string;
  sqft?: number;
  leaseStart?: string;
  leaseEnd?: string;
  terminationDate?: string;
  terminationReason: string;
  monthlyRent?: number;
  rentStartDate?: string;
  securityDeposit?: number;
  rentPerSqft?: number;
  escalationPct?: number;
  nnnPerSqft?: number;
  nnnTotalAmount?: number;
  tiAllowance?: number;
  rentDueDay?: number;
  brokerName: string;
  combinedDealRef: string;
  notes: string;
  /** Only ever set by the generic-mapping path (R9) — the template path attaches these
   * later, from the Commission Installments sheet, after validateTenancyRows returns. */
  commissionInstallments?: { amount: number; paidAt?: string }[];
  errors: string[];
}

@Injectable()
export class LeaseImportService {
  constructor(
    private prisma: PrismaService,
    private leases: LeasesService,
  ) {}

  // ─────── Template ───────

  async buildTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    addColumnarSheet(wb, SHEET_TENANCIES, TENANCY_COLUMNS);
    addColumnarSheet(wb, SHEET_LEDGER_EXCEPTIONS, LEDGER_EXCEPTION_COLUMNS);
    addColumnarSheet(wb, SHEET_COMMISSIONS, COMMISSION_COLUMNS);
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  // ─────── Preview (parse + validate, no writes) ───────

  async previewImport(fileBuffer: Buffer, projectId: string): Promise<ImportPreview> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(fileBuffer as any);
    } catch {
      throw new BadRequestException('Could not read this file — is it a .xlsx file built from the template?');
    }

    const tenancySheet = wb.getWorksheet(SHEET_TENANCIES);
    if (!tenancySheet) {
      throw new BadRequestException(`This file has no "${SHEET_TENANCIES}" sheet — use the downloaded template.`);
    }

    // ---- Pass 1: read raw rows off the Tenancies sheet ----
    const raw: RawTenancy[] = [];
    tenancySheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header
      const get = (key: string) => row.getCell(TENANCY_COLUMNS.findIndex((c) => c.key === key) + 1);
      const unitNumber = cellText(get('unitNumber'));
      const tenantName = cellText(get('tenantName'));
      if (!unitNumber && !tenantName) return; // blank row — skip silently
      raw.push({
        rowNumber,
        unitNumber,
        building: cellText(get('building')),
        tenantName,
        tenantLegalName: cellText(get('tenantLegalName')),
        tenantBrand: cellText(get('tenantBrand')),
        sqft: cellNumber(get('sqft')),
        leaseStart: cellDateIso(get('leaseStart')),
        leaseEnd: cellDateIso(get('leaseEnd')),
        terminationDate: cellDateIso(get('terminationDate')),
        terminationReason: cellText(get('terminationReason')).toUpperCase(),
        monthlyRent: cellNumber(get('monthlyRent')),
        rentStartDate: cellDateIso(get('rentStartDate')),
        securityDeposit: cellNumber(get('securityDeposit')),
        rentDueDay: cellNumber(get('rentDueDay')),
        brokerName: cellText(get('brokerName')),
        combinedDealRef: cellText(get('combinedDealRef')),
        notes: cellText(get('notes')),
        errors: [],
      });
    });

    const tenancies = await this.validateTenancyRows(raw, projectId);

    // ---- Join Ledger Exceptions + Commission Installments by (Unit Number, Tenant Name) ----
    const rowsByKey = new Map<string, TenancyPreviewRow[]>();
    for (const t of tenancies) {
      const k = joinKey(t.unitNumber, t.tenantName);
      const list = rowsByKey.get(k) ?? [];
      list.push(t);
      rowsByKey.set(k, list);
    }

    const orphaned: OrphanedAuxRow[] = [];

    const ledgerSheet = wb.getWorksheet(SHEET_LEDGER_EXCEPTIONS);
    if (ledgerSheet) {
      ledgerSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const get = (key: string) => row.getCell(LEDGER_EXCEPTION_COLUMNS.findIndex((c) => c.key === key) + 1);
        const unitNumber = cellText(get('unitNumber'));
        const tenantName = cellText(get('tenantName'));
        if (!unitNumber && !tenantName) return;
        const month = cellText(get('month'));
        const amount = cellNumber(get('amountCollected'));
        const matches = rowsByKey.get(joinKey(unitNumber, tenantName)) ?? [];
        if (matches.length !== 1) {
          orphaned.push({
            sheet: SHEET_LEDGER_EXCEPTIONS, rowNumber, unitNumber, tenantName,
            error: matches.length === 0
              ? 'No Tenancies row matches this Unit Number + Tenant Name.'
              : 'More than one Tenancies row matches this Unit Number + Tenant Name — ambiguous.',
          });
          return;
        }
        if (!/^\d{4}-\d{2}$/.test(month) || amount == null) {
          orphaned.push({
            sheet: SHEET_LEDGER_EXCEPTIONS, rowNumber, unitNumber, tenantName,
            error: 'Month must be YYYY-MM and Amount Collected must be a number.',
          });
          return;
        }
        const target = matches[0];
        target.data.collections = { ...(target.data.collections ?? {}), [month]: amount };
      });
    }

    const commissionSheet = wb.getWorksheet(SHEET_COMMISSIONS);
    if (commissionSheet) {
      commissionSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const get = (key: string) => row.getCell(COMMISSION_COLUMNS.findIndex((c) => c.key === key) + 1);
        const unitNumber = cellText(get('unitNumber'));
        const tenantName = cellText(get('tenantName'));
        if (!unitNumber && !tenantName) return;
        const amount = cellNumber(get('amount'));
        const paidAt = cellDateIso(get('paidAt'));
        const matches = rowsByKey.get(joinKey(unitNumber, tenantName)) ?? [];
        if (matches.length !== 1) {
          orphaned.push({
            sheet: SHEET_COMMISSIONS, rowNumber, unitNumber, tenantName,
            error: matches.length === 0
              ? 'No Tenancies row matches this Unit Number + Tenant Name.'
              : 'More than one Tenancies row matches this Unit Number + Tenant Name — ambiguous.',
          });
          return;
        }
        const target = matches[0];
        if (amount == null) {
          orphaned.push({ sheet: SHEET_COMMISSIONS, rowNumber, unitNumber, tenantName, error: 'Amount is required.' });
          return;
        }
        if (!target.data.brokerId) {
          target.errors.push(`Commission installment given (row ${rowNumber}) but no Broker Name was set on this tenancy.`);
          target.status = 'error';
          return;
        }
        target.data.commissionInstallments = [...(target.data.commissionInstallments ?? []), { amount, paidAt }];
      });
    }

    return {
      tenancies,
      orphaned,
      summary: {
        total: tenancies.length,
        ready: tenancies.filter((t) => t.status === 'ready').length,
        errors: tenancies.filter((t) => t.status === 'error').length,
      },
    };
  }

  /**
   * Shared by both parse paths (our fixed template, and R9's generic column mapping): R8's
   * proportional-by-sqft rent split, unit/broker resolution, required-field checks, and
   * same-file overlap detection. Neither caller re-implements any of this.
   */
  private async validateTenancyRows(
    raw: RawTenancy[],
    projectId: string,
    /** R9.2 — a sheet-wide fallback broker for rows whose own Broker Name doesn't
     * resolve (or wasn't mapped at all), used only when the row actually carries
     * commission installments to attribute. Never overrides a row's own broker. */
    defaultBrokerId?: string,
    /** R9.3 — per-row broker fixes, keyed by rowNumber. Different tenants on the same
     * sheet often have different brokers, so a single sheet-wide default doesn't fit —
     * this lets the preview screen fix one row at a time. Takes priority over
     * defaultBrokerId for the row it names; still never overrides a row's own broker. */
    rowBrokerOverrides?: Record<number, string>,
  ): Promise<TenancyPreviewRow[]> {
    // ---- R8: proportional rent split within each Combined Deal group ----
    const groups = new Map<string, RawTenancy[]>();
    for (const r of raw) {
      if (!r.combinedDealRef) continue;
      const list = groups.get(r.combinedDealRef) ?? [];
      list.push(r);
      groups.set(r.combinedDealRef, list);
    }
    const autoSplitRows = new Set<RawTenancy>();
    for (const [ref, rows] of groups) {
      const withRent = rows.filter((r) => r.monthlyRent != null);
      const withoutRent = rows.filter((r) => r.monthlyRent == null);
      if (withoutRent.length === 0) continue; // every row already has its own figure
      if (withRent.length !== 1) {
        // Either nobody entered a total, or more than one row did — ambiguous either way.
        for (const r of withoutRent) {
          r.errors.push(
            `Combined Deal "${ref}": Monthly Rent is blank and the group total isn't unambiguous ` +
            `(exactly one row must carry the total; ${withRent.length} do).`,
          );
        }
        continue;
      }
      const total = withRent[0].monthlyRent!;
      const missingSqft = rows.filter((r) => r.sqft == null);
      if (missingSqft.length > 0) {
        for (const r of withoutRent) {
          r.errors.push(`Combined Deal "${ref}": cannot split rent by Sqft — Sqft is missing for one or more rows in this group.`);
        }
        continue;
      }
      const totalSqft = rows.reduce((sum, r) => sum + (r.sqft ?? 0), 0);
      if (totalSqft <= 0) {
        for (const r of withoutRent) r.errors.push(`Combined Deal "${ref}": total Sqft across the group is zero.`);
        continue;
      }
      for (const r of rows) {
        if (r.monthlyRent == null) {
          r.monthlyRent = Math.round((total * (r.sqft! / totalSqft)) * 100) / 100;
          autoSplitRows.add(r);
        }
      }
    }

    // ---- Resolve units + brokers + validate ----
    const units = await this.prisma.unit.findMany({
      where: { deletedAt: null, building: { projectId, deletedAt: null } },
      select: { id: true, unitNumber: true, building: { select: { name: true } } },
    });
    const brokers = await this.prisma.broker.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });
    // Trust nothing arriving as a bare id string from the request — only fall back to
    // it if it's actually a real, non-deleted broker.
    const resolvedDefaultBrokerId = defaultBrokerId && brokers.some((b) => b.id === defaultBrokerId)
      ? defaultBrokerId
      : undefined;

    const today = new Date(); today.setUTCHours(0, 0, 0, 0);

    // Track [leaseStart, terminationDate] per unit within THIS file to catch a same-file
    // overlap before it ever reaches the DB constraint — the DB check on commit is still
    // the authority, but this is the difference between "row 12 conflicts with row 4 in
    // the file you're looking at" and a bare 500 on commit.
    const rangesByUnit = new Map<string, { rowNumber: number; start: Date; end: Date }[]>();

    return raw.map((r) => {
      const errors = [...r.errors];

      if (!r.unitNumber) errors.push('Unit Number is required.');
      if (!r.tenantName) errors.push('Tenant Name is required.');
      if (!r.leaseStart) errors.push('Lease Start is required and must be a valid date.');
      if (!r.leaseEnd) errors.push('Lease End is required and must be a valid date.');
      // Termination Date is intentionally NOT required — a blank one means the tenancy
      // is still going (R9.2), and backfillTenancy() creates it ACTIVE instead of
      // EXPIRED/TERMINATED. A row whose cell was mapped but failed to PARSE looks
      // identical to one deliberately left blank; that's an accepted trade-off — the
      // preview clearly shows "still active" so a genuinely-ended tenancy with a bad
      // date is easy to spot and fix, rather than silently misclassified either way.
      if (r.monthlyRent == null) errors.push('Monthly Rent is required.');
      if (r.terminationReason && !(TERMINATION_REASONS as readonly string[]).includes(r.terminationReason)) {
        errors.push(`Termination Reason "${r.terminationReason}" is not one of: ${TERMINATION_REASONS.join(', ')}.`);
      }

      const unitResolved = resolveUnit(units, r.unitNumber, r.building);
      if (unitResolved.error) errors.push(unitResolved.error);
      const unitId = unitResolved.unitId;

      const brokerResolved = resolveBroker(brokers, r.brokerName);
      if (brokerResolved.error) errors.push(brokerResolved.error);
      // Priority for a row that named no broker of its own: this row's specific fix
      // (rowBrokerOverrides) first, then the sheet-wide default — neither ever overrides
      // a row's own (resolved or unresolved-with-error) Broker Name.
      const rowOverrideId = rowBrokerOverrides?.[r.rowNumber];
      const resolvedRowOverrideId = rowOverrideId && brokers.some((b) => b.id === rowOverrideId) ? rowOverrideId : undefined;
      const brokerId = brokerResolved.brokerId
        ?? (!r.brokerName ? resolvedRowOverrideId : undefined)
        ?? (!r.brokerName && r.commissionInstallments?.length ? resolvedDefaultBrokerId ?? null : null);

      // Only ever true for a generic-mapped row (see RawTenancy) — the template path's
      // equivalent check happens later, when the Commission Installments sheet is
      // joined, since that data isn't available yet at this point for that path.
      if (r.commissionInstallments?.length && !brokerId) {
        errors.push('Commission installment given but no Broker Name was set on this tenancy.');
      }

      let leaseStart: Date | undefined, leaseEnd: Date | undefined, terminationDate: Date | undefined;
      if (r.leaseStart && r.leaseEnd) {
        leaseStart = new Date(r.leaseStart);
        leaseEnd = new Date(r.leaseEnd);
        if (leaseEnd < leaseStart) errors.push('Lease End cannot be before Lease Start.');
        if (r.terminationDate) {
          terminationDate = new Date(r.terminationDate);
          if (terminationDate < leaseStart) errors.push('Termination Date cannot be before Lease Start.');
          if (terminationDate > today) errors.push('Termination Date is in the future — this tenancy has not ended yet.');
        }
      }
      // Still active = no Termination Date, but only once the row is otherwise valid —
      // an unresolved row shouldn't claim either status.
      const willBeActive = errors.length === 0 && !terminationDate;

      // Mirrors the DB's own overlap constraint, which ranges over
      // COALESCE(terminationDate, leaseEnd) for exactly this reason — an active lease's
      // occupancy window runs through its contracted end, not through "ongoing forever".
      const effectiveEnd = terminationDate ?? leaseEnd;
      if (unitId && leaseStart && effectiveEnd) {
        const existing = rangesByUnit.get(unitId) ?? [];
        const overlap = existing.find((e) => leaseStart! <= e.end && effectiveEnd! >= e.start);
        if (overlap) errors.push(`Overlaps another row for the same unit (row ${overlap.rowNumber}) in this file.`);
        existing.push({ rowNumber: r.rowNumber, start: leaseStart, end: effectiveEnd });
        rangesByUnit.set(unitId, existing);
      }

      return {
        rowNumber: r.rowNumber,
        status: errors.length ? 'error' : 'ready',
        errors,
        unitNumber: r.unitNumber,
        tenantName: r.tenantName,
        rentAutoSplit: autoSplitRows.has(r),
        willBeActive,
        sqft: r.sqft,
        data: {
          unitId,
          tenantName: r.tenantName,
          tenantLegalName: r.tenantLegalName || undefined,
          tenantBrand: r.tenantBrand || undefined,
          landlordEntity: r.landlordEntity || undefined,
          tenantEmail: r.tenantEmail || undefined,
          tenantPhone: r.tenantPhone || undefined,
          leaseStart: r.leaseStart,
          leaseEnd: r.leaseEnd,
          terminationDate: r.terminationDate,
          terminationReason: r.terminationReason || undefined,
          monthlyRent: r.monthlyRent,
          rentStartDate: r.rentStartDate,
          securityDeposit: r.securityDeposit,
          rentPerSqft: r.rentPerSqft,
          escalationPct: r.escalationPct,
          nnnPerSqft: r.nnnPerSqft,
          nnnTotalAmount: r.nnnTotalAmount,
          tiAllowance: r.tiAllowance,
          rentDueDay: r.rentDueDay,
          brokerId,
          combinedDealRef: r.combinedDealRef || undefined,
          notes: r.notes || undefined,
          commissionInstallments: r.commissionInstallments,
        },
      };
    });
  }

  // ─────── Generic column-mapping import (R9) ───────

  /**
   * Structural analysis only — no DB lookups, no validation. Reads whatever the client
   * uploaded as a plain grid, guesses the sheet's orientation, and suggests a target field
   * per column so the frontend can show a mapping screen with sensible defaults already
   * filled in. The user confirms (or corrects) the mapping before anything is parsed for
   * real in previewMappedImport().
   */
  async analyzeGenericFile(fileBuffer: Buffer): Promise<AnalyzeResult> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(fileBuffer as any);
    } catch {
      throw new BadRequestException('Could not read this file — is it a .xlsx spreadsheet?');
    }
    const grid = readRawGrid(wb);
    if (grid.length === 0) {
      throw new BadRequestException('This file has no data on its first sheet.');
    }
    return analyzeGrid(grid);
  }

  /**
   * The confirmed-mapping counterpart to previewImport(): same output shape, same
   * validation (validateTenancyRows), but the input rows are built from a user-confirmed
   * column mapping over an arbitrary sheet instead of our fixed template. Ledger
   * Exceptions / Commission Installments aren't sourced from a generic sheet in v1 — a
   * historical tenancy backfilled this way can still have those added by hand afterward.
   */
  async previewMappedImport(
    fileBuffer: Buffer,
    projectId: string,
    mapping: ConfirmedMapping,
    defaultBrokerId?: string,
    rowBrokerOverrides?: Record<number, string>,
  ): Promise<ImportPreview> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(fileBuffer as any);
    } catch {
      throw new BadRequestException('Could not read this file — is it a .xlsx spreadsheet?');
    }
    const grid = readRawGrid(wb);
    if (grid.length === 0) {
      throw new BadRequestException('This file has no data on its first sheet.');
    }
    const records = applyMapping(grid, mapping);

    const raw: RawTenancy[] = records.map((rec, i) => {
      const leaseStart = textToDateIso(rec.leaseStart);
      // Lease End is often not given directly — the real client sample gives a
      // duration ("10years") instead. Derive it only when Lease End itself is blank;
      // an explicit Lease End column always wins over a derived one.
      let leaseEnd = textToDateIso(rec.leaseEnd);
      if (!leaseEnd && leaseStart) {
        const months = parseDurationMonths(rec.leaseTermMonths);
        if (months != null) leaseEnd = addMonthsIso(leaseStart, months);
      }

      const commissionInstallments = [rec.commissionInstallment1, rec.commissionInstallment2, rec.commissionInstallment3]
        .map((v) => textToNumber(v))
        .filter((amount): amount is number => amount != null && amount > 0)
        .map((amount) => ({ amount }));

      return {
        rowNumber: i + 2, // +1 for the header row this grid still has, +1 to be 1-based
        unitNumber: (rec.unitNumber ?? '').trim(),
        building: (rec.building ?? '').trim(),
        tenantName: (rec.tenantName ?? '').trim(),
        tenantLegalName: (rec.tenantLegalName ?? '').trim(),
        tenantBrand: (rec.tenantBrand ?? '').trim(),
        landlordEntity: (rec.landlordEntity ?? '').trim(),
        tenantEmail: extractFirstEmail(rec.tenantEmail) ?? '',
        tenantPhone: extractFirstToken(rec.tenantPhone) ?? '',
        sqft: textToNumber(rec.sqft),
        leaseStart,
        leaseEnd,
        terminationDate: textToDateIso(rec.terminationDate),
        terminationReason: (rec.terminationReason ?? '').trim().toUpperCase(),
        monthlyRent: textToNumber(rec.monthlyRent),
        rentStartDate: textToDateIso(rec.rentStartDate),
        securityDeposit: textToNumber(rec.securityDeposit),
        rentPerSqft: textToNumber(rec.rentPsf),
        escalationPct: textToNumber(rec.escalationPct),
        nnnPerSqft: textToNumber(rec.nnnPsf),
        nnnTotalAmount: textToNumber(rec.nnnTotalAmount),
        tiAllowance: textToNumber(rec.tiAllowance),
        rentDueDay: textToNumber(rec.rentDueDay),
        brokerName: (rec.brokerName ?? '').trim(),
        combinedDealRef: (rec.combinedDealRef ?? '').trim(),
        notes: (rec.notes ?? '').trim(),
        commissionInstallments: commissionInstallments.length ? commissionInstallments : undefined,
        errors: [],
      };
    }).filter((r) => r.unitNumber || r.tenantName);

    const tenancies = await this.validateTenancyRows(raw, projectId, defaultBrokerId, rowBrokerOverrides);
    return {
      tenancies,
      orphaned: [],
      summary: {
        total: tenancies.length,
        ready: tenancies.filter((t) => t.status === 'ready').length,
        errors: tenancies.filter((t) => t.status === 'error').length,
      },
    };
  }

  // ─────── Commit (real writes) ───────

  /**
   * Each row is committed by calling the EXISTING backfillTenancy() — composition, not a
   * bypass, so an imported row inherits every guard, ledger generation, isHistorical
   * flagging and audit trail the manual form already has. A broken row is caught and
   * reported; it never blocks the rest of the batch, and nothing is written for it.
   */
  async commitImport(rows: ImportCommitRowInput[], userId?: string): Promise<ImportCommitResult> {
    const results: ImportCommitResult['results'] = [];
    for (const row of rows) {
      // terminationDate deliberately NOT required here — an omitted one is a tenancy
      // that's still going (R9.2), not a broken row; backfillTenancy() creates it ACTIVE.
      if (!row.unitId || !row.leaseStart || !row.leaseEnd || row.monthlyRent == null) {
        results.push({
          tenantName: row.tenantName,
          unitId: row.unitId ?? null,
          success: false,
          error: 'Row is missing required fields — it must be re-previewed before committing.',
        });
        continue;
      }
      try {
        const outcome = await this.leases.backfillTenancy(
          {
            unitId: row.unitId,
            tenantName: row.tenantName,
            tenantLegalName: row.tenantLegalName,
            tenantBrand: row.tenantBrand,
            landlordEntity: row.landlordEntity,
            tenantEmail: row.tenantEmail,
            tenantPhone: row.tenantPhone,
            leaseStart: row.leaseStart,
            leaseEnd: row.leaseEnd,
            terminationDate: row.terminationDate,
            terminationReason: row.terminationReason as any,
            monthlyRent: row.monthlyRent,
            rentStartDate: row.rentStartDate,
            securityDeposit: row.securityDeposit,
            rentPerSqft: row.rentPerSqft,
            escalationPct: row.escalationPct,
            nnnPerSqft: row.nnnPerSqft,
            nnnTotalAmount: row.nnnTotalAmount,
            tiAllowance: row.tiAllowance,
            rentDueDay: row.rentDueDay,
            notes: row.notes,
            combinedDealRef: row.combinedDealRef,
            brokerId: row.brokerId ?? undefined,
            commissionInstallments: row.commissionInstallments,
            collections: row.collections,
          },
          userId,
        );
        results.push({ tenantName: row.tenantName, unitId: row.unitId, success: true, leaseId: outcome.lease.id });
      } catch (e: any) {
        results.push({ tenantName: row.tenantName, unitId: row.unitId, success: false, error: e?.message ?? 'Unknown error' });
      }
    }
    return {
      imported: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }
}
