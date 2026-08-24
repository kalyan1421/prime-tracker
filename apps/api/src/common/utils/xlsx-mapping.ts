import ExcelJS from 'exceljs';
import { cellText } from './xlsx-import';

/**
 * Generic column-mapping support (R9 — see docs/client-discovery/HISTORICAL_DATA_SHEET_IMPORT_SPEC.md).
 *
 * Unlike xlsx-import.ts (which parses OUR fixed template by column key), this reads an
 * arbitrary client spreadsheet as a plain grid, guesses which of our known fields each
 * column probably is, and lets the caller turn a user-confirmed mapping into the same raw
 * row shape the template parser already produces — so validation never has to be written
 * twice.
 */

export interface FieldDef {
  key: string;
  label: string;
  synonyms: string[];
}

/** Known target fields for a Tenancy backfill row, in preferred display order. Synonyms
 * are drawn from the real client rent-roll sample seen during R9 discovery, not guessed.
 * Extended 2026-08-23 after auditing that sample against the field list: LLC/landlord,
 * email/phone, escalation, NNN and TI (both already real Lease/backfill fields, just not
 * previously exposed to import), lease-term-as-duration, and per-installment commission
 * amounts were all present in real client data with nowhere to map to. */
export const TENANCY_FIELD_DEFS: FieldDef[] = [
  { key: 'unitNumber', label: 'Unit Number', synonyms: ['unit no', 'unit num', 'unit #', 'suite', 'suite no', 'space'] },
  { key: 'building', label: 'Building', synonyms: ['bldg', 'property'] },
  { key: 'tenantName', label: 'Tenant Name', synonyms: ['tenant', 'lessee', 'occupant'] },
  { key: 'tenantLegalName', label: 'Tenant Legal Name', synonyms: ['legal name', 'legal entity', 'entity name'] },
  { key: 'tenantBrand', label: 'Tenant Brand', synonyms: ['tenant business', 'dba', 'trade name', 'storefront'] },
  { key: 'landlordEntity', label: 'Landlord / Owning Entity', synonyms: ['llc name', 'llc name landlord', 'landlord', 'owner llc', 'owning entity'] },
  { key: 'tenantEmail', label: 'Tenant Email', synonyms: ['email', 'email id', 'email address'] },
  { key: 'tenantPhone', label: 'Tenant Phone', synonyms: ['phone', 'contact no', 'contact number', 'phone number'] },
  // 'sf' deliberately excluded — as a bare synonym it substring-matches inside "psf",
  // "nnn(psf/total)" etc. and wrongly out-scores the real target (found auditing the
  // real client sample: "TI(PSF/Total)" was suggesting Sqft because of this).
  { key: 'sqft', label: 'Sqft', synonyms: ['sq ft', 'square feet', 'area'] },
  { key: 'leaseStart', label: 'Lease Start', synonyms: ['leased date', 'lease commencement', 'start date', 'commencement date'] },
  { key: 'leaseEnd', label: 'Lease End', synonyms: ['expiration date', 'expiry date', 'end date', 'lease expiration'] },
  { key: 'leaseTermMonths', label: 'Lease Term (duration, e.g. "10 years")', synonyms: ['lease term', 'term', 'lease duration'] },
  { key: 'terminationDate', label: 'Termination Date', synonyms: ['move out date', 'vacated date', 'actual end date', 'date vacated'] },
  { key: 'terminationReason', label: 'Termination Reason', synonyms: ['reason for leaving', 'exit reason'] },
  { key: 'monthlyRent', label: 'Monthly Rent', synonyms: ['rent', 'base rent', 'monthly rate', 'rent per month'] },
  { key: 'rentPsf', label: 'Rent PSF', synonyms: ['rent psf', 'psf', 'rate psf', 'rent per sqft', 'rent(psf/month)'] },
  { key: 'rentStartDate', label: 'Rent Start Date', synonyms: ['rent commencement date', 'rent commencement'] },
  { key: 'escalationPct', label: 'Annual Increase %', synonyms: ['annual increase', 'escalation', 'rent increase', 'escalation pct'] },
  { key: 'securityDeposit', label: 'Security Deposit', synonyms: ['deposit', 'sec deposit'] },
  { key: 'nnnTotalAmount', label: 'NNN Total', synonyms: ['nnn', 'nnn total', 'nnn amount'] },
  { key: 'nnnPsf', label: 'NNN PSF (informational)', synonyms: ['nnn psf', 'nnn rate'] },
  // Bare 'ti' deliberately excluded — it token-matched "TI Paid"/"TI Balance" too, which
  // are DISBURSEMENT figures, not the agreed total; auto-suggesting this field for those
  // would silently overwrite the agreed TI amount with what's been paid so far.
  { key: 'tiAllowance', label: 'TI Allowance — Agreed Total', synonyms: ['ti allowance', 'ti total', 'tenant improvement'] },
  { key: 'tiPsf', label: 'TI PSF (informational)', synonyms: ['ti psf', 'ti rate'] },
  { key: 'rentDueDay', label: 'Rent Due Day', synonyms: ['due day', 'payment day'] },
  { key: 'brokerName', label: 'Broker Name', synonyms: ['broker', 'agent'] },
  { key: 'commissionInstallment1', label: 'Commission Installment 1 Amount', synonyms: ['1st commission', '1st commission paid', 'commission 1', 'first commission'] },
  { key: 'commissionInstallment2', label: 'Commission Installment 2 Amount', synonyms: ['2nd commission', '2nd commission paid', 'commission 2', 'second commission'] },
  { key: 'commissionInstallment3', label: 'Commission Installment 3 Amount', synonyms: ['3rd commission', '3rd commission paid', 'commission 3', 'third commission'] },
  { key: 'combinedDealRef', label: 'Combined Deal Reference', synonyms: ['deal ref', 'combined units', 'deal group'] },
  { key: 'notes', label: 'Notes', synonyms: ['comments', 'remarks', 'renewals', 'renewal options'] },
];

