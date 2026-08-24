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
 */
export function resolveUnit(
  units: UnitCandidate[],
  unitNumber: string,
  building: string,
): { unitId: string | null; error?: string } {
  if (!unitNumber) return { unitId: null };
  const matches = units.filter((u) => u.unitNumber === unitNumber
    && (!building || u.building.name.trim().toLowerCase() === building.trim().toLowerCase()));
  if (matches.length === 0) return { unitId: null, error: `Unit "${unitNumber}" was not found in this project.` };
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
