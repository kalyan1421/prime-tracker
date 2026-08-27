import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Button, Input, Select, SelectItem, Textarea, Modal, ModalContent,
    ModalHeader, ModalBody, ModalFooter, Chip, Avatar, Tooltip, Switch,
    Tabs, Tab, useDisclosure, addToast,
} from '@heroui/react';
import {
    FiPlus, FiSearch, FiPaperclip, FiLink, FiBookmark, FiLock,
    FiMessageSquare, FiCalendar, FiChevronRight, FiX,
    FiDownload, FiSend, FiRss, FiAlertCircle,
    FiEdit2, FiTrash2, FiExternalLink, FiActivity,
} from 'react-icons/fi';
import {
    useUpdateBoardPosts, useUpdateBoardPost, useCreateUpdateBoardPost,
    useUpdateUpdateBoardPost, useDeleteUpdateBoardPost,
    useUpdateBoardComments, useCreateUpdateBoardComment, useDeleteUpdateBoardComment,
    useAddUpdateBoardAttachment, useDeleteUpdateBoardAttachment, usePresignedUpload,
    useProjects, useBuildings, useUnits, useAssignableUsers, useCustomOptions,
    useActivityFeed, useActivityActors,
} from '../hooks/useApi';
import { usePagination } from '../hooks/usePagination';
import { Pagination, PermissionGate } from '../components/ui';
import { useAuthStore } from '../store/authStore';
import { errMsg } from '../utils/fmt';

/** Narrower than updateBoard:create (which every role but CLIENT/VIEWER now holds) — matches
 * the backend's UPDATE_BOARD_ADMIN_ROLES for reaching into someone else's post. */
const UPDATE_BOARD_ADMIN_ROLES = ['SUPER_ADMIN', 'FOUNDER'];

/** Who can pin a post, and see it at all when it's "Leadership Only" restricted. Mirrors
 * LEADERSHIP_ROLES on the backend (notifications.service.ts). */
const LEADERSHIP_ROLES = ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE'];

function statusColor(status: string) {
    switch (status) {
        case 'TODO': return 'default';
        case 'IN_PROGRESS': return 'primary';
        case 'BLOCKED': return 'danger';
        case 'DONE': return 'success';
        case 'CANCELLED': return 'danger';
        default: return 'default';
    }
}

function priorityColor(priority: string) {
    switch (priority) {
        case 'LOW': return 'success';
        case 'MEDIUM': return 'warning';
        // HIGH and URGENT used to both be 'danger' — visually identical at a glance.
        // 'secondary' doesn't collide with statusColor() above or this function's own cases.
        case 'HIGH': return 'secondary';
        case 'URGENT': return 'danger';
        default: return 'default';
    }
}

function fmtDate(d?: string | null) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isOverdue(dueDate?: string | null, status?: string) {
    if (!dueDate || status === 'DONE' || status === 'CANCELLED') return false;
    return new Date(dueDate) < new Date();
}

const PAGE_SIZE = 20;

const EMPTY_FORM = {
    title: '',
    body: '',
    status: 'TODO',
    priority: 'MEDIUM',
    dueDate: '',
    pinned: false,
    restricted: false,
    projectId: '',
    buildingId: '',
    unitId: '',
    assigneeIds: [] as string[],
    links: [] as { url: string; label: string }[],
};