export function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(s: string): string[] {
  return normalizeHeader(s).split(' ').filter(Boolean);
}

function scoreMatch(header: string, candidate: string): number {
  const h = normalizeHeader(header);
  const c = normalizeHeader(candidate);
  if (!h || !c) return 0;
  if (h === c) return 1;
  if (h.includes(c) || c.includes(h)) return 0.85;
  const hTokens = new Set(tokens(header));
  const cTokens = tokens(candidate);
  const overlap = cTokens.filter((t) => hTokens.has(t)).length;
  if (overlap === 0) return 0;
  return 0.5 * (overlap / Math.max(hTokens.size, cTokens.length));
}

/** Minimum confidence to auto-suggest a field for a column. Below this, the column is
 * offered to the user unmapped rather than guessed wrong. */
export const SUGGESTION_THRESHOLD = 0.4;

export function suggestField(header: string, fieldDefs: FieldDef[] = TENANCY_FIELD_DEFS): { field: string | null; confidence: number } {
  let best = { field: null as string | null, confidence: 0 };
  for (const def of fieldDefs) {
    for (const candidate of [def.label, ...def.synonyms]) {
      const score = scoreMatch(header, candidate);
      if (score > best.confidence) best = { field: def.key, confidence: score };
    }
  }
  return best.confidence >= SUGGESTION_THRESHOLD ? best : { field: null, confidence: best.confidence };
}

/** Reads the first worksheet of a workbook as a plain text grid — no assumption about
 * which row is a header or which columns mean what. Blank trailing rows/cols are kept
 * (callers slice what they need) so row/column indices stay stable. */
export function readRawGrid(wb: ExcelJS.Workbook): string[][] {
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const grid: string[][] = [];
  const colCount = sheet.columnCount;
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let c = 1; c <= colCount; c++) cells.push(cellText(row.getCell(c)));
    grid[rowNumber - 1] = cells;
  });
  return grid;
}

export type SheetOrientation = 'rows' | 'columns';

/**
 * Row-per-record: field names run across row 1, one record per subsequent row.
 * Transposed: field names run down column A, one record per subsequent column.
 * Decided by whichever axis' first line scores more recognizable field names — not a
 * guarantee, just the best signal available before the user is shown the sheet.
 */
export function detectOrientation(grid: string[][]): SheetOrientation {
  const firstRow = grid[0] ?? [];
  const firstCol = grid.map((r) => r[0] ?? '');
  const rowScore = firstRow.filter((h) => suggestField(h).field).length;
  const colScore = firstCol.filter((h) => suggestField(h).field).length;
  return colScore > rowScore ? 'columns' : 'rows';
}

const PSF_TOTAL_RE = /^\$?\s*([\d,]+(?:\.\d+)?)\s*\/\s*\$?\s*([\d,]+(?:\.\d+)?)\s*$/;

/** True when most non-blank sample values look like "$12.50/$3200" — a PSF rate and a
 * total jammed into one cell, seen in the client's real rent-roll sample. */
