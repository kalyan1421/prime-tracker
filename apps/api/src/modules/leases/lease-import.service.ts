import { Injectable, BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { LeasesService, TERMINATION_REASONS } from './leases.service';
import {
  addColumnarSheet, assertHeaderMatches, cellText, cellDateIso, cellNumber, resolveUnit, resolveBroker, joinKey,
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
 * Header of the OPTIONAL project column. The template does not ship one — an import is
 * always launched from inside a project, so naming the project again is redundant. But
 * client-built workbooks routinely add one anyway (the 2026-08-25 "Lease History.xlsx"
 * carries every project's tenancies on a single tab), and without reading it a row from
 * another project silently resolves against a same-numbered unit here and imports into
 * the WRONG project. Matched by header text, not position, since it's an extra column
 * bolted onto the end of the template's fixed layout.
 */
const PROJECT_HEADER = 'project';

/** Money is only ever split/compared here at 2dp, the precision it is stored and billed at. */
const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtMoney = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Compares a sheet's project label to a real project name loosely enough to survive the
 * gap between what a spreadsheet calls a project and what the app does — "RRC" vs
 * "RRC Bldg 1-8", "RRC Phase II" vs "RRC Phase 2 Bldg 9-12". Case, punctuation, spacing
 * and roman numerals are all normalised away, then either string containing the other
 * counts as a match.
 */
function normalizeProjectName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bphase\s+iii\b/g, 'phase 3')
    .replace(/\bphase\s+ii\b/g, 'phase 2')
    .replace(/\bphase\s+i\b/g, 'phase 1')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Which of the sheet's project labels refers to the project being imported into.
 *
 * The import is always launched from one project's Revenue tab, so that project — never
 * a question put back to the user — decides where the rows land. This only exists to
 * keep OTHER projects' rows out of it: unit numbers repeat across projects ("101",
 * "701" and "1001" each exist in more than one), so without this a foreign row resolves
 * against a same-numbered unit here and imports into the wrong project looking perfectly
 * valid.
 *
 * The LONGEST match wins, which is what separates the two RRC projects: importing into
 * "RRC Phase 2 Bldg 9-12", both "RRC" and "RRC Phase II" match, and the more specific
 * one is the right answer. Returns null when nothing matches, in which case the caller
 * imports everything and warns rather than blocking — a naming mismatch we can't read is
 * not a reason to refuse a file.
 */
/** How convincingly one label names one project. Higher wins; 0 means no match at all. */
function labelMatchTier(label: string, projectName: string): number {
  const l = normalizeProjectName(label);
  const p = normalizeProjectName(projectName);
  if (!l || !p) return 0;
  if (l === p) return 3;        // exact
  if (p.includes(l)) return 2;  // sheet abbreviates the app's longer name — the usual case
  if (l.includes(p)) return 1;  // sheet is MORE specific than the app
  return 0;
}

/** The label that best names this project, with how convincingly. */
function bestLabelFor(labels: string[], projectName: string): { label: string; tier: number } | null {
  let best: { label: string; tier: number } | null = null;
  for (const label of labels) {
    const tier = labelMatchTier(label, projectName);
    if (tier === 0) continue;
    // Within a tier the longest label wins — that is what separates "RRC Phase II" from
    // the bare "RRC" for a project called "RRC Phase 2 Bldg 9-12".
    const better = !best || tier > best.tier
      || (tier === best.tier && normalizeProjectName(label).length > normalizeProjectName(best.label).length);
    if (better) best = { label, tier };
  }
  if (best?.tier === 1) {
    // Tier 1 is the direction that invents matches: a short project name is a prefix of
    // any number of longer labels. Accept it only when exactly one label qualifies.
    const tier1 = labels.filter((l) => labelMatchTier(l, projectName) === 1);
    if (tier1.length !== 1) return null;
  }
  return best;
}

/**
 * Which of the sheet's project labels refers to the project being imported into.
 *
 * The import is always launched from one project's Revenue tab, so that project — never
 * a question put back to the user — decides where the rows land. This only exists to
 * keep OTHER projects' rows out of it: unit numbers repeat across projects ("101",
 * "701" and "1001" each exist in more than one), so without this a foreign row resolves
 * against a same-numbered unit here and imports into the wrong project looking perfectly
 * valid.
 *
 * `otherProjectNames` is what stops a confident wrong answer. Containment alone is blind
 * to the qualifier that distinguishes two projects: importing into "Centro Plaza II",
 * "centroplaza2" contains "centroplaza", so the phase-I rows were claimed and the banner
 * then stated the filter had worked. A label that another project names MORE convincingly
 * (here, exactly) belongs to that project, so this returns null and the caller warns
 * instead of filtering — the same thing it does when nothing matches at all.
 */
export function matchProjectLabel(
  labels: string[],
  projectName: string,
  otherProjectNames: string[] = [],
): string | null {
  const best = bestLabelFor(labels, projectName);
  if (!best) return null;
  for (const other of otherProjectNames) {
    const rival = bestLabelFor(labels, other);
    // Only a rival whose OWN best label is this one contests it. A project that merely
    // happens to contain "RRC" while its own best label is "RRC Phase II" is not a claim.
    if (rival && rival.label === best.label && rival.tier > best.tier) return null;
  }
  return best.label;
}

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
  /** 'duplicate' is its own outcome, not an error: the tenancy is already in the system
   * from an earlier run of this same import. Re-uploading a file is normal (fix three
   * rows, upload again), so the rows that already landed must read as "nothing to do"
   * rather than joining the pile of things to go and fix. Neither ready nor duplicate
   * rows are ever committed twice — only 'ready' is sent. */
  status: 'ready' | 'error' | 'duplicate';
  errors: string[];
  unitNumber: string;
  /** Raw Building label from the sheet, not resolved — surfaced for exactly the reason
   * SalePreviewRow.building is: a row whose unit doesn't exist yet can then offer
   * creating the BUILDING as well as the unit, pre-filled with what the sheet already
   * said, instead of dead-ending on "that building doesn't exist here either". */
  building: string;
  tenantName: string;
  /** This row's raw value from the optional Project column ('' when there is none).
   * Shown per-row in the preview whenever the sheet has one, so that when NO label could
   * be matched to this project (matchedProjectLabel === null, nothing filtered) a
   * foreign row is still obvious to the eye before anyone presses Import. */
  sheetProject: string;
  /** The sheet's own Project label when this row was left out for belonging to a
   * DIFFERENT project than the one being imported into; null otherwise. Lets the UI
   * separate "this needs fixing" from "this simply isn't ours" without re-deriving it
   * from error text. */
  otherProject: string | null;
  rentAutoSplit: boolean;
  /** How a split row's share was worked out. 'sqft' is proportional (the real answer);
   * 'even' means the sheet gave no usable per-unit sqft and the deal total was divided
   * equally — a stated assumption, not a fact, so the preview labels it differently.
   * null when this row carried its own rent. */
  rentSplitBasis: 'sqft' | 'even' | null;
  /** Things worth seeing that do not stop the row importing. Kept apart from `errors`
   * so that a row which is fine still reads as fine. */
  warnings: string[];
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
  /** `errors` counts only rows THIS project can act on. A row carried for another
   * project is counted in `skippedOtherProject` instead — it is not a defect to fix,
   * and listing 36 of them as errors buries the handful that are. */
  summary: { total: number; ready: number; errors: number; duplicates: number; skippedOtherProject: number };
  /** Distinct values found in an OPTIONAL "Project" column on the Tenancies sheet (see
   * PROJECT_HEADER). Empty when the sheet has no such column — the template deliberately
   * has none, because an import is always scoped to the project you launched it from. */
  projectLabels: string[];
  /** Which of those labels was matched to this project, so rows carrying the others
   * could be left out. Null when the sheet named projects but none looked like this
   * one — everything is then imported, and the UI warns instead of blocking. */
  matchedProjectLabel: string | null;
}

