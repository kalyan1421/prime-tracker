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
import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Button, Input, Select, SelectItem, Chip, Tooltip, addToast,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure,
} from '@heroui/react';
import {
  FiChevronDown, FiChevronRight, FiSearch, FiUsers, FiX, FiMessageSquare,
  FiPlus, FiEdit2, FiHome, FiBell, FiUploadCloud, FiUserPlus, FiList,
} from 'react-icons/fi';
import {
  useSiteTracker, useUpdateSiteTracker, useSetUnitAssignees,
  useProjects, useBuildings, useCustomOptions, useAssignableUsers,
  useStageCatalogue, useAddUnitConstructionStages, useSetSiteGroup,
} from '../hooks/useApi';
import { useCollapsibleGroups } from '../hooks/useCollapsibleGroups';
import { usePagination } from '../hooks/usePagination';
import { useDebounced } from '../hooks/useDebounced';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { LoadingState, ErrorState, EmptyState, PermissionGate, chipColor } from '../components/ui';
import { DailyLogFeed } from '../components/DailyLogFeed';
import { EditUnitModal } from '../components/EditUnitModal';
import { SiteTrackerDetailsModal } from '../components/SiteTrackerDetailsModal';
import { SiteTrackerRowActions } from '../components/SiteTrackerRowActions';
import { UnitConstructionChecklist } from '../components/UnitConstructionChecklist';
import { PeoplePicker } from '../components/PeoplePicker';
import { MondayImportModal } from '../components/MondayImportModal';
import { NextActionCell } from '../components/NextActionCell';
import { StatusCell, TimelinePill, Cell, fillFor, groupColor, type CellOption } from '../components/BoardCells';
import { useAuthStore } from '../store/authStore';
import { errMsg, fmtDateShort } from '../utils/fmt';

