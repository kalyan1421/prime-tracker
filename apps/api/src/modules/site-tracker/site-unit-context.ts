import type { PrismaService } from '../../prisma/prisma.service';

/** Numeric-aware sort so "Units 805, 807, 1003" does not come out as "1003, 805, 807". */
export function compareUnitNumbers(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * How a tracker row names itself: "Unit 103", or "Units 805, 807, 809" when the row is one
 * job across several units (see Unit.trackedWithId). The same words the monday board used,
 * so a notification reads the way the row does.
 */
export function siteUnitLabel(unitNumber: string, memberNumbers: string[] = []) {
  if (memberNumbers.length === 0) return `Unit ${unitNumber}`;
  return `Units ${[unitNumber, ...memberNumbers].sort(compareUnitNumbers).join(', ')}`;
}

/**
 * Everything a site notification needs about a unit, resolved to its tracker ROW.
 *
 * A member of a multi-unit job carries no tracker data of its own — owners, watchers and the
 * checklist all live on the lead — so an update filed against Unit 807 from its own page is
 * routed exactly as if it had been posted on the "Units 805, 807, …" row. Null when the unit
 * is gone, which callers treat as "nothing to notify".
 */
export async function loadSiteUnitContext(prisma: PrismaService, unitId: string) {
  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    select: { id: true, trackedWithId: true, deletedAt: true },
  });
  if (!unit || unit.deletedAt) return null;
  const leadId = unit.trackedWithId ?? unit.id;
  const lead = await prisma.unit.findUnique({
    where: { id: leadId },
    select: {
      id: true, unitNumber: true,
      trackedUnits: { where: { deletedAt: null }, select: { unitNumber: true } },
      building: { select: { project: { select: { id: true, name: true } } } },
    },
  });
  if (!lead) return null;
  return {
    unitId: lead.id,
    label: siteUnitLabel(lead.unitNumber, lead.trackedUnits.map((u) => u.unitNumber)),
    projectId: lead.building.project.id,
    projectName: lead.building.project.name,
  };
}
