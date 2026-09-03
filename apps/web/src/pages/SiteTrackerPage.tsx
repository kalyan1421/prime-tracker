/**
 * Site Tracker — the cross-property construction grid (Phase 5).
 *
 * One row per tracked unit, grouped Project -> Building, with the blocker, the checklist
 * percentage and the stage that needs attention all visible without opening anything.
 * Ports the column set from the client's monday board (see
 * docs/client-discovery/SITE_TRACKER_UPDATE_SECTION_PLAN.md) with four deliberate
 * departures, each noted at its call site below:
 *
 *   - percent complete, which the source board shows nowhere;
 *   - blocker AGE, which it cannot show at all;
 *   - a real create form, instead of a button that appends a blank row;
 *   - the tenant column redacted for a viewer without lease:view (CONSTRUCTION holds
 *     siteTracker:view and not lease:view — the backend never sends it).
 *
 * The two AI columns from Phase 4 are not built yet. This page ships without them.
 */
import { useEffect, useMemo, useState, memo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Button, Input, Select, SelectItem, Chip, Tooltip, CircularProgress,
  Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, addToast,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure,
} from '@heroui/react';
import {
  FiAlertTriangle, FiChevronDown, FiChevronRight, FiSearch, FiUsers, FiX, FiMessageSquare,
  FiPlus, FiEdit2, FiHome,
} from 'react-icons/fi';
import {
  useSiteTracker, useUpdateSiteTracker, useSetUnitAssignees,
  useProjects, useBuildings, useCustomOptions, useAssignableUsers,
  useStageCatalogue, useAddUnitConstructionStages,
} from '../hooks/useApi';
import { useCollapsibleGroups } from '../hooks/useCollapsibleGroups';
import { usePagination } from '../hooks/usePagination';
import { useDebounced } from '../hooks/useDebounced';
import { LoadingState, ErrorState, EmptyState, PermissionGate, chipColor, type HeroColor } from '../components/ui';
import { DailyLogFeed } from '../components/DailyLogFeed';
import { EditUnitModal } from '../components/EditUnitModal';
import { SiteTrackerDetailsModal } from '../components/SiteTrackerDetailsModal';
import { SiteTrackerRowActions } from '../components/SiteTrackerRowActions';
import { UnitConstructionChecklist } from '../components/UnitConstructionChecklist';
import { useAuthStore } from '../store/authStore';
import { errMsg, fmtDateShort } from '../utils/fmt';

interface Assignee { id: string; name: string | null; email: string }
interface Stage { id: string; label: string; status: string; sortOrder: number; inspectionStatus: string | null }
interface Row {
  id: string; unitNumber: string; status: string;
  project: { id: string; name: string };
  building: { id: string; name: string };
  blockerStatus: string | null; blockerReason: string | null; blockerDays: number | null;
  sitePriority: string | null;
  template: { id: string; name: string; version: number; stampedVersion: number | null } | null;
  assignees: Assignee[];
  tenantName?: string | null;
  totalStages: number; doneStages: number; pctComplete: number | null;
  currentStage: { id: string; label: string; status: string } | null;
  stages: Stage[];
  updateCount?: number; staleDays: number | null;
  latestUpdate?: {
    notes: string; logDate: string; authorName: string | null; stageLabel: string | null;
  } | null;
}

/** Units per page. Groups are formed from the page, so a building can span two. */
const PAGE_SIZE = 50;

