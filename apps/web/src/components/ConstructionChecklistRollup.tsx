/**
 * ConstructionChecklistRollup — the main visual for the Construction tab: every unit that
 * has a checklist (never every unit in the project — a unit with no checklist just isn't
 * shown, matching the "not all units" requirement), grouped by building, each rendered as
 * a compact ring + current-stage card. A unit's headline stage is derived purely from ITS
 * OWN ordered stage list, so this holds up across buildings whose templates differ in
 * length or labels — nothing here assumes a shared column set.
 *
 * Redesigned 2026-08-24 (pass 1): replaced the one-segment-per-stage strip (up to 18 tiny
 * bars per row) with a single percentage ring + the ONE stage that actually needs attention
 * right now (the first blocked stage if any, else the next incomplete one).
 *
 * Redesigned 2026-08-24 (pass 2, scale): pass 1 was still a single-column list, which grows
 * 1:1 with unit count — a 15-unit building alone ran to ~1000px of scroll with no way to
 * spot a problem without reading every row. Units now render in a responsive card grid
 * instead of a full-width list, and each building header carries an aggregate (avg % +
 * blocked count) so risk is visible without expanding anything. Buildings collapse by
 * default once they're large AND clean; a blocked unit anywhere forces the section open —
 * the one thing worth seeing at a glance should never be hidden behind a click.
 *
 * Redesigned 2026-08-24 (pass 3, code review): pct/color/headline-stage were each being
 * recomputed independently at up to 3 levels (UnitCard, BuildingSection's stats, and the
 * top-level hasBlocked check) — one .find() scan per unit tripled into three. Now computed
 * ONCE per unit in the `buildings` memo below and carried on the row; every consumer just
 * reads it. Also switched to the shared `useCollapsibleGroups`/`chipColor` primitives
 * (apps/web/src/hooks/useCollapsibleGroups.ts, apps/web/src/components/ui.tsx) instead of
 * a third hand-rolled copy of each — see ConstructionBoard.tsx and UnitsTab for the other
 * two copies this replaces.
 */
import { useMemo, memo } from 'react';
import { Link } from 'react-router-dom';
import { Tooltip, CircularProgress } from '@heroui/react';
import { FiChevronDown, FiChevronRight } from 'react-icons/fi';
import { useConstructionRollup, useCustomOptions } from '../hooks/useApi';
import { useCollapsibleGroups } from '../hooks/useCollapsibleGroups';
import { LoadingState, EmptyState, chipColor, type HeroColor } from './ui';

interface OptionLike { value: string; label: string; color?: string | null }
interface StageLike { id: string; label: string; status: string }
interface RollupRow {
  unit: any;
  doneStages: number;
  totalStages: number;
  nextStage: StageLike | null;
  stages: StageLike[];
  pct: number;
  color: HeroColor;
  headline: StageLike | null;
}

const DOT_FILL: Record<HeroColor, string> = {
  default: 'bg-gray-300',
  primary: 'bg-blue-500',
  secondary: 'bg-purple-500',
  success: 'bg-green-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
};

