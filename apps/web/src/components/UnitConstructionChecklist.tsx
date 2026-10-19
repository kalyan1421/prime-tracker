/**
 * UnitConstructionChecklist — the fixed, ordered per-unit stage checklist (e.g.
 * "01 - Contracts" .. "22 - Final Inspection"), separate from the Task/kind=CONSTRUCTION
 * "Updates Board" (see ConstructionBoard.tsx / UnitConstructionPanel). That board is
 * ad-hoc work items with day-wise updates; this is a template-driven progress checklist
 * with its own Status + Inspection Status + Inspection Date per stage, matching the
 * client's Monday.com board shape (client-confirmed 2026-08-21 as a NEW, separate system).
 *
 * A unit with no stages yet offers "Apply template" (one-time — refused server-side if
 * the unit already has any stages) or, if the building has no template either, just
 * "Add stage" to build one from scratch.
 */
import { useMemo, useRef, useState } from 'react';
import {
  Button, Chip, Input, Select, SelectItem, Tooltip, Textarea, addToast,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
} from '@heroui/react';
import {
  FiPlus, FiTrash2, FiZap, FiCamera, FiX, FiMessageSquare, FiChevronUp, FiChevronDown, FiUser,
} from 'react-icons/fi';
import {
  useUnitConstructionStages, useConstructionTemplate, useApplyConstructionTemplate,
  useAddUnitConstructionStage, useAddUnitConstructionStages, useUpdateConstructionStage,
  useStageCatalogue,
  useReorderUnitConstructionStages, useDeleteConstructionStage,
  useCustomOptions, useAssignableUsers, useAddStagePhoto, useRemoveStagePhoto, usePresignedUpload,
  useCreateDailyLog, useDailyLogs,
} from '../hooks/useApi';
import { errMsg, fmtDate, fmtDateShort } from '../utils/fmt';
import { LoadingState, EmptyState, chipColor, AddButton } from './ui';
import { PeoplePicker, personLabel } from './PeoplePicker';
import { StatusCell, InlineText, InlineDate, TimelinePill, Cell } from './BoardCells';
import { useAuthStore } from '../store/authStore';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { MentionBox, MentionText } from './MentionText';
import { useAttemptRef, useSiteOutbox } from '../hooks/useSiteOutbox';

/**
 * The delete rule (client, 2026-10-16): you may remove what you added; anybody else's needs
 * siteTracker:manage (Founder / Super Admin). The API enforces it; this only hides the
 * button nobody could use.
 */
function useMayDelete() {
  const me = useAuthStore((s) => s.user?.id);
  const manage = useAuthStore((s) => s.hasPermission('siteTracker:manage'));
  return (createdBy?: string | null) => manage || (!!createdBy && createdBy === me);
}

/** Looks like a HeroUI sm Select, opens the searchable PeoplePicker. */
function OwnerField({ ownerId, users, onChange, isDisabled }: {
  ownerId: string | null | undefined; users: any[]; onChange: (id: string | null) => void; isDisabled?: boolean;
}) {
  const owner = users.find((u: any) => u.id === ownerId);
  return (
    <PeoplePicker
      mode="single" label="Stage owner" isDisabled={isDisabled}
      selected={ownerId ? [ownerId] : []} onChange={(ids) => onChange(ids[0] ?? null)}
    >
      <button
        type="button" disabled={isDisabled} aria-label="Stage owner"
        className="flex h-12 w-full flex-col justify-center rounded-small bg-default-100 px-3 text-left hover:bg-default-200 disabled:opacity-50"
      >
        <span className="text-[11px] text-gray-600">Owner</span>
        <span className={`truncate text-sm ${owner ? 'text-gray-900' : 'text-gray-500'}`}>
          {owner ? (owner.name ?? owner.email) : 'Unassigned — tap to assign'}
        </span>
      </button>
    </PeoplePicker>
  );
}

interface OptionLike { value: string; label: string; color?: string | null }

function useOptionList(category: string) {
  const { data } = useCustomOptions(category);
  return useMemo(() => (Array.isArray(data) ? (data as OptionLike[]) : []), [data]);
}