export function detectPsfTotalSplit(samples: string[]): boolean {
  const nonEmpty = samples.map((s) => s.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return false;
  const matches = nonEmpty.filter((v) => PSF_TOTAL_RE.test(v));
  return matches.length / nonEmpty.length >= 0.5;
}

export function splitPsfTotal(raw: string): { psf: number | null; total: number | null } {
  const m = PSF_TOTAL_RE.exec(raw.trim());
  if (!m) return { psf: null, total: null };
  return { psf: Number(m[1].replace(/,/g, '')), total: Number(m[2].replace(/,/g, '')) };
}

/** A "$X/$Y" cell means something different depending on what column it's in — rent,
 * NNN, and TI each have their own PSF+total pair. Header-driven, not sample-driven: the
 * real client sheet has all three shapes ("Rent(PSF/Month)", "NNN", "TI(PSF/Total)") and
 * they were all indistinguishable from the VALUES alone (e.g. "$13/$3304.16" for NNN
 * looks identical in shape to a rent figure). */
function splitTargetsForHeader(header: string): [string, string] {
  const h = normalizeHeader(header);
  if (/\bti\b/.test(h) || h.includes('tenant improvement')) return ['tiPsf', 'tiAllowance'];
  if (/\bnnn\b/.test(h)) return ['nnnPsf', 'nnnTotalAmount'];
  return ['rentPsf', 'monthlyRent'];
}

export interface FieldCandidate {
  index: number; // column index (0-based) for 'rows' orientation, row index (0-based) for 'columns'
  header: string;
  samples: string[];
  suggestedField: string | null;
  confidence: number;
  splitSuggestion?: { type: 'psf_total'; parts: [string, string] };
}

export interface AnalyzeResult {
  orientation: SheetOrientation;
  supported: boolean;
  recordCount: number;
  fields: FieldCandidate[];
}

const SAMPLE_COUNT = 5;

/** field.index means "column index" in 'rows' orientation and "row index" in 'columns'
 * (transposed) orientation — the axis that carries field NAMES, either way. */
export function analyzeGrid(grid: string[][]): AnalyzeResult {
  const orientation = detectOrientation(grid);
  return orientation === 'columns' ? analyzeTransposed(grid) : analyzeRowPerRecord(grid);
}

function analyzeRowPerRecord(grid: string[][]): AnalyzeResult {
  const header = grid[0] ?? [];
  const dataRows = grid.slice(1);
  const fields: FieldCandidate[] = header.map((h, colIndex) => {
    const samples = dataRows.slice(0, SAMPLE_COUNT).map((r) => r[colIndex] ?? '').filter(Boolean);
    const suggestion = suggestField(h);
    const field: FieldCandidate = {
      index: colIndex, header: h, samples, suggestedField: suggestion.field, confidence: suggestion.confidence,
    };
    if (detectPsfTotalSplit(samples)) field.splitSuggestion = { type: 'psf_total', parts: splitTargetsForHeader(h) };
    return field;
  });
  const recordCount = dataRows.filter((r) => r.some((c) => c.trim())).length;
  return { orientation: 'rows', supported: true, recordCount, fields };
}

/** Transposed sheets (field labels down column A, one record per subsequent column) — the
 * shape of the client's real rent-roll sample. Every row with a non-blank label cell
 * becomes a field candidate, whether or not it fuzzy-matches one of our known fields —
 * an unrecognized label (e.g. a title/grouping row) just gets offered to the user unmapped
 * rather than dropped silently. */
function analyzeTransposed(grid: string[][]): AnalyzeResult {
  const maxCols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const fields: FieldCandidate[] = [];
  grid.forEach((row, rowIndex) => {
    const header = (row[0] ?? '').trim();
    if (!header) return;
    const samples = row.slice(1, 1 + SAMPLE_COUNT).filter((v) => v?.trim());
    const suggestion = suggestField(header);
    const field: FieldCandidate = {
      index: rowIndex, header, samples, suggestedField: suggestion.field, confidence: suggestion.confidence,
    };
    if (detectPsfTotalSplit(samples)) field.splitSuggestion = { type: 'psf_total', parts: splitTargetsForHeader(header) };
    fields.push(field);
  });
  let recordCount = 0;
  for (let c = 1; c < maxCols; c++) {
    if (grid.some((r) => (r[c] ?? '').trim())) recordCount++;
  }
  return { orientation: 'columns', supported: true, recordCount, fields };
}

export interface MappedColumn {
  columnIndex: number;
  field: string;
  splitPart?: 'psf' | 'total';
}

export interface ConfirmedMapping {
  orientation: SheetOrientation;
  columns: MappedColumn[]; // .columnIndex means column index ('rows') or row index ('columns')
}

/** Plain-text equivalents of cellDateIso/cellNumber (xlsx-import.ts) — the mapped-record
 * pipeline works off already-extracted strings, not live ExcelJS cells. */
export function textToDateIso(s: string | undefined): string | undefined {
  if (!s) return undefined;
  // Free-text client dates carry ordinal suffixes ("29th", "2nd ,2025.") that native Date
  // parsing rejects outright (seen throughout the real client sample) — our own template
  // never produces these, so cellDateIso never needed this, but a generic mapper reading
  // someone else's spreadsheet has to.
  const cleaned = s.trim()
    .replace(/(\d+)(st|nd|rd|th)\b/gi, '$1')
    .replace(/\s+,/g, ',')
    .replace(/\.$/, '');
  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) return undefined;
  // new Date(text) parses a bare date string in the SERVER's local timezone, so
  // .toISOString() alone shifts the calendar date backward a day in any zone ahead of
  // UTC (reproduced on this machine, IST). Re-anchor the same Y/M/D at UTC midnight
  // instead of converting the parsed moment across timezones.
  return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())).toISOString().slice(0, 10);
}

