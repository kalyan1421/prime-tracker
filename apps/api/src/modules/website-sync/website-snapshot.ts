import { createHash } from 'crypto';
import { UnitStatus } from '@prisma/client';

/**
 * What a published project looks like to the public website — version 1 of the
 * contract in PrimeDevelopers-web/docs/tracker-sync-and-aws-plan.md.
 *
 * This file is the privacy boundary. Whatever is not put into the snapshot here
 * never leaves the tracker, so nothing in it may carry a buyer, a price, a rent,
 * a deposit or a contact detail. The website validates the shape strictly and
 * rejects any field it does not know, so adding one is a change on both sides.
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
}

export interface WebsiteSnapshot {
  version: 1;
  generatedAt: string;
  project: { id: string; name: string; websiteSlug: string };
  buildings: { id: string; name: string; units: WebsiteSnapshotUnit[] }[];
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

export interface SourceUnit {
  id: string;
  unitNumber: string;
  status: UnitStatus;
  sqft: number | null;
  /** ACTIVE, live leases only. */
  leases: SourceLease[];
  /** Live sales of any status; CANCELLED is filtered here, as the tracker UI does. */
  sales: SourceSale[];
}

export interface SourceProject {
  id: string;
  name: string;
  websiteSlug: string;
  buildings: { id: string; name: string; units: SourceUnit[] }[];
}

const OCCUPIED: UnitStatus[] = ['LEASED', 'OCCUPIED'];

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

function occupantOf(unit: SourceUnit): string | null {
  if (!OCCUPIED.includes(unit.status)) return null;
  const lease = unit.leases[0];
  return lease?.tenantBrand?.trim() || lease?.tenantName?.trim() || null;
}

const byNumber = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export function buildSnapshot(project: SourceProject, now = new Date()): WebsiteSnapshot {
  return {
    version: 1,
    generatedAt: now.toISOString(),
    project: { id: project.id, name: project.name, websiteSlug: project.websiteSlug },
    buildings: project.buildings.map((building) => ({
      id: building.id,
      name: building.name,
      units: [...building.units]
        .sort((a, b) => byNumber(a.unitNumber, b.unitNumber))
        .map((unit) => ({
          id: unit.id,
          unitNumber: unit.unitNumber,
          status: unit.status,
          sqft: unit.sqft ?? null,
          dealRef: dealRefOf(unit),
          occupant: occupantOf(unit),
        })),
    })),
  };
}

/** Identity of a snapshot's content: the same units give the same hash whenever built. */
export function snapshotHash(snapshot: WebsiteSnapshot): string {
  const { generatedAt: _generatedAt, ...content } = snapshot;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}