export default function UpdatesPage() {
    const { hasPermission } = useAuthStore();
    const { data: statusOpts = [] } = useCustomOptions('task_status');
    const { data: priorityOpts = [] } = useCustomOptions('task_priority');
    const [search, setSearch] = useState('');
    const [filterProject, setFilterProject] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [filterPriority, setFilterPriority] = useState('');
    const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
    const [tab, setTab] = useState('updates');
    const { isOpen: isCreateOpen, onOpen: onCreateOpen, onClose: onCreateClose } = useDisclosure();

    const { data: posts = [], isLoading: loadingPosts } = useUpdateBoardPosts({
        projectId: filterProject || undefined,
        status: filterStatus || undefined,
        priority: filterPriority || undefined,
    });
    const { data: projects = [] } = useProjects();

    const filteredPosts = search
        ? (posts as any[]).filter((p: any) =>
            p.title.toLowerCase().includes(search.toLowerCase()) ||
            (p.body ?? '').toLowerCase().includes(search.toLowerCase())
        )
        : (posts as any[]);

    const { page, setPage, totalPages, paged: pagedPosts, total } = usePagination(
        filteredPosts, PAGE_SIZE, [search, filterProject, filterStatus, filterPriority],
    );

    return (
        <div className="flex flex-col lg:flex-row gap-0 h-full min-h-[100dvh]" style={{ background: 'none' }}>
            {/* Main feed */}
            <div className={`flex flex-col flex-1 min-w-0 transition-all ${selectedPostId ? 'lg:pr-0' : ''}`}>
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Updates</h1>
                        <p className="text-sm text-gray-500 mt-0.5">
                            {tab === 'updates' ? (
                                <>
                                    {total} update{total !== 1 ? 's' : ''} across Prime Tracker
                                    {filterProject || filterStatus || filterPriority ? ' (filtered)' : ''}
                                </>
                            ) : (
                                'Every change made across Prime Tracker, by person'
                            )}
                        </p>
                    </div>
                    {tab === 'updates' && (
                        <PermissionGate permission="updateBoard:create">
                            <Button
                                color="primary"
                                startContent={<FiPlus />}
                                onPress={onCreateOpen}
                                id="new-update-btn"
                                className="self-start sm:self-auto"
                            >
                                New Update
                            </Button>
                        </PermissionGate>
                    )}
                </div>

                <Tabs
                    aria-label="Updates sections"
                    variant="underlined"
                    color="primary"
                    selectedKey={tab}
                    onSelectionChange={(k) => setTab(String(k))}
                    className="mb-4"
                >
                    <Tab key="updates" title="Updates" />
                    <Tab
                        key="activity"
                        title={
                            <span className="flex items-center gap-1.5">
                                <FiActivity /> Activity log
                            </span>
                        }
                    />
                </Tabs>

                {tab === 'updates' && (<>
                {/* Filter bar */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:flex gap-3 mb-5">
                    <Input
                        placeholder="Search updates…"
                        startContent={<FiSearch className="text-gray-400" />}
                        value={search}
                        onValueChange={setSearch}
                        className="w-full sm:w-56"
                        size="sm"
                        id="update-search"
                    />
                    <Select
                        placeholder="All Projects"
                        selectedKeys={filterProject ? [filterProject] : []}
                        onSelectionChange={(keys) => setFilterProject(Array.from(keys)[0] as string ?? '')}
                        className="w-full sm:w-44"
                        size="sm"
                        id="filter-update-project"
                    >
                        {(projects as any[]).map((p: any) => (
                            <SelectItem key={p.id}>{p.name}</SelectItem>
                        ))}
                    </Select>
                    <Select
                        placeholder="Any Status"
                        selectedKeys={filterStatus ? [filterStatus] : []}
                        onSelectionChange={(keys) => setFilterStatus(Array.from(keys)[0] as string ?? '')}
                        className="w-full sm:w-40"
                        size="sm"
                        id="filter-update-status"
                    >
                        {statusOpts.map((o) => (
                            <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
                        ))}
                    </Select>
                    <Select
                        placeholder="Any Priority"
                        selectedKeys={filterPriority ? [filterPriority] : []}
                        onSelectionChange={(keys) => setFilterPriority(Array.from(keys)[0] as string ?? '')}
                        className="w-full sm:w-40"
                        size="sm"
                        id="filter-update-priority"
                    >
                        {priorityOpts.map((o) => (
                            <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
                        ))}
                    </Select>
                    {(filterProject || filterStatus || filterPriority || search) && (
                        <Button
                            size="sm"
                            variant="flat"
                            startContent={<FiX />}
                            onPress={() => {
                                setSearch('');
                                setFilterProject('');
                                setFilterStatus('');
                                setFilterPriority('');
                            }}
                        >
                            Clear
                        </Button>
                    )}
                </div>

                {/* Feed */}
                {loadingPosts ? (
                    <div className="flex items-center justify-center py-20 text-gray-500">
                        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                        <p className="text-sm">Loading updates…</p>
                    </div>
                ) : filteredPosts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                        <FiRss className="text-5xl mb-3 opacity-30" />
                        <p className="font-medium">No updates yet</p>
                        <p className="text-sm mt-1">Company-wide announcements and updates will show up here</p>
                        <PermissionGate permission="updateBoard:create">
                            <Button color="primary" size="sm" className="mt-4" onPress={onCreateOpen} startContent={<FiPlus />}>
                                New Update
                            </Button>
                        </PermissionGate>
                    </div>
                ) : (
                    <>
                        <div className="space-y-2">
                            {pagedPosts.map((post: any) => (
                                <PostRow
                                    key={post.id}
                                    post={post}
                                    isSelected={selectedPostId === post.id}
                                    onSelect={() => setSelectedPostId(post.id === selectedPostId ? null : post.id)}
                                />
                            ))}
                        </div>
                        <Pagination
                            page={page}
                            totalPages={totalPages}
                            total={total}
                            pageSize={PAGE_SIZE}
                            itemLabel="updates"
                            onPrev={() => setPage((p) => p - 1)}
                            onNext={() => setPage((p) => p + 1)}
                        />
                    </>
                )}
                </>)}

                {tab === 'activity' && <ActivityLogTab />}
            </div>

            {/* Side panel — belongs to a post, so it has no meaning on the activity tab. */}
            {tab === 'updates' && selectedPostId && (
                <div className="w-full lg:w-[440px] lg:shrink-0 lg:ml-6 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden flex flex-col mt-4 lg:mt-0 lg:sticky lg:top-6 lg:max-h-[calc(100vh_-_120px)]">
                    <PostSidePanel
                        postId={selectedPostId}
                        onClose={() => setSelectedPostId(null)}
                        onDeleted={() => setSelectedPostId(null)}
                    />
                </div>
            )}

            {/* Create Modal */}
            {isCreateOpen && hasPermission('updateBoard:create') && (
                <PostFormModal
                    isOpen={isCreateOpen}
                    onClose={onCreateClose}
                    mode="create"
                />
            )}
        </div>
    );
}

// ---- Activity Log ----

/** One colour per area, reusing the department convention already used for comments. */
const AREA_COLOR: Record<string, string> = {
    'Sales & Leads': 'bg-blue-100 text-blue-700',
    'Money': 'bg-green-100 text-green-700',
    'Ads & Campaigns': 'bg-purple-100 text-purple-700',
    'Leases': 'bg-teal-100 text-teal-700',
    'Units & Buildings': 'bg-amber-100 text-amber-700',
    'Construction': 'bg-orange-100 text-orange-700',
    'Interior / Fit-Out': 'bg-pink-100 text-pink-700',
    'Documents': 'bg-cyan-100 text-cyan-700',
    'Tasks & Updates': 'bg-indigo-100 text-indigo-700',
    'Administration': 'bg-gray-200 text-gray-700',
};

const ACTIVITY_PAGE_SIZE = 30;

function activityDayLabel(iso: string) {
    const d = new Date(iso);
    const today = new Date();
    const yday = new Date(today);
    yday.setDate(today.getDate() - 1);
    const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    if (same(d, today)) return 'Today';
    if (same(d, yday)) return 'Yesterday';
    return d.toLocaleDateString(undefined, {
        month: 'short', day: 'numeric',
        ...(d.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
    });
}

/**
 * A person's colour, derived from their name so it is the same on every row, in every
 * session, for everyone looking.
 *
 * The avatar was HeroUI's default grey disc, which made the one column the feed exists to
 * be scanned by — who did this — the least distinguishable thing on the row. Colour is the
 * cheapest way to let someone follow one person down the page without reading a word.
 * Hue only; it carries no meaning beyond identity, so it must not borrow the palette the
 * area chips use semantically.
 */
const ACTOR_COLORS = [
    'bg-blue-100 text-blue-700',
    'bg-emerald-100 text-emerald-700',
    'bg-violet-100 text-violet-700',
    'bg-amber-100 text-amber-700',
    'bg-teal-100 text-teal-700',
    'bg-rose-100 text-rose-700',
    'bg-indigo-100 text-indigo-700',
    'bg-cyan-100 text-cyan-700',
];

function actorStyle(name: string) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return ACTOR_COLORS[h % ACTOR_COLORS.length];
}