export function UnitConstructionChecklist({
  unitId,
  buildingId,
  projectId,
  canEdit,
}: {
  unitId: string;
  buildingId?: string;
  /** Needed to post a stage-pinned site update. Without it the message column is hidden. */
  projectId?: string;
  canEdit: boolean;
}) {
  const stagesQ = useUnitConstructionStages(unitId);
  const templateQ = useConstructionTemplate(buildingId);
  const statusOptions = useOptionList('construction_stage_status');
  const inspectionOptions = useOptionList('construction_inspection_status');
  // Was useUsers() — an admin-only route (user:manage), so for every PM and every
  // CONSTRUCTION user the owner list was EMPTY: "I can't find my name to assign myself"
  // (meeting 2026-10-13). The assignable list is every active person, any role.
  const { data: usersData } = useAssignableUsers();
  const users: any[] = Array.isArray(usersData) ? usersData : [];
  const mayDelete = useMayDelete();

  const applyTemplate = useApplyConstructionTemplate();
  const addStage = useAddUnitConstructionStage();
  const updateStage = useUpdateConstructionStage();
  const deleteStage = useDeleteConstructionStage();
  const reorder = useReorderUnitConstructionStages();

  const [adding, setAdding] = useState(false);
  /**
   * Which stage's detail dialog is open, by ID — not by object.
   * Every field on a stage (owner, inspection status and date, timeline, notes, photos)
   * is editable in StageDetailModal, and until now the ONLY way in was the "Add note"
   * link in the last column. The other cells rendered a bare "—" that looked like dead
   * text, so a grid full of em-dashes read as "there is nothing to set here" rather than
   * "nobody has set this yet". Held at table level so any cell can open the same dialog.
   * The id, not the row, so the dialog re-reads the freshly patched stage on every render.
   */
  const [detailStageId, setDetailStageId] = useState<string | null>(null);
  // Deleting a stage takes away its status, dates, inspection and notes, and there is no
  // undo — so it asks first, which the bare trash icon never did.
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);

  const stages: any[] = Array.isArray(stagesQ.data) ? stagesQ.data : [];
  const template: any[] = Array.isArray(templateQ.data) ? templateQ.data : [];
  // Below tablet width the 10-column grid pushed Owner and Status off-screen — the two
  // things anyone checks on a phone at site. One layout is MOUNTED, not merely hidden.
  const isPhone = useMediaQuery('(max-width: 767px)');

  if (stagesQ.isLoading) return <LoadingState message="Loading checklist…" />;

  const patch = async (stageId: string, data: Record<string, unknown>) => {
    try {
      await updateStage.mutateAsync({ stageId, unitId, data });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to update the stage'), color: 'danger' });
    }
  };

  /**
   * Swap a stage with its neighbour and send the whole resulting order.
   *
   * The endpoint takes the complete list rather than "move this one to index N" so the
   * server never has to guess what happens to the rows in between — and so two people
   * reordering at once collide loudly instead of interleaving into an order neither of
   * them asked for.
   */
  const move = async (index: number, dir: -1 | 1) => {
    const next = [...stages];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await reorder.mutateAsync({ unitId, stageIds: next.map((s) => s.id) });
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not reorder the stages'), color: 'danger' });
    }
  };

  const handleApplyTemplate = async () => {
    try {
      await applyTemplate.mutateAsync({ unitId });
      addToast({ title: 'Checklist created from the building template', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to apply the template'), color: 'danger' });
    }
  };


  if (stages.length === 0) {
    /**
     * One line, not a 200px-tall empty state.
     *
     * On a unit with nothing recorded, this card, Financing and Construction each rendered
     * a full-height illustrated placeholder, so the page was mostly boxes announcing their
     * own emptiness. Say it in a sentence and keep the actions on the same row (client,
     * 2026-09-02).
     */
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 py-1">
          <p className="text-sm text-gray-500">
            {template.length > 0
              ? `No stages yet — this building has a ${template.length}-stage template to copy.`
              : 'No stages recorded for this unit.'}
          </p>
          {canEdit && (
            <div className="flex items-center gap-2">
              {template.length > 0 && (
                <Button
                  size="sm" color="primary" startContent={<FiZap size={13} />}
                  onPress={handleApplyTemplate} isLoading={applyTemplate.isPending}
                >
                  Apply template
                </Button>
              )}
              <AddButton onPress={() => setAdding(true)}>Add stage</AddButton>
            </div>
          )}
        </div>
        {adding && (
          <AddStageModal
            unitId={unitId}
            statusOptions={statusOptions} inspectionOptions={inspectionOptions}
            users={users} onClose={() => setAdding(false)}
            usedLabels={stages.map((s) => s.label)}
          />
        )}
      </div>
    );
  }

  const doneCount = stages.filter((s) => s.status === 'DONE').length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{doneCount} of {stages.length} stages done</span>
        {canEdit && (
          <AddButton onPress={() => setAdding(true)}>Add stages from list</AddButton>
        )}
      </div>

      {isPhone ? (
        // Phone: one row per stage — name, status and owner where a thumb can reach them.
        // Everything else (inspection, dates, notes, photos, updates) is one tap away in
        // the stage dialog, which already edits all of it.
        <>
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 border-l-4 border-l-blue-500 bg-white">
            {stages.map((s, i) => {
              const insp = inspectionOptions.find((o) => o.value === s.inspectionStatus);
              const updates = s._count?.dailyLogs ?? 0;
              const meta = [
                insp?.label,
                s.inspectionDate ? `inspection ${fmtDateShort(s.inspectionDate)}` : null,
                s.startsOn || s.endsOn
                  ? `${s.startsOn ? fmtDateShort(s.startsOn) : '…'} – ${s.endsOn ? fmtDateShort(s.endsOn) : '…'}`
                  : null,
                updates ? `${updates} update${updates === 1 ? '' : 's'}` : null,
              ].filter(Boolean);
              return (
                <li key={s.id} className="flex items-center gap-2 px-2 py-2">
                  <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-gray-500">{i + 1}</span>
                  <button
                    type="button" onClick={() => setDetailStageId(s.id)}
                    className="min-w-0 flex-1 text-left" aria-label={`Open stage ${s.label}`}
                  >
                    <span className="block truncate text-sm font-medium text-gray-900">{s.label}</span>
                    {meta.length > 0 && <span className="block truncate text-[11px] text-gray-500">{meta.join(' · ')}</span>}
                  </button>
                  <OwnerAvatar
                    ownerId={s.ownerId} users={users} canEdit={canEdit}
                    onChange={(id) => patch(s.id, { ownerId: id })}
                  />
                  <div className="w-28 shrink-0 overflow-hidden rounded">
                    <StatusCell
                      value={s.status} options={statusOptions} canEdit={canEdit} label="Status"
                      onChange={(v) => { if (v) patch(s.id, { status: v }); }}
                    />
                  </div>
                </li>
              );
            })}
            {canEdit && (
              <li className="px-2 py-1">
                <AddSubitemRow unitId={unitId} existing={stages.map((st) => st.label)} />
              </li>
            )}
          </ul>
          <p className="text-[11px] text-gray-500">Tap a stage for its inspection, dates, notes, photos and updates.</p>
        </>
      ) : (
        <>
        {/* The subitem grid, monday-style (client, 2026-10-16): every value edits where it
            sits — name, owner, status, inspection, dates, timeline, notes. Status-type cells
            are colour-filled. Updates and photos still open the stage dialog, from the bubble. */}
        <div className="overflow-x-auto rounded-md border border-gray-200 border-l-4 border-l-blue-500 bg-white">
          <table className="w-full min-w-[1120px] border-collapse text-xs">
            <thead>
              <tr className="text-[11px] font-medium text-gray-600">
                <GridTh className="w-16">#</GridTh>
                <GridTh className="min-w-[220px] text-left">Subitem</GridTh>
                <GridTh className="w-20">Owner</GridTh>
                <GridTh className="w-36">Status</GridTh>
                <GridTh className="w-40">Inspection status</GridTh>
                <GridTh className="w-32">Inspection date</GridTh>
                <GridTh className="w-40">Timeline</GridTh>
                <GridTh className="min-w-[200px] text-left">Notes</GridTh>
                <GridTh className="w-20">Updates</GridTh>
                <GridTh className="w-10" />
              </tr>
            </thead>
            <tbody>
              {stages.map((s, i) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <Cell className="tabular-nums text-gray-500">
                    {canEdit ? (
                      // Arrows rather than drag-and-drop: this table scrolls sideways and is
                      // read on a phone at a site, where a drag competes with the scroll.
                      <div className="flex items-center gap-1">
                        <span className="w-5 text-right">{i + 1}</span>
                        <div className="flex flex-col">
                          <button
                            type="button" aria-label={`Move ${s.label} up`}
                            disabled={i === 0 || reorder.isPending}
                            onClick={() => move(i, -1)}
                            className="leading-none text-gray-500 hover:text-gray-800 disabled:opacity-30"
                          >
                            <FiChevronUp size={11} />
                          </button>
                          <button
                            type="button" aria-label={`Move ${s.label} down`}
                            disabled={i === stages.length - 1 || reorder.isPending}
                            onClick={() => move(i, 1)}
                            className="leading-none text-gray-500 hover:text-gray-800 disabled:opacity-30"
                          >
                            <FiChevronDown size={11} />
                          </button>
                        </div>
                      </div>
                    ) : <span className="block text-center">{i + 1}</span>}
                  </Cell>
                  <Cell>
                    <InlineText
                      value={s.label} nullable={false} canEdit={canEdit} label="Subitem name"
                      textClassName="font-medium"
                      onSave={(v) => { if (v) patch(s.id, { label: v }); }}
                    />
                  </Cell>
                  <Cell className="text-center">
                    <OwnerAvatar
                      ownerId={s.ownerId} users={users} canEdit={canEdit}
                      onChange={(id) => patch(s.id, { ownerId: id })}
                    />
                  </Cell>
                  <Cell pad={false}>
                    <StatusCell
                      value={s.status} options={statusOptions} canEdit={canEdit} label="Status"
                      onChange={(v) => { if (v) patch(s.id, { status: v }); }}
                    />
                  </Cell>
                  <Cell pad={false}>
                    <StatusCell
                      value={s.inspectionStatus} options={inspectionOptions} canEdit={canEdit} allowClear
                      label="Inspection status" onChange={(v) => patch(s.id, { inspectionStatus: v })}
                    />
                  </Cell>
                  <Cell>
                    <InlineDate
                      value={s.inspectionDate} canEdit={canEdit} label="Inspection date"
                      onSave={(v) => patch(s.id, { inspectionDate: v })}
                    />
                  </Cell>
                  <Cell className="text-center">
                    <TimelinePill
                      start={s.startsOn} end={s.endsOn} canEdit={canEdit}
                      onSave={(v) => patch(s.id, v)}
                    />
                  </Cell>
                  <Cell>
                    <InlineText
                      value={s.notes} canEdit={canEdit} label="Notes" placeholder={canEdit ? 'Add a note' : '—'}
                      onSave={(v) => patch(s.id, { notes: v })}
                    />
                  </Cell>
                  <Cell className="text-center">
                    <UpdatesBubble stage={s} onOpen={() => setDetailStageId(s.id)} />
                  </Cell>
                  <Cell className="text-center">
                    {canEdit && mayDelete(s.createdById) && (
                      <Tooltip content="Remove this subitem" size="sm">
                        <button
                          type="button"
                          aria-label={`Remove stage ${s.label}`}
                          onClick={() => setConfirmDelete(s)}
                          className="text-gray-300 transition-colors hover:text-red-700"
                        >
                          <FiTrash2 size={13} />
                        </button>
                      </Tooltip>
                    )}
                  </Cell>
                </tr>
              ))}
              {canEdit && (
                <tr>
                  <td colSpan={10} className="border-b border-gray-200 px-2 py-1">
                    <AddSubitemRow unitId={unitId} existing={stages.map((st) => st.label)} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        </>
      )}

      {adding && (
        <AddStageModal
          unitId={unitId}
          statusOptions={statusOptions} inspectionOptions={inspectionOptions}
          users={users} onClose={() => setAdding(false)}
          usedLabels={stages.map((s) => s.label)}
        />
      )}

      {/* One dialog for the whole table, resolved from the CURRENT stages array so it
          shows the freshly patched row rather than the snapshot taken when it opened.
          Falls closed on its own if the stage is deleted underneath it. */}
      {(() => {
        const s = stages.find((x) => x.id === detailStageId);
        if (!s) return null;
        return (
          <StageDetailModal
            stage={s} unitId={unitId} projectId={projectId} canEdit={canEdit}
            pending={updateStage.isPending}
            onSaveNotes={(v: string | null) => patch(s.id, { notes: v })}
            onPatch={(d: Record<string, unknown>) => patch(s.id, d)}
            users={users} inspectionOptions={inspectionOptions}
            statusOptions={statusOptions}
            onClose={() => setDetailStageId(null)}
          />
        );
      })()}

      <Modal
        isOpen={confirmDelete !== null}
        onClose={() => !deleteStage.isPending && setConfirmDelete(null)}
        size="md"
      >
        <ModalContent>
          <ModalHeader className="text-sm">Remove this stage?</ModalHeader>
          <ModalBody className="gap-2 text-sm text-gray-700">
            <p className="font-medium text-gray-900">{confirmDelete?.label}</p>
            <p className="text-xs text-gray-700">
              Its status, dates, inspection and notes go with it, along with
              {' '}{confirmDelete?.photos?.length
                ? `its ${confirmDelete.photos.length} photo${confirmDelete.photos.length === 1 ? '' : 's'}`
                : 'any photos on it'}. This cannot be undone.
            </p>
            {/* DailyLog.stageId is SetNull — the update outlives the stage it was pinned to,
                which is worth saying here because "delete the stage" reads like it takes the
                conversation with it. */}
            <p className="text-xs text-gray-700">
              Updates posted against this stage are kept on the unit's feed and lose only their pin.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              size="sm" variant="light" isDisabled={deleteStage.isPending}
              onPress={() => setConfirmDelete(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm" color="danger" isLoading={deleteStage.isPending}
              onPress={async () => {
                try {
                  await deleteStage.mutateAsync({ stageId: confirmDelete.id, unitId });
                  setConfirmDelete(null);
                } catch (e) {
                  addToast({ title: errMsg(e, 'Could not remove the stage'), color: 'danger' });
                }
              }}
            >
              Remove stage
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}



function GridTh({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`border-b border-r border-gray-200 bg-gray-50 px-2 py-2 text-center font-medium ${className}`}>
      {children}
    </th>
  );
}

const initialsOf = (u: { name?: string | null; email?: string }) =>
  (u.name ?? u.email ?? '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');

/** monday's person cell: an avatar, or an empty person icon; click to search and assign. */
function OwnerAvatar({ ownerId, users, canEdit, onChange }: {
  ownerId: string | null | undefined; users: any[]; canEdit: boolean; onChange: (id: string | null) => void;
}) {
  const owner = users.find((u: any) => u.id === ownerId);
  const face = owner ? (
    <span
      title={personLabel(owner)}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-[11px] font-semibold text-blue-700"
    >
      {initialsOf(owner)}
    </span>
  ) : (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-gray-300 text-gray-500">
      <FiUser size={13} />
    </span>
  );
  if (!canEdit) return face;
  return (
    <PeoplePicker
      mode="single" label="Subitem owner" selected={ownerId ? [ownerId] : []}
      onChange={(ids) => onChange(ids[0] ?? null)}
    >
      <button type="button" aria-label={`Owner: ${owner ? personLabel(owner) : 'unassigned'} — change`} className="rounded-full hover:ring-2 hover:ring-blue-200">
        {face}
      </button>
    </PeoplePicker>
  );
}

/** Updates and photos on a stage — the one thing that still opens the stage dialog. */
function UpdatesBubble({ stage, onOpen }: { stage: any; onOpen: () => void }) {
  const updates = stage._count?.dailyLogs ?? 0;
  const photos = (stage.photos ?? []).length;
  return (
    <button
      type="button" onClick={onOpen}
      aria-label={`Updates and photos for ${stage.label}`}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-gray-100 ${updates ? 'text-blue-600' : 'text-gray-500'}`}
    >
      <FiMessageSquare size={14} />
      {updates > 0 && <span className="text-[11px] font-semibold tabular-nums">{updates}</span>}
      {photos > 0 && (
        <span className="inline-flex items-center gap-0.5 text-gray-600">
          <FiCamera size={11} /><span className="text-[11px] tabular-nums">{photos}</span>
        </span>
      )}
    </button>
  );
}

/**
 * monday's "+ Add subitem" row at the foot of the list: type a name, Enter adds it and the
 * box stays ready for the next. Names from the stage list are suggested, so the common
 * steps stay linked to the catalogue; anything else is added as a one-off.
 */
function AddSubitemRow({ unitId, existing }: { unitId: string; existing: string[] }) {
  const addStage = useAddUnitConstructionStage();
  const catalogueQ = useStageCatalogue();
  const [name, setName] = useState('');
  const taken = new Set(existing.map((l) => l.trim().toLowerCase()));
  const suggestions = (Array.isArray(catalogueQ.data) ? catalogueQ.data : [])
    .map((c: any) => c.label as string)
    .filter((l) => !taken.has(l.trim().toLowerCase()));
  const listId = `subitem-suggestions-${unitId}`;

  const submit = async () => {
    const label = name.trim();
    if (!label) return;
    if (taken.has(label.toLowerCase())) {
      addToast({ title: `This unit already has "${label}"`, color: 'warning' });
      return;
    }
    try {
      await addStage.mutateAsync({ unitId, label });
      setName('');
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not add the subitem'), color: 'danger' });
    }
  };

  return (
    <div className="flex items-center gap-2">
      <FiPlus size={13} className="ml-1 text-gray-500" />
      <input
        value={name} onChange={(e) => setName(e.target.value)} list={listId}
        disabled={addStage.isPending}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
        placeholder="Add subitem — type a name and press Enter"
        aria-label="Add subitem"
        className="h-8 w-full max-w-md rounded border border-transparent bg-transparent px-2 text-xs text-gray-900 outline-none placeholder:text-gray-500 hover:border-gray-300 focus:border-blue-500 focus:bg-white"
      />
      <datalist id={listId}>
        {suggestions.map((l) => <option key={l} value={l} />)}
      </datalist>
      {name.trim() && (
        <Button size="sm" color="primary" variant="flat" onPress={submit} isLoading={addStage.isPending}>
          Add
        </Button>
      )}
    </div>
  );
}

function StageDetailModal({ stage, unitId, projectId, canEdit, pending, onSaveNotes, onPatch, users, inspectionOptions, statusOptions = [], onClose }: any) {
  const create = useCreateDailyLog();
  const addPhoto = useAddStagePhoto();
  const removePhoto = useRemoveStagePhoto();
  const mayDelete = useMayDelete();
  const presigned = usePresignedUpload();
  const { data: logsData } = useDailyLogs(projectId, undefined, unitId);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [note, setNote] = useState(stage.notes ?? '');
  const [text, setText] = useState('');
  const outbox = useSiteOutbox();
  // A retry of the same text after a lost answer reuses one ref, so it cannot post twice.
  const attempt = useAttemptRef();
  const postStageUpdate = async () => {
    if (!text.trim() || create.isPending) return;
    try {
      const r = await outbox.postOrQueue(
        { projectId, unitId, stageId: stage.id, notes: text.trim() },
        { send: create.mutateAsync, clientRef: attempt.refFor(text.trim()) },
      );
      attempt.done();
      setText('');
      if (r.status === 'queued') addToast({ title: 'No signal — saved on this device. It will post on its own.', color: 'warning' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not post the update'), color: 'danger' });
    }
  };
  const photos: any[] = stage.photos ?? [];

  // Only this stage's updates. The feed query is already cached for the unit, so this costs
  // no extra request.
  const updates = (Array.isArray(logsData) ? logsData : []).filter((l: any) => l.stage?.id === stage.id);

  const uploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const file of files) {
      try {
        const { storagePath } = await presigned.mutateAsync({ file, category: 'daily-logs' });
        await addPhoto.mutateAsync({ stageId: stage.id, unitId, storagePath });
      } catch (err) {
        addToast({ title: errMsg(err, 'Upload failed'), color: 'danger' });
      }
    }
  };

  return (
    <Modal isOpen onOpenChange={onClose} size="lg" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">{stage.label}</span>
          <span className="text-[11px] font-normal text-gray-500">Notes, updates and photos for this stage</span>
        </ModalHeader>
        <ModalBody className="pb-4">
          {/* Every field for this stage lives here. The grid is text so it can be scanned;
              this is where it is changed. Status ALSO stays inline in the row — it is the
              field people change on a walk-round, and a popup for one click would be three
              — but it is repeated here so this dialog is the complete set rather than
              "everything except the one you probably came for". */}
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              size="sm" label="Status" isDisabled={!canEdit || pending}
              selectedKeys={stage.status ? new Set([stage.status]) : new Set()}
              onSelectionChange={(k) => {
                const v = Array.from(k)[0] as string;
                if (v) onPatch({ status: v });
              }}
            >
              {statusOptions.map((o: OptionLike) => (
                <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
              ))}
            </Select>
            <OwnerField
              ownerId={stage.ownerId} users={users} isDisabled={!canEdit || pending}
              onChange={(id) => onPatch({ ownerId: id })}
            />
            <Select
              size="sm" label="Inspection status" isDisabled={!canEdit || pending}
              selectedKeys={stage.inspectionStatus ? new Set([stage.inspectionStatus]) : new Set()}
              onSelectionChange={(k) => onPatch({ inspectionStatus: (Array.from(k)[0] as string) ?? null })}
            >
              {inspectionOptions.map((o: OptionLike) => (
                <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
              ))}
            </Select>
            <Input
              size="sm" type="date" label="Inspection date" isDisabled={!canEdit || pending}
              value={stage.inspectionDate ? stage.inspectionDate.slice(0, 10) : ''}
              onChange={(e) => onPatch({ inspectionDate: e.target.value || null })}
            />
            <div className="flex items-end gap-1">
              <Input
                size="sm" type="date" label="Timeline from" isDisabled={!canEdit || pending}
                value={stage.startsOn ? stage.startsOn.slice(0, 10) : ''}
                onChange={(e) => onPatch({ startsOn: e.target.value || null })}
              />
              <Input
                size="sm" type="date" label="to" isDisabled={!canEdit || pending}
                value={stage.endsOn ? stage.endsOn.slice(0, 10) : ''}
                onChange={(e) => onPatch({ endsOn: e.target.value || null })}
              />
            </div>
          </div>

          <Textarea
            size="sm" minRows={2} label="Note" value={note} onValueChange={setNote}
            isDisabled={!canEdit || pending}
            placeholder="The durable summary for this stage"
            onBlur={() => { if (note !== (stage.notes ?? '')) onSaveNotes(note.trim() || null); }}
          />

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Photos</p>
            <div className="flex flex-wrap items-center gap-2">
              {photos.map((p) => (
                <div key={p.id} className="group relative h-16 w-16 overflow-hidden rounded border border-gray-200 bg-gray-100">
                  <img
                    src={p.url} alt={p.caption || ''} className="h-full w-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
                  />
                  {canEdit && mayDelete((p as any).uploadedById) && (
                    <button
                      type="button" aria-label="Remove photo"
                      onClick={() => removePhoto.mutate({ photoId: p.id, unitId })}
                      className="absolute right-0 top-0 bg-white/85 p-0.5 can-hover:opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                    >
                      <FiX className="text-[11px] text-red-700" />
                    </button>
                  )}
                </div>
              ))}
              {canEdit && (
                <>
                  <button
                    type="button" aria-label="Add stage photo" onClick={() => fileRef.current?.click()}
                    className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600"
                  >
                    <FiCamera size={16} />
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={uploadFiles} />
                </>
              )}
              {!canEdit && photos.length === 0 && <span className="text-xs text-gray-500">No photos</span>}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Updates</p>
            {updates.length === 0 && <p className="text-xs text-gray-500">Nothing posted against this stage yet.</p>}
            <div className="space-y-2">
              {updates.map((u: any) => (
                <div key={u.id} className="rounded-md border border-gray-100 p-2">
                  <div className="flex items-center gap-2 text-[11px] text-gray-500">
                    <span className="font-medium text-gray-700">{u.author?.name}</span>
                    <span>{fmtDate(u.logDate)}</span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-xs text-gray-700">
                    <MentionText text={u.notes ?? ''} names={(users ?? []).map((x: any) => x.name ?? '').filter(Boolean)} />
                  </p>
                </div>
              ))}
            </div>
            {canEdit && projectId && (
              <div className="mt-2 flex items-start gap-1.5">
                <MentionBox
                  label="Stage update" hideLabel className="min-w-0 flex-1" minRows={1} maxRows={4}
                  value={text} onChange={setText} users={users ?? []} onSubmit={() => postStageUpdate()}
                  placeholder="Post an update on this stage… type @ to notify someone"
                />
                <Button
                  size="sm" color="primary" isLoading={create.isPending} isDisabled={!text.trim()}
                  onPress={() => postStageUpdate()}
                >
                  Post
                </Button>
              </div>
            )}
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

/**
 * One row of the stage picker.
 *
 * `usedOn` is shown because the library is drawn from stages in USE, not a curated list —
 * so a typo somebody made once is selectable alongside the real thing. "on 1 unit" next to
 * "on 40 units" is what tells them apart without anyone having to police a catalogue.
 */
function StageOption({ item, checked, onToggle }: {
  item: { label: string };
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-gray-800 hover:bg-gray-50">
      <input
        type="checkbox"
        className="h-3.5 w-3.5 accent-blue-600"
        checked={checked}
        onChange={onToggle}
      />
      <span className="flex-1">{item.label}</span>
    </label>
  );
}

/**
 * Is a typed name near enough to a catalogue stage to be a mistake?
 *
 * Only the escape hatch needs this. Exact matches are already impossible to add twice, so
 * what is left is the near miss — "Storefront glass" against "Store Front Glass" — which
 * is how one stage became three names last time. Compared on letters and digits alone, so
 * spacing, case, hyphens and the old "07 - " prefixes all fall away.
 */
function nearestStage(typed: string, catalogue: { label: string }[]) {
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = norm(typed);
  if (key.length < 3) return null;
  return catalogue.find((o) => {
    const k = norm(o.label);
    return k === key || k.includes(key) || key.includes(k);
  }) ?? null;
}

/**
 * Create a stage from a form rather than a bare row.
 *
 * Two ways in, because there are two real cases: a unit is MISSING a stage everyone else
 * runs (pick it, and the wording matches every other unit), or the work genuinely is
 * one-off (type it). The list shows only stages this unit does not already have.
 *
 * The pickable set is the STAGE LIBRARY, not just the building's template. Templates are
 * configured per building, so keying the picker to one meant a building nobody had set up
 * offered nothing — on a portfolio where the full eighteen-stage list was already running
 * on units one building over. The library is the union, so the standard list is reachable
 * from every unit and stays consistent, while the building's own template still sorts
 * first because it is what that building is supposed to run.
 *
 * This docblock described the picker for some time before the picker existed — the modal
 * was free-text only until 2026-09-01. Both halves are now real.
 */
function AddStageModal({
  unitId, statusOptions, inspectionOptions, users, onClose, usedLabels = [],
}: {
  unitId: string; statusOptions: OptionLike[]; inspectionOptions: OptionLike[]; users: any[];
  onClose: () => void;
  /** Labels already on this unit, so the list offers the gap rather than everything. */
  usedLabels?: string[];
}) {
  const addStage = useAddUnitConstructionStage();
  const addStages = useAddUnitConstructionStages();

  // A stage name used to be free text backed by a list DERIVED from labels already used in
  // this project — so it was empty on any project that had not used the feature, and it
  // treated every typo as a permanent option once saved. That is how one stage became
  // "Store Front Glass", "Storefront glass" and "SF glass".
  //
  // It is now the `construction_stage` option catalogue: org-wide, seeded, ordered, and
  // edited in Admin -> Options like Project Status and Unit Type. Same list on every
  // project, so this can no longer come up empty.
  //
  // Typing one in stays as an escape hatch — genuinely one-off work exists — but it does
  // NOT quietly join the catalogue; it is flagged in Admin to promote or ignore.
  const catalogueQ = useStageCatalogue();
  const catalogue: any[] = Array.isArray(catalogueQ.data) ? catalogueQ.data : [];
  const used = new Set(usedLabels.map((l) => l.trim().toLowerCase()));
  const available = catalogue.filter((t) => !used.has(String(t.label).trim().toLowerCase()));

  // Null means "not chosen yet", resolved on every render rather than frozen at mount.
  // Seeding the state from available.length instead put the modal on the one-off tab every
  // time: the catalogue is still loading on first render, so the count is zero and the
  // escape hatch became the default door.
  const [mode, setMode] = useState<'template' | 'custom' | null>(null);
  const effectiveMode: 'template' | 'custom' = mode ?? (available.length > 0 ? 'template' : 'custom');
  // A set, not one value: seeding a checklist means taking most of the template at once,
  // and doing that a stage at a time is seventeen trips through this modal.
  const [picked, setPicked] = useState<string[]>([]);
  const [label, setLabel] = useState('');
  const [form, setForm] = useState<Record<string, string>>({
    ownerId: '', status: 'NOT_STARTED', inspectionStatus: '', inspectionDate: '',
    startsOn: '', endsOn: '', notes: '',
  });
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [err, setErr] = useState<string | null>(null);

  const toggle = (l: string) => setPicked((p) => (
    p.includes(l) ? p.filter((x) => x !== l) : [...p, l]
  ));
  const allPicked = available.length > 0 && picked.length === available.length;

  const submit = async () => {
    setErr(null);
    try {
      if (effectiveMode === 'template') {
        if (picked.length === 0) { setErr('Pick at least one stage.'); return; }
        // Added in catalogue order regardless of the order they were ticked in — the
        // catalogue's order is the order the work happens in, and a checklist that came
        // out shuffled because of the sequence someone clicked would be worse than
        // useless. Reordering afterwards is a deliberate act, on the grid.
        const labels = available.filter((t: any) => picked.includes(t.label)).map((t: any) => t.label);
        const res = await addStages.mutateAsync({ unitId, labels });
        addToast({
          title: `Added ${res.added} stage${res.added === 1 ? '' : 's'}`,
          color: 'success',
        });
      } else {
        const finalLabel = label.trim();
        if (!finalLabel) { setErr('Give the stage a name.'); return; }
        // Catches what the picker cannot: a typed name matching a stage already here.
        if (used.has(finalLabel.toLowerCase())) {
          setErr(`"${finalLabel}" is already on this unit's checklist.`);
          return;
        }
        await addStage.mutateAsync({
          unitId,
          label: finalLabel,
          ownerId: form.ownerId || null,
          status: form.status || undefined,
          inspectionStatus: form.inspectionStatus || null,
          inspectionDate: form.inspectionDate || null,
          startsOn: form.startsOn || null,
          endsOn: form.endsOn || null,
          notes: form.notes.trim() || null,
        });
        addToast({ title: `Added "${finalLabel}"`, color: 'success' });
      }
      onClose();
    } catch (e) {
      setErr(errMsg(e, 'Could not add the stage'));
    }
  };

  return (
    <Modal isOpen onOpenChange={onClose} size="lg" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Add a stage</span>
          <span className="text-[11px] font-normal text-gray-500">
            Added to this unit only. The stage list itself is edited in Admin → Options.
          </span>
        </ModalHeader>
        <ModalBody className="pb-2">
          {err && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>
          )}

          {available.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                size="sm" variant={effectiveMode === 'template' ? 'solid' : 'flat'}
                color={effectiveMode === 'template' ? 'primary' : 'default'}
                onPress={() => { setMode('template'); setErr(null); }}
              >
                Pick stages
              </Button>
              <Button
                size="sm" variant={effectiveMode === 'custom' ? 'solid' : 'flat'}
                color={effectiveMode === 'custom' ? 'primary' : 'default'}
                onPress={() => { setMode('custom'); setErr(null); }}
              >
                One-off stage
              </Button>
            </div>
          )}

          {effectiveMode === 'template' && available.length > 0 ? (
            <div className="rounded-lg border border-gray-200">
              <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
                <span className="text-xs text-gray-500">
                  {picked.length} of {available.length} selected
                </span>
                <Button
                  size="sm" variant="light"
                  onPress={() => setPicked(allPicked ? [] : available.map((t: any) => t.label))}
                >
                  {allPicked ? 'Clear' : 'Select all'}
                </Button>
              </div>
              {/* One list, in catalogue order. The old two-heading split ("this
                  building's template" / "used elsewhere") existed because the options came
                  from two guessed-at sources; there is one source now. */}
              <div className="max-h-64 overflow-y-auto p-1">
                {available.map((t: any) => (
                  <StageOption
                    key={t.value ?? t.label} item={t}
                    checked={picked.includes(t.label)} onToggle={() => toggle(t.label)}
                  />
                ))}
              </div>
              <p className="border-t border-gray-100 px-3 py-2 text-[11px] text-gray-500">
                Added in the order listed — reorder them on the checklist afterwards. Owner,
                status and dates are set per stage there; a date that fits eighteen stages at
                once does not exist.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {/* Pick ONE stage from the catalogue, with its owner, status and dates set
                  below in the same pass.
                  Until now this tab was a bare text box, so adding a single catalogue
                  stage WITH its detail was impossible: the multi-select tab cannot set
                  per-stage fields (one inspection date across seventeen stages is
                  seventeen wrong dates) and this tab could not reach the catalogue. The
                  common case — "add Slab Pour, owned by Ravi, starting Monday" — had no
                  route that did not involve retyping a name the list already holds. */}
              {available.length > 0 && (
                <Select
                  size="sm"
                  label="Stage"
                  labelPlacement="outside"
                  placeholder="Choose a stage"
                  selectedKeys={label && available.some((t: any) => t.label === label)
                    ? new Set([label])
                    : new Set()}
                  onSelectionChange={(k) => {
                    const v = Array.from(k)[0] as string | undefined;
                    setLabel(v ?? '');
                    setErr(null);
                  }}
                  description="From the shared stage list — the same names every other unit uses."
                >
                  {available.map((t: any) => (
                    <SelectItem key={t.label} textValue={t.label}>{t.label}</SelectItem>
                  ))}
                </Select>
              )}

              {/* `labelPlacement="outside"` on both: the default in-field label sits on
                  top of the placeholder at size="sm", so "Stage name" and
                  "e.g. Temporary hoarding" rendered over each other and neither was
                  readable. Outside placement gives the label its own line. */}
              <Input
                size="sm" label={available.length > 0 ? 'Or type a one-off name' : 'Stage name'}
                labelPlacement="outside"
                value={available.some((t: any) => t.label === label) ? '' : label}
                onValueChange={setLabel}
                placeholder="e.g. Temporary hoarding"
                autoFocus={available.length === 0}
                description={
                  available.length === 0 && catalogue.length === 0
                    ? 'The stage list is empty. Add stages in Admin → Options so every unit can pick the same ones.'
                    : 'For genuinely one-off work. It stays on this unit and is not added to the stage list.'
                }
              />
              {/* The near miss is the whole risk of keeping a text box: "Storefront glass"
                  typed next to a catalogue "Store Front Glass" is how one stage became
                  three names. Named, not blocked — sometimes the similar one is wrong. */}
              {/* Not when the name came from the dropdown just above — telling someone
                  "the list already has Slab Pour" about the Slab Pour they selected FROM
                  the list is the warning crying wolf. */}
              {!available.some((t: any) => t.label === label) && nearestStage(label, catalogue) && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                  The stage list already has{' '}
                  <strong>“{nearestStage(label, catalogue)!.label}”</strong>. Use that one unless
                  this is genuinely different — two spellings of one stage never group in a report.
                </p>
              )}
            </div>
          )}

          {/* Per-stage detail, so only for the single-stage path. These fields cannot
              mean anything applied to a batch: one inspection date across seventeen
              stages is not a shortcut, it is seventeen wrong dates. */}
          {effectiveMode === 'custom' && (<>
          <div className="grid gap-2 sm:grid-cols-2">
            <OwnerField
              ownerId={form.ownerId || null} users={users}
              onChange={(id) => set('ownerId')(id ?? '')}
            />
            <Select
              size="sm" label="Status" selectedKeys={form.status ? new Set([form.status]) : new Set()}
              onSelectionChange={(k) => set('status')((Array.from(k)[0] as string) ?? 'NOT_STARTED')}
            >
              {statusOptions.map((o) => (
                <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm" label="Inspection status"
              selectedKeys={form.inspectionStatus ? new Set([form.inspectionStatus]) : new Set()}
              onSelectionChange={(k) => set('inspectionStatus')((Array.from(k)[0] as string) ?? '')}
            >
              {inspectionOptions.map((o) => (
                <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
              ))}
            </Select>
            <Input size="sm" type="date" label="Inspection date" value={form.inspectionDate}
              onChange={(e) => set('inspectionDate')(e.target.value)} />
            <Input size="sm" type="date" label="Timeline from" value={form.startsOn}
              onChange={(e) => set('startsOn')(e.target.value)} />
            <Input size="sm" type="date" label="to" value={form.endsOn}
              onChange={(e) => set('endsOn')(e.target.value)} />
          </div>

          <Textarea size="sm" minRows={2} label="Note" value={form.notes}
            onValueChange={set('notes')} placeholder="Optional" />
          </>)}
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button
            size="sm" color="primary" onPress={submit}
            isLoading={addStage.isPending || addStages.isPending}
          >
            {effectiveMode === 'template' && picked.length > 1 ? `Add ${picked.length} stages` : 'Add stage'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