export function textToNumber(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s.replace(/[$,]/g, ''));
  return Number.isNaN(n) ? undefined : n;
}

/** Parses a free-text lease duration ("10years", "5 YEARS", "18 months") into a month
 * count. The real client sheet gives lease length this way instead of an end date. */
export function parseDurationMonths(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = /^(\d+(?:\.\d+)?)\s*(year|yr|y|month|mo|m)s?\.?$/i.exec(text.trim().replace(/\s+/g, ' '));
  if (!m) return undefined;
  const n = Number(m[1]);
  if (Number.isNaN(n)) return undefined;
  return Math.round(n * (m[2].toLowerCase().startsWith('y') ? 12 : 1));
}

/** Adds a month count to an ISO date (YYYY-MM-DD), staying in UTC calendar terms. */
export function addMonthsIso(dateIso: string, months: number): string | undefined {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** A cell like "a@x.com\nb@y.com" is several tenant contacts jammed into one — take the
 * first, since the target field holds one value. Real pattern from the client sample. */
export function extractFirstEmail(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/[^\s,;]+@[^\s,;]+\.[^\s,;]+/);
  return m ? m[0] : undefined;
}

/** Same idea for a multi-value phone cell ("(614)-886-0786\n972-816-3136"). */
export function extractFirstToken(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const first = raw.split(/[\n,;]/)[0]?.trim();
  return first || undefined;
}

function extractField(raw: string, col: MappedColumn, record: Record<string, string>) {
  if (!raw) return;
  // First mapped column wins for a given target field, for a split OR a plain column —
  // a mapping that (by whatever cause, e.g. a client bug) names the same target field
  // twice must not let the second one silently overwrite the first with unrelated data.
  if (col.field in record) return;
  if (col.splitPart) {
    const { psf, total } = splitPsfTotal(raw);
    const value = col.splitPart === 'psf' ? psf : total;
    if (value != null) record[col.field] = String(value);
  } else {
    record[col.field] = raw;
  }
}

/** Turns a raw grid + a user-confirmed mapping into the same field-keyed record shape the
 * template parser produces, so downstream validation is shared code, not a second copy of
 * it — for EITHER orientation the mapping was confirmed against. */
export function applyMapping(grid: string[][], mapping: ConfirmedMapping): Record<string, string>[] {
  if (mapping.orientation === 'columns') {
    const maxCols = grid.reduce((m, r) => Math.max(m, r.length), 0);
    const records: Record<string, string>[] = [];
    for (let c = 1; c < maxCols; c++) {
      const record: Record<string, string> = {};
      for (const col of mapping.columns) {
        extractField((grid[col.columnIndex]?.[c] ?? '').trim(), col, record);
      }
      if (Object.keys(record).length > 0) records.push(record);
    }
    return records;
  }

  const dataRows = grid.slice(1);
  return dataRows
    .filter((r) => r.some((c) => c.trim()))
    .map((row) => {
      const record: Record<string, string> = {};
      for (const col of mapping.columns) {
        extractField((row[col.columnIndex] ?? '').trim(), col, record);
      }
      return record;
    });
}
