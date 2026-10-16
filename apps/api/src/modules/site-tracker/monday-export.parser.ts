/**
 * Reads a monday.com "Export board to Excel" file of the client's Site Tracker board.
 *
 * Header-driven, never positional: the export lays the board out as
 *
 *   Site Tracker                                  <- board title (ignored)
 *   CENTRO PLAZA                                  <- group title = the property
 *   Name | Subitems | BLOCKER | PRIORITY | …       <- item header
 *   1 - Unit 103 | … | NO | HIGH | …               <- items
 *   Subitems | Name | Owner | Status | …           <- subitem header (after an item that has them)
 *            | 01 - Contracts | | Done | …         <- subitems of the item above
 *
 * Columns are found by their TITLES (the ones the 2026-08-27 board audit recorded), so a
 * reordered or extra column does not break the read, and a missing one just leaves that
 * field empty. What could not be read is reported, not guessed at — the import shows a
 * preview before anything is written.
 *
 * Pure: takes cell TEXT rows, so it is testable without a spreadsheet. `rowsFromWorksheet`
 * is the thin ExcelJS adapter.
 */
import type ExcelJS from 'exceljs';

export interface MondaySubitem {
  name: string;
  owner?: string;
  status?: string;
  inspectionStatus?: string;
  inspectionDate?: string;
  timeline?: string;
}

export interface MondayItem {
  /** Spreadsheet row, 1-based — what the preview cites so a person can find it. */
  row: number;
  name: string;
  blocker?: string;
  priority?: string;
  latestUpdates?: string;
  nextActions?: string;
  tenant?: string;
  persons: string[];
  subitems: MondaySubitem[];
}

export interface MondayGroup {
  name: string;
  items: MondayItem[];
}

const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

const ITEM_FIELDS: Record<string, string[]> = {
  blocker: ['blocker'],
  priority: ['priority'],
  latestUpdates: ['latest updates', 'latest update'],
  nextActions: ['next actions', 'next action'],
  tenant: ['tenant / business', 'tenant/business', 'tenant', 'business'],
  person: ['person', 'people', 'owners', 'owner'],
};
const SUB_FIELDS: Record<string, string[]> = {
  owner: ['owner', 'person'],
  status: ['status'],
  inspectionStatus: ['inspection status'],
  inspectionDate: ['inspection date'],
  timeline: ['timeline'],
};
/** Titles only an ITEM header carries — how an item header is told from a subitem one. */
const ITEM_ONLY = ['blocker', 'priority', 'tenant / business', 'latest updates', 'next actions'];

function indexOfAny(header: string[], names: string[]) {
  for (const n of names) {
    const i = header.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

function isItemHeader(h: string[]) {
  return ITEM_ONLY.some((t) => h.includes(t));
}
function isSubHeader(h: string[]) {
  return !isItemHeader(h) && (h.includes('subitems') || h.includes('subitem') || h.includes('inspection status'));
}

type Cols = Record<string, number>;

function itemCols(h: string[]): Cols {
  const cols: Cols = {};
  // The name column is titled by the board ("Building-unit"), or "Name" in some exports.
  let name = indexOfAny(h, ['name', 'building-unit', 'building unit', 'item']);
  if (name < 0) name = h.findIndex((c) => c !== '');
  cols.name = name;
  for (const [k, names] of Object.entries(ITEM_FIELDS)) cols[k] = indexOfAny(h, names);
  return cols;
}

function subCols(h: string[]): Cols {
  const cols: Cols = {};
  cols.name = indexOfAny(h, ['name', 'subitem', 'subitems']);
  for (const [k, names] of Object.entries(SUB_FIELDS)) cols[k] = indexOfAny(h, names);
  return cols;
}

const at = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');

export function parseMondayRows(rows: string[][]): { groups: MondayGroup[]; warnings: string[] } {
  const groups: MondayGroup[] = [];
  const warnings: string[] = [];
  let group: MondayGroup | null = null;
  let iCols: Cols | null = null;
  let sCols: Cols | null = null;
  let mode: 'none' | 'items' | 'subitems' = 'none';
  let lastItem: MondayItem | null = null;

  const nextNonBlank = (from: number) => {
    for (let j = from; j < rows.length; j++) if (rows[j].some((c) => (c ?? '').trim())) return rows[j];
    return null;
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].map((c) => (c ?? '').trim());
    const filled = row.filter(Boolean);
    if (filled.length === 0) continue;
    const header = row.map(norm);

    if (isItemHeader(header)) { iCols = itemCols(header); mode = 'items'; continue; }
    if (isSubHeader(header) && lastItem) { sCols = subCols(header); mode = 'subitems'; continue; }

    // A lone cell whose next row is an item header is a group (property) title.
    if (filled.length === 1) {
      const next = nextNonBlank(i + 1);
      if (next && isItemHeader(next.map(norm))) {
        group = { name: filled[0], items: [] };
        groups.push(group);
        mode = 'none';
        lastItem = null;
        continue;
      }
    }

    if (!iCols) continue; // board title and anything before the first header

    if (mode === 'subitems' && sCols && lastItem) {
      // Is this the next ITEM or another subitem? An item puts something in a column only
      // items have (blocker, priority, tenant…); when the two layouts share the name column
      // that is the only reliable tell.
      const itemOnlyIdx = ['blocker', 'priority', 'latestUpdates', 'nextActions', 'tenant']
        .map((k) => iCols![k]).filter((ix) => ix >= 0 && !Object.values(sCols!).includes(ix));
      const subName = at(row, sCols.name);
      // When both layouts share the name column, a row with every item-only column empty
      // could be either; one NAMED like a unit ("Unit 615", "Building 2") is an item, since
      // checklist steps are named after work ("06 - Framing").
      const looksLikeItem = itemOnlyIdx.some((ix) => row[ix])
        || (sCols.name === iCols.name && /\b(?:units?|building|bldg|suites?)\b/i.test(subName));
      if (!looksLikeItem && subName) {
        lastItem.subitems.push({
          name: subName,
          owner: at(row, sCols.owner) || undefined,
          status: at(row, sCols.status) || undefined,
          inspectionStatus: at(row, sCols.inspectionStatus) || undefined,
          inspectionDate: at(row, sCols.inspectionDate) || undefined,
          timeline: at(row, sCols.timeline) || undefined,
        });
        continue;
      }
      mode = 'items';
    }

    const name = at(row, iCols.name);
    if (!name) continue; // footers, summaries
    if (!group) {
      group = { name: '', items: [] };
      groups.push(group);
      warnings.push('Rows before the first property heading were read without a property.');
    }
    lastItem = {
      row: i + 1,
      name,
      blocker: at(row, iCols.blocker) || undefined,
      priority: at(row, iCols.priority) || undefined,
      latestUpdates: at(row, iCols.latestUpdates) || undefined,
      nextActions: at(row, iCols.nextActions) || undefined,
      tenant: at(row, iCols.tenant) || undefined,
      persons: at(row, iCols.person).split(/\s*[,;]\s*/).filter(Boolean),
      subitems: [],
    };
    group.items.push(lastItem);
  }

  if (groups.every((g) => g.items.length === 0)) {
    warnings.push('No board rows were found. Export the board from monday with "Export board to Excel" and upload that file.');
  }
  return { groups, warnings };
}

/** Cell text the way a person sees it; dates as YYYY-MM-DD so the parser can read them. */
function cellToText(cell: ExcelJS.Cell): string {
  const v = cell.value as any;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return v.result == null ? '' : String(v.result);
  }
  return String(v);
}