/** First letters of the first two words — "Demo Founder" reads as DF, not DE. */
function actorInitials(name: string) {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * One line of the feed.
 *
 * The server resolves what was touched into a name and a Building · Project line, so a
 * row reads "Asha updated Unit A-101" rather than "Asha updated a unit". When the record
 * has since been deleted there is nothing left to name and the row falls back to the
 * generic wording — deliberately, rather than showing a blank or a raw id.
 */
function ActivityRow({ event: e, onOpen }: { event: any; onOpen: (to: string) => void }) {
    const time = new Date(e.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    // Three weights, not two: the actor and the record they touched are what the row is
    // for, and the verb between them is connective tissue. Before this the verb and the
    // record name were set identically, so the eye had nothing to land on.
    const what = e.subject ?? (e.summary ?? '').replace(new RegExp(`^${e.verb ?? ''}\\s*`), '');
    const body = (
        <>
            <span
                aria-hidden="true"
                className={`shrink-0 grid h-8 w-8 place-items-center rounded-full text-xs font-semibold ${actorStyle(e.actorName)}`}
            >
                {actorInitials(e.actorName)}
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-sm truncate">
                    <span className="font-medium text-gray-700">{e.actorName}</span>{' '}
                    <span className="text-gray-500">{e.verb ?? e.summary}</span>{' '}
                    {e.verb && <span className="font-medium text-gray-700">{what}</span>}
                </p>
                {e.subjectContext && (
                    <p className="text-[11px] text-gray-500 truncate">{e.subjectContext}</p>
                )}
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${AREA_COLOR[e.area] ?? 'bg-gray-100 text-gray-700'}`}>
                {e.area}
            </span>
            <span className="shrink-0 text-xs text-gray-500 tabular-nums w-[62px] text-right">{time}</span>
        </>
    );

    // Only rows that resolved to a live record get a link; a deleted one has nowhere to go.
    if (!e.href) {
        return <div className="flex items-center gap-3 px-4 py-2.5">{body}</div>;
    }
    return (
        <button
            type="button"
            onClick={() => onOpen(e.href)}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50"
        >
            {body}
        </button>
    );
}

/**
 * The second Updates tab: every change made across the app, by person.
 *
 * Reads the permission-filtered feed, so what a person sees here is exactly what they
 * could have seen by opening each module themselves — a site lead gets units, checklists
 * and draws; finance additionally gets budgets, loans and actuals. Nothing here reveals
 * a value, only that something changed and who changed it; the before/after payloads stay
 * on the admin audit page behind `audit:view`.
 */
function ActivityLogTab() {
    const navigate = useNavigate();
    const [page, setPage] = useState(1);
    const [actorId, setActorId] = useState('');
    const [area, setArea] = useState('');

    const { data, isLoading, error } = useActivityFeed({
        page, limit: ACTIVITY_PAGE_SIZE,
        userId: actorId || undefined,
        area: area || undefined,
    });
    const { data: actors = [] } = useActivityActors();

    const events: any[] = data?.events ?? [];
    const areas: string[] = data?.areas ?? [];
    const total: number = data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));
    const filtersActive = !!(actorId || area);

    // Reset to the first page whenever a filter changes, or a filtered result set shorter
    // than the current page number would render as empty with no explanation.
    const resetTo = (fn: () => void) => { fn(); setPage(1); };

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                <FiAlertCircle className="text-4xl mb-3 opacity-40" />
                <p className="font-medium">Could not load the activity log</p>
            </div>
        );
    }

    // Group consecutive events by calendar day. The feed is already sorted newest-first,
    // so a single pass is enough — no need to bucket and re-sort.
    const days: { label: string; items: any[] }[] = [];
    for (const e of events) {
        const label = activityDayLabel(e.at);
        if (days.length && days[days.length - 1].label === label) days[days.length - 1].items.push(e);
        else days.push({ label, items: [e] });
    }

    return (
        <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:flex gap-3 mb-5">
                <Select
                    size="sm" className="xl:max-w-[220px]" aria-label="Filter by person"
                    placeholder="Anyone" selectedKeys={actorId ? [actorId] : []}
                    onChange={(e) => resetTo(() => setActorId(e.target.value))}
                >
                    {(actors as any[]).map((a: any) => (
                        <SelectItem key={a.value} textValue={a.label}>
                            {a.label} ({a.count})
                        </SelectItem>
                    ))}
                </Select>
                <Select
                    size="sm" className="xl:max-w-[220px]" aria-label="Filter by area"
                    placeholder="All areas" selectedKeys={area ? [area] : []}
                    onChange={(e) => resetTo(() => setArea(e.target.value))}
                >
                    {areas.map((a) => (
                        <SelectItem key={a} textValue={a}>{a}</SelectItem>
                    ))}
                </Select>
                {filtersActive && (
                    <Button
                        size="sm" variant="light" startContent={<FiX />}
                        onPress={() => resetTo(() => { setActorId(''); setArea(''); })}
                    >
                        Clear
                    </Button>
                )}
            </div>

            {isLoading && events.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
                    <p className="text-sm">Loading activity…</p>
                </div>
            ) : events.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                    <FiActivity className="text-5xl mb-3 opacity-30" />
                    <p className="font-medium">No activity to show</p>
                    <p className="text-sm mt-1">
                        {filtersActive
                            ? 'Nothing matches these filters yet.'
                            : 'Changes people make across Prime Tracker will appear here.'}
                    </p>
                </div>
            ) : (
                <>
                    {days.map((day) => (
                        <div key={day.label} className="mb-5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
                                {day.label}
                            </p>
                            <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
                                {day.items.map((e: any) => (
                                    <ActivityRow key={e.id} event={e} onOpen={navigate} />
                                ))}
                            </div>
                        </div>
                    ))}
                    <Pagination
                        page={page}
                        totalPages={totalPages}
                        total={total}
                        pageSize={ACTIVITY_PAGE_SIZE}
                        itemLabel="events"
                        onPrev={() => setPage((p) => p - 1)}
                        onNext={() => setPage((p) => p + 1)}
                    />
                </>
            )}
        </div>
    );
}

// ---- Post Row ----
function PostRow({
    post,
    isSelected,
    onSelect,
}: {
    post: any;
    isSelected: boolean;
    onSelect: () => void;
}) {
    const overdue = isOverdue(post.dueDate, post.status);
    const tagLabel = post.unit ? `Unit ${post.unit.unitNumber}` : post.building ? post.building.name : post.project?.name;

    return (
        <div
            onClick={onSelect}
            className={`flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-all hover:shadow-sm ${isSelected
                ? 'border-blue-300 bg-blue-50/60 shadow-sm'
                : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50'
                }`}
            id={`update-row-${post.id}`}
        >
            {post.pinned && (
                <Tooltip content="Pinned">
                    <span className="shrink-0 inline-flex">
                        <FiBookmark className="text-blue-600 fill-current" />
                    </span>
                </Tooltip>
            )}
            {post.restricted && (
                <Tooltip content="Leadership Only">
                    <span className="shrink-0 inline-flex">
                        <FiLock className="text-amber-600" />
                    </span>
                </Tooltip>
            )}

            <div className="shrink-0">
                <Chip size="sm" color={statusColor(post.status) as any} variant="flat" className="text-xs font-medium min-w-[80px] justify-center">
                    {post.status.replace('_', ' ')}
                </Chip>
            </div>

            <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${post.status === 'DONE' ? 'line-through text-gray-500' : 'text-gray-900'}`}>
                    {post.title}
                </p>
                <div className="flex items-center gap-2 sm:gap-3 mt-0.5 flex-wrap">
                    <span className="text-xs text-gray-500">by {post.createdBy?.name}</span>
                    {tagLabel && <span className="text-xs text-gray-500 truncate max-w-[140px]">{tagLabel}</span>}
                </div>
            </div>

            <div className="flex w-full sm:w-auto items-center gap-3 flex-wrap sm:flex-nowrap">
                <Chip size="sm" color={priorityColor(post.priority) as any} variant="dot" className="text-xs">
                    {post.priority}
                </Chip>
                {post.dueDate && (
                    <div className="flex items-center gap-1 text-xs">
                        <FiCalendar className={overdue ? 'text-red-500' : 'text-gray-400'} />
                        <span className={overdue ? 'text-red-700 font-medium' : 'text-gray-500'}>
                            {fmtDate(post.dueDate)}
                        </span>
                    </div>
                )}
                <div className="flex -space-x-1.5">
                    {(post.assignments ?? []).slice(0, 3).map((a: any) => (
                        <Tooltip key={a.userId} content={a.user?.name}>
                            <Avatar size="sm" name={a.user?.name} src={a.user?.avatarUrl} className="w-6 h-6 text-xs border-2 border-white" />
                        </Tooltip>
                    ))}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    {post._count?.comments > 0 && (
                        <span className="flex items-center gap-0.5"><FiMessageSquare />{post._count.comments}</span>
                    )}
                    {post._count?.attachments > 0 && (
                        <span className="flex items-center gap-0.5"><FiPaperclip />{post._count.attachments}</span>
                    )}
                </div>
            </div>

            <FiChevronRight className="hidden sm:block text-gray-300 shrink-0" />
        </div>
    );
}

// ---- Side Panel ----
function PostSidePanel({
    postId,
    onClose,
    onDeleted,
}: {
    postId: string;
    onClose: () => void;
    onDeleted: () => void;
}) {
    const navigate = useNavigate();
    const { user, hasPermission } = useAuthStore();
    const canComment = hasPermission('updateBoard:create');
    const { data: panelStatusOpts = [] } = useCustomOptions('task_status');
    const { data: post, isLoading: loadingPost } = useUpdateBoardPost(postId);
    const { data: comments = [], isLoading: loadingComments } = useUpdateBoardComments(postId);
    const createComment = useCreateUpdateBoardComment();
    const deleteComment = useDeleteUpdateBoardComment();
    const updatePost = useUpdateUpdateBoardPost();
    const deletePost = useDeleteUpdateBoardPost();
    const addAttachment = useAddUpdateBoardAttachment();
    const deleteAttachment = useDeleteUpdateBoardAttachment();
    const presignedUpload = usePresignedUpload();

    const [commentText, setCommentText] = useState('');
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    if (loadingPost) {
        return <div className="flex items-center justify-center h-40 text-gray-500 text-sm">Loading…</div>;
    }
    if (!post) {
        return <div className="flex items-center justify-center h-40 text-gray-500 text-sm">Update not found.</div>;
    }

    const canManage = post.createdById === user?.id || UPDATE_BOARD_ADMIN_ROLES.includes(user?.role ?? '');

    async function handleDelete() {
        try {
            await deletePost.mutateAsync(post.id);
            addToast({ title: 'Update deleted', color: 'success' });
            onDeleted();
        } catch (e) {
            addToast({ title: errMsg(e, 'Failed to delete update'), color: 'danger' });
        }
    }

    async function postComment() {
        if (!commentText.trim()) return;
        try {
            await createComment.mutateAsync({ postId, content: commentText.trim() });
            setCommentText('');
        } catch (e) {
            addToast({ title: errMsg(e, 'Failed to post comment'), color: 'danger' });
        }
    }

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const { storagePath, filename } = await presignedUpload.mutateAsync({
                file,
                projectId: post.projectId ?? undefined,
                category: 'update-board',
            });
            await addAttachment.mutateAsync({ postId, storagePath, fileName: filename || file.name, mimeType: file.type });
            addToast({ title: 'File attached', color: 'success' });
        } catch (e) {
            addToast({ title: errMsg(e, 'Upload failed'), color: 'danger' });
        } finally {
            setUploading(false);
        }
        e.target.value = '';
    }

    async function handleStatusChange(newStatus: string) {
        try {
            await updatePost.mutateAsync({ id: post.id, data: { status: newStatus } });
        } catch (e) {
            addToast({ title: errMsg(e, 'Failed to update status'), color: 'danger' });
        }
    }

    const overdue = isOverdue(post.dueDate, post.status);
    const links: { url: string; label: string }[] = Array.isArray(post.links) ? post.links : [];

    return (
        <div className="flex flex-col h-full">
            {/* Panel header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100">
                <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-1.5">
                        {post.pinned && <FiBookmark className="text-blue-600 fill-current shrink-0" />}
                        {post.restricted && (
                            <Tooltip content="Leadership Only — hidden from everyone except leadership, the creator, and tagged people">
                                <span className="inline-flex shrink-0">
                                    <FiLock className="text-amber-600" />
                                </span>
                            </Tooltip>
                        )}
                        <p className={`font-semibold text-gray-900 text-base leading-tight ${post.status === 'DONE' ? 'line-through text-gray-500' : ''}`}>
                            {post.title}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {panelStatusOpts.map((o) => (
                            <button
                                key={o.value}
                                onClick={() => canManage && handleStatusChange(o.value)}
                                disabled={!canManage}
                                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${post.status === o.value
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'border-gray-200 text-gray-600 hover:border-gray-400'
                                    } ${!canManage ? 'cursor-not-allowed opacity-60' : ''}`}
                            >
                                {o.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {canManage && (
                        <Tooltip content="Edit update">
                            <Button isIconOnly size="sm" variant="light" onPress={() => setIsEditOpen(true)} id="edit-update-btn">
                                <FiEdit2 className="text-gray-500" />
                            </Button>
                        </Tooltip>
                    )}
                    {canManage && (
                        <Tooltip content="Delete update" color="danger">
                            <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => setConfirmDelete(true)} id="delete-update-btn">
                                <FiTrash2 />
                            </Button>
                        </Tooltip>
                    )}
                    <Button isIconOnly size="sm" variant="light" onPress={onClose}>
                        <FiX className="text-gray-400" />
                    </Button>
                </div>
            </div>

            {/* Panel body — scrollable */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                <div className="space-y-3">
                    {post.body && <p className="text-sm text-gray-600 whitespace-pre-wrap">{post.body}</p>}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <div className="flex flex-col gap-0.5">
                            <span className="text-xs text-gray-600 uppercase tracking-wide">Priority</span>
                            <Chip size="sm" color={priorityColor(post.priority) as any} variant="flat">
                                {(post.priority === 'URGENT' || post.priority === 'HIGH') && <FiAlertCircle className="inline mr-1" />}
                                {post.priority}
                            </Chip>
                        </div>
                        {post.dueDate && (
                            <div className="flex flex-col gap-0.5">
                                <span className="text-xs text-gray-600 uppercase tracking-wide">Due Date</span>
                                <span className={`text-sm font-medium flex items-center gap-1 ${overdue ? 'text-red-700' : 'text-gray-700'}`}>
                                    <FiCalendar />
                                    {fmtDate(post.dueDate)}
                                    {overdue && <span className="text-xs text-red-700 ml-1">Overdue</span>}
                                </span>
                            </div>
                        )}
                        <div className="flex flex-col gap-0.5">
                            <span className="text-xs text-gray-600 uppercase tracking-wide">Posted By</span>
                            <span className="text-sm text-gray-700">{post.createdBy?.name}</span>
                        </div>
                        {post.project && (
                            <div className="flex flex-col gap-0.5">
                                <span className="text-xs text-gray-600 uppercase tracking-wide">Project</span>
                                <button
                                    className="text-sm text-blue-600 hover:underline text-left"
                                    onClick={() => navigate(`/projects/${post.project.id}`)}
                                >
                                    {post.project.name}
                                </button>
                            </div>
                        )}
                        {post.building && post.projectId && (
                            <div className="flex flex-col gap-0.5">
                                <span className="text-xs text-gray-600 uppercase tracking-wide">Building</span>
                                <button
                                    className="text-sm text-blue-600 hover:underline text-left"
                                    onClick={() => navigate(`/projects/${post.projectId}/buildings/${post.building.id}`)}
                                >
                                    {post.building.name}
                                </button>
                            </div>
                        )}
                        {post.unit && post.projectId && (
                            <div className="flex flex-col gap-0.5">
                                <span className="text-xs text-gray-600 uppercase tracking-wide">Unit</span>
                                <button
                                    className="text-sm text-blue-600 hover:underline text-left"
                                    onClick={() => navigate(`/projects/${post.projectId}/units/${post.unit.id}`)}
                                >
                                    Unit {post.unit.unitNumber}
                                </button>
                            </div>
                        )}
                    </div>

                    {(post.assignments ?? []).length > 0 && (
                        <div>
                            <span className="text-xs text-gray-600 uppercase tracking-wide">Tagged</span>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                                {post.assignments.map((a: any) => (
                                    <div key={a.userId} className="flex items-center gap-1.5 bg-gray-50 border border-gray-100 rounded-full pl-1 pr-2.5 py-0.5">
                                        <Avatar size="sm" name={a.user?.name} src={a.user?.avatarUrl} className="w-5 h-5 text-xs" />
                                        <span className="text-xs text-gray-700">{a.user?.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {links.length > 0 && (
                        <div>
                            <span className="text-xs text-gray-600 uppercase tracking-wide">Links</span>
                            <div className="space-y-1 mt-1">
                                {links.map((l, i) => (
                                    <a
                                        key={i}
                                        href={l.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
                                    >
                                        <FiLink className="shrink-0" />
                                        <span className="truncate">{l.label || l.url}</span>
                                        <FiExternalLink className="shrink-0 text-xs" />
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Attachments */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                            Attachments {post.attachments?.length > 0 && `(${post.attachments.length})`}
                        </span>
                        {canComment && (
                            <>
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="text-xs text-blue-600 hover:underline flex items-center gap-1 disabled:opacity-50"
                                    disabled={uploading}
                                    id="attach-update-file-btn"
                                >
                                    <FiPaperclip /> {uploading ? 'Uploading…' : 'Attach file'}
                                </button>
                                <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} id="update-file-input" />
                            </>
                        )}
                    </div>
                    {post.attachments?.length > 0 ? (
                        <div className="space-y-1.5">
                            {post.attachments.map((att: any) => (
                                <div key={att.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 group">
                                    <FiPaperclip className="text-gray-400 shrink-0" />
                                    <span className="text-sm text-gray-700 flex-1 truncate">{att.fileName}</span>
                                    {att.url && (
                                        <a href={att.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-700">
                                            <FiDownload />
                                        </a>
                                    )}
                                    {(att.uploadedById === user?.id || UPDATE_BOARD_ADMIN_ROLES.includes(user?.role ?? '')) && (
                                        <button
                                            onClick={() => deleteAttachment.mutate({ postId, attachmentId: att.id })}
                                            className="text-red-400 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <FiX />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs text-gray-600 py-2">No attachments yet</p>
                    )}
                </div>

                <hr className="border-gray-100" />

                {/* Comments — the chat */}
                <div>
                    <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3 block">
                        Chat {(comments as any[]).length > 0 && `(${(comments as any[]).length})`}
                    </span>
                    {loadingComments ? (
                        <p className="text-xs text-gray-600">Loading…</p>
                    ) : (comments as any[]).length === 0 ? (
                        <p className="text-xs text-gray-600 py-1">No replies yet. Start the conversation.</p>
                    ) : (
                        <div className="space-y-3">
                            {(comments as any[]).map((c: any) => (
                                <div key={c.id} className="flex gap-2.5 group">
                                    <Avatar size="sm" name={c.author?.name} src={c.author?.avatarUrl} className="w-7 h-7 text-xs shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-gray-700">{c.author?.name}</span>
                                            <span className="text-xs text-gray-600">
                                                {new Date(c.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                            </span>
                                            {(c.authorId === user?.id || UPDATE_BOARD_ADMIN_ROLES.includes(user?.role ?? '')) && (
                                                <button
                                                    onClick={() => deleteComment.mutate({ postId, commentId: c.id })}
                                                    className="text-red-400 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity ml-auto"
                                                >
                                                    <FiX className="text-xs" />
                                                </button>
                                            )}
                                        </div>
                                        <p className="text-sm text-gray-600 mt-0.5 whitespace-pre-wrap">{c.content}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Comment input — sticky bottom */}
            {canComment && (
                <div className="border-t border-gray-100 px-4 py-3 bg-white">
                    <div className="flex gap-2">
                        <Avatar size="sm" name={user?.name} src={user?.avatarUrl} className="w-7 h-7 text-xs shrink-0 mt-1" />
                        <div className="flex-1 flex gap-2">
                            <Textarea
                                placeholder="Reply…"
                                value={commentText}
                                onValueChange={setCommentText}
                                minRows={1}
                                maxRows={4}
                                size="sm"
                                className="flex-1"
                                id="update-comment-input"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) postComment();
                                }}
                            />
                            <Button
                                isIconOnly
                                color="primary"
                                size="sm"
                                onPress={postComment}
                                isLoading={createComment.isPending}
                                isDisabled={!commentText.trim()}
                                id="post-update-comment-btn"
                            >
                                <FiSend />
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {isEditOpen && (
                <PostFormModal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} mode="edit" post={post} />
            )}

            <Modal isOpen={confirmDelete} onClose={() => setConfirmDelete(false)} size="sm">
                <ModalContent>
                    <ModalHeader>Delete Update</ModalHeader>
                    <ModalBody>
                        <p className="text-sm text-gray-600">
                            Are you sure you want to delete "<strong>{post.title}</strong>"? This cannot be undone.
                        </p>
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="flat" onPress={() => setConfirmDelete(false)}>Cancel</Button>
                        <Button color="danger" onPress={handleDelete} isLoading={deletePost.isPending} id="confirm-delete-update-btn">
                            Delete
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </div>
    );
}

// ---- Create / Edit Modal ----
function PostFormModal({
    isOpen,
    onClose,
    mode,
    post,
}: {
    isOpen: boolean;
    onClose: () => void;
    mode: 'create' | 'edit';
    post?: any;
}) {
    const { user } = useAuthStore();
    const canPin = LEADERSHIP_ROLES.includes(user?.role ?? '');
    const createPost = useCreateUpdateBoardPost();
    const updatePost = useUpdateUpdateBoardPost();
    const presignedUpload = usePresignedUpload();
    const addAttachment = useAddUpdateBoardAttachment();
    const deleteAttachment = useDeleteUpdateBoardAttachment();
    const { data: statusOpts = [] } = useCustomOptions('task_status');
    const { data: priorityOpts = [] } = useCustomOptions('task_priority');
    const { data: projects = [] } = useProjects();
    const { data: assignableUsers = [] } = useAssignableUsers();

    // Existing attachments (edit mode only — a create post has none yet) and files picked in
    // this session but not uploaded yet. Pending files are uploaded AFTER the post exists
    // (create) or immediately (edit, since the postId is already known) — an attachment
    // can't be created without a postId to hang off.
    const [existingAttachments, setExistingAttachments] = useState<any[]>(
        mode === 'edit' && post?.attachments ? post.attachments : [],
    );
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [uploadingNow, setUploadingNow] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [form, setForm] = useState<typeof EMPTY_FORM>(() => mode === 'edit' && post
        ? {
            title: post.title,
            body: post.body ?? '',
            status: post.status,
            priority: post.priority,
            dueDate: post.dueDate ? post.dueDate.slice(0, 10) : '',
            pinned: !!post.pinned,
            restricted: !!post.restricted,
            projectId: post.projectId ?? '',
            buildingId: post.buildingId ?? '',
            unitId: post.unitId ?? '',
            assigneeIds: (post.assignments ?? []).map((a: any) => a.userId as string),
            links: (Array.isArray(post.links) ? post.links : []) as { url: string; label: string }[],
        }
        : EMPTY_FORM);

    const { data: buildings = [] } = useBuildings(form.projectId);
    const { data: units = [] } = useUnits(form.projectId);

    const set = (field: string) => (e: any) =>
        setForm((f) => ({ ...f, [field]: e.target?.value ?? e }));

    const filteredUnits = form.buildingId
        ? (units as any[]).filter((u: any) => u.buildingId === form.buildingId)
        : (units as any[]);

    function updateLink(i: number, patch: Partial<{ url: string; label: string }>) {
        setForm((f) => ({ ...f, links: f.links.map((l, idx) => idx === i ? { ...l, ...patch } : l) }));
    }
    function removeLink(i: number) {
        setForm((f) => ({ ...f, links: f.links.filter((_, idx) => idx !== i) }));
    }
    function addLink() {
        setForm((f) => ({ ...f, links: [...f.links, { url: '', label: '' }] }));
    }

    function queueFiles(fileList: FileList | null) {
        if (!fileList?.length) return;
        setPendingFiles((f) => [...f, ...Array.from(fileList)]);
    }
    function removePendingFile(i: number) {
        setPendingFiles((f) => f.filter((_, idx) => idx !== i));
    }
    async function removeExistingAttachment(attachmentId: string) {
        try {
            await deleteAttachment.mutateAsync({ postId: post.id, attachmentId });
            setExistingAttachments((a) => a.filter((att) => att.id !== attachmentId));
        } catch (e) {
            addToast({ title: errMsg(e, 'Failed to remove attachment'), color: 'danger' });
        }
    }

    /** Upload+attach every queued file to a now-existing post. Never fatal — one failed
     * upload must not make the whole save look like it failed when the post itself saved
     * fine; each failure gets its own toast instead. */
    async function uploadPendingFiles(postId: string) {
        if (pendingFiles.length === 0) return;
        setUploadingNow(true);
        for (const file of pendingFiles) {
            try {
                const { storagePath, filename } = await presignedUpload.mutateAsync({
                    file,
                    projectId: form.projectId || undefined,
                    category: 'update-board',
                });
                await addAttachment.mutateAsync({ postId, storagePath, fileName: filename || file.name, mimeType: file.type });
            } catch (e) {
                addToast({ title: errMsg(e, `Failed to attach "${file.name}"`), color: 'danger' });
            }
        }
        setUploadingNow(false);
        setPendingFiles([]);
    }

    const saving = createPost.isPending || updatePost.isPending || uploadingNow;

    async function handleSubmit() {
        if (!form.title.trim()) {
            addToast({ title: 'Title is required', color: 'danger' });
            return;
        }
        const linkUrls = form.links.map((l) => l.url.trim()).filter(Boolean);
        const badLink = linkUrls.find((u) => !/^https?:\/\//i.test(u));
        if (badLink) {
            addToast({ title: `Link "${badLink}" must start with http:// or https://`, color: 'danger' });
            return;
        }
        const payload = {
            title: form.title.trim(),
            body: form.body.trim() || undefined,
            status: form.status,
            priority: form.priority,
            dueDate: form.dueDate || undefined,
            pinned: form.pinned,
            restricted: form.restricted,
            projectId: form.projectId || undefined,
            buildingId: form.buildingId || undefined,
            unitId: form.unitId || undefined,
            assigneeIds: form.assigneeIds,
            links: form.links.filter((l) => l.url.trim()),
        };
        try {
            let postId: string;
            if (mode === 'create') {
                const created = await createPost.mutateAsync(payload);
                postId = created.id;
                addToast({ title: 'Update posted!', color: 'success' });
            } else {
                postId = post.id;
                await updatePost.mutateAsync({
                    id: post.id,
                    data: {
                        ...payload,
                        projectId: form.projectId || null,
                        buildingId: form.buildingId || null,
                        unitId: form.unitId || null,
                    },
                });
                addToast({ title: 'Update saved', color: 'success' });
            }
            await uploadPendingFiles(postId);
            onClose();
        } catch (e) {
            addToast({ title: errMsg(e, mode === 'create' ? 'Failed to post update' : 'Failed to save update'), color: 'danger' });
        }
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
            <ModalContent>
                <ModalHeader>
                    <div className="flex items-center gap-2">
                        <FiRss className="text-blue-500" />
                        {mode === 'create' ? 'New Update' : 'Edit Update'}
                    </div>
                </ModalHeader>
                <ModalBody className="space-y-4 pb-2">
                    <Input
                        label="Title"
                        placeholder="What's the update?"
                        value={form.title}
                        onChange={set('title')}
                        isRequired
                        id="update-form-title"
                    />
                    <Textarea
                        label="Details"
                        placeholder="Add context, details or notes…"
                        value={form.body}
                        onChange={set('body')}
                        minRows={2}
                        id="update-form-body"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Select
                            label="Status"
                            selectedKeys={[form.status]}
                            onSelectionChange={(keys) => setForm((f) => ({ ...f, status: Array.from(keys)[0] as string ?? 'TODO' }))}
                            id="update-form-status"
                        >
                            {statusOpts.map((o) => <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>)}
                        </Select>
                        <Select
                            label="Priority"
                            selectedKeys={[form.priority]}
                            onSelectionChange={(keys) => setForm((f) => ({ ...f, priority: Array.from(keys)[0] as string ?? 'MEDIUM' }))}
                            id="update-form-priority"
                        >
                            {priorityOpts.map((o) => <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>)}
                        </Select>
                        <Input
                            type="date"
                            label="Due Date (optional)"
                            value={form.dueDate}
                            onChange={set('dueDate')}
                            id="update-form-due"
                        />
                    </div>

                    {canPin && (
                        <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                            <div>
                                <p className="text-sm font-medium text-gray-800">Pin to top</p>
                                <p className="text-xs text-gray-600">Keeps this update at the top of the feed</p>
                            </div>
                            <Switch
                                size="sm"
                                isSelected={form.pinned}
                                onValueChange={(v) => setForm((f) => ({ ...f, pinned: v }))}
                                id="update-form-pinned"
                            >
                                {/* HeroUI's Switch wires its aria-labelledby to its own children, not to a
                                    plain aria-label prop (that lands on the wrapper <label>, not the input) —
                                    an sr-only child is the reliable way to give it an accessible name without
                                    visually duplicating the "Pin to top" text already shown beside it. */}
                                <span className="sr-only">Pin to top — keeps this update at the top of the feed</span>
                            </Switch>
                        </div>
                    )}

                    <div className="flex items-center justify-between rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
                        <div>
                            <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
                                <FiLock className="text-amber-600" /> Leadership Only
                            </p>
                            <p className="text-xs text-gray-600">
                                Hides this update from everyone except Super Admin, Founder, Executive, and anyone you tag on it
                            </p>
                        </div>
                        <Switch
                            size="sm"
                            isSelected={form.restricted}
                            onValueChange={(v) => setForm((f) => ({ ...f, restricted: v }))}
                            id="update-form-restricted"
                        >
                            <span className="sr-only">
                                Leadership Only — hides this update from everyone except Super Admin, Founder, Executive, and anyone you tag on it
                            </span>
                        </Switch>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Select
                            label="Project (optional)"
                            selectedKeys={form.projectId ? [form.projectId] : []}
                            onSelectionChange={(keys) => {
                                const v = Array.from(keys)[0] as string ?? '';
                                setForm((f) => ({ ...f, projectId: v, buildingId: '', unitId: '' }));
                            }}
                            id="update-form-project"
                        >
                            {(projects as any[]).map((p: any) => <SelectItem key={p.id}>{p.name}</SelectItem>)}
                        </Select>
                        <Select
                            label="Building (optional)"
                            selectedKeys={form.buildingId ? [form.buildingId] : []}
                            onSelectionChange={(keys) => {
                                const v = Array.from(keys)[0] as string ?? '';
                                setForm((f) => ({ ...f, buildingId: v, unitId: '' }));
                            }}
                            isDisabled={!form.projectId}
                            id="update-form-building"
                        >
                            {(buildings as any[]).map((b: any) => <SelectItem key={b.id}>{b.name}</SelectItem>)}
                        </Select>
                        <Select
                            label="Unit (optional)"
                            selectedKeys={form.unitId ? [form.unitId] : []}
                            onSelectionChange={(keys) => setForm((f) => ({ ...f, unitId: Array.from(keys)[0] as string ?? '' }))}
                            isDisabled={!form.projectId}
                            id="update-form-unit"
                        >
                            {filteredUnits.map((u: any) => <SelectItem key={u.id}>Unit {u.unitNumber}</SelectItem>)}
                        </Select>
                    </div>

                    <Select
                        label="Tag People"
                        selectionMode="multiple"
                        description="Everyone tagged is notified"
                        selectedKeys={new Set(form.assigneeIds)}
                        onSelectionChange={(keys) => setForm((f) => ({ ...f, assigneeIds: [...keys].map(String) }))}
                        id="update-form-assignees"
                    >
                        {(assignableUsers as any[]).map((u: any) => (
                            <SelectItem key={u.id} textValue={u.name || u.email}>{u.name || u.email}</SelectItem>
                        ))}
                    </Select>

                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-sm text-gray-700">Links</span>
                            <button type="button" onClick={addLink} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                                <FiPlus /> Add link
                            </button>
                        </div>
                        <div className="space-y-2">
                            {form.links.map((l, i) => (
                                <div key={i} className="flex gap-2">
                                    <Input
                                        placeholder="https://…"
                                        size="sm"
                                        value={l.url}
                                        onValueChange={(v) => updateLink(i, { url: v })}
                                        className="flex-[2]"
                                    />
                                    <Input
                                        placeholder="Label (optional)"
                                        size="sm"
                                        value={l.label}
                                        onValueChange={(v) => updateLink(i, { label: v })}
                                        className="flex-1"
                                    />
                                    <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => removeLink(i)}>
                                        <FiX />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-sm text-gray-700">Attachments</span>
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                            >
                                <FiPaperclip /> Add images / documents
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                className="hidden"
                                onChange={(e) => { queueFiles(e.target.files); e.target.value = ''; }}
                                id="update-form-file-input"
                            />
                        </div>
                        {existingAttachments.length > 0 || pendingFiles.length > 0 ? (
                            <div className="space-y-1.5">
                                {existingAttachments.map((att) => (
                                    <div key={att.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
                                        <FiPaperclip className="text-gray-400 shrink-0" />
                                        <span className="text-sm text-gray-700 flex-1 truncate">{att.fileName}</span>
                                        {att.url && (
                                            <a href={att.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-700">
                                                <FiDownload />
                                            </a>
                                        )}
                                        <button type="button" onClick={() => removeExistingAttachment(att.id)} className="text-red-400 hover:text-red-700">
                                            <FiX />
                                        </button>
                                    </div>
                                ))}
                                {pendingFiles.map((file, i) => (
                                    <div key={i} className="flex items-center gap-2 px-3 py-2 bg-blue-50/60 rounded-lg border border-blue-100">
                                        <FiPaperclip className="text-blue-500 shrink-0" />
                                        <span className="text-sm text-gray-700 flex-1 truncate">{file.name}</span>
                                        <span className="text-xs text-gray-500 shrink-0">
                                            {uploadingNow ? 'Uploading…' : 'Not uploaded yet'}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => removePendingFile(i)}
                                            disabled={uploadingNow}
                                            className="text-red-400 hover:text-red-700 disabled:opacity-40"
                                        >
                                            <FiX />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-gray-600">No images or documents attached</p>
                        )}
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button variant="flat" onPress={onClose}>Cancel</Button>
                    <Button color="primary" onPress={handleSubmit} isLoading={saving} id="update-form-submit-btn">
                        {mode === 'create' ? 'Post Update' : 'Save Changes'}
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
}
