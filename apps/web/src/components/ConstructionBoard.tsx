/**
 * ConstructionBoard — the project's site/fit-out board.
 *
 * Modelled on the Monday board Prime runs today (PRIME LEWISVILLE): one row per work
 * item, grouped by building, with Person / Status / Priority / Title / Updates.
 *
 * Two things it is NOT:
 *
 *  - It is not a Monday replacement. No custom columns, no formulas, no automations,
 *    no drag ordering. Replacing one board is the goal; replacing the tool is not.
 *  - A multi-unit row ("UNITS 402,403,404") is NOT a combined unit. Those units stay
 *    separate and keep their own leases, sales and rent history — only the WORK is
 *    shared. UnitsService.combine() is a different operation entirely and must never be
 *    reached from here.
 *
 * Status and priority chips read their label and colour from CustomOption, so the client
 * can relabel "In Progress" to "Working on it" without a deploy. The stored slugs stay
 * canonical so filters and reports never have to know the wording.
 */

import { useMemo, useRef, useState } from 'react';
import {
  Button, Chip, Input, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Select, SelectItem, Textarea, Tooltip, addToast,
} from '@heroui/react';
import {
  FiPlus, FiCalendar, FiUser, FiLayers, FiTrash2, FiEdit2, FiCamera, FiHome,
  FiChevronDown, FiChevronRight,
} from 'react-icons/fi';
import {
  useTasks, useCreateTask, useUpdateTask, useDeleteTask,
  useTaskUpdates, useAddTaskUpdate, useDeleteTaskUpdate, useAddTaskUpdatePhoto,
  useBuildings, useUnits, useUsers, useCustomOptions, usePresignedUpload,
} from '../hooks/useApi';
import { useCollapsibleGroups } from '../hooks/useCollapsibleGroups';
import { errMsg, fmtDate } from '../utils/fmt';
import { LoadingState, ErrorState, EmptyState, chipColor } from './ui';

const KIND = 'CONSTRUCTION';

interface OptionLike { value: string; label: string; color?: string | null }

function useOptionLookup(category: string) {
  const { data } = useCustomOptions(category);
  return useMemo(() => {
    const list: OptionLike[] = Array.isArray(data) ? data : [];
    return {
      list,
      of: (value?: string | null) =>
        list.find((o) => o.value === value) ?? { value: value ?? '', label: value ?? '—', color: null },
    };
  }, [data]);
}

/**
 * Everybody holding the item, not just the first.
 *
 * Reads the join table and falls back to the legacy scalar, so rows written before
 * multi-assignee existed still show their owner.
 */
function peopleLabel(task: any): string | null {
  const names = (task.assignees ?? [])
    .map((a: any) => a.user?.name || a.user?.email)
    .filter(Boolean);
  if (names.length) return names.join(', ');
  return task.assignedUser?.name ?? null;
}

/** Every building the item touches — the group header shows one, this shows the rest. */
function buildingsLabel(task: any): string | null {
  const names = (task.buildings ?? [])
    .map((tb: any) => tb.building?.name)
    .filter(Boolean);
  if (names.length) return names.join(', ');
  return task.building?.name ?? null;
}

/** "402, 403, 404" — the label that made a multi-unit item legible on the old board. */
function unitLabel(task: any): string {
  const nums = (task.units ?? [])
    .map((tu: any) => tu.unit?.unitNumber)
    .filter(Boolean);
  // A building-wide item names its buildings instead. Reading the scalar alone left a
  // bare em-dash on every multi-building item, because the scalar is null by design
  // whenever more than one is linked.
  if (nums.length === 0) return buildingsLabel(task) ?? '—';
  if (nums.length === 1) return `Unit ${nums[0]}`;
  return `Units ${nums.join(', ')}`;
}