const initials = (a: Assignee) =>
  (a.name ?? a.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');

/** Deterministic avatar tint — same person, same colour, on every screen. */
const AVATAR_TINTS = [
  'bg-blue-100 text-blue-700', 'bg-purple-100 text-purple-700', 'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700', 'bg-teal-100 text-teal-700',
];
function tintFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

/**
 * Legacy stage labels carry their own "01 - " prefix (that is how every checklist created
 * before Phase 2 is stored), while seeded template steps do not. The panel renders the
 * position itself, so leaving the prefix in place gives "01  01 - Soil Compaction".
 * Same prefix shape ChecklistTemplatesService.norm strips on the API side.
 */
function stripStepPrefix(label: string) {
  return label.replace(/^\s*\d+\s*[-.]\s*/, '');
}

function pctColor(pct: number): HeroColor {
  if (pct >= 90) return 'success';
  if (pct >= 40) return 'primary';
  return 'warning';
}

function optLabel(opts: { value: string; label: string }[], value?: string | null) {
  if (!value) return null;
  return opts.find((o) => o.value === value)?.label ?? value;
}

export default function SiteTrackerPage() {
  const { hasPermission } = useAuthStore();
  const canEdit = hasPermission('siteTracker:edit');
  // Same gate the row's pencil sat behind — it now guards the secondary route to the
  // unit form rather than the pencil itself.
  const canEditUnit = hasPermission('unit:editBuild');
  // Editing a stage is gated on checklist:edit, not siteTracker:edit — the same permission
  // that governs it on the unit page, so the two screens agree on who may touch a checklist.
  const canEditChecklist = hasPermission('checklist:edit');

  // Project Details links here with ?projectId= so "open in Site Tracker" lands already
  // filtered rather than on all fourteen units.
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState(params.get('projectId') ?? '');
  const [blockerStatus, setBlockerStatus] = useState('');
  // Priority is editable on every row and filterable on none of them — the API accepted
  // it all along, and buildingId too. Building narrows within the chosen property, so it
  // only appears once there is one.
  const [sitePriority, setSitePriority] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const debouncedSearch = useDebounced(search, 300);

  const { data, isLoading, error } = useSiteTracker({
    projectId, buildingId, blockerStatus, sitePriority, search: debouncedSearch,
  });
  const { data: projects = [], isSuccess: projectsLoaded } = useProjects();
  const { data: buildings = [] } = useBuildings(projectId);
  const { data: priorityOpts = [] } = useCustomOptions('site_priority');
  const { data: stageStatusOpts = [] } = useCustomOptions('construction_stage_status');

  // The dropdown only ever lists live projects (useProjects excludes archived), so an
  // archived-mid-session project just vanishes from its options — but `projectId` is local
  // state, independent of that list, so it kept filtering by an id nothing could select any
  // more: the Select rendered blank and the grid silently showed zero rows with no
  // explanation. Gated on `projectsLoaded` so this can't fire on the very first render,
  // before the list has arrived, and mistake "not loaded yet" for "no longer exists."
  useEffect(() => {
    if (!projectId || !projectsLoaded) return;
    if (projects.some((p: any) => p.id === projectId)) return;
    setProjectId('');
    setBuildingId('');
    addToast({ title: 'That project is no longer available — cleared the filter.', color: 'warning' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, projectsLoaded, projectId]);

  const rows: Row[] = data?.rows ?? [];
  const summary = data?.summary;

  // The update count used to be a dead number — it reported how many updates a unit had
  // and gave you no way to read them. This opens the unit's feed in place.
  const feedModal = useDisclosure();
  // Bringing a unit that already exists ONTO the tracker — this page's one create action.
  // A unit counts as tracked once it has any site work recorded, so this seeds a checklist
  // rather than inventory. It replaced a "New unit" button that made a second copy of a
  // unit people already had.
  const trackUnit = useDisclosure();
  const [editUnit, setEditUnit] = useState<Row | null>(null);
  /**
   * The row pencil opens THIS — the unit's site-tracker fields (blocker, priority,
   * owners) — not EditUnitModal, which edits the asset. Unit details stay reachable
   * from a secondary button inside it.
   */
  const [trackerUnit, setTrackerUnit] = useState<Row | null>(null);
  const [feedUnit, setFeedUnit] = useState<Row | null>(null);
  const openFeed = (row: Row) => { setFeedUnit(row); feedModal.onOpen(); };

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleRow = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Reset collapsed-group overrides whenever a filter narrows the list — otherwise a
  // section collapsed earlier stays shut and a search looks like it found nothing.
  const { isExpanded, toggle } = useCollapsibleGroups(
    [debouncedSearch, projectId, buildingId, blockerStatus, sitePriority],
  );

  // Paginated on UNITS, then grouped, so a page is a fixed amount of work regardless of
  // how the buildings happen to divide — and every expanded row's stage list is bounded
  // with it. The August list-scale pass added this across seven components; this table was
  // built afterwards and rendered every row and every stage at once.
  const {
    page, setPage, totalPages, paged: pagedRows, total: totalRows,
  } = usePagination(rows, PAGE_SIZE, [debouncedSearch, projectId, buildingId, blockerStatus, sitePriority]);

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; project: Row['project']; building: Row['building']; units: Row[] }>();
    for (const r of pagedRows) {
      const key = `${r.project.id}:${r.building.id}`;
      const g = map.get(key);
      if (g) g.units.push(r);
      else map.set(key, { key, project: r.project, building: r.building, units: [r] });
    }
    return Array.from(map.values()).map((g) => {
      const tracked = g.units.filter((u) => u.pctComplete !== null);
      return {
        ...g,
        blockedCount: g.units.filter((u) => u.blockerStatus === 'YES').length,
        avgPct: tracked.length
          ? Math.round(tracked.reduce((s, u) => s + (u.pctComplete ?? 0), 0) / tracked.length)
          : null,
        // The segmented battery from the source board's group footers, moved into the
        // header where it is visible without scrolling to the end of a section.
        battery: g.units.reduce(
          (acc, u) => {
            for (const s of u.stages) {
              if (s.status === 'DONE') acc.done += 1;
              else if (s.status === 'BLOCKED') acc.blocked += 1;
              else if (s.status === 'NOT_STARTED') acc.idle += 1;
              else acc.wip += 1;
            }
            return acc;
          },
          { done: 0, wip: 0, blocked: 0, idle: 0 },
        ),
      };
    });
  }, [pagedRows]);

  const filtersActive = !!(search || projectId || buildingId || blockerStatus || sitePriority);

  if (isLoading) return <LoadingState message="Loading the site tracker…" />;
  if (error) return <ErrorState message={errMsg(error, 'Could not load the site tracker')} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Site Tracker</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Every unit under construction across all properties, its blocker, and where its checklist stands.
          </p>
        </div>
        {/* One action, because there is one thing this page starts: putting a unit on the
            tracker. "Add stage" duplicated what expanding a row already does better (with
            the unit's own checklist in front of you), and "New unit" created inventory —
            the wrong verb here, gated on a permission the site team does not hold, and the
            button people pressed when they meant "track this one". Units are created in
            Project Details, where the rest of the unit's details are set. */}
        <div className="flex items-center gap-2">
          <PermissionGate permission="checklist:edit">
            <Button size="sm" color="primary" startContent={<FiPlus />} onPress={trackUnit.onOpen}>
              Track a unit
            </Button>
          </PermissionGate>
        </div>
      </div>

      {summary && <SummaryRail summary={summary} filtered={filtersActive} />}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          size="sm" className="max-w-[220px]" value={search} onValueChange={setSearch}
          placeholder="Unit, tenant, stage…" startContent={<FiSearch className="text-gray-400" />}
          isClearable onClear={() => setSearch('')} aria-label="Search the site tracker"
        />
        <Select
          size="sm" className="max-w-[180px]" aria-label="Filter by property"
          placeholder="All properties" selectedKeys={projectId ? [projectId] : []}
          onChange={(e) => { setProjectId(e.target.value); setBuildingId(''); }}
        >
          {projects.map((p: any) => (
            <SelectItem key={p.id} textValue={p.name}>{p.name}</SelectItem>
          ))}
        </Select>
        <Select
          size="sm" className="max-w-[150px]" aria-label="Filter by blocker"
          placeholder="Any blocker" selectedKeys={blockerStatus ? [blockerStatus] : []}
          onChange={(e) => setBlockerStatus(e.target.value)}
        >
          <SelectItem key="YES" textValue="Blocked">Blocked</SelectItem>
          <SelectItem key="NO" textValue="Not blocked">Not blocked</SelectItem>
          {/* Distinct from "Not blocked": nobody has assessed these at all. */}
          <SelectItem key="NONE" textValue="Not assessed">Not assessed</SelectItem>
        </Select>
        <Select
          size="sm" className="max-w-[150px]" aria-label="Filter by priority"
          placeholder="Any priority" selectedKeys={sitePriority ? [sitePriority] : []}
          onChange={(e) => setSitePriority(e.target.value)}
        >
          {priorityOpts.map((o: any) => (
            <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
          ))}
        </Select>
        {/* Only once a property is chosen — a flat list of every building across the
            portfolio would be longer than the unit list it filters. */}
        {projectId && buildings.length > 1 && (
          <Select
            size="sm" className="max-w-[170px]" aria-label="Filter by building"
            placeholder="All buildings" selectedKeys={buildingId ? [buildingId] : []}
            onChange={(e) => setBuildingId(e.target.value)}
          >
            {buildings.map((b: any) => (
              <SelectItem key={b.id} textValue={b.name}>{b.name}</SelectItem>
            ))}
          </Select>
        )}
        {filtersActive && (
          <Button
            size="sm" variant="light" startContent={<FiX />}
            onPress={() => {
              setSearch(''); setProjectId(''); setBuildingId('');
              setBlockerStatus(''); setSitePriority('');
            }}
          >
            Clear
          </Button>
        )}
        <div className="ml-auto text-[11px] text-gray-500">
          {rows.length} unit{rows.length === 1 ? '' : 's'}
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title={filtersActive ? 'Nothing matches those filters' : 'No units on the tracker yet'}
          // The old copy said units appear "as soon as they belong to a building on a
          // project you can see", which is not the rule and is the exact misreading that
          // had people pressing New unit and making a second copy of a unit they had.
          // A unit joins this board when site work is recorded against it.
          message={filtersActive
            ? 'Try clearing a filter.'
            : 'A unit joins the board once site work is recorded on it — a checklist, a blocker, a priority or an owner. Use “Track a unit” to bring one on.'}
        />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white overflow-x-auto">
          <table className="w-full min-w-[1420px] border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <Th className="w-[200px]">Unit</Th>
                <Th className="w-[150px]">Blocker</Th>
                <Th className="w-[110px]">Priority</Th>
                <Th className="w-[300px]">Latest update</Th>
                <Th className="w-[120px]">Owners</Th>
                <Th className="w-[130px]">Progress</Th>
                <Th>Current stage</Th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                // A section with a blocked unit is forced open — the one thing worth
                // seeing at a glance should never be hidden behind a click.
                const defaultOpen = g.blockedCount > 0 || g.units.length <= 8;
                const open = isExpanded(g.key, defaultOpen);
                return (
                  <GroupSection
                    key={g.key} group={g} open={open} onToggle={() => toggle(g.key, open)}
                    expanded={expanded} onToggleRow={toggleRow} onOpenFeed={openFeed}
                    onEditUnit={setTrackerUnit}
                    canEdit={canEdit} canEditUnit={canEditUnit} canEditChecklist={canEditChecklist}
                    priorityOpts={priorityOpts}
                    stageStatusOpts={stageStatusOpts}
                  />
                );
              })}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2.5">
              <span className="text-xs text-gray-500 tabular-nums">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalRows)} of {totalRows} units
              </span>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="flat" isDisabled={page === 1} onPress={() => setPage(page - 1)}>
                  Previous
                </Button>
                <span className="px-2 text-xs tabular-nums text-gray-500">Page {page} / {totalPages}</span>
                <Button size="sm" variant="flat" isDisabled={page === totalPages} onPress={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {trackerUnit && (
        <SiteTrackerDetailsModal
          unit={trackerUnit}
          canEdit={canEdit}
          onClose={() => setTrackerUnit(null)}
          onEditUnitDetails={canEditUnit ? () => { setEditUnit(trackerUnit); setTrackerUnit(null); } : undefined}
        />
      )}

      {editUnit && (
        <EditUnitModal unit={editUnit} onClose={() => setEditUnit(null)} />
      )}

      {trackUnit.isOpen && (
        <TrackExistingUnitModal projects={projects} onClose={trackUnit.onClose} />
      )}

      {/* Unit feed, opened from the update count. Rendered once at page level rather than
          per row: fourteen mounted modals would each hold their own query. */}
      <Modal
        isOpen={feedModal.isOpen} onOpenChange={feedModal.onOpenChange}
        size="2xl" scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold">Unit {feedUnit?.unitNumber}</span>
            <span className="text-[11px] font-normal text-gray-500">
              {feedUnit?.building.name} · {feedUnit?.project.name}
            </span>
          </ModalHeader>
          <ModalBody className="pb-5">
            {feedUnit && (
              <DailyLogFeed
                projectId={feedUnit.project.id}
                unitId={feedUnit.id}
                title="Updates"
              />
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}

/**
 * The newest thing SAID about this unit, given its own column.
 *
 * It was 11px grey text tucked under the unit name, which is where you put something nobody
 * needs to read. A count tells you that something happened; the sentence tells you what,
 * and that is the reason anyone was going to open the row at all — so it earns a column
 * beside Blocker and Priority, the way the client's own board has it.
 */
function LatestUpdateCell({ row, onOpenFeed }: { row: Row; onOpenFeed: (r: Row) => void }) {
  // undefined means the viewer cannot read the update feed at all.
  if (row.latestUpdate === undefined) {
    return <span className="text-[11px] text-gray-500 italic">Hidden</span>;
  }
  if (!row.latestUpdate) {
    return (
      <button
        type="button" onClick={() => onOpenFeed(row)}
        className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-blue-600"
      >
        <FiMessageSquare size={11} /> No updates yet
      </button>
    );
  }
  const u = row.latestUpdate;
  return (
    <button type="button" onClick={() => onOpenFeed(row)} className="group/upd block w-full text-left">
      <p className="line-clamp-2 text-xs text-gray-700 group-hover/upd:text-blue-600" title={u.notes}>
        {u.notes}
      </p>
      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1">
          <FiMessageSquare size={10} />{row.updateCount}
        </span>
        {u.authorName && <span>{u.authorName}</span>}
        <span>{fmtDateShort(u.logDate)}</span>
        {u.stageLabel && <span className="truncate text-amber-700">{u.stageLabel}</span>}
        {row.staleDays !== null && row.staleDays >= 7 && (
          <span className="text-amber-700">{row.staleDays}d ago</span>
        )}
      </span>
    </button>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 px-3 py-2 ${className}`}>
      {children}
    </th>
  );
}

function SummaryRail({ summary, filtered }: { summary: any; filtered: boolean }) {
  const tiles = [
    {
      label: 'Blocked now', value: summary.blocked,
      // Blocker AGE, which the source board cannot show at all. "Blocked" matters much
      // less than "blocked for eleven days". Null is "no start date recorded", which is
      // not the same as zero days and must not read as "blocked today".
      foot: summary.blocked === 0
        ? 'none open'
        : summary.oldestBlockerDays === null
          ? 'start date not recorded'
          : `oldest ${summary.oldestBlockerDays}d`,
      tone: summary.blocked ? 'border-l-red-500' : 'border-l-gray-300',
    },
    { label: 'Units tracked', value: summary.total, foot: `${summary.noChecklist} with no checklist`, tone: 'border-l-gray-300' },
    {
      label: 'Avg. complete',
      value: summary.avgPctComplete === null ? '—' : `${summary.avgPctComplete}%`,
      foot: 'units with a checklist', tone: 'border-l-emerald-500',
    },
    // null means "you cannot see updates", which is not the same as zero stale units.
    ...(summary.stale === null ? [] : [{
      label: 'No update 7d+', value: summary.stale, foot: 'silence is its own risk',
      tone: summary.stale ? 'border-l-amber-500' : 'border-l-gray-300',
    }]),
    // Counts STAGES, not units — three can be three steps on one unit. Said plainly,
    // because it sits fifth in a row of unit counts and read as three units.
    { label: 'Awaiting inspection', value: summary.awaitingInspection, foot: 'stages scheduled or in progress', tone: 'border-l-blue-500' },
  ];
  return (
    <div className="flex flex-col gap-1.5">
    {/* Every number here is computed over what the filters left, so a search quietly
        turns "blocked now" into "blocked among the matches". Say so rather than letting
        the rail look portfolio-wide while the table under it is not. */}
    {filtered && (
      <p className="text-[11px] text-gray-500">Across the filtered units only.</p>
    )}
    <div className="grid gap-2 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className={`rounded-lg border border-gray-200 border-l-[3px] ${t.tone} bg-white px-3 py-2`}>
          <div className="text-[11px] font-medium text-gray-500">{t.label}</div>
          <div className="text-lg font-semibold text-gray-900 leading-tight">{t.value}</div>
          <div className="text-[11px] text-gray-500">{t.foot}</div>
        </div>
      ))}
    </div>
    </div>
  );
}

const GroupSection = memo(function GroupSection({
  group, open, onToggle, expanded, onToggleRow, onOpenFeed, onEditUnit, canEdit, canEditUnit, canEditChecklist,
  priorityOpts, stageStatusOpts,
}: any) {
  const b = group.battery;
  const totalSteps = Math.max(b.done + b.wip + b.blocked + b.idle, 1);
  const seg = (n: number, cls: string, title: string) =>
    n > 0 ? <span className={cls} style={{ width: `${(n / totalSteps) * 100}%` }} title={title} /> : null;

  return (
    <>
      <tr className="bg-gray-100/70 border-y border-gray-200">
        <td colSpan={7} className="px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button" onClick={onToggle}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-900 hover:text-blue-600"
              aria-expanded={open}
            >
              {open ? <FiChevronDown className="text-gray-500" /> : <FiChevronRight className="text-gray-500" />}
              {group.building.name}
            </button>
            {/* The only way back to the project from here used to be opening a unit first.
                Project Detail already links forward to this page filtered by project
                (?projectId=); this closes the loop the other direction. */}
            <Link
              to={`/projects/${group.project.id}/construction`}
              onClick={(e) => e.stopPropagation()}
              className="text-[11px] text-gray-500 hover:text-blue-600 hover:underline"
            >
              {group.project.name}
            </Link>
            <span className="text-[11px] text-gray-500">
              {group.units.length} unit{group.units.length === 1 ? '' : 's'}
            </span>
            <span
              className="flex h-1.5 w-28 overflow-hidden rounded-full bg-gray-200"
              role="img"
              aria-label={`${b.done} steps done, ${b.wip} in progress, ${b.blocked} held, ${b.idle} not started`}
            >
              {seg(b.done, 'bg-emerald-500', `${b.done} done`)}
              {seg(b.wip, 'bg-amber-500', `${b.wip} working`)}
              {seg(b.blocked, 'bg-red-500', `${b.blocked} held`)}
              {seg(b.idle, 'bg-gray-300', `${b.idle} not started`)}
            </span>
            {group.avgPct !== null && (
              <span className="text-[11px] tabular-nums text-gray-600">{group.avgPct}% avg</span>
            )}
            {group.blockedCount > 0 && (
              <Chip size="sm" color="danger" variant="flat" className="text-[11px]">
                {group.blockedCount} blocked
              </Chip>
            )}
          </div>
        </td>
      </tr>
      {open && group.units.map((u: Row) => (
        <UnitRow
          key={u.id} row={u} isOpen={expanded.has(u.id)} onToggle={() => onToggleRow(u.id)}
          onOpenFeed={onOpenFeed} onEditUnit={onEditUnit}
          canEdit={canEdit} canEditUnit={canEditUnit} canEditChecklist={canEditChecklist}
          priorityOpts={priorityOpts}
          stageStatusOpts={stageStatusOpts}
        />
      ))}
    </>
  );
});

function UnitRow({ row, isOpen, onToggle, onOpenFeed, onEditUnit, canEdit, canEditUnit, canEditChecklist, priorityOpts, stageStatusOpts }: any) {
  const u = row as Row;
  const update = useUpdateSiteTracker();
  const [blockerOpen, setBlockerOpen] = useState(false);

  const save = (data: Record<string, unknown>) =>
    update.mutate({ unitId: u.id, data }, {
      onError: (e) => addToast({ title: errMsg(e, 'Could not save'), color: 'danger' }),
    });

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50 align-top">
        <td className="px-3 py-2">
          <div className="flex items-start gap-1.5">
            <button
              type="button" onClick={onToggle} aria-expanded={isOpen}
              aria-label={isOpen ? 'Hide checklist' : 'Show checklist'}
              className="mt-0.5 rounded border border-gray-200 p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            >
              {isOpen ? <FiChevronDown size={12} /> : <FiChevronRight size={12} />}
            </button>
            <div className="min-w-0">
              <Link
                to={`/projects/${u.project.id}/units/${u.id}`}
                className="text-xs font-semibold text-gray-900 hover:text-blue-600 hover:underline"
              >
                Unit {u.unitNumber}
              </Link>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-500">{u.status.replace(/_/g, ' ').toLowerCase()}</span>
                {/* Opens the SITE details — blocker, priority, owners — which
                    is what this board is about. It used to open the unit form (number,
                    type, size, price); that is the asset rather than the work, and is now
                    a secondary button inside the dialog, still behind unit:editBuild.
                    Shown to whoever can edit either one. */}
                {(canEdit || canEditUnit) && (
                  <Tooltip size="sm" content="Edit site details — blocker, priority, owners">
                    <button
                      type="button" aria-label={`Edit site details for unit ${u.unitNumber}`}
                      onClick={() => onEditUnit(u)}
                      className="rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-blue-600"
                    >
                      <FiEdit2 size={11} />
                    </button>
                  </Tooltip>
                )}
                {/* The board's only destructive actions, kept off the row itself and behind
                    a confirmation that counts what goes — see SiteTrackerRowActions. */}
                <SiteTrackerRowActions
                  row={{
                    id: u.id, unitNumber: u.unitNumber,
                    totalStages: u.totalStages, doneStages: u.doneStages,
                    updateCount: u.updateCount,
                    assigneeCount: u.assignees.length,
                    blockerStatus: u.blockerStatus,
                    sitePriority: u.sitePriority,
                  }}
                  canEditChecklist={canEditChecklist}
                  canEditTracker={canEdit}
                />
              </div>
              {/* Who is in there. The API has fetched and permission-gated this all along
                  — `undefined` means "you may not see tenancies", `null` means "there is
                  none" — and nothing rendered it, so the search placeholder promised a
                  tenant you could match but never read. Shown here rather than as an
                  eighth column: the table already scrolls sideways on a phone.
                  `undefined` gets its own line — same "Hidden" language as LatestUpdateCell
                  — so a viewer without lease:view can tell "withheld" from "genuinely no
                  tenant" (which stays silent, same as before, so a tenant-less unit isn't
                  cluttered with a line that has nothing to say). */}
              {u.tenantName ? (
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500">
                  <FiHome size={10} className="shrink-0" />
                  <span className="truncate" title={u.tenantName}>{u.tenantName}</span>
                </div>
              ) : u.tenantName === undefined && (
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500 italic">
                  <FiHome size={10} className="shrink-0" />
                  Tenant hidden
                </div>
              )}
            </div>
          </div>
        </td>

        <td className="px-3 py-2">
          <BlockerCell
            row={u} canEdit={canEdit} isOpen={blockerOpen}
            setOpen={setBlockerOpen} onSave={save} pending={update.isPending}
          />
        </td>

        <td className="px-3 py-2">
          <InlineOption
            value={u.sitePriority} options={priorityOpts} canEdit={canEdit} pending={update.isPending}
            placeholder="Set priority" onChange={(v: string | null) => save({ sitePriority: v })}
          />
        </td>

        <td className="px-3 py-2"><LatestUpdateCell row={u} onOpenFeed={onOpenFeed} /></td>

        <td className="px-3 py-2"><AssigneeCell row={u} canEdit={canEdit} /></td>

        <td className="px-3 py-2">
          {u.pctComplete === null ? (
            <span className="text-[11px] text-gray-500">No checklist</span>
          ) : (
            <div className="flex items-center gap-2">
              <CircularProgress
                size="sm" value={u.pctComplete} color={pctColor(u.pctComplete)}
                aria-label={`${u.pctComplete}% complete`} showValueLabel={false}
              />
              <div>
                <div className="text-xs font-semibold tabular-nums text-gray-900">{u.pctComplete}%</div>
                <div className="text-[11px] tabular-nums text-gray-500">{u.doneStages}/{u.totalStages}</div>
              </div>
            </div>
          )}
        </td>

        <td className="px-3 py-2">
          {u.currentStage ? (
            <>
              <div className="text-xs text-gray-700">{stripStepPrefix(u.currentStage.label)}</div>
              <Chip
                size="sm" variant="flat" className="mt-1 text-[11px]"
                color={chipColor(stageStatusOpts.find((o: any) => o.value === u.currentStage!.status)?.color)}
              >
                {optLabel(stageStatusOpts, u.currentStage.status) ?? u.currentStage.status}
              </Chip>
            </>
          ) : u.totalStages > 0 ? (
            <Chip size="sm" color="success" variant="flat" className="text-[11px]">Complete</Chip>
          ) : (
            <span className="text-[11px] text-gray-500">—</span>
          )}
        </td>
      </tr>

      {isOpen && (
        <tr className="border-b border-gray-200 bg-gray-50">
          <td colSpan={7} className="px-4 py-3">
            <ChecklistPanel row={u} canEdit={canEditChecklist} />
          </td>
        </tr>
      )}
    </>
  );
}

function BlockerCell({ row, canEdit, isOpen, setOpen, onSave, pending }: any) {
  const u = row as Row;
  const [reason, setReason] = useState('');

  if (isOpen) {
    return (
      <div className="space-y-1.5">
        <Input
          size="sm" autoFocus value={reason} onValueChange={setReason}
          placeholder="What is holding it up?" aria-label="Blocker reason"
        />
        <div className="flex gap-1">
          <Button
            size="sm" color="danger" isDisabled={!reason.trim() || pending}
            onPress={() => { onSave({ blockerStatus: 'YES', blockerReason: reason.trim() }); setOpen(false); setReason(''); }}
          >
            Flag
          </Button>
          <Button size="sm" variant="light" onPress={() => { setOpen(false); setReason(''); }}>Cancel</Button>
        </div>
      </div>
    );
  }

  if (u.blockerStatus === 'YES') {
    return (
      <div>
        {/* Age lives on the CHIP, not in the reason below it: the reason is clamped to two
            lines, so a day count appended to it is the first thing to get clipped — and
            "blocked for 11 days" is the half of this cell that actually drives action. */}
        <Chip
          size="sm" color="danger" variant="flat" startContent={<FiAlertTriangle size={11} />}
          className={`text-[11px] ${canEdit && !pending ? 'cursor-pointer' : ''}`}
          onClick={canEdit && !pending ? () => onSave({ blockerStatus: 'NO' }) : undefined}
        >
          Blocked{u.blockerDays !== null && <> · <span className="tabular-nums">{u.blockerDays}d</span></>}
        </Chip>
        <div className="text-[11px] text-gray-600 mt-1 line-clamp-2" title={u.blockerReason ?? undefined}>
          {u.blockerReason}
        </div>
      </div>
    );
  }

  const label = u.blockerStatus === 'NO' ? 'Not blocked' : 'Not assessed';
  return (
    <Chip
      size="sm" variant="flat" color={u.blockerStatus === 'NO' ? 'success' : 'default'}
      className={`text-[11px] ${canEdit && !pending ? 'cursor-pointer' : ''}`}
      onClick={canEdit && !pending ? () => setOpen(true) : undefined}
    >
      {label}
    </Chip>
  );
}

/** A chip that becomes a picker on click — the grid's inline-edit primitive. */
function InlineOption({ value, options, canEdit, placeholder, onChange, pending }: any) {
  const current = options.find((o: any) => o.value === value);
  if (!canEdit) {
    return current
      ? <Chip size="sm" variant="flat" color={chipColor(current.color)} className="text-[11px]">{current.label}</Chip>
      : <span className="text-[11px] text-gray-500">—</span>;
  }
  return (
    <Dropdown isDisabled={pending}>
      <DropdownTrigger>
        {current ? (
          <Chip size="sm" variant="flat" color={chipColor(current.color)} className={`text-[11px] ${pending ? '' : 'cursor-pointer'}`}>
            {current.label}
          </Chip>
        ) : (
          <button type="button" disabled={pending} className="text-[11px] text-gray-500 hover:text-blue-600 underline decoration-dotted disabled:opacity-50">
            {placeholder}
          </button>
        )}
      </DropdownTrigger>
      <DropdownMenu
        aria-label={placeholder}
        onAction={(key) => onChange(key === '__clear' ? null : String(key))}
      >
        {[
          ...options.map((o: any) => (
            <DropdownItem key={o.value} textValue={o.label}>{o.label}</DropdownItem>
          )),
          <DropdownItem key="__clear" textValue="Clear" className="text-gray-500">Clear</DropdownItem>,
        ]}
      </DropdownMenu>
    </Dropdown>
  );
}

function AssigneeCell({ row, canEdit }: { row: Row; canEdit: boolean }) {
  const { data: users = [] } = useAssignableUsers();
  const setAssignees = useSetUnitAssignees();

  const stack = (
    <div className="flex">
      {row.assignees.length === 0 ? (
        <span className="text-[11px] text-gray-500">Unassigned</span>
      ) : row.assignees.map((a, i) => (
        <Tooltip key={a.id} content={a.name ?? a.email} size="sm">
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold ${tintFor(a.id)}`}
            style={{ marginLeft: i === 0 ? 0 : -6 }}
          >
            {initials(a)}
          </span>
        </Tooltip>
      ))}
    </div>
  );

  if (!canEdit) return stack;

  // Multi-assign, one PUT with the whole set — never a write per person. A per-item loop
  // here would hit the API's 10-req/sec throttle and silently drop assignees.
  // Each checkbox toggle fires the full-set PUT (see the comment above) — with no guard,
  // ticking two boxes quickly sends two overlapping requests whose responses can resolve
  // out of order, letting the first click's set win over the second. Disabling the trigger
  // while one is in flight closes that window the same way BlockerCell/InlineOption do.
  return (
    <Dropdown closeOnSelect={false} isDisabled={setAssignees.isPending}>
      <DropdownTrigger>
        <button
          type="button" disabled={setAssignees.isPending}
          className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-gray-100 disabled:opacity-50"
          aria-label="Change owners"
        >
          {stack}
          <FiUsers className="text-gray-400" size={12} />
        </button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label="Site owners"
        selectionMode="multiple"
        selectedKeys={new Set(row.assignees.map((a) => a.id))}
        onSelectionChange={(keys) => {
          if (setAssignees.isPending) return;
          const userIds = Array.from(keys as Set<string>);
          setAssignees.mutate({ unitId: row.id, userIds }, {
            onError: (e) => addToast({ title: errMsg(e, 'Could not update owners'), color: 'danger' }),
          });
        }}
      >
        {users.map((usr: any) => (
          <DropdownItem key={usr.id} textValue={usr.name ?? usr.email}>{usr.name ?? usr.email}</DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
}

/**
 * Bring a unit that already exists onto the tracker.
 *
 * "On the tracker" is not "exists" — a portfolio of ~636 units has a dozen under active
 * construction, and the grid deliberately lists only units with site work recorded against
 * them. That left no way to say "this one is starting now": the only visible button was
 * "New unit", so people used it, and got a second copy of a unit they already had.
 *
 * Seeding stages is what does it — a unit counts as tracked the moment it has a checklist —
 * so this is a stage picker, not a unit form. All of them is the common case and is
 * preselected; a fit-out that only needs four steps unticks the rest. Order is the
 * catalogue's; it is changed afterwards on the checklist, in one place.
 *
 * The stages come from the org-wide `construction_stage` catalogue. They used to come from
 * whatever had already been recorded in the same project, which meant this modal refused to
 * do its job on precisely the projects that most needed it: no stages recorded yet, nothing
 * to seed from, and a suggestion to go and type them into the unit by hand instead.
 */
function TrackExistingUnitModal({ projects, onClose }: { projects: any[]; onClose: () => void }) {
  const [projectId, setProjectId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // `untrackedOnly` asks the API the question this modal actually has, and waits for a
  // property before asking it at all.
  //
  // It used to request every unit the viewer could see and then keep the ones with no
  // stages. That was wrong twice over. Wrong in fact — a unit counts as tracked on FIVE
  // signals, so one with a blocker and no checklist was offered here while already sitting
  // on the grid, and tracking it appended a second checklist to a unit the board was
  // showing. And wrong in cost — the unfiltered call returned 393 rows and 268 KB of
  // stages, leases and daily logs to populate a dropdown that stays disabled until a
  // property is picked.
  const { data, isLoading } = useSiteTracker(
    { projectId, untrackedOnly: 'true' },
    { enabled: !!projectId },
  );
  const untracked: Row[] = useMemo(() => data?.rows ?? [], [data]);
  const unit = untracked.find((r) => r.id === unitId) ?? null;

  // The org-wide stage catalogue, not a list derived from what this project happens to
  // have recorded. Deriving it is why this modal used to dead-end on exactly the units it
  // exists to bring onto the tracker: a project with no stages yet had nothing to seed
  // from, which is every project the feature had not been used on.
  const catalogueQ = useStageCatalogue();
  const template: any[] = Array.isArray(catalogueQ.data) ? catalogueQ.data : [];
  const addStages = useAddUnitConstructionStages();

  // All of them, ticked. Putting a unit on the tracker means giving it the standard list;
  // a fit-out that only needs four steps unticks the rest, which is the rarer case.
  const templateKey = template.map((t: any) => t.value ?? t.label).join('|');
  useEffect(() => {
    setPicked(template.map((t: any) => t.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateKey]);

  const allPicked = template.length > 0 && picked.length === template.length;

  const submit = async () => {
    if (!unit) { setErr('Pick a unit.'); return; }
    if (picked.length === 0) { setErr('Pick at least one stage.'); return; }
    setErr(null);
    try {
      const labels = template.filter((t: any) => picked.includes(t.label)).map((t: any) => t.label);
      const res = await addStages.mutateAsync({ unitId: unit.id, labels });
      addToast({
        title: `${unit.unitNumber} is on the tracker with ${res.added} stage${res.added === 1 ? '' : 's'}`,
        color: 'success',
      });
      onClose();
    } catch (e) {
      setErr(errMsg(e, 'Could not add the unit to the tracker'));
    }
  };

  return (
    <Modal isOpen onOpenChange={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Track a unit</span>
          <span className="text-[11px] font-normal text-gray-500">
            An existing unit that is not on the tracker yet. Nothing new is created.
          </span>
        </ModalHeader>
        <ModalBody className="pb-4 gap-3">
          {err && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>
          )}

          <Select
            size="sm" label="Property" aria-label="Filter by property"
            selectedKeys={projectId ? [projectId] : []}
            onChange={(e) => { setProjectId(e.target.value); setUnitId(''); }}
          >
            {projects.map((p: any) => (
              <SelectItem key={p.id} textValue={p.name}>{p.name}</SelectItem>
            ))}
          </Select>

          <Select
            size="sm" label="Unit" aria-label="Pick a unit to track"
            selectedKeys={unitId ? [unitId] : []}
            onChange={(e) => setUnitId(e.target.value)}
            isDisabled={!projectId || isLoading || untracked.length === 0}
            description={
              !projectId
                ? 'Pick a property first.'
                : isLoading
                  ? 'Loading units…'
                  : untracked.length === 0
                    ? 'Every unit here is already on the tracker.'
                    : `${untracked.length} unit${untracked.length === 1 ? '' : 's'} not on the tracker yet.`
            }
          >
            {untracked.map((r) => (
              <SelectItem key={r.id} textValue={`${r.unitNumber} · ${r.building.name}`}>
                {r.unitNumber} · {r.building.name}
              </SelectItem>
            ))}
          </Select>

          {/* Only reachable if the catalogue itself has been emptied in Admin — it ships
              seeded, so this is a misconfiguration, not the normal first-run state it used
              to be. It says where to fix it rather than sending anyone off to type names
              into a unit by hand. */}
          {unit && template.length === 0 && !catalogueQ.isLoading && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              The stage list is empty, so there is nothing to put on this unit. Add stages in
              Admin → Options → Construction Stage; every unit picks from the same list.
            </p>
          )}

          {unit && template.length > 0 && (
            <div className="rounded-lg border border-gray-200">
              <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
                <span className="text-xs text-gray-500">
                  {picked.length} of {template.length} stages
                </span>
                <Button
                  size="sm" variant="light"
                  onPress={() => setPicked(allPicked ? [] : template.map((t: any) => t.label))}
                >
                  {allPicked ? 'Clear' : 'Select all'}
                </Button>
              </div>
              <div className="max-h-64 overflow-y-auto p-1">
                {template.map((t: any) => (
                  <label
                    key={t.value ?? t.label}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-gray-800 hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-blue-600"
                      checked={picked.includes(t.label)}
                      onChange={() => setPicked((p) => (
                        p.includes(t.label) ? p.filter((x) => x !== t.label) : [...p, t.label]
                      ))}
                    />
                    <span>{t.label}</span>
                  </label>
                ))}
              </div>
              <p className="border-t border-gray-100 px-3 py-2 text-[11px] text-gray-500">
                The standard stage list, in order. Untick anything {unit.building.name} does
                not need; reorder on the checklist once the unit is on the tracker.
              </p>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button
            size="sm" color="primary" onPress={submit}
            isDisabled={!unit || picked.length === 0}
            isLoading={addStages.isPending}
          >
            {/* The count only means something once there is a unit to put them on. The
                whole catalogue is preselected from the start, so without this the button
                announced "Track with 18 stages" before a property had even been chosen. */}
            {unit && picked.length > 0
              ? `Track with ${picked.length} stage${picked.length === 1 ? '' : 's'}`
              : 'Track unit'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ChecklistPanel({ row, canEdit }: { row: Row; canEdit: boolean }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-xs font-semibold text-gray-900">Checklist</h3>
        {/* A unit with no stages used to stop here with "Apply one from the unit page" —
            a dead end on the screen the site team actually works from, and the reason
            adding a stage looked like it needed a new unit. UnitConstructionChecklist has
            always rendered its own empty state with Apply template / Add stage on it; it
            was simply never reached. */}
        {row.stages.length > 0 && (row.template ? (
          <span className="text-[11px] text-gray-600">
            {row.template.name} <span className="tabular-nums">v{row.template.stampedVersion ?? row.template.version}</span>
            {' '}· {row.stages.length} steps · stamped at creation
          </span>
        ) : (
          <Chip size="sm" color="warning" variant="flat" className="text-[11px]">No template recorded</Chip>
        ))}
      </div>
      {/* The full editable subitem grid — the same component the unit page uses, so a stage
          is edited in one place with one set of rules rather than two implementations that
          drift. Was a read-only card grid until 2026-08-27. */}
      <UnitConstructionChecklist
        unitId={row.id}
        buildingId={row.building.id}
        projectId={row.project.id}
        canEdit={canEdit}
      />
    </div>
  );
}
