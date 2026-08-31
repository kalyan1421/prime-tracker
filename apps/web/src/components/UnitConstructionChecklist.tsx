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
import { FiPlus, FiTrash2, FiZap, FiCamera, FiX, FiMessageSquare } from 'react-icons/fi';
import {
  useUnitConstructionStages, useConstructionTemplate, useApplyConstructionTemplate,
  useAddUnitConstructionStage, useUpdateConstructionStage, useDeleteConstructionStage,
  useCustomOptions, useUsers, useAddStagePhoto, useRemoveStagePhoto, usePresignedUpload,
  useCreateDailyLog, useDailyLogs,
} from '../hooks/useApi';
import { errMsg, fmtDate, fmtDateShort } from '../utils/fmt';
import { LoadingState, EmptyState, chipColor } from './ui';

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
  const { data: usersData } = useUsers();
  const users: any[] = Array.isArray(usersData) ? usersData : [];

  const applyTemplate = useApplyConstructionTemplate();
  const addStage = useAddUnitConstructionStage();
  const updateStage = useUpdateConstructionStage();
  const deleteStage = useDeleteConstructionStage();

  const [adding, setAdding] = useState(false);

  const stages: any[] = Array.isArray(stagesQ.data) ? stagesQ.data : [];
  const template: any[] = Array.isArray(templateQ.data) ? templateQ.data : [];

  if (stagesQ.isLoading) return <LoadingState message="Loading checklist…" />;

  const patch = async (stageId: string, data: Record<string, unknown>) => {
    try {
      await updateStage.mutateAsync({ stageId, unitId, data });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to update the stage'), color: 'danger' });
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
    return (
      <div className="space-y-3">
        <EmptyState
          title="No construction checklist yet"
          message={
            template.length > 0
              ? `Copy this building's ${template.length}-stage template to start tracking this unit.`
              : "This unit's building has no template yet — add stages to start one, or set the template up from the building."
          }
          action={canEdit ? (
            <div className="flex items-center gap-2">
              {template.length > 0 && (
                <Button
                  size="sm" color="primary" startContent={<FiZap size={13} />}
                  onPress={handleApplyTemplate} isLoading={applyTemplate.isPending}
                >
                  Apply template
                </Button>
              )}
              <Button
                size="sm" variant="flat" startContent={<FiPlus size={13} />}
                onPress={() => setAdding(true)}
              >
                Add stage
              </Button>
            </div>
          ) : undefined}
        />
        {adding && (
          <AddStageModal
            unitId={unitId} statusOptions={statusOptions} inspectionOptions={inspectionOptions}
            users={users} onClose={() => setAdding(false)}
            template={template} usedLabels={stages.map((s) => s.label)}
          />
        )}
      </div>
    );
  }

  const doneCount = stages.filter((s) => s.status === 'DONE').length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{doneCount} of {stages.length} stages done</span>
        {canEdit && (
          <Button size="sm" variant="light" startContent={<FiPlus size={13} />} onPress={() => setAdding(true)}>
            Add stage
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-100">
        <table className="w-full text-xs min-w-[980px]">
          <thead>
            <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide text-[11px]">
              <th className="text-left px-3 py-2 font-medium w-8">#</th>
              <th className="text-left px-3 py-2 font-medium">Subitem</th>
              <th className="text-left px-3 py-2 font-medium">Owner</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Inspection Status</th>
              <th className="text-left px-3 py-2 font-medium">Inspection Date</th>
              {/* startsOn/endsOn have been in the schema and writable through the API since
                  Phase 2, and invisible in the app until now. */}
              <th className="text-left px-3 py-2 font-medium">Timeline</th>
              {/* Notes and Updates were two adjacent columns doing the same job — saying
                  something about this stage. One column, one popup, and the cell shows the
                  most recent thing said rather than a count of things said. */}
              <th className="text-left px-3 py-2 font-medium">Notes &amp; updates</th>
              {canEdit && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {stages.map((s) => (
              <tr key={s.id} className="border-t border-gray-100">
                <td className="px-3 py-2 tabular-nums text-gray-500">{s.sortOrder + 1}</td>
                <td className="px-3 py-2 font-medium text-gray-800">{s.label}</td>
                <td className="px-3 py-2 text-gray-700">
                  {s.owner?.name ?? <span className="text-gray-500">—</span>}
                </td>
                <td className="px-3 py-2">
                  {canEdit ? (
                    <Select
                      size="sm" aria-label="Status" className="min-w-[130px]"
                      selectedKeys={s.status ? [s.status] : []}
                      onSelectionChange={(keys) => {
                        const v = Array.from(keys)[0] as string;
                        if (v) patch(s.id, { status: v });
                      }}
                    >
                      {statusOptions.map((o) => (
                        <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
                      ))}
                    </Select>
                  ) : (
                    <Chip size="sm" variant="flat" color={chipColor(statusOptions.find((o) => o.value === s.status)?.color)}>
                      {statusOptions.find((o) => o.value === s.status)?.label ?? s.status}
                    </Chip>
                  )}
                </td>
                <td className="px-3 py-2">
                  {s.inspectionStatus ? (
                    <Chip size="sm" variant="flat" color={chipColor(inspectionOptions.find((o) => o.value === s.inspectionStatus)?.color)}>
                      {inspectionOptions.find((o) => o.value === s.inspectionStatus)?.label ?? s.inspectionStatus}
                    </Chip>
                  ) : <span className="text-gray-500">—</span>}
                </td>
                <td className="px-3 py-2 text-gray-700">
                  {s.inspectionDate ? fmtDateShort(s.inspectionDate) : <span className="text-gray-500">—</span>}
                </td>
                <td className="px-3 py-2 text-gray-700">
                  {s.startsOn || s.endsOn ? (
                    <span className="whitespace-nowrap rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                      {s.startsOn ? fmtDateShort(s.startsOn) : '…'} – {s.endsOn ? fmtDateShort(s.endsOn) : '…'}
                    </span>
                  ) : <span className="text-gray-500">—</span>}
                </td>
                <td className="px-3 py-2">
                  <StageDetailCell
                    stage={s} unitId={unitId} projectId={projectId} canEdit={canEdit}
                    onSaveNotes={(v: string | null) => patch(s.id, { notes: v })}
                    onPatch={(d: Record<string, unknown>) => patch(s.id, d)}
                    users={users} inspectionOptions={inspectionOptions}
                  />
                </td>
                {canEdit && (
                  <td className="px-3 py-2">
                    <Tooltip content="Remove this stage" size="sm">
                      <button
                        type="button"
                        onClick={() => deleteStage.mutate({ stageId: s.id, unitId })}
                        className="text-gray-300 hover:text-red-700 transition-colors"
                      >
                        <FiTrash2 size={13} />
                      </button>
                    </Tooltip>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && (
        <AddStageModal
          unitId={unitId} statusOptions={statusOptions} inspectionOptions={inspectionOptions}
          users={users} onClose={() => setAdding(false)}
          template={template} usedLabels={stages.map((s) => s.label)}
        />
      )}
    </div>
  );
}


/**
 * Notes and updates for one stage, behind a single cell.
 *
 * These were two adjacent columns doing the same job — saying something about this stage —
 * and between them they put an "Add note" link and a message icon on all 18 rows. The cell
 * now shows the most recent thing SAID rather than a count of things said, and everything
 * else moves into a popup that only exists while someone is using it. Photos live in the
 * popup too: they are worth having and not worth a column of empty dashed squares.
 */
function StageDetailCell({ stage, unitId, projectId, canEdit, onSaveNotes, onPatch, users, inspectionOptions }: {
  stage: any; unitId: string; projectId?: string; canEdit: boolean;
  onSaveNotes: (v: string | null) => void;
  onPatch: (d: Record<string, unknown>) => void;
  users: any[]; inspectionOptions: OptionLike[];
}) {
  const [open, setOpen] = useState(false);
  const updateCount = stage._count?.dailyLogs ?? 0;
  const photoCount = (stage.photos ?? []).length;
  // Prefer the note, which is the durable summary of the stage; fall back to a bare count.
  const preview = stage.notes || (updateCount > 0 ? `${updateCount} update${updateCount === 1 ? '' : 's'}` : null);

  return (
    <>
      <button
        type="button" onClick={() => setOpen(true)}
        className="flex w-full max-w-[260px] items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-gray-100"
        aria-label="Open notes and updates for this stage"
      >
        {preview ? (
          <span className="truncate text-gray-700" title={stage.notes || undefined}>{preview}</span>
        ) : (
          <span className="text-gray-500 underline decoration-dotted">Add note</span>
        )}
        {updateCount > 0 && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-gray-500">
            <FiMessageSquare size={11} /><span className="tabular-nums text-[11px]">{updateCount}</span>
          </span>
        )}
        {photoCount > 0 && (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-gray-500">
            <FiCamera size={11} /><span className="tabular-nums text-[11px]">{photoCount}</span>
          </span>
        )}
      </button>
      {open && (
        <StageDetailModal
          stage={stage} unitId={unitId} projectId={projectId} canEdit={canEdit}
          onSaveNotes={onSaveNotes} onPatch={onPatch} users={users} inspectionOptions={inspectionOptions}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function StageDetailModal({ stage, unitId, projectId, canEdit, onSaveNotes, onPatch, users, inspectionOptions, onClose }: any) {
  const create = useCreateDailyLog();
  const addPhoto = useAddStagePhoto();
  const removePhoto = useRemoveStagePhoto();
  const presigned = usePresignedUpload();
  const { data: logsData } = useDailyLogs(projectId, undefined, unitId);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [note, setNote] = useState(stage.notes ?? '');
  const [text, setText] = useState('');
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
          {/* Every field for this stage lives here now. The grid is text so it can be
              scanned; this is where it is changed. Status is the exception and stays in the
              row — it is the field people change on a walk-round and a popup for one click
              would be three. */}
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              size="sm" label="Owner" isDisabled={!canEdit}
              selectedKeys={stage.ownerId ? new Set([stage.ownerId]) : new Set()}
              onSelectionChange={(k) => onPatch({ ownerId: (Array.from(k)[0] as string) ?? null })}
            >
              {users.map((u: any) => (
                <SelectItem key={u.id} textValue={u.name ?? u.email}>{u.name ?? u.email}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm" label="Inspection status" isDisabled={!canEdit}
              selectedKeys={stage.inspectionStatus ? new Set([stage.inspectionStatus]) : new Set()}
              onSelectionChange={(k) => onPatch({ inspectionStatus: (Array.from(k)[0] as string) ?? null })}
            >
              {inspectionOptions.map((o: OptionLike) => (
                <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
              ))}
            </Select>
            <Input
              size="sm" type="date" label="Inspection date" isDisabled={!canEdit}
              value={stage.inspectionDate ? stage.inspectionDate.slice(0, 10) : ''}
              onChange={(e) => onPatch({ inspectionDate: e.target.value || null })}
            />
            <div className="flex items-end gap-1">
              <Input
                size="sm" type="date" label="Timeline from" isDisabled={!canEdit}
                value={stage.startsOn ? stage.startsOn.slice(0, 10) : ''}
                onChange={(e) => onPatch({ startsOn: e.target.value || null })}
              />
              <Input
                size="sm" type="date" label="to" isDisabled={!canEdit}
                value={stage.endsOn ? stage.endsOn.slice(0, 10) : ''}
                onChange={(e) => onPatch({ endsOn: e.target.value || null })}
              />
            </div>
          </div>

          <Textarea
            size="sm" minRows={2} label="Note" value={note} onValueChange={setNote}
            isDisabled={!canEdit}
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
                  {canEdit && (
                    <button
                      type="button" aria-label="Remove photo"
                      onClick={() => removePhoto.mutate({ photoId: p.id, unitId })}
                      className="absolute right-0 top-0 bg-white/85 p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
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
                  <p className="mt-0.5 whitespace-pre-wrap text-xs text-gray-700">{u.notes}</p>
                </div>
              ))}
            </div>
            {canEdit && projectId && (
              <div className="mt-2 flex gap-1.5">
                <Input
                  size="sm" value={text} onChange={(e) => setText(e.target.value)}
                  placeholder="Post an update on this stage" aria-label="Stage update"
                />
                <Button
                  size="sm" color="primary" isLoading={create.isPending} isDisabled={!text.trim()}
                  onPress={async () => {
                    try {
                      await create.mutateAsync({ projectId, unitId, stageId: stage.id, notes: text.trim() });
                      setText('');
                    } catch (e) {
                      addToast({ title: errMsg(e, 'Could not post the update'), color: 'danger' });
                    }
                  }}
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
 * Create a stage from a form rather than a bare row.
 *
 * Two ways in, because there are two real cases: a unit is MISSING a step its template has
 * (pick it from the list and the wording matches everything else), or the work genuinely is
 * one-off (type it). Offering the whole template would mostly list steps already on the
 * checklist, so the dropdown shows only the gap.
 *
 * This docblock described the picker for some time before the picker existed — the modal
 * was free-text only until 2026-09-01. Both halves are now real.
 */
function AddStageModal({
  unitId, statusOptions, inspectionOptions, users, onClose, template = [], usedLabels = [],
}: {
  unitId: string; statusOptions: OptionLike[]; inspectionOptions: OptionLike[]; users: any[];
  onClose: () => void;
  /** The building's stage template — the predefined list. Empty is normal, not an error. */
  template?: any[];
  /** Labels already on this unit, so the list offers the gap rather than the whole template. */
  usedLabels?: string[];
}) {
  const addStage = useAddUnitConstructionStage();

  // A stage name used to be free text only, which is how one unit gets "Store Front Glass",
  // the next "Storefront glass" and a third "SF glass" — three names for one stage, and a
  // rollup that can never group them. The building's template is the list everyone is
  // supposed to be working from, so it is offered first.
  //
  // Typing one in is still allowed rather than removed. Genuinely one-off work exists, and
  // a building whose template hasn't been set up yet would otherwise have no way to add
  // anything at all — the picker simply doesn't appear when there is nothing to pick.
  const used = new Set(usedLabels.map((l) => l.trim().toLowerCase()));
  const available = template.filter((t) => !used.has(String(t.label).trim().toLowerCase()));

  const [mode, setMode] = useState<'template' | 'custom'>(available.length > 0 ? 'template' : 'custom');
  const [picked, setPicked] = useState('');
  const [label, setLabel] = useState('');
  const [form, setForm] = useState<Record<string, string>>({
    ownerId: '', status: 'NOT_STARTED', inspectionStatus: '', inspectionDate: '',
    startsOn: '', endsOn: '', notes: '',
  });
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [err, setErr] = useState<string | null>(null);

  const finalLabel = mode === 'template' ? picked.trim() : label.trim();

  const submit = async () => {
    if (!finalLabel) {
      setErr(mode === 'template' ? 'Pick a stage from the list.' : 'Give the stage a name.');
      return;
    }
    // Catches the case the picker cannot: a typed name that matches a stage already here.
    if (used.has(finalLabel.toLowerCase())) {
      setErr(`"${finalLabel}" is already on this unit's checklist.`);
      return;
    }
    setErr(null);
    try {
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
            Added to this unit only — the template is untouched.
          </span>
        </ModalHeader>
        <ModalBody className="pb-2">
          {err && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>
          )}

          {available.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                size="sm" variant={mode === 'template' ? 'solid' : 'flat'}
                color={mode === 'template' ? 'primary' : 'default'}
                onPress={() => { setMode('template'); setErr(null); }}
              >
                From the template
              </Button>
              <Button
                size="sm" variant={mode === 'custom' ? 'solid' : 'flat'}
                color={mode === 'custom' ? 'primary' : 'default'}
                onPress={() => { setMode('custom'); setErr(null); }}
              >
                One-off stage
              </Button>
            </div>
          )}

          {mode === 'template' && available.length > 0 ? (
            <Select
              size="sm" label="Stage" selectedKeys={picked ? new Set([picked]) : new Set()}
              onSelectionChange={(k) => setPicked((Array.from(k)[0] as string) ?? '')}
              description={`${available.length} of this building's ${template.length} template stages are not on this unit yet.`}
            >
              {available.map((t: any) => (
                <SelectItem key={t.label} textValue={t.label}>{t.label}</SelectItem>
              ))}
            </Select>
          ) : (
            <Input
              size="sm" label="Stage name" value={label} onValueChange={setLabel}
              placeholder="e.g. Store Front Glass" autoFocus
              description={
                template.length === 0
                  ? "This building has no stage template yet — stages added here are one-offs. Set the template up on the building to reuse them across units."
                  : undefined
              }
            />
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              size="sm" label="Owner" selectedKeys={form.ownerId ? new Set([form.ownerId]) : new Set()}
              onSelectionChange={(k) => set('ownerId')((Array.from(k)[0] as string) ?? '')}
            >
              {users.map((u: any) => (
                <SelectItem key={u.id} textValue={u.name ?? u.email}>{u.name ?? u.email}</SelectItem>
              ))}
            </Select>
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
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button size="sm" color="primary" onPress={submit} isLoading={addStage.isPending}>Add stage</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