interface Assignee { id: string; name: string | null; email: string }
interface Stage { id: string; label: string; status: string; sortOrder: number; inspectionStatus: string | null }
interface Row {
  id: string; unitNumber: string; status: string;
  /** "Unit 103", or "Units 805, 807, 809" when the row is one job across several units. */
  label: string;
  /** The other units the row covers (the lead is the row itself). */
  groupUnits: { id: string; unitNumber: string; status: string }[];
  watching: boolean; watcherCount: number;
  /** Earliest stage start -> latest stage end. Null when no stage carries a date. */
  timeline: { start: string | null; end: string | null } | null;
  project: { id: string; name: string };
  building: { id: string; name: string };
  blockerStatus: string | null; blockerReason: string | null; blockerDays: number | null;
  sitePriority: string | null;
  /** The typed "Next action" (client, 2026-10-16). Null when nobody has written one. */
  nextAction?: { text: string; at: string | null; by: { id: string; name: string | null } | null } | null;
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

export default function SiteTrackerPage() {
  const { hasPermission } = useAuthStore();
  const canEdit = hasPermission('siteTracker:edit');
  // Same gate the row's pencil sat behind — it now guards the secondary route to the
  // unit form rather than the pencil itself.
  const canEditUnit = hasPermission('unit:editBuild');
  // Editing a stage is gated on checklist:edit, not siteTracker:edit — the same permission
  // that governs it on the unit page, so the two screens agree on who may touch a checklist.
  const canEditChecklist = hasPermission('checklist:edit');
  // Founder / Super Admin: the delete key, and the monday import.
  const canManage = hasPermission('siteTracker:manage');
  const importer = useDisclosure();
  // Tailwind's md breakpoint. One layout is MOUNTED, not merely shown, so an expanded row
  // does not build its checklist twice.
  const isPhone = useMediaQuery('(max-width: 767px)');

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
  // "+ Track a unit" at the foot of a property block opens with that property chosen.
  const [trackProjectId, setTrackProjectId] = useState('');
  const openTrack = (pid = '') => { setTrackProjectId(pid); trackUnit.onOpen(); };
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

  // One block per PROPERTY, the way the client's monday board groups its rows (meeting
  // 2026-10-13). The building is shown on each row instead of being a level of its own —
  // a fit-out row like "Units 805, 807, 809" already says which building it is in.
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; project: Row['project']; units: Row[] }>();
    for (const r of pagedRows) {
      const g = map.get(r.project.id);
      if (g) g.units.push(r);
      else map.set(r.project.id, { key: r.project.id, project: r.project, units: [r] });
    }
    return Array.from(map.values()).map((g) => {
      const tracked = g.units.filter((u) => u.pctComplete !== null);
      const count = (pred: (u: Row) => boolean) => g.units.filter(pred).length;
      return {
        ...g,
        blockedCount: count((u) => u.blockerStatus === 'YES'),
        avgPct: tracked.length
          ? Math.round(tracked.reduce((s, u) => s + (u.pctComplete ?? 0), 0) / tracked.length)
          : null,
        // monday's group footer: a colour battery per status column.
        blockerBattery: [
          { value: 'YES', n: count((u) => u.blockerStatus === 'YES') },
          { value: 'NO', n: count((u) => u.blockerStatus === 'NO') },
          { value: '', n: count((u) => !u.blockerStatus) },
        ],
        priorityBattery: [
          { value: 'HIGH', n: count((u) => u.sitePriority === 'HIGH') },
          { value: 'MEDIUM', n: count((u) => u.sitePriority === 'MEDIUM') },
          { value: 'LOW', n: count((u) => u.sitePriority === 'LOW') },
          { value: '', n: count((u) => !u.sitePriority) },
        ],
      };
    });
  }, [pagedRows]);

  const filtersActive = !!(search || projectId || buildingId || blockerStatus || sitePriority);

  // Shared by both layouts — on a phone it used to live inside the table, which is not mounted there.
  const pager = totalPages > 1 ? (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-3 py-2.5">
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
  ) : null;

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
          {canManage && (
            <Button size="sm" variant="flat" startContent={<FiUploadCloud />} onPress={importer.onOpen}>
              Import from monday
            </Button>
          )}
          <PermissionGate permission="checklist:edit">
            <Button size="sm" color="primary" startContent={<FiPlus />} onPress={() => openTrack()}>
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
        <>
        {/* Phones get a card per unit (meeting 2026-10-13: the board is updated on site,
            one-handed). The table needs ~1500px and only scrolled sideways on a phone. */}
        {isPhone ? (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.key} className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-2 px-1">
                <h2 className={`text-sm font-bold uppercase tracking-wide ${groupColor(g.project.id).text}`}>{g.project.name}</h2>
                <span className="text-[11px] text-gray-500">{g.units.length} unit{g.units.length === 1 ? '' : 's'}</span>
                {g.blockedCount > 0 && (
                  <Chip size="sm" color="danger" variant="flat" className="text-[11px]">{g.blockedCount} blocked</Chip>
                )}
              </div>
              {g.units.map((u) => (
                <UnitCard
                  key={u.id} row={u} canEdit={canEdit} canEditChecklist={canEditChecklist}
                  isOpen={expanded.has(u.id)} onToggle={() => toggleRow(u.id)}
                  onOpenFeed={openFeed} onEditUnit={setTrackerUnit} priorityOpts={priorityOpts}
                />
              ))}
            </section>
          ))}
          {pager}
        </div>
        ) : (
        <div className="space-y-6">
          {groups.map((g) => {
            // A block with a blocked unit is forced open — the one thing worth seeing at a
            // glance should never be hidden behind a click.
            const defaultOpen = g.blockedCount > 0 || g.units.length <= 12;
            const open = isExpanded(g.key, defaultOpen);
            return (
              <PropertyBlock
                key={g.key} group={g} open={open} onToggle={() => toggle(g.key, open)}
                expanded={expanded} onToggleRow={toggleRow} onOpenFeed={openFeed}
                onEditUnit={setTrackerUnit} onTrackUnit={() => openTrack(g.project.id)}
                canEdit={canEdit} canEditUnit={canEditUnit} canEditChecklist={canEditChecklist}
                priorityOpts={priorityOpts} stageStatusOpts={stageStatusOpts} canManage={canManage}
              />
            );
          })}
          {pager}
        </div>
        )}
        </>
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
        <TrackExistingUnitModal projects={projects} initialProjectId={trackProjectId} onClose={trackUnit.onClose} />
      )}

      {importer.isOpen && (
        <MondayImportModal projects={projects} onClose={importer.onClose} />
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
    { label: 'Awaiting inspection', value: summary.awaitingInspection, foot: 'stages waiting, scheduled or in progress', tone: 'border-l-blue-500' },
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

const BLOCKER_OPTIONS: CellOption[] = [
  { value: 'YES', label: 'Blocked', color: 'danger' },
  { value: 'NO', label: 'Not blocked', color: 'success' },
];

function BoardTh({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`border-b border-r border-gray-200 bg-white px-2 py-2 text-center text-[11px] font-medium text-gray-600 ${className}`}>
      {children}
    </th>
  );
}

/** monday's group-footer battery: one coloured segment per value, sized by count. */
function Battery({ parts, options }: { parts: { value: string; n: number }[]; options: CellOption[] }) {
  const total = parts.reduce((t, p) => t + p.n, 0) || 1;
  return (
    <div className="flex h-5 w-full overflow-hidden rounded-sm" role="img"
      aria-label={parts.filter((p) => p.n).map((p) => `${p.n} ${options.find((o) => o.value === p.value)?.label ?? 'not set'}`).join(', ')}>
      {parts.filter((p) => p.n > 0).map((p) => (
        <span
          key={p.value || 'none'}
          title={`${options.find((o) => o.value === p.value)?.label ?? 'Not set'}: ${p.n}`}
          className={fillFor(options.find((o) => o.value === p.value) ?? null).split(' ')[0]}
          style={{ width: `${(p.n / total) * 100}%` }}
        />
      ))}
    </div>
  );
}

/**
 * One property, as a block — the client's monday board, one group per property (meeting
 * 2026-10-13): a coloured title, a coloured stripe down the left, its own header row,
 * colour-filled status cells, "+ Track a unit" at the foot, and the status battery under
 * the Blocker and Priority columns.
 */
const PropertyBlock = memo(function PropertyBlock({
  group, open, onToggle, expanded, onToggleRow, onOpenFeed, onEditUnit, onTrackUnit,
  canEdit, canEditUnit, canEditChecklist, priorityOpts, stageStatusOpts, canManage,
}: any) {
  const color = groupColor(group.project.id);
  return (
    <section>
      <div className="mb-1.5 flex flex-wrap items-center gap-3">
        <button
          type="button" onClick={onToggle} aria-expanded={open}
          className={`flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide ${color.text} hover:opacity-80`}
        >
          {open ? <FiChevronDown /> : <FiChevronRight />}
          {group.project.name}
        </button>
        <Link to={`/projects/${group.project.id}/construction`} className="text-[11px] text-gray-500 hover:text-blue-600 hover:underline">
          Open property
        </Link>
        <span className="text-[11px] text-gray-500">
          {group.units.length} unit{group.units.length === 1 ? '' : 's'}
          {group.avgPct !== null && <> · <span className="tabular-nums">{group.avgPct}%</span> avg complete</>}
        </span>
        {group.blockedCount > 0 && (
          <Chip size="sm" color="danger" variant="flat" className="text-[11px]">{group.blockedCount} blocked</Chip>
        )}
      </div>
      {open && (
        <div className="flex overflow-hidden rounded-md border border-gray-200 bg-white">
          <div className={`w-1.5 shrink-0 ${color.stripe}`} aria-hidden />
          <div className="min-w-0 flex-1 overflow-x-auto">
            <table className="w-full min-w-[1440px] border-collapse">
              <thead>
                <tr>
                  <BoardTh className="w-[240px] text-left">Unit</BoardTh>
                  <BoardTh className="w-[120px]">Blocker</BoardTh>
                  <BoardTh className="w-[100px]">Priority</BoardTh>
                  <BoardTh className="min-w-[240px] text-left">Latest update</BoardTh>
                  <BoardTh className="w-[220px] text-left">Next action</BoardTh>
                  <BoardTh className="w-[100px]">Owners</BoardTh>
                  <BoardTh className="w-[140px]">Progress</BoardTh>
                  <BoardTh className="w-[170px]">Current stage</BoardTh>
                  <BoardTh className="w-[140px]">Timeline</BoardTh>
                </tr>
              </thead>
              <tbody>
                {group.units.map((u: Row) => (
                  <UnitRow
                    key={u.id} row={u} isOpen={expanded.has(u.id)} onToggle={() => onToggleRow(u.id)}
                    onOpenFeed={onOpenFeed} onEditUnit={onEditUnit}
                    canEdit={canEdit} canEditUnit={canEditUnit} canEditChecklist={canEditChecklist}
                    priorityOpts={priorityOpts} stageStatusOpts={stageStatusOpts} canManage={canManage}
                  />
                ))}
                {canEditChecklist && (
                  <tr>
                    <td colSpan={9} className="border-b border-gray-200 px-3 py-1.5">
                      <button type="button" onClick={onTrackUnit}
                        className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-blue-600">
                        <FiPlus size={12} /> Track a unit in {group.project.name}
                      </button>
                    </td>
                  </tr>
                )}
                <tr>
                  <td className="border-r border-gray-200" />
                  <td className="border-r border-gray-200 px-2 py-2"><Battery parts={group.blockerBattery} options={BLOCKER_OPTIONS} /></td>
                  <td className="border-r border-gray-200 px-2 py-2"><Battery parts={group.priorityBattery} options={priorityOpts} /></td>
                  <td colSpan={6} />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
});

function UnitRow({ row, isOpen, onToggle, onOpenFeed, onEditUnit, canEdit, canEditUnit, canEditChecklist, priorityOpts, stageStatusOpts, canManage }: any) {
  const u = row as Row;
  const update = useUpdateSiteTracker();
  const save = (data: Record<string, unknown>) =>
    update.mutate({ unitId: u.id, data }, {
      onError: (e) => addToast({ title: errMsg(e, 'Could not save'), color: 'danger' }),
    });
  const current = u.currentStage ? stageStatusOpts.find((o: any) => o.value === u.currentStage!.status) : null;

  return (
    <>
      <tr className="group/row hover:bg-gray-50">
        <Cell className="py-1.5">
          <div className="flex items-start gap-1.5">
            <button
              type="button" onClick={onToggle} aria-expanded={isOpen}
              aria-label={isOpen ? 'Hide checklist' : 'Show checklist'}
              className="mt-0.5 rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            >
              {isOpen ? <FiChevronDown size={13} /> : <FiChevronRight size={13} />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <Link
                  to={`/projects/${u.project.id}/units/${u.id}`}
                  className="truncate text-xs font-semibold text-gray-900 hover:text-blue-600 hover:underline"
                  title={u.groupUnits.length ? 'One job across these units — its checklist and updates live on this row' : undefined}
                >
                  {u.label}
                </Link>
                {u.totalStages > 0 && (
                  <span className="shrink-0 rounded bg-gray-100 px-1 text-[11px] tabular-nums text-gray-600" title="Subitems">
                    {u.totalStages}
                  </span>
                )}
                {u.watching && (
                  <span className="shrink-0 text-blue-600" title="You are watching this unit" aria-label="Watching"><FiBell size={11} /></span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-60 group-hover/row:opacity-100">
                  {(canEdit || canEditUnit) && (
                    <button
                      type="button" aria-label={`Edit site details for ${u.label}`} title="Site details — blocker, priority, owners, units in this job"
                      onClick={() => onEditUnit(u)}
                      className="rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-blue-600"
                    >
                      <FiEdit2 size={11} />
                    </button>
                  )}
                  <SiteTrackerRowActions
                    row={{
                      id: u.id, unitNumber: u.unitNumber,
                      totalStages: u.totalStages, doneStages: u.doneStages,
                      updateCount: u.updateCount, assigneeCount: u.assignees.length,
                      blockerStatus: u.blockerStatus, sitePriority: u.sitePriority,
                      label: u.label, groupCount: u.groupUnits.length, watching: u.watching,
                    }}
                    canEditChecklist={canEditChecklist}
                    canManage={canManage}
                  />
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-gray-500">
                <span>{u.building.name}</span>
                {u.tenantName ? (
                  <span className="inline-flex items-center gap-1 truncate" title={u.tenantName}><FiHome size={10} />{u.tenantName}</span>
                ) : u.tenantName === undefined && (
                  <span className="italic">Tenant hidden</span>
                )}
              </div>
              {u.blockerStatus === 'YES' && u.blockerReason && (
                <p className="mt-0.5 line-clamp-2 text-[11px] text-red-700" title={u.blockerReason}>{u.blockerReason}</p>
              )}
            </div>
          </div>
        </Cell>

        <Cell pad={false}>
          <BlockerCell row={u} canEdit={canEdit} onSave={save} />
        </Cell>

        <Cell pad={false}>
          <StatusCell
            value={u.sitePriority} options={priorityOpts} canEdit={canEdit} allowClear label="Priority"
            onChange={(v) => save({ sitePriority: v })}
          />
        </Cell>

        <Cell className="py-1.5"><LatestUpdateCell row={u} onOpenFeed={onOpenFeed} /></Cell>

        <Cell className="py-1"><NextActionCell row={u} canEdit={canEdit} /></Cell>

        <Cell className="text-center"><div className="flex justify-center"><AssigneeCell row={u} canEdit={canEdit} /></div></Cell>

        <Cell>
          {u.pctComplete === null ? (
            <span className="block text-center text-[11px] text-gray-500">No checklist</span>
          ) : (
            <div className="flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
                <div className={`h-full ${u.pctComplete >= 100 ? 'bg-emerald-600' : 'bg-blue-600'}`} style={{ width: `${u.pctComplete}%` }} />
              </div>
              <span className="w-[60px] text-right text-[11px] tabular-nums text-gray-700">
                {u.pctComplete}% · {u.doneStages}/{u.totalStages}
              </span>
            </div>
          )}
        </Cell>

        <Cell pad={false}>
          {u.currentStage ? (
            <div className="flex h-full flex-col justify-center gap-0.5 px-2 py-1">
              <span className="truncate text-xs text-gray-800">{stripStepPrefix(u.currentStage.label)}</span>
              <span className={`inline-flex w-fit rounded px-1.5 py-0.5 text-[11px] font-medium ${fillFor(current)}`}>
                {current?.label ?? u.currentStage.status}
              </span>
            </div>
          ) : u.totalStages > 0 ? (
            <span className={`flex h-9 items-center justify-center text-xs font-medium ${fillFor({ value: 'DONE', label: 'Complete' })}`}>Complete</span>
          ) : (
            <span className="block text-center text-[11px] text-gray-500">—</span>
          )}
        </Cell>

        <Cell className="text-center">
          {/* Derived from the stages' own dates, so it is set on the subitems below. */}
          <TimelinePill start={u.timeline?.start} end={u.timeline?.end} canEdit={false} onSave={() => {}} />
        </Cell>
      </tr>

      {isOpen && (
        <tr>
          <td colSpan={9} className="border-b border-gray-200 bg-gray-50/60 py-3 pl-8 pr-3">
            <ChecklistPanel row={u} canEdit={canEditChecklist} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The blocker, monday-style: a colour-filled cell (red Blocked / green Not blocked / grey
 * not assessed). Choosing Blocked asks for the reason in place — a blocker nobody explained
 * is one somebody has to chase — and the age rides on the cell.
 */
function BlockerCell({ row, canEdit, onSave }: { row: Row; canEdit: boolean; onSave: (d: Record<string, unknown>) => void }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  if (asking) {
    return (
      <div className="flex flex-col gap-1 p-1">
        <input
          autoFocus value={reason} onChange={(e) => setReason(e.target.value)} aria-label="What is blocking it?"
          placeholder="What is blocking it?"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && reason.trim()) { onSave({ blockerStatus: 'YES', blockerReason: reason.trim() }); setAsking(false); setReason(''); }
            if (e.key === 'Escape') { setAsking(false); setReason(''); }
          }}
          className="h-7 w-full rounded border border-red-300 px-1.5 text-xs text-gray-900 outline-none focus:border-red-600"
        />
        <div className="flex gap-1">
          <button type="button" disabled={!reason.trim()}
            onClick={() => { onSave({ blockerStatus: 'YES', blockerReason: reason.trim() }); setAsking(false); setReason(''); }}
            className="flex-1 rounded bg-red-600 py-0.5 text-[11px] font-medium text-white disabled:opacity-40">Flag</button>
          <button type="button" onClick={() => { setAsking(false); setReason(''); }}
            className="flex-1 rounded border border-gray-300 py-0.5 text-[11px] text-gray-700">Cancel</button>
        </div>
      </div>
    );
  }
  const options = BLOCKER_OPTIONS.map((o) => (
    o.value === 'YES' && row.blockerStatus === 'YES' && row.blockerDays !== null
      ? { ...o, label: `Blocked · ${row.blockerDays}d` }
      : o
  ));
  return (
    <StatusCell
      value={row.blockerStatus} options={options} canEdit={canEdit} allowClear label="Blocker"
      emptyText="Not assessed"
      onChange={(v) => {
        if (v === 'YES') { setAsking(true); return; }
        onSave({ blockerStatus: v });
      }}
    />
  );
}

function AssigneeCell({ row, canEdit }: { row: Row; canEdit: boolean }) {
  const setAssignees = useSetUnitAssignees();
  // Local while picking, saved once the ticking stops: the API takes the WHOLE set per
  // call, and overlapping full-set PUTs can resolve out of order and drop a pick. One save
  // ~half a second after the last tap, with the latest set, closes that window without
  // freezing the picker between taps.
  const [draft, setDraft] = useState<string[] | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const selected = draft ?? row.assignees.map((a) => a.id);

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

  return (
    <PeoplePicker
      mode="multi" label={`Owners of ${row.label}`} selected={selected}
      footnote="Owners, the project's PMs and Founders are notified of every update."
      onChange={(ids) => {
        setDraft(ids);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          setAssignees.mutate({ unitId: row.id, userIds: ids }, {
            onSettled: () => setDraft(null),
            onError: (e) => addToast({ title: errMsg(e, 'Could not update owners'), color: 'danger' }),
          });
        }, 500);
      }}
    >
      <button
        type="button"
        className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-gray-100"
        aria-label={`Change owners of ${row.label}`}
      >
        {stack}
        <FiUsers className="text-gray-500" size={12} />
      </button>
    </PeoplePicker>
  );
}

/**
 * The phone layout of a row. Same data and the same controls that matter on site —
 * post an update, assign yourself, see the blocker — at a size a thumb can hit.
 */
function UnitCard({ row, canEdit, canEditChecklist, isOpen, onToggle, onOpenFeed, onEditUnit, priorityOpts }: {
  row: Row; canEdit: boolean; canEditChecklist: boolean; isOpen: boolean; onToggle: () => void;
  onOpenFeed: (r: Row) => void; onEditUnit: (r: Row) => void; priorityOpts: any[];
}) {
  const me = useAuthStore((st) => st.user?.id);
  const setAssignees = useSetUnitAssignees();
  const priority = priorityOpts.find((o: any) => o.value === row.sitePriority);
  const mine = !!me && row.assignees.some((a) => a.id === me);
  return (
    <article className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/projects/${row.project.id}/units/${row.id}`} className="text-sm font-semibold text-gray-900">
            {row.label}
          </Link>
          {row.tenantName && <p className="truncate text-[11px] text-gray-500">{row.tenantName}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {row.blockerStatus === 'YES' && (
            <Chip size="sm" color="danger" variant="flat" className="text-[11px]">
              Blocked{row.blockerDays !== null ? ` · ${row.blockerDays}d` : ''}
            </Chip>
          )}
          {priority && (
            <Chip size="sm" variant="flat" color={chipColor(priority.color)} className="text-[11px]">{priority.label}</Chip>
          )}
        </div>
      </div>
      {row.blockerStatus === 'YES' && row.blockerReason && (
        <p className="mt-1 text-xs text-red-700">{row.blockerReason}</p>
      )}
      <button type="button" onClick={() => onOpenFeed(row)} className="mt-2 block w-full text-left">
        {row.latestUpdate ? (
          <>
            <p className="line-clamp-3 text-xs text-gray-700">{row.latestUpdate.notes}</p>
            <p className="mt-0.5 text-[11px] text-gray-500">
              {row.latestUpdate.authorName} · {fmtDateShort(row.latestUpdate.logDate)} · {row.updateCount} update{row.updateCount === 1 ? '' : 's'}
            </p>
          </>
        ) : (
          <p className="text-xs text-gray-500">No updates yet</p>
        )}
      </button>
      {(row.nextAction || canEdit) && (
        <div className="mt-2 rounded-md bg-gray-50 px-2 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Next action</span>
          <NextActionCell row={row} canEdit={canEdit} roomy />
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-600">
        <span>{row.pctComplete === null ? 'No checklist' : `${row.pctComplete}% · ${row.doneStages}/${row.totalStages} steps`}</span>
        {row.currentStage && <span className="text-gray-700">{stripStepPrefix(row.currentStage.label)}</span>}
        <TimelinePill start={row.timeline?.start} end={row.timeline?.end} canEdit={false} onSave={() => {}} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <AssigneeCell row={row} canEdit={canEdit} />
        {row.watching && <span className="inline-flex items-center gap-1 text-[11px] text-blue-600"><FiBell size={11} /> Watching</span>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button size="sm" color="primary" startContent={<FiMessageSquare />} onPress={() => onOpenFeed(row)}>
          Post update
        </Button>
        {canEdit && !mine && me ? (
          <Button
            size="sm" variant="flat" startContent={<FiUserPlus />} isLoading={setAssignees.isPending}
            onPress={() => setAssignees.mutate(
              { unitId: row.id, userIds: [...row.assignees.map((a) => a.id), me] },
              {
                onSuccess: () => addToast({ title: `You own ${row.label} now`, color: 'success' }),
                onError: (e) => addToast({ title: errMsg(e, 'Could not assign you'), color: 'danger' }),
              },
            )}
          >
            Assign me
          </Button>
        ) : canEdit ? (
          <Button size="sm" variant="flat" startContent={<FiEdit2 />} onPress={() => onEditUnit(row)}>
            Site details
          </Button>
        ) : <span />}
        {row.totalStages > 0 || canEditChecklist ? (
          <Button size="sm" variant="light" className="col-span-2" startContent={<FiList />} onPress={onToggle}>
            {isOpen ? 'Hide checklist' : 'Checklist'}
          </Button>
        ) : null}
      </div>
      {isOpen && (
        <div className="-mx-3 mt-2 overflow-x-auto border-t border-gray-100 px-3 pt-2">
          <ChecklistPanel row={row} canEdit={canEditChecklist} />
        </div>
      )}
    </article>
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
function TrackExistingUnitModal({ projects, onClose, initialProjectId = '' }: {
  projects: any[]; onClose: () => void; initialProjectId?: string;
}) {
  const [projectId, setProjectId] = useState(initialProjectId);
  const [unitId, setUnitId] = useState('');
  // The rest of a multi-unit job ("Units 805–815"), tracked as ONE row led by `unitId`.
  const [alsoIds, setAlsoIds] = useState<string[]>([]);
  const setGroup = useSetSiteGroup();
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
  const sameBuilding = unit ? untracked.filter((r) => r.building.id === unit.building.id && r.id !== unit.id) : [];

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
      let name = `Unit ${unit.unitNumber}`;
      if (alsoIds.length) {
        const g = await setGroup.mutateAsync({ unitId: unit.id, unitIds: alsoIds });
        name = g.label;
      }
      addToast({
        title: `${name} ${alsoIds.length ? 'are' : 'is'} on the tracker with ${res.added} stage${res.added === 1 ? '' : 's'}`,
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
            onChange={(e) => { setUnitId(e.target.value); setAlsoIds([]); }}
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

          {unit && sameBuilding.length > 0 && (
            <Select
              size="sm" label="Other units in this job (optional)" selectionMode="multiple"
              aria-label="Other units in this job"
              description={`One fit-out across several units in ${unit.building.name} is one row with one checklist — like "Units 805–815" on monday.`}
              selectedKeys={new Set(alsoIds)}
              onSelectionChange={(k) => setAlsoIds(Array.from(k as Set<string>))}
            >
              {sameBuilding.map((r) => (
                <SelectItem key={r.id} textValue={`Unit ${r.unitNumber}`}>Unit {r.unitNumber}</SelectItem>
              ))}
            </Select>
          )}

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
            isLoading={addStages.isPending || setGroup.isPending}
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
