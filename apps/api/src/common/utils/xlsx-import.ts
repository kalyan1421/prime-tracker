import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';

/**
 * Shared plumbing for the two bulk-import flows (R1 rent history, R5 sale history — see
 * docs/client-discovery/HISTORICAL_DATA_SHEET_IMPORT_SPEC.md). Both parse a multi-tab
 * .xlsx built from a downloadable template, so the cell-reading and template-building
 * primitives live here once rather than twice.
 */

export function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell || cell.value == null) return '';
  const v = cell.value as any;
  if (typeof v === 'object' && v.richText) return v.richText.map((r: any) => r.text).join('');
  if (typeof v === 'object' && v.text) return String(v.text);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

export function cellDateIso(cell: ExcelJS.Cell | undefined): string | undefined {
  if (!cell || cell.value == null || cell.value === '') return undefined;
  const v = cell.value as any;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const text = cellText(cell);
  if (!text) return undefined;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return undefined;
  // Same fix as textToDateIso (xlsx-mapping.ts): a bare text date parses in the SERVER's
  // local timezone, so .toISOString() alone shifts the calendar date backward a day in
  // any zone ahead of UTC — re-anchor the parsed Y/M/D at UTC midnight instead.
  return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())).toISOString().slice(0, 10);
}

export function cellNumber(cell: ExcelJS.Cell | undefined): number | undefined {
  if (!cell || cell.value == null || cell.value === '') return undefined;
  const v = cell.value as any;
  const n = typeof v === 'object' && 'result' in v ? Number(v.result) : Number(v);
  return Number.isNaN(n) ? undefined : n;
}

export interface ColumnSpec {
  key: string;
  label: string;
  note: string;
}

/** Adds one header-styled, commented sheet to a workbook. Used by buildTemplate(). */
export function addColumnarSheet(wb: ExcelJS.Workbook, name: string, columns: ReadonlyArray<ColumnSpec>) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(18, c.label.length + 4) }));
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.eachCell((cell, colNumber) => {
    cell.note = columns[colNumber - 1].note;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
  });
}

/**
 * Refuses a sheet whose columns are not the template's, before a single row is read.
 *
 * Every value is pulled by column POSITION, so one inserted or deleted column shifts the
 * whole layout and each field is then read from its neighbour. Nothing about that looks
 * wrong on the way through: deleting "Rent PSF" (whose own note says it is not stored, so
 * people do delete it) made a valid row come back with `Termination Reason "2024-01-01"`
 * and `Monthly Rent is required` — errors pointing at cells that were perfectly correct.
 * Inserting a column instead produced an empty preview and no error at all.
 *
 * The header row was already there and unread. Comparing against it turns both into one
 * accurate sentence. Trailing columns may be absent (dropping a last column shifts
 * nothing) and extra columns past the layout are fine — that is where the rent importer's
 * optional Project column lives — so only a header that is PRESENT and WRONG is rejected.
 */
export function assertHeaderMatches(
  sheet: ExcelJS.Worksheet,
  sheetName: string,
  columns: ReadonlyArray<{ label: string }>,
): void {
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');
  const header = sheet.getRow(1);
  for (let i = 0; i < columns.length; i++) {
    const found = cellText(header.getCell(i + 1));
    if (!found) continue;
    if (norm(found) !== norm(columns[i].label)) {
      throw new BadRequestException(
        `The "${sheetName}" sheet's columns don't match the template: column ${i + 1} should be ` +
        `"${columns[i].label}" but reads "${found}". A column has been added, removed or moved, and every ` +
        'value after it would be read from the wrong field. Download a fresh template and paste the data ' +
        'into it, or put the columns back in their original order.',
      );
    }
  }
}

/** A cell-getter bound to one row + one column layout, by column key rather than index. */
export function rowGetter(row: ExcelJS.Row, columns: ReadonlyArray<{ key: string }>) {
  return (key: string) => row.getCell(columns.findIndex((c) => c.key === key) + 1);
}

export interface UnitCandidate {
  id: string;
  unitNumber: string;
  building: { name: string };
}

/**
 * Resolves a Unit Number (+ optional Building name) against the units already loaded for
 * a project. Returns an error string instead of throwing — every import row collects its
 * own errors rather than aborting the whole file on the first bad one.
 *
 * The exact wording of the "not found" error is load-bearing: RentHistoryImportPage's
 * "create missing units" flow (apps/web/src/pages/RentHistoryImportPage.tsx) offers to
 * create a unit only when a row's errors contain "was not found in this project" — a row
 * that instead gets the more specific building-mismatch error below is deliberately
 * excluded from that flow, since the unit already exists and creating another would
 * duplicate it. Changing either message needs the other checked.
 */
export function resolveUnit(
  units: UnitCandidate[],
  unitNumber: string,
  building: string,
): { unitId: string | null; error?: string } {
  if (!unitNumber) return { unitId: null };
  // Case- and whitespace-insensitive, matching how the Building name is compared just
  // below. Exact comparison meant a sheet writing "e2" did not find the unit recorded as
  // "E2": the row reported the unit as missing, the preview offered to create it, and
  // the create succeeded — two records for one physical space. (The unique index folds
  // case too now, so that last step would fail; this stops it being reached at all.)
  const key = unitNumber.trim().toLowerCase();
  const byNumber = units.filter((u) => u.unitNumber.trim().toLowerCase() === key);
  const matches = building
    ? byNumber.filter((u) => u.building.name.trim().toLowerCase() === building.trim().toLowerCase())
    : byNumber;
  if (matches.length === 0) {
    // The unit number is real, just not under the building label this row gives —
    // e.g. a source sheet writes "Centro Plaza - Building 2" while the app's building
    // is plainly "Building 2". "not found" would send someone hunting for a unit that
    // exists right there; naming its actual building says what to fix instead.
    if (building && byNumber.length > 0) {
      const actual = [...new Set(byNumber.map((u) => u.building.name))].join(', ');
      return {
        unitId: null,
        error: `Unit "${unitNumber}" exists in this project, but under building "${actual}" — not "${building}" as this row states.`,
      };
    }
    return { unitId: null, error: `Unit "${unitNumber}" was not found in this project.` };
  }
  if (matches.length > 1) return { unitId: null, error: `Unit "${unitNumber}" exists in more than one building — specify a Building.` };
  return { unitId: matches[0].id };
}

export interface BrokerCandidate {
  id: string;
  name: string;
}

export function resolveBroker(brokers: BrokerCandidate[], brokerName: string): { brokerId: string | null; error?: string } {
  if (!brokerName) return { brokerId: null };
  const match = brokers.find((b) => b.name.trim().toLowerCase() === brokerName.trim().toLowerCase());
  if (!match) return { brokerId: null, error: `Broker "${brokerName}" was not found.` };
  return { brokerId: match.id };
}

/** Case-insensitive (Unit Number, secondary key) join key — shared by both importers'
 * auxiliary-sheet matching (Ledger Exceptions/Commission Installments by tenant; sale
 * Commission Installments by buyer). */
export function joinKey(unit: string, secondary: string): string {
  return `${unit.trim().toLowerCase()}::${secondary.trim().toLowerCase()}`;
}
