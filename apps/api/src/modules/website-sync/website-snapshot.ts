import { createHash } from 'crypto';
import { UnitStatus } from '@prisma/client';

/**
 * What a published project looks like to the public website — version 2 of the
 * contract in PrimeDevelopers-web/docs/tracker-sync-and-aws-plan.md.
 *
 * This file is the privacy boundary. Whatever is not put into the snapshot here
 * never leaves the tracker, so nothing in it may carry a buyer, a price, a rent,
 * a deposit or a contact detail. The website validates the shape strictly and
 * rejects any field it does not know, so adding one is a change on both sides —
 * and the website has to accept it before the tracker sends it.
 *
 * Version 2 only adds fields. Asking rent and asking price are list prices for a
 * unit on the market, sent only while it is on the market, so neither can be
 * read as what a tenant or buyer agreed to pay.
 */
export interface WebsiteSnapshotUnit {
  id: string;
  unitNumber: string;
  status: UnitStatus;
  sqft: number | null;
  /** `LEASE:<ref>` / `SALE:<ref>` when let or sold together with other units. */
  dealRef: string | null;
  /** The storefront name of the active lease. Never a buyer. */
  occupant: string | null;
  /**
   * Every unit in the building in a deal with this one, this one included,
   * whatever each one's status — so a pair whose halves stop sharing a status
   * (SOLD 402 with UNDER_CONTRACT 404) still reads as one deal. Empty when the
   * unit is in no deal.
   */
  dealUnitIds: string[];
  /**
   * Units combined into this one. Combining mints a new unit and archives the
   * sources (UnitsService.combine), so these are how the website knows the new
   * unit continues their photographs.
   */
  mergedFromIds: string[];
  unitType: string | null;
  /** Per sq ft per month. Only while the unit is on the market. */
  askingRent: number | null;
  /** Only while the unit is on the market. */
  askingPrice: number | null;
  availableSince: string | null;
}

export interface WebsiteSnapshotBuilding {
  id: string;
  name: string;
  totalSqft: number | null;
  stories: number | null;
  units: WebsiteSnapshotUnit[];
}

export interface WebsiteSnapshot {
  version: 2;
  generatedAt: string;
  project: { id: string; name: string; websiteSlug: string };
  buildings: WebsiteSnapshotBuilding[];
}

/** The rows `WebsiteSyncService.load()` selects — exactly these, and nothing wider. */
export interface SourceLease {
  combinedDealRef: string | null;
  tenantBrand: string | null;
  tenantName: string;
}

export interface SourceSale {
  status: string;
  combinedDealRef: string | null;
}

/** Prisma's Decimal, or anything else that turns into a number. */
export type DecimalLike = { toString(): string } | number;

export interface SourceUnit {
  id: string;
  unitNumber: string;
  status: UnitStatus;
  sqft: number | null;
  unitType?: string | null;
  askingRent?: DecimalLike | null;
  askingPrice?: DecimalLike | null;
  availableSince?: Date | null;
  /** ACTIVE, live leases only. */
  leases: SourceLease[];
  /** Live sales of any status; CANCELLED is filtered here, as the tracker UI does. */
  sales: SourceSale[];
  /** The units combined into this one, and theirs in turn. */
  mergedFrom?: { id: string; mergedFrom?: { id: string }[] }[];
}

export interface SourceBuilding {
  id: string;
  name: string;
  totalSqft?: number | null;
  stories?: number | null;
  units: SourceUnit[];
}

export interface SourceProject {
  id: string;
  name: string;
  websiteSlug: string;
  buildings: SourceBuilding[];
}

const OCCUPIED: UnitStatus[] = ['LEASED', 'OCCUPIED'];

/** On the market: the only states in which an asking figure is published. */
const ON_MARKET: UnitStatus[] = ['AVAILABLE', 'UNDER_CONSTRUCTION'];

/**
 * What holds a unit together with others, keyed by kind — the server-side twin of
 * `dealOfUnit()` in apps/web/src/utils/tenancy.ts, so the website groups units
 * exactly as the tracker's own "N units leased together" does. A sold unit is
 * grouped by its sale: a lease surviving on it is history.
 */