export function ConstructionBoard({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { data: tasks, isLoading, error } = useTasks({ projectId, kind: KIND });
  const { data: buildings } = useBuildings(projectId);
  const { data: users } = useUsers();
  const statuses = useOptionLookup('task_status');
  const priorities = useOptionLookup('task_priority');

  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [openUpdates, setOpenUpdates] = useState<any>(null);
  const [buildingFilter, setBuildingFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');

  // Undefined = follow the default (open if small or something needs attention, else
  // collapsed); once the user manually toggles a building's section, their choice wins for
  // the rest of the session — same pattern as ConstructionChecklistRollup. Manual overrides
  // reset whenever a filter changes, so a group collapsed earlier can't hide a match a
  // filter just narrowed down to.
  const { isExpanded, toggle } = useCollapsibleGroups([buildingFilter, assigneeFilter]);

  /** Every building the item covers, join table first, legacy scalar as fallback. */
  const buildingsOf = (t: any): Array<{ id: string; name: string }> => {
    const linked = (t.buildings ?? [])
      .map((tb: any) => tb.building)
      .filter(Boolean);
    if (linked.length) return linked;
    return t.building ? [t.building] : [];
  };

  const rows = useMemo(() => {
    let list: any[] = Array.isArray(tasks) ? tasks : [];
    // Both filters go through the links, never the scalars — the scalar is null on any
    // item covering more than one, so a scalar filter would hide exactly the multi-
    // building and multi-person items the links exist for.
    if (buildingFilter) {
      list = list.filter((t) => buildingsOf(t).some((b) => b.id === buildingFilter));
    }
    if (assigneeFilter) {
      list = list.filter((t) =>
        (t.assignees ?? []).some((a: any) => a.userId === assigneeFilter)
        || t.assignedTo === assigneeFilter);
    }
    return list;
  }, [tasks, buildingFilter, assigneeFilter]);

  // Grouped by building. An item spanning B1 and B2 appears under BOTH — the alternative
  // is picking one and hiding it from everybody looking at the other, which is the whole
  // failure that multi-building was asked for. The row carries a badge saying so, so the
  // repeat reads as deliberate rather than as duplicate data.
  const groups = useMemo(() => {
    const byBuilding = new Map<string, { name: string; items: any[] }>();
    for (const t of rows) {
      const linked = buildingsOf(t);
      const targets = linked.length ? linked : [{ id: '__none__', name: 'No building' }];
      for (const b of targets) {
        if (!byBuilding.has(b.id)) byBuilding.set(b.id, { name: b.name, items: [] });
        byBuilding.get(b.id)!.items.push(t);
      }
    }
    return [...byBuilding.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [rows]);

  // Per-building aggregate for the collapsed header: "danger"-colored status or priority
  // (Blocked/Cancelled status, High/Urgent priority — whatever those are relabelled to)
  // means the item needs attention; "success"-colored status is Done. Both read the same
  // CustomOption color token the chips render with, so a client relabel never breaks this.
  const groupStats = useMemo(() => {
    const map = new Map<string, { attention: number; done: number; total: number }>();
    for (const [key, group] of groups) {
      let attention = 0;
      let done = 0;
      for (const t of group.items) {
        const stColor = chipColor(statuses.of(t.status).color);
        const prColor = chipColor(priorities.of(t.priority).color);
        if (stColor === 'danger' || prColor === 'danger') attention += 1;
        if (stColor === 'success') done += 1;
      }
      map.set(key, { attention, done, total: group.items.length });
    }
    return map;
  }, [groups, statuses, priorities]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={errMsg(error, 'Could not load the board')} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          size="sm"
          label="Building"
          className="max-w-[200px]"
          selectedKeys={buildingFilter ? [buildingFilter] : []}
          onSelectionChange={(k) => setBuildingFilter(String(Array.from(k)[0] ?? ''))}
        >
          {(Array.isArray(buildings) ? buildings : []).map((b: any) => (
            <SelectItem key={b.id} textValue={b.name}>{b.name}</SelectItem>
          ))}
        </Select>
        <Select
          size="sm"
          label="Assignee"
          className="max-w-[200px]"
          selectedKeys={assigneeFilter ? [assigneeFilter] : []}
          onSelectionChange={(k) => setAssigneeFilter(String(Array.from(k)[0] ?? ''))}
        >
          {(Array.isArray(users) ? users : []).map((u: any) => (
            <SelectItem key={u.id} textValue={u.name || u.email}>{u.name || u.email}</SelectItem>
          ))}
        </Select>
        {(buildingFilter || assigneeFilter) && (
          <Button size="sm" variant="light" onPress={() => { setBuildingFilter(''); setAssigneeFilter(''); }}>
            Clear
          </Button>
        )}
        <div className="ml-auto">
          {canEdit && (
            <Button size="sm" color="primary" startContent={<FiPlus />} onPress={() => setCreating(true)}>
              Add item
            </Button>
          )}
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title="No construction items yet"
          message="Add an item for a unit, a group of units, or a whole building."
        />
      ) : (
        groups.map(([key, group]) => {
          const stats = groupStats.get(key) ?? { attention: 0, done: 0, total: group.items.length };
          // Open by default when something needs attention, or when the group is small
          // enough that a table adds no scroll cost; a manual click always wins after that.
          const defaultExpanded = stats.attention > 0 || group.items.length <= 6;
          const expanded = isExpanded(key, defaultExpanded);
          const donePct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
          return (
          <div key={key} className="border border-gray-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(key, expanded)}
              className="w-full flex items-center justify-between gap-3 bg-gray-50 px-4 py-2 border-b border-gray-200 text-left"
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 uppercase tracking-wide">
                {expanded ? <FiChevronDown className="shrink-0" /> : <FiChevronRight className="shrink-0" />}
                {group.name}
                <span className="ml-1 text-xs font-normal text-gray-400 normal-case">
                  · {group.items.length} item(s)
                </span>
              </span>
              <span className="flex items-center gap-3 text-xs shrink-0">
                {stats.attention > 0 && (
                  <span className="flex items-center gap-1 text-red-600 font-medium normal-case">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
                    {stats.attention} need{stats.attention === 1 ? 's' : ''} attention
                  </span>
                )}
                <span className="text-gray-400 normal-case">{donePct}% done</span>
              </span>
            </button>
            {expanded && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100">
                    <th className="text-left font-medium px-4 py-2">Item</th>
                    <th className="text-left font-medium px-3 py-2 w-40">Person</th>
                    <th className="text-left font-medium px-3 py-2 w-36">Status</th>
                    <th className="text-left font-medium px-3 py-2 w-32">Priority</th>
                    <th className="text-left font-medium px-3 py-2">Title</th>
                    <th className="text-left font-medium px-3 py-2 w-28">Updates</th>
                    <th className="w-20" />
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((t: any) => {
                    const st = statuses.of(t.status);
                    const pr = priorities.of(t.priority);
                    return (
                      <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                        <td className="px-4 py-2 font-medium text-gray-800">
                          <div className="flex items-center gap-1.5">
                            {(t.units?.length ?? 0) > 1 && (
                              <Tooltip content="One item covering several units — the units themselves are not combined">
                                <span><FiLayers className="w-3.5 h-3.5 text-gray-400" /></span>
                              </Tooltip>
                            )}
                            {(t.buildings?.length ?? 0) > 1 && (
                              <Tooltip content={`Also shown under ${buildingsLabel(t)} — one item, listed in each`}>
                                <span><FiHome className="w-3.5 h-3.5 text-gray-400" /></span>
                              </Tooltip>
                            )}
                            {unitLabel(t)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-gray-700">
                          {peopleLabel(t) ?? <span className="text-gray-300">Unassigned</span>}
                        </td>
                        <td className="px-3 py-2">
                          <Chip size="sm" color={chipColor(st.color)} variant="flat">{st.label}</Chip>
                        </td>
                        <td className="px-3 py-2">
                          <Chip size="sm" color={chipColor(pr.color)} variant="flat">{pr.label}</Chip>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{t.title}</td>
                        <td className="px-3 py-2">
                          <button
                            className="text-xs text-blue-600 hover:underline"
                            onClick={() => setOpenUpdates(t)}
                          >
                            {t._count?.updates ? `${t._count.updates} update(s)` : 'Add update'}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {canEdit && (
                            <button
                              onClick={() => setEditing(t)}
                              className="text-gray-400 hover:text-blue-600 p-1"
                              title="Edit item"
                            >
                              <FiEdit2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>
          );
        })
      )}

      <ItemDialog
        projectId={projectId}
        task={editing}
        isOpen={creating || !!editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        statuses={statuses.list}
        priorities={priorities.list}
      />
      <UpdatesDialog
        task={openUpdates}
        isOpen={!!openUpdates}
        onClose={() => setOpenUpdates(null)}
        canEdit={canEdit}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit an item
// ---------------------------------------------------------------------------

function ItemDialog({
  projectId, task, isOpen, onClose, statuses, priorities,
}: {
  projectId: string;
  task: any | null;
  isOpen: boolean;
  onClose: () => void;
  statuses: OptionLike[];
  priorities: OptionLike[];
}) {
  const create = useCreateTask();
  const update = useUpdateTask();
  const del = useDeleteTask();
  const { data: buildings } = useBuildings(projectId);
  const { data: users } = useUsers();

  const [form, setForm] = useState<Record<string, string>>({});
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [buildingIds, setBuildingIds] = useState<string[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);

  // Seed from the row being edited on first render of an open dialog.
  const seeded = touched ? form : {
    title: task?.title ?? '',
    status: task?.status ?? 'TODO',
    priority: task?.priority ?? 'MEDIUM',
    dueDate: task?.dueDate ? String(task.dueDate).slice(0, 10) : '',
    description: task?.description ?? '',
  };
  const seededUnits = touched ? unitIds : (task?.units ?? []).map((tu: any) => tu.unitId);
  // Join table first, legacy scalar as fallback — an item saved before multi-building
  // existed still opens with its building selected.
  const seededBuildings = touched
    ? buildingIds
    : ((task?.buildings ?? []).map((tb: any) => tb.buildingId).filter(Boolean).length
        ? task.buildings.map((tb: any) => tb.buildingId)
        : task?.buildingId ? [task.buildingId] : []);
  const seededAssignees = touched
    ? assigneeIds
    : ((task?.assignees ?? []).map((a: any) => a.userId).filter(Boolean).length
        ? task.assignees.map((a: any) => a.userId)
        : task?.assignedTo ? [task.assignedTo] : []);

  /**
   * Every setter has to seed ALL the state, not just its own field.
   *
   * `touched` flips the whole dialog from reading the task to reading local state, so a
   * setter that only fills `form` leaves the three link lists empty — and typing a title
   * on an existing item would silently drop its buildings, units and people on save.
   */
  const seedAll = () => {
    setTouched(true);
    setUnitIds(seededUnits);
    setBuildingIds(seededBuildings);
    setAssigneeIds(seededAssignees);
  };

  const set = (k: string) => (v: string) => {
    seedAll();
    setForm({ ...seeded, [k]: v });
  };

  const { data: units } = useUnits(projectId);
  // Narrowed to the chosen buildings so a long list stays usable — but NOT restricted to
  // one, and not enforced: the server accepts units from anywhere and folds their
  // buildings into the item. With nothing chosen, everything is offered.
  const unitChoices = useMemo(
    () => (Array.isArray(units) ? units : []).filter(
      (u: any) => seededBuildings.length === 0 || seededBuildings.includes(u.buildingId),
    ),
    [units, seededBuildings],
  );

  const close = () => {
    setTouched(false); setForm({}); setUnitIds([]); setBuildingIds([]); setAssigneeIds([]);
    onClose();
  };

  /** Same rule for the multi-selects: seed everything, then apply this one's change. */
  const setMulti = (setter: (v: string[]) => void) => (keys: any) => {
    seedAll();
    setForm(seeded);
    setter([...keys].map(String));
  };

  const submit = async () => {
    if (!seeded.title?.trim()) {
      addToast({ title: 'A title is required', color: 'warning' });
      return;
    }
    const data = {
      projectId,
      kind: KIND,
      title: seeded.title.trim(),
      description: seeded.description || undefined,
      // Always sent, even empty: an omitted field leaves the existing links alone
      // server-side, which would make "remove the last building" impossible.
      buildingIds: seededBuildings,
      unitIds: seededUnits,
      assigneeIds: seededAssignees,
      status: seeded.status,
      priority: seeded.priority,
      dueDate: seeded.dueDate || undefined,
    };
    try {
      if (task) await update.mutateAsync({ id: task.id, data });
      else await create.mutateAsync(data);
      addToast({ title: task ? 'Item updated' : 'Item added', color: 'success' });
      close();
    } catch (err) {
      addToast({ title: errMsg(err, 'Could not save the item'), color: 'danger' });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>{task ? 'Edit item' : 'Add construction item'}</ModalHeader>
        <ModalBody className="gap-3">
          <Input label="Title" value={seeded.title} onValueChange={set('title')} isRequired />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select
              label="Buildings"
              selectionMode="multiple"
              description="One item can span buildings — it appears under each"
              selectedKeys={new Set(seededBuildings)}
              onSelectionChange={setMulti(setBuildingIds)}
            >
              {(Array.isArray(buildings) ? buildings : []).map((b: any) => (
                <SelectItem key={b.id} textValue={b.name}>{b.name}</SelectItem>
              ))}
            </Select>
            <Select
              label="Units"
              selectionMode="multiple"
              description="Several units share one item — they are not merged"
              selectedKeys={new Set(seededUnits)}
              onSelectionChange={setMulti(setUnitIds)}
            >
              {unitChoices.map((u: any) => (
                <SelectItem key={u.id} textValue={u.unitNumber}>{u.unitNumber}</SelectItem>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Select
              label="Status"
              selectedKeys={[seeded.status]}
              onSelectionChange={(k) => set('status')(String(Array.from(k)[0] ?? ''))}
            >
              {statuses.map((o) => <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>)}
            </Select>
            <Select
              label="Priority"
              selectedKeys={[seeded.priority]}
              onSelectionChange={(k) => set('priority')(String(Array.from(k)[0] ?? ''))}
            >
              {priorities.map((o) => <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>)}
            </Select>
            <Input type="date" label="Due" value={seeded.dueDate} onValueChange={set('dueDate')} />
          </div>

          <Select
            label="People"
            selectionMode="multiple"
            description="Everyone tagged is notified — only people newly added, not the whole list on every save"
            selectedKeys={new Set(seededAssignees)}
            onSelectionChange={setMulti(setAssigneeIds)}
          >
            {(Array.isArray(users) ? users : []).map((u: any) => (
              <SelectItem key={u.id} textValue={u.name || u.email}>{u.name || u.email}</SelectItem>
            ))}
          </Select>

          <Textarea label="Description" value={seeded.description} onValueChange={set('description')} minRows={2} />
        </ModalBody>
        <ModalFooter>
          {task && (
            <Button
              color="danger"
              variant="light"
              startContent={<FiTrash2 />}
              onPress={async () => {
                try {
                  await del.mutateAsync(task.id);
                  addToast({ title: 'Item deleted', color: 'success' });
                  close();
                } catch (err) {
                  addToast({ title: errMsg(err, 'Could not delete'), color: 'danger' });
                }
              }}
            >
              Delete
            </Button>
          )}
          <Button variant="light" onPress={close}>Cancel</Button>
          <Button color="primary" onPress={submit} isLoading={create.isPending || update.isPending}>
            {task ? 'Save' : 'Add item'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Day-wise updates
// ---------------------------------------------------------------------------

function UpdatesDialog({
  task, isOpen, onClose, canEdit,
}: {
  task: any | null;
  isOpen: boolean;
  onClose: () => void;
  canEdit: boolean;
}) {
  const { data: updates, isLoading } = useTaskUpdates(task?.id);
  const add = useAddTaskUpdate();
  const del = useDeleteTaskUpdate();
  const addPhoto = useAddTaskUpdatePhoto();
  const presigned = usePresignedUpload();
  const fileRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [updateDate, setUpdateDate] = useState(new Date().toISOString().slice(0, 10));
  const [uploading, setUploading] = useState(false);

  if (!task) return null;

  const submit = async () => {
    if (!content.trim()) return;
    try {
      const update = await add.mutateAsync({
        taskId: task.id,
        data: { content: content.trim(), updateDate },
      });
      // Photos go up AFTER the update exists, because they hang off its id. A failure
      // here must not discard the text the user just wrote — the update is already
      // saved, so this reports and moves on rather than throwing.
      if (files.length) {
        setUploading(true);
        for (const file of files) {
          try {
            const { storagePath } = await presigned.mutateAsync({ file, category: 'task-updates' });
            await addPhoto.mutateAsync({ updateId: update.id, storagePath, taskId: task.id });
          } catch {
            addToast({ title: `Update saved, but ${file.name} did not upload`, color: 'warning' });
          }
        }
        setUploading(false);
      }
      setContent('');
      setFiles([]);
      addToast({ title: 'Update posted', color: 'success' });
    } catch (err) {
      setUploading(false);
      addToast({ title: errMsg(err, 'Could not post the update'), color: 'danger' });
    }
  };

  const list: any[] = Array.isArray(updates) ? updates : [];

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex-col items-start gap-0">
          <span>Updates — {task.title}</span>
          <span className="text-xs font-normal text-gray-500">{unitLabel(task)}</span>
        </ModalHeader>
        <ModalBody className="gap-4">
          {/*
            The composer. One field, one row of controls.
            
            It was a labelled textarea above a labelled date input above two buttons —
            four stacked blocks and roughly 180px to say "what happened today". The date
            is the only one that needs explaining, and it explains itself once, quietly,
            rather than carrying a floating label and a helper line.
          */}
          {canEdit && (
            <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-2.5">
              <Textarea
                aria-label="What happened"
                placeholder="What happened on site? Type @name to notify someone."
                value={content}
                onValueChange={setContent}
                minRows={2}
                variant="flat"
                classNames={{ inputWrapper: 'bg-white shadow-none border border-gray-200' }}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                  <FiCalendar size={12} className="shrink-0 text-gray-400" />
                  <span className="sr-only">The day this happened</span>
                  <input
                    type="date"
                    aria-label="The day this happened"
                    className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 outline-none focus:border-gray-400"
                    value={updateDate}
                    onChange={(e) => setUpdateDate(e.target.value)}
                  />
                </label>

                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => setFiles([...(e.target.files ?? [])])}
                />
                <Button
                  size="sm"
                  variant="light"
                  className="h-7 min-w-0 px-2 text-[11px] text-gray-600"
                  startContent={<FiCamera size={13} />}
                  onPress={() => fileRef.current?.click()}
                >
                  {files.length ? `${files.length} photo${files.length === 1 ? '' : 's'}` : 'Add photos'}
                </Button>

                {/* Named files, so somebody can see they picked the wrong one before
                    posting rather than after. */}
                {files.length > 0 && (
                  <span className="truncate text-[11px] text-gray-400">
                    {files.map((f) => f.name).join(', ')}
                  </span>
                )}

                <Button
                  size="sm"
                  color="primary"
                  className="ml-auto h-7 min-w-0 px-3 text-[11px]"
                  isDisabled={!content.trim()}
                  onPress={submit}
                  isLoading={add.isPending || uploading}
                >
                  Post
                </Button>
              </div>
            </div>
          )}

          {isLoading ? (
            <LoadingState />
          ) : list.length === 0 ? (
            // Says what this space is FOR, not merely that it is empty.
            <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center">
              <p className="text-sm font-medium text-gray-600">No updates yet</p>
              <p className="mt-0.5 text-xs text-gray-400">
                {canEdit
                  ? 'Post what happened on site, with photos. Each update is dated by the day it happened, not the day it was typed.'
                  : 'Site progress on this item will appear here.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-0">
              {list.map((u, i) => (
                <li
                  key={u.id}
                  className={`group flex gap-3 py-3 ${i > 0 ? 'border-t border-gray-100' : ''}`}
                >
                  {/* A dot and a rule, not a filled bar: the timeline should suggest
                      sequence, not compete with the photographs. */}
                  <div className="flex flex-col items-center pt-1.5">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                    {i < list.length - 1 && <span className="mt-1 w-px flex-1 bg-gray-100" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[11px] text-gray-400">
                      <span className="font-medium text-gray-600">{fmtDate(u.updateDate)}</span>
                      <span className="text-gray-300">·</span>
                      <span>{u.author?.name ?? 'Unknown'}</span>
                      {canEdit && (
                        <button
                          // Revealed on hover for pointers, always reachable by keyboard,
                          // and never hidden on touch — where there is no hover at all.
                          className="ml-auto p-1 text-gray-300 opacity-100 transition-opacity hover:text-red-500 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                          onClick={() => del.mutateAsync({ updateId: u.id, taskId: task.id })}
                          title="Delete update"
                          aria-label={`Delete the update from ${fmtDate(u.updateDate)}`}
                        >
                          <FiTrash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                      {u.content}
                    </p>
                    {(u.photos?.length ?? 0) > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {u.photos.map((ph: any) => (
                          <a
                            key={ph.id}
                            href={ph.url || undefined}
                            target="_blank"
                            rel="noreferrer"
                            className="block overflow-hidden rounded-lg border border-gray-200 transition-shadow hover:shadow-md"
                          >
                            <img
                              src={ph.url}
                              alt={ph.caption ?? `Site photo from ${fmtDate(u.updateDate)}`}
                              loading="lazy"
                              className="h-20 w-20 object-cover"
                            />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>Close</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Unit-level view
// ---------------------------------------------------------------------------

/**
 * The construction items covering ONE unit, for the Unit Detail page.
 *
 * Read-only on purpose: creating work belongs on the project board where the building
 * and the sibling units are in view. What this answers is the question someone actually
 * has on a unit page — "is anything happening to this unit, and who has it?" — sitting
 * alongside its rent history, which is the whole reason the board was worth pulling in
 * from Monday in the first place.
 *
 * Reads through the join table, so a unit correctly shows the items that ALSO cover its
 * neighbours; the multi-unit badge says so rather than making it look unit-specific.
 */
export function UnitConstructionPanel({ unitId, canEdit }: { unitId: string; canEdit: boolean }) {
  const { data, isLoading } = useTasks({ unitId, kind: KIND });
  const statuses = useOptionLookup('task_status');
  const priorities = useOptionLookup('task_priority');
  const [openUpdates, setOpenUpdates] = useState<any>(null);

  const items: any[] = Array.isArray(data) ? data : [];

  if (isLoading) return <LoadingState />;
  if (items.length === 0) {
    return <p className="text-sm text-gray-400 py-2">No construction items for this unit.</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((t) => {
        const st = statuses.of(t.status);
        const pr = priorities.of(t.priority);
        const shared = (t.units?.length ?? 0) > 1;
        return (
          <div key={t.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{t.title}</p>
              <p className="text-xs text-gray-500">
                {t.assignedUser?.name ?? 'Unassigned'}
                {shared && (
                  <span className="ml-2 text-gray-400">· shared with {unitLabel(t)}</span>
                )}
              </p>
            </div>
            <Chip size="sm" color={chipColor(pr.color)} variant="flat">{pr.label}</Chip>
            <Chip size="sm" color={chipColor(st.color)} variant="flat">{st.label}</Chip>
            <button
              className="text-xs text-blue-600 hover:underline shrink-0"
              onClick={() => setOpenUpdates(t)}
            >
              {t._count?.updates ? `${t._count.updates} update(s)` : 'Updates'}
            </button>
          </div>
        );
      })}
      <UpdatesDialog
        task={openUpdates}
        isOpen={!!openUpdates}
        onClose={() => setOpenUpdates(null)}
        canEdit={canEdit}
      />
    </div>
  );
}