/**
 * Values typed into the PREVIEW to fix one row, keyed by its sheet row number.
 *
 * The client's source files genuinely do not contain some of what a tenancy needs — the
 * 2026-08-25 workbook is missing Lease End on 11 rows, a rent figure on 5, and writes
 * prose into Termination Reason on 7. Sending people back to Excel to patch a sheet they
 * assembled from records that never had the value is a dead end, so the missing piece is
 * supplied here instead.
 *
 * An override is treated as if the SHEET had said it: it is merged into the raw row
 * before any validation runs, so a hand-entered value goes through exactly the same
 * checks (term bounds, overlap, combined-deal split) as a parsed one. Nothing is
 * committed straight from an override.
 */
export interface RowOverride {
  brokerId?: string;
  /** Which unit this row is about. Correctable here because the sheet's own reference can
   * simply be wrong — a stale unit number, or a Building label ("Centro Plaza - Building
   * 2") that never matched the building's real name — and neither is a reason to create
   * new inventory. The corrected value is resolved by resolveUnit exactly as a parsed one
   * is; the "create the missing unit/building" flow is untouched and still the answer when
   * the unit genuinely doesn't exist. */
  unitNumber?: string;
  /** Unlike every other field here, an explicit `null` CLEARS the building rather than
   * meaning "not supplied": dropping a wrong label so the row matches on unit number
   * alone is a real fix, and the commonest one when a sheet prefixes the project name. */
  building?: string | null;
  tenantName?: string;
  leaseStart?: string;
  leaseEnd?: string;
  terminationDate?: string;
  terminationReason?: string;
  monthlyRent?: number;
  rentStartDate?: string;
  securityDeposit?: number;
  rentDueDay?: number;
}