export function rowsFromWorksheet(ws: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const out: string[] = [];
    for (let c = 1; c <= Math.max(row.cellCount, ws.columnCount); c++) out.push(cellToText(row.getCell(c)));
    rows.push(out);
  }
  return rows;
}

// ── Unit names ────────────────────────────────────────────────────────────────

export interface ParsedUnitLabel {
  kind: 'units' | 'building' | 'other';
  /** "8" from "8 - Units 805, 807" — the board numbers rows by building. */
  buildingNo?: string;
  units: string[];
}

/**
 * Item names on the board are free text with unit numbers embedded (audit §3.1):
 * "1 - Unit 103", "8 - Units 805, 807, 809", "10 - Unit 1003-9", "7 - Unit 701, 2, 3",
 * "UNITS 402,403,404", "BUILDING 7", "PARTY HALL".
 *
 * Abbreviations are expanded the way a person reads them: "1003-9" is 1003 to 1009, and in
 * "701, 2, 3" the short numbers borrow the leading digits of the one before.
 */
export function parseUnitLabel(raw: string): ParsedUnitLabel {
  let rest = raw.trim();
  let buildingNo: string | undefined;
  const lead = rest.match(/^(\d+)\s*[-–]\s*(.+)$/);
  if (lead) { buildingNo = lead[1]; rest = lead[2].trim(); }

  const bldg = rest.match(/^(?:building|bldg)\.?\s*#?\s*(\w+)\s*$/i);
  if (bldg) return { kind: 'building', buildingNo: bldg[1], units: [] };

  rest = rest.replace(/^(?:units?|suites?)\s*#?\s*/i, '');
  if (!/\d/.test(rest)) return { kind: 'other', buildingNo, units: [] };

  const units: string[] = [];
  let prev = '';
  for (const tok of rest.split(/\s*(?:,|&|\+|\/|\band\b)\s*/i).map((t) => t.trim()).filter(Boolean)) {
    const range = tok.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) {
      const a = range[1];
      let b = range[2];
      if (b.length < a.length) b = a.slice(0, a.length - b.length) + b;
      const from = Number(a); const to = Number(b);
      if (to >= from && to - from <= 50) {
        for (let n = from; n <= to; n++) units.push(String(n));
        prev = b;
        continue;
      }
    }
    if (/^\d+$/.test(tok) && prev && tok.length < prev.length) {
      const full = prev.slice(0, prev.length - tok.length) + tok;
      units.push(full);
      prev = full;
      continue;
    }
    const clean = tok.replace(/^(?:units?|suites?)\s*#?\s*/i, '');
    if (/\d/.test(clean)) { units.push(clean); prev = clean.replace(/\D.*$/, '') || clean; }
  }
  return { kind: units.length ? 'units' : 'other', buildingNo, units: [...new Set(units)] };
}

/** "2026-08-19 - 2026-08-21" (monday's timeline export) -> two ISO dates. */
export function parseTimeline(text?: string): { start?: string; end?: string } {
  if (!text) return {};
  const dates = text.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  return { start: dates[0], end: dates[1] ?? dates[0] };
}

/** A real calendar date, or undefined — never a guess. */
export function parseDate(text?: string): string | undefined {
  if (!text) return undefined;
  const iso = text.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return undefined;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
}