function dealRefOf(unit: SourceUnit): string | null {
  if (unit.status === 'SOLD') {
    const sales = unit.sales.filter((s) => s.status !== 'CANCELLED');
    const ref = (sales.find((s) => s.combinedDealRef) ?? sales[0])?.combinedDealRef?.trim();
    return ref ? `SALE:${ref}` : null;
  }
  const ref = (unit.leases.find((l) => l.combinedDealRef) ?? unit.leases[0])?.combinedDealRef?.trim();
  return ref ? `LEASE:${ref}` : null;
}

/**
 * Every deal a unit is part of, whatever its own status: any live sale's ref
 * (so a unit UNDER_CONTRACT still belongs with its SOLD partner) and the active
 * lease's. Wider than dealRefOf(), which decides the website's grouping and must
 * keep grouping as the tracker UI does.
 */
function dealKeysOf(unit: SourceUnit): string[] {
  const sales = unit.sales
    .filter((s) => s.status !== 'CANCELLED')
    .map((s) => s.combinedDealRef?.trim())
    .filter((ref): ref is string => !!ref)
    .map((ref) => `SALE:${ref}`);
  const leases = unit.leases
    .map((l) => l.combinedDealRef?.trim())
    .filter((ref): ref is string => !!ref)
    .map((ref) => `LEASE:${ref}`);
  return [...new Set([...sales, ...leases])];
}

function occupantOf(unit: SourceUnit): string | null {
  if (!OCCUPIED.includes(unit.status)) return null;
  const lease = unit.leases[0];
  return lease?.tenantBrand?.trim() || lease?.tenantName?.trim() || null;
}

/** An asking figure, only while the unit is on the market. */
function askingOf(unit: SourceUnit, value: DecimalLike | null | undefined): number | null {
  if (!ON_MARKET.includes(unit.status) || value === null || value === undefined) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const byNumber = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function mergedFromIdsOf(unit: SourceUnit): string[] {
  const ids = (unit.mergedFrom ?? []).flatMap((source) => [source.id, ...(source.mergedFrom ?? []).map((s) => s.id)]);
  return [...new Set(ids)].sort();
}

function buildUnits(units: SourceUnit[]): WebsiteSnapshotUnit[] {
  const keys = new Map(units.map((unit) => [unit.id, dealKeysOf(unit)]));
  const partnersOf = (unit: SourceUnit) => {
    const own = keys.get(unit.id) ?? [];
    if (!own.length) return [];
    return units
      .filter((other) => (keys.get(other.id) ?? []).some((key) => own.includes(key)))
      .map((other) => other.id)
      .sort();
  };

  return [...units]
    .sort((a, b) => byNumber(a.unitNumber, b.unitNumber))
    .map((unit) => ({
      id: unit.id,
      unitNumber: unit.unitNumber,
      status: unit.status,
      sqft: unit.sqft ?? null,
      dealRef: dealRefOf(unit),
      occupant: occupantOf(unit),
      dealUnitIds: partnersOf(unit),
      mergedFromIds: mergedFromIdsOf(unit),
      unitType: unit.unitType?.trim() || null,
      askingRent: askingOf(unit, unit.askingRent),
      askingPrice: askingOf(unit, unit.askingPrice),
      availableSince: unit.availableSince ? unit.availableSince.toISOString() : null,
    }));
}

export function buildSnapshot(project: SourceProject, now = new Date()): WebsiteSnapshot {
  return {
    version: 2,
    generatedAt: now.toISOString(),
    project: { id: project.id, name: project.name, websiteSlug: project.websiteSlug },
    buildings: project.buildings.map((building) => ({
      id: building.id,
      name: building.name,
      totalSqft: building.totalSqft ?? null,
      stories: building.stories ?? null,
      units: buildUnits(building.units),
    })),
  };
}

/** Identity of a snapshot's content: the same units give the same hash whenever built. */
export function snapshotHash(snapshot: WebsiteSnapshot): string {
  const { generatedAt: _generatedAt, ...content } = snapshot;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}