/** Merges preview-entered values into the parsed rows, in place. */
function applyRowOverrides(raw: RawTenancy[], overrides?: Record<number, RowOverride>) {
  if (!overrides) return;
  for (const r of raw) {
    const o = overrides[r.rowNumber];
    if (!o) continue;
    // Only fields actually supplied are touched — an absent key must never blank a value
    // the sheet did provide, and '' is treated as "not supplied" for the same reason.
    // Typed rather than trusted: the preview endpoints hand this map through as parsed
    // JSON, so a malformed client payload must not reach .trim() (or overwrite a good
    // sheet value with an object).
    if (typeof o.unitNumber === 'string' && o.unitNumber.trim()) r.unitNumber = o.unitNumber.trim();
    if (o.building !== undefined) r.building = typeof o.building === 'string' ? o.building.trim() : '';
    if (typeof o.tenantName === 'string' && o.tenantName.trim()) r.tenantName = o.tenantName.trim();
    if (o.leaseStart) r.leaseStart = o.leaseStart;
    if (o.leaseEnd) r.leaseEnd = o.leaseEnd;
    if (o.terminationDate) r.terminationDate = o.terminationDate;
    if (o.terminationReason) r.terminationReason = o.terminationReason.trim().toUpperCase();
    if (o.monthlyRent != null) r.monthlyRent = o.monthlyRent;
    if (o.rentStartDate) r.rentStartDate = o.rentStartDate;
    if (o.securityDeposit != null) r.securityDeposit = o.securityDeposit;
    if (o.rentDueDay != null) r.rentDueDay = o.rentDueDay;
  }
}