function StatusLegend({ options }: { options: OptionLike[] }) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 mb-4">
      {options.map((o) => (
        <span key={o.value} className="flex items-center gap-1.5">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${DOT_FILL[chipColor(o.color)]}`} />
          {o.label}
        </span>
      ))}
    </div>
  );
}

/** The one stage worth showing: a blocked stage anywhere beats the next incomplete one — a
 *  blocker further down the list is more urgent than an untouched stage still waiting its turn. */
function headlineStage(stages: StageLike[], nextStage: StageLike | null, statusByValue: Map<string, OptionLike>) {
  const blocked = stages.find((s) => chipColor(statusByValue.get(s.status)?.color) === 'danger');
  return blocked ?? nextStage;
}

/** A unit's overall color for the ring/dot: blocked beats in-progress beats the next
 *  incomplete stage's own color, and a fully-done unit is always success regardless. */
function unitColor(pct: number, headline: StageLike | null, statusByValue: Map<string, OptionLike>): HeroColor {
  if (pct === 100) return 'success';
  return chipColor(headline ? statusByValue.get(headline.status)?.color : undefined);
}

const UnitCard = memo(function UnitCard({
  r,
  projectId,
  statusByValue,
}: {
  r: RollupRow;
  projectId: string;
  statusByValue: Map<string, OptionLike>;
}) {
  const breakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of r.stages) {
      const label = statusByValue.get(s.status)?.label ?? s.status;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([label, n]) => `${n} ${label}`).join(' · ');
  }, [r.stages, statusByValue]);

  return (
    <Link
      to={`/projects/${projectId}/units/${r.unit.id}#construction-checklist`}
      className="flex items-center gap-3 rounded-lg border border-gray-100 p-2.5 hover:bg-gray-50/60 hover:border-gray-200 transition-colors"
    >
      <Tooltip size="sm" content={`${r.doneStages}/${r.totalStages} stages — ${breakdown || 'no stages'}`}>
        <div className="shrink-0">
          <CircularProgress
            aria-label={`${r.unit.unitNumber ?? r.unit.id} progress`}
            size="sm"
            value={r.pct}
            color={r.color}
            showValueLabel
            classNames={{ svg: 'w-10 h-10', value: 'text-[0.6rem] font-semibold' }}
          />
        </div>
      </Tooltip>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-800 truncate">Unit {r.unit.unitNumber ?? r.unit.id}</div>
        <div className="text-xs text-gray-400 mb-0.5">{r.doneStages}/{r.totalStages} done</div>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${DOT_FILL[r.color]}`} />
          <span className="text-xs text-gray-600 truncate">
            {r.pct === 100 ? 'Complete' : r.headline ? r.headline.label : 'Complete'}
          </span>
        </div>
      </div>
    </Link>
  );
});

const BuildingSection = memo(function BuildingSection({
  b,
  projectId,
  statusByValue,
  expanded,
  onToggle,
}: {
  b: { id: string; name: string; units: RollupRow[] };
  projectId: string;
  statusByValue: Map<string, OptionLike>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const stats = useMemo(() => {
    let sumPct = 0;
    let blocked = 0;
    for (const r of b.units) {
      sumPct += r.pct;
      if (r.color === 'danger') blocked += 1;
    }
    return { avgPct: b.units.length ? Math.round(sumPct / b.units.length) : 0, blocked };
  }, [b.units]);

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 py-1.5 text-left"
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {expanded ? <FiChevronDown className="shrink-0" /> : <FiChevronRight className="shrink-0" />}
          {b.name}
          <span className="font-normal text-gray-400 normal-case">· {b.units.length} unit{b.units.length === 1 ? '' : 's'}</span>
        </span>
        <span className="flex items-center gap-3 text-xs shrink-0">
          {stats.blocked > 0 && (
            <span className="flex items-center gap-1 text-red-600 font-medium">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
              {stats.blocked} blocked
            </span>
          )}
          <span className="text-gray-400">{stats.avgPct}% avg</span>
        </span>
      </button>
      {expanded && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 mt-1">
          {b.units.map((r) => (
            <UnitCard key={r.unit.id} r={r} projectId={projectId} statusByValue={statusByValue} />
          ))}
        </div>
      )}
    </div>
  );
});

export function ConstructionChecklistRollup({ projectId }: { projectId: string }) {
  const rollupQ = useConstructionRollup(projectId);
  const { data: statusOptionsData } = useCustomOptions('construction_stage_status');
  const statusOptions = useMemo<OptionLike[]>(
    () => (Array.isArray(statusOptionsData) ? statusOptionsData : []),
    [statusOptionsData],
  );
  const statusByValue = useMemo(
    () => new Map(statusOptions.map((o) => [o.value, o])),
    [statusOptions],
  );

  const rows: any[] = Array.isArray(rollupQ.data) ? rollupQ.data : [];

  // No search/filter exists on this view yet, so there's nothing to reset collapse state
  // against — pass no resetDeps. If a search/filter is ever added here, list it so a
  // manually-collapsed building can't hide a match (see UnitsTab/ConstructionBoard).
  const { isExpanded, toggle } = useCollapsibleGroups();

  const buildings = useMemo(() => {
    const byBuilding = new Map<string, { id: string; name: string; units: RollupRow[] }>();
    for (const r of rows) {
      const b = r.unit.building;
      const key = b?.id ?? 'unassigned';
      if (!byBuilding.has(key)) byBuilding.set(key, { id: key, name: b?.name ?? 'Unassigned', units: [] });
      const stages: StageLike[] = r.stages ?? [];
      const pct = r.totalStages > 0 ? Math.round((r.doneStages / r.totalStages) * 100) : 0;
      const headline = headlineStage(stages, r.nextStage, statusByValue);
      const color = unitColor(pct, headline, statusByValue);
      byBuilding.get(key)!.units.push({ ...r, stages, pct, color, headline });
    }
    const list = Array.from(byBuilding.values());
    list.forEach((b) => b.units.sort((a, c) =>
      (a.unit.unitNumber ?? '').localeCompare(c.unit.unitNumber ?? '', undefined, { numeric: true })));
    list.sort((a, c) => a.name.localeCompare(c.name));
    return list;
  }, [rows, statusByValue]);

  if (rollupQ.isLoading) return <LoadingState message="Loading checklist rollup…" />;
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No unit checklists yet"
        message="Units with a construction checklist will show their progress here, grouped by building."
      />
    );
  }

  return (
    <div>
      <StatusLegend options={statusOptions} />
      <div className="space-y-4">
        {buildings.map((b) => {
          const hasBlocked = b.units.some((r) => r.color === 'danger');
          const defaultExpanded = hasBlocked || b.units.length <= 6;
          const expanded = isExpanded(b.id, defaultExpanded);
          return (
            <BuildingSection
              key={b.id}
              b={b}
              projectId={projectId}
              statusByValue={statusByValue}
              expanded={expanded}
              onToggle={() => toggle(b.id, expanded)}
            />
          );
        })}
      </div>
    </div>
  );
}