/** The broker id chosen per row, from either the dedicated map or a full RowOverride. */
function brokerOverridesFrom(
  rowBrokerOverrides?: Record<number, string>,
  rowOverrides?: Record<number, RowOverride>,
): Record<number, string> {
  const merged: Record<number, string> = { ...(rowBrokerOverrides ?? {}) };
  for (const [rowNumber, o] of Object.entries(rowOverrides ?? {})) {
    if (o.brokerId) merged[Number(rowNumber)] = o.brokerId;
  }
  return merged;
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
  /** The row's own value from the optional "Project" column, '' when the sheet has none.
   * Never used to LOOK UP a project — only to reject a row that names a different one. */
  sheetProject: string;
  /** Set to sheetProject when this row was excluded as another project's. */
  otherProject?: string | null;
  /** Only ever set by the generic-mapping path (R9) — the template path attaches these
   * later, from the Commission Installments sheet, after validateTenancyRows returns. */
  commissionInstallments?: { amount: number; paidAt?: string }[];
  errors: string[];
  warnings: string[];
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

  async previewImport(
    fileBuffer: Buffer,
    projectId: string,
    /** Preview-entered fixes. Same three levers the generic-mapping path already had —
     * they were unreachable from the template path, which is where the client's own
     * workbook lands, so a template row with a commission and no broker had no way out. */
    opts: {
      defaultBrokerId?: string;
      rowBrokerOverrides?: Record<number, string>;
      rowOverrides?: Record<number, RowOverride>;
    } = {},
  ): Promise<ImportPreview> {
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

    assertHeaderMatches(tenancySheet, SHEET_TENANCIES, TENANCY_COLUMNS);

    // ---- Pass 1: read raw rows off the Tenancies sheet ----
    // Find the optional Project column by header text (see PROJECT_HEADER). Only columns
    // beyond the template's own layout are considered, so a sheet that happens to label
    // something else "Project" inside the fixed range can't hijack a real column.
    const headerRow = tenancySheet.getRow(1);
    let projectCol = 0;
    for (let c = TENANCY_COLUMNS.length + 1; c <= tenancySheet.columnCount; c++) {
      if (cellText(headerRow.getCell(c)).trim().toLowerCase() === PROJECT_HEADER) { projectCol = c; break; }
    }

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
        sheetProject: projectCol ? cellText(row.getCell(projectCol)).trim() : '',
        errors: [],
        warnings: [],
      });
    });

    const projectLabels = [...new Set(raw.map((r) => r.sheetProject).filter(Boolean))];

    // The project is whichever one this import was launched from — never asked for
    // again. The sheet's own label is read only to keep other projects' rows out; see
    // matchProjectLabel for why that matters and why a no-match warns instead of blocks.
    let matchedProjectLabel: string | null = null;
    if (projectLabels.length > 1) {
      // Every project, not just this one: a label another project names more convincingly
      // is that project's, and claiming it here would filter silently and wrongly.
      const allProjects = await this.prisma.project.findMany({
        where: { deletedAt: null }, select: { id: true, name: true },
      });
      const project = allProjects.find((p) => p.id === projectId) ?? null;
      matchedProjectLabel = project
        ? matchProjectLabel(
            projectLabels,
            project.name,
            allProjects.filter((p) => p.id !== projectId).map((p) => p.name),
          )
        : null;
      if (matchedProjectLabel) {
        for (const r of raw) {
          if (r.sheetProject && r.sheetProject !== matchedProjectLabel) {
            r.otherProject = r.sheetProject;
            r.errors.push(
              `This row is for project "${r.sheetProject}" — this import is adding to "${project!.name}". ` +
              'Upload the file from that project\'s Revenue tab to bring these in.',
            );
          }
        }
      }
    }

    applyRowOverrides(raw, opts.rowOverrides);
    const tenancies = await this.validateTenancyRows(
      raw,
      projectId,
      opts.defaultBrokerId,
      brokerOverridesFrom(opts.rowBrokerOverrides, opts.rowOverrides),
    );

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
      assertHeaderMatches(ledgerSheet, SHEET_LEDGER_EXCEPTIONS, LEDGER_EXCEPTION_COLUMNS);
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

    // Only hit the DB when a fallback was actually offered — the common case supplies none.
    const brokerFallback = await this.resolveBrokerFallback(
      opts.defaultBrokerId,
      brokerOverridesFrom(opts.rowBrokerOverrides, opts.rowOverrides),
    );

    const commissionSheet = wb.getWorksheet(SHEET_COMMISSIONS);
    if (commissionSheet) {
      assertHeaderMatches(commissionSheet, SHEET_COMMISSIONS, COMMISSION_COLUMNS);
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
          // The default/per-row broker can only be applied HERE on this path. Rows do not
          // carry their commission installments until this join runs, and
          // validateTenancyRows deliberately only falls back for a row that already has
          // commission to attribute — so at validation time this row looked like an
          // ordinary broker-less tenancy and was left alone. That is why the fix existed
          // on the generic path but was unreachable from the template one.
          const fallback = brokerFallback.byRow[target.rowNumber] ?? brokerFallback.defaultId;
          if (!fallback) {
            target.errors.push(`Commission installment given (row ${rowNumber}) but no Broker Name was set on this tenancy.`);
            target.status = 'error';
            return;
          }
          target.data.brokerId = fallback;
        }
        target.data.commissionInstallments = [...(target.data.commissionInstallments ?? []), { amount, paidAt }];
      });
    }

    return {
      tenancies,
      orphaned,
      projectLabels,
      matchedProjectLabel,
      summary: {
        total: tenancies.length,
        ready: tenancies.filter((t) => t.status === 'ready').length,
        errors: tenancies.filter((t) => t.status === 'error' && !t.otherProject).length,
        duplicates: tenancies.filter((t) => t.status === 'duplicate').length,
        skippedOtherProject: tenancies.filter((t) => t.otherProject).length,
      },
    };
  }

  /**
   * Keeps only the broker ids that name a real, non-deleted broker. Nothing arriving as a
   * bare id from a request is trusted — the same rule validateTenancyRows applies to its
   * own defaultBrokerId.
   */
  private async resolveBrokerFallback(
    defaultBrokerId?: string,
    rowBrokerOverrides: Record<number, string> = {},
  ): Promise<{ defaultId?: string; byRow: Record<number, string> }> {
    const wanted = [...new Set([defaultBrokerId, ...Object.values(rowBrokerOverrides)].filter(Boolean) as string[])];
    if (wanted.length === 0) return { byRow: {} };
    const real = new Set(
      (await this.prisma.broker.findMany({ where: { id: { in: wanted }, deletedAt: null }, select: { id: true } }))
        .map((b) => b.id),
    );
    const byRow: Record<number, string> = {};
    for (const [rowNumber, id] of Object.entries(rowBrokerOverrides)) {
      if (real.has(id)) byRow[Number(rowNumber)] = id;
    }
    return { defaultId: defaultBrokerId && real.has(defaultBrokerId) ? defaultBrokerId : undefined, byRow };
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
    const splitBasisByRow = new Map<RawTenancy, 'sqft' | 'even'>();
    for (const [ref, rows] of groups) {
      // A deal belonging to another project is not this import's to split or complain
      // about — its rows are already labelled as somebody else's and are never written.
      if (rows.every((r) => r.otherProject)) continue;
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

      // Two rows of the same deal naming two different tenants means the reference is
      // being reused (a typo, or copy-paste from another deal) — splitting one tenant's
      // rent across another's units would be silent nonsense, so it is refused outright.
      const tenants = [...new Set(rows.map((r) => r.tenantName.trim().toLowerCase()).filter(Boolean))];
      if (tenants.length > 1) {
        for (const r of rows) {
          r.errors.push(
            `Combined Deal "${ref}" is shared by more than one tenant ` +
            `(${[...new Set(rows.map((r2) => r2.tenantName).filter(Boolean))].join(', ')}). ` +
            'A Combined Deal Reference links the units of ONE lease — give the other tenant its own reference.',
          );
        }
        continue;
      }

      // Proportional by sqft is the real answer, and needs a usable figure on EVERY row:
      // one row's sqft alone would hand it the entire total and leave the others at zero.
      // Failing that, divide the deal equally — the client's own sheets record combined
      // figures only ("no per-unit split in source"), and refusing the row outright just
      // meant the tenancy could not be entered at all. The assumption is labelled in the
      // preview rather than hidden.
      const totalSqft = rows.reduce((sum, r) => sum + (r.sqft ?? 0), 0);
      const bySqft = rows.every((r) => r.sqft != null && r.sqft > 0) && totalSqft > 0;
      if (!bySqft) {
        for (const r of rows) {
          r.warnings.push(
            `Combined Deal "${ref}": no per-unit Sqft in the sheet, so the ${fmtMoney(total)} deal rent ` +
            `was divided equally across ${rows.length} units. Enter each unit's Sqft to split it properly.`,
          );
        }
      }
      // The single figure entered on one row is the GROUP's total, so EVERY row in the
      // group takes its share of it — including the row that carried it. Splitting only
      // the blank rows left that row holding the whole total on top of the shares given
      // to the others, so the group billed more than the deal was worth: RRC-B7-700-701
      // went in as 8,641.66 + 4,456.83 = 13,098.49/mo against a real base rent of
      // 8,641.66. Confirmed against live data 2026-08-25.
      let allocated = 0;
      // Largest unit last, so the rounding remainder lands on the row where a cent
      // matters least in percentage terms — and the group sums to the total exactly.
      const ordered = bySqft ? [...rows].sort((a, b) => (a.sqft ?? 0) - (b.sqft ?? 0)) : [...rows];
      ordered.forEach((r, i) => {
        const share = i === ordered.length - 1
          ? round2(total - allocated)
          : round2(bySqft ? total * (r.sqft! / totalSqft) : total / ordered.length);
        allocated = round2(allocated + share);
        r.monthlyRent = share;
        splitBasisByRow.set(r, bySqft ? 'sqft' : 'even');
      });
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
    // Leases ALREADY on this project's units. Without these the preview only ever
    // compared rows against each other, so a re-upload showed a wall of green "ready"
    // and then failed row-by-row at commit against the DB's lease_unit_no_overlap
    // constraint — the check has to happen where the user can still act on it.
    const existingLeases = await this.prisma.lease.findMany({
      where: { deletedAt: null, unitId: { not: null }, unit: { deletedAt: null, building: { projectId, deletedAt: null } } },
      select: {
        unitId: true, tenantName: true, tenantBrand: true, status: true, monthlyRent: true,
        leaseStart: true, leaseEnd: true, terminationDate: true,
      },
    });
    const existingByUnit = new Map<string, typeof existingLeases>();
    for (const l of existingLeases) {
      if (!l.unitId) continue;
      const list = existingByUnit.get(l.unitId) ?? [];
      list.push(l);
      existingByUnit.set(l.unitId, list);
    }
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
      const warnings = [...r.warnings];

      // A row this file carries for ANOTHER project is not this import's to validate. It
      // already says so, it will never be written, and checking it can only do harm:
      // unit numbers repeat across projects — 10 of the 58 rows in the 2026-08-25
      // workbook resolve against a same-numbered unit in whichever project you happen to
      // be importing into — so registering its occupancy made three legitimate Centro
      // Plaza rows fail with "Overlaps another row for the same unit (row 5)", naming a
      // row belonging to RRC. Everything below is skipped for these.
      const foreign = !!r.otherProject;

      if (!foreign) {
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
      }

      const unitResolved = foreign ? { unitId: null as string | null, error: undefined } : resolveUnit(units, r.unitNumber, r.building);
      if (unitResolved.error) errors.push(unitResolved.error);
      const unitId = unitResolved.unitId;

      const brokerResolved = foreign ? { brokerId: null as string | null, error: undefined } : resolveBroker(brokers, r.brokerName);
      // A row's OWN broker name failing to resolve is fixable by naming the broker in the
      // preview: that is the user correcting an unresolvable string, not a default
      // quietly displacing a real choice. Only then is the error dropped. The client's
      // "Joyce Poe, Linc Realty" spans six rows and matches no broker record — without
      // this there is no way to enter it short of creating a broker by that exact name.
      const rowOverrideForUnresolved = brokerResolved.error
        ? (rowBrokerOverrides?.[r.rowNumber] && brokers.some((b) => b.id === rowBrokerOverrides[r.rowNumber])
            ? rowBrokerOverrides[r.rowNumber]
            : undefined)
        : undefined;
      if (brokerResolved.error && !rowOverrideForUnresolved) errors.push(brokerResolved.error);
      // Priority for a row that named no broker of its own: this row's specific fix
      // (rowBrokerOverrides) first, then the sheet-wide default — neither ever overrides
      // a row's own (resolved or unresolved-with-error) Broker Name.
      const rowOverrideId = rowBrokerOverrides?.[r.rowNumber];
      const resolvedRowOverrideId = rowOverrideId && brokers.some((b) => b.id === rowOverrideId) ? rowOverrideId : undefined;
      const brokerId = brokerResolved.brokerId
        ?? rowOverrideForUnresolved
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

      // A tenancy this row duplicates rather than conflicts with — reported separately.
      let duplicateOfExisting = false;

      if (unitId && leaseStart && effectiveEnd) {
        // '[)' — inclusive start, exclusive end, matching lease_unit_no_overlap exactly
        // (migration 20260813000000). Same-day turnover is legal: a lease ending on the
        // 30th and one starting on the 30th do not collide, and must not be flagged as
        // if they did.
        const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && bStart < aEnd;

        const existing = rangesByUnit.get(unitId) ?? [];
        const inFile = existing.find((e) => overlaps(leaseStart!, effectiveEnd!, e.start, e.end));
        if (inFile) errors.push(`Overlaps another row for the same unit (row ${inFile.rowNumber}) in this file.`);
        existing.push({ rowNumber: r.rowNumber, start: leaseStart, end: effectiveEnd });
        rangesByUnit.set(unitId, existing);

        for (const ex of existingByUnit.get(unitId) ?? []) {
          const exEnd = ex.terminationDate ?? ex.leaseEnd;
          if (!overlaps(leaseStart, effectiveEnd, ex.leaseStart, exEnd)) continue;

          const day = (d: Date) => d.toISOString().slice(0, 10);
          // Same unit, same start date, same party = this exact tenancy is already in,
          // which is what a second run of the same file looks like. The party is matched
          // on tenantName OR tenantBrand because the two diverge in real data (unit 203
          // is "JB Sree Ventures" trading as "Brickerz Club") and either one identifies
          // it — matching on only one reads a repeat as a conflict with a stranger.
          const same = (a: string | null | undefined, b: string | null | undefined) =>
            !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
          const sameParty = same(ex.tenantName, r.tenantName) || same(ex.tenantBrand, r.tenantName)
            || same(ex.tenantName, r.tenantBrand) || same(ex.tenantBrand, r.tenantBrand);

          if (sameParty && day(ex.leaseStart) === day(leaseStart)) {
            duplicateOfExisting = true;
            // Skipping a duplicate is normally the end of it. Not when the lease already
            // in the system holds a DIFFERENT rent to what this deal now splits to: the
            // row is skipped, the stored figure stays wrong, and the group keeps billing
            // the difference every month. Live example: unit 1101 sat at 7,557.33 (the
            // whole deal) while its share is 4,314.66.
            if (r.monthlyRent != null && round2(Number(ex.monthlyRent)) !== round2(r.monthlyRent)) {
              warnings.push(
                `Already imported at ${fmtMoney(Number(ex.monthlyRent))}/mo, but this file splits it to ` +
                `${fmtMoney(r.monthlyRent)}/mo. The existing lease is NOT updated by an import — correct its ` +
                'rent by hand, or this unit keeps billing the difference.',
              );
            }
            break;
          }
          // A genuine clash. Name BOTH the legal name and the trading name when they
          // differ — the commit-time error shows only the brand, which is why a repeat
          // of "Sri Vanguard Imports America II" came back as a conflict with "Vivek
          // Flowers" and read like a different tenant entirely.
          const who = ex.tenantBrand && !same(ex.tenantBrand, ex.tenantName)
            ? `${ex.tenantName} (trading as ${ex.tenantBrand})`
            : ex.tenantName;
          errors.push(
            `Overlaps a lease already on this unit: ${who}, ${day(ex.leaseStart)} to ${day(exEnd)}` +
            `${ex.status ? `, ${String(ex.status).toLowerCase()}` : ''}. ` +
            'A lease may start on the day another ends.',
          );
          break;
        }
      }

      return {
        rowNumber: r.rowNumber,
        // A duplicate only counts as such when nothing ELSE is wrong with the row —
        // otherwise a row with real problems would be quietly filed as "already done".
        status: errors.length ? 'error' : (duplicateOfExisting ? 'duplicate' : 'ready'),
        errors,
        unitNumber: r.unitNumber,
        building: r.building,
        tenantName: r.tenantName,
        sheetProject: r.sheetProject,
        otherProject: r.otherProject ?? null,
        rentAutoSplit: splitBasisByRow.has(r),
        rentSplitBasis: splitBasisByRow.get(r) ?? null,
        warnings,
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
    rowOverrides?: Record<number, RowOverride>,
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
        // The generic mapper has no Project target field — a mapped sheet is always read
        // as belonging wholly to the project the import was launched from.
        sheetProject: '',
        commissionInstallments: commissionInstallments.length ? commissionInstallments : undefined,
        errors: [],
        warnings: [],
      };
    }).filter((r) => r.unitNumber || r.tenantName);

    applyRowOverrides(raw, rowOverrides);
    const tenancies = await this.validateTenancyRows(
      raw, projectId, defaultBrokerId, brokerOverridesFrom(rowBrokerOverrides, rowOverrides),
    );
    return {
      tenancies,
      orphaned: [],
      projectLabels: [],
      matchedProjectLabel: null,
      summary: {
        total: tenancies.length,
        ready: tenancies.filter((t) => t.status === 'ready').length,
        errors: tenancies.filter((t) => t.status === 'error' && !t.otherProject).length,
        duplicates: tenancies.filter((t) => t.status === 'duplicate').length,
        skippedOtherProject: tenancies.filter((t) => t.otherProject).length,
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
