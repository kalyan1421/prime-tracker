import { useRef, useState } from 'react';
import {
  Card, CardBody, CardHeader, Button, Input, Avatar, Chip, Select, SelectItem, addToast,
} from '@heroui/react';
import { FiCamera, FiTrash2, FiPlus, FiCloud, FiUsers, FiClipboard, FiX, FiImage, FiHome, FiGrid, FiSmartphone, FiCornerDownRight, FiCheckSquare, FiEdit2 } from 'react-icons/fi';
import {
  useDailyLogs, useCreateDailyLog, useDeleteDailyLog, useUpdateDailyLog,
  useAddDailyLogPhoto, useRemoveDailyLogPhoto,
  usePresignedUpload, useBuildings, useUnitConstructionStages, useAssignableUsers,
} from '../hooks/useApi';
import { MentionBox, MentionText } from './MentionText';
import { useSiteOutbox } from '../hooks/useSiteOutbox';
import { SiteOutboxNotice } from './SiteOutbox';
import type { MentionUser } from './MentionTextarea';
import { fmtDate, errMsg } from '../utils/fmt';
import { PermissionGate } from './ui';
import { useAuthStore } from '../store/authStore';
import { FormError } from './FormError';
import { wideSelectProps } from './ui';

const photoUrl = (photo: { url?: string; storagePath: string }) => photo.url || '';

const todayStr = () => new Date().toISOString().slice(0, 10);

/** Who can be @mentioned in a site update (ST-10) — the same list the owner pickers use. */
function useMentionUsers(): MentionUser[] {
  const { data } = useAssignableUsers();
  return Array.isArray(data) ? data : [];
}

/**
 * How the update arrived. WEB is deliberately absent: it is the unremarkable default and a
 * chip on every single row would be noise. The client's own board does the same — it marks a
 * post made from a phone and says nothing about the rest.
 *
 * Only MOBILE is listed because only WEB and MOBILE are reachable — inbound email ingestion
 * was removed on 2026-08-27. An unknown value renders no chip rather than breaking the row,
 * so restoring a channel is a matter of adding its entry back here.
 */
const SOURCE_MARKS: Record<string, { icon: JSX.Element; label: string; color: 'default' | 'primary' | 'success' }> = {
  MOBILE: { icon: <FiSmartphone className="text-xs" />, label: 'From site', color: 'default' },
};

/**
 * The site update feed. Scoped to a project, a building, or a single unit.
 *
 * `unitId` is the narrowest scope and the one the Site Tracker links to. When it is set the
 * building selector disappears: the API derives the building from the unit, so offering the
 * choice would let someone file a unit's update under a building it is not in.
 *
 * The weather and crew fields also drop away at unit scope — they describe a site day, not
 * one unit's fit-out, and every unit-level post would otherwise carry the same two values.
 */
export function DailyLogFeed({
  projectId, buildingId, unitId, title, showList = true, bare = false, onPosted,
}: {
  projectId: string; buildingId?: string; unitId?: string; title?: string;
  /** Composer only. Used when a merged timeline elsewhere is already showing the posts. */
  showList?: boolean;
  /** Drop the Card chrome, for embedding inside another section. */
  bare?: boolean;
  /** After an update is posted or kept on the device — e.g. to close a collapsible composer. */
  onPosted?: () => void;
}) {
  const { data, isLoading } = useDailyLogs(projectId, buildingId, unitId);
  const { data: buildingsData } = useBuildings(projectId);
  // Only meaningful at unit scope — a site-wide log has no stage to hang off.
  const { data: stagesData } = useUnitConstructionStages(unitId);
  const stages: any[] = Array.isArray(stagesData) ? stagesData : [];
  const create = useCreateDailyLog();
  const addPhoto = useAddDailyLogPhoto();
  const presigned = usePresignedUpload();
  const mentionUsers = useMentionUsers();
  const outbox = useSiteOutbox();
  const logs: any[] = Array.isArray(data) ? data : [];
  const buildings: any[] = Array.isArray(buildingsData) ? buildingsData : [];

  const [form, setForm] = useState<Record<string, string>>({
    logDate: todayStr(), notes: '', weather: '', crewCount: '', buildingId: buildingId || '',
    stageId: '',
  });
  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const [logFeedErr, setLogFeedErr] = useState<string | null>(null);

  const [pendingFiles, setPendingFiles] = useState<{ file: File; preview: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const next = files.map((file) => ({ file, preview: URL.createObjectURL(file) }));
    setPendingFiles((prev) => [...prev, ...next]);
  };

  const removePending = (idx: number) => {
    setPendingFiles((prev) => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const submit = async () => {
    if (!form.notes.trim()) {
      setLogFeedErr('Add what happened on site');
      return;
    }
    setLogFeedErr(null);
    try {
      setUploading(true);
      // No signal: a text-only update is kept on this device and sent later (SiteOutbox).
      const result = await outbox.postOrQueue({
        projectId,
        unitId: unitId || undefined,
        // At unit scope the server derives this from the unit; sending the form value
        // would be the caller asserting something it cannot know better than the server.
        buildingId: unitId ? undefined : (form.buildingId || undefined),
        logDate: form.logDate ? new Date(form.logDate).toISOString() : undefined,
        notes: form.notes.trim(),
        weather: form.weather || undefined,
        crewCount: form.crewCount ? Number(form.crewCount) : undefined,
        stageId: form.stageId || undefined,
      }, { send: create.mutateAsync, hasPhotos: pendingFiles.length > 0 });
      if (result.status === 'queued') {
        setForm({ logDate: todayStr(), notes: '', weather: '', crewCount: '', buildingId: buildingId || '', stageId: '' });
        addToast({ title: 'No signal — saved on this device. It will post on its own when there is.', color: 'warning' });
        onPosted?.();
        return;
      }
      const log = result.log;
      for (const { file } of pendingFiles) {
        try {
          const { storagePath } = await presigned.mutateAsync({ file, category: 'daily-logs' });
          await addPhoto.mutateAsync({ id: (log as any).id, storagePath });
        } catch {
          // non-fatal — log created, photo upload failed
        }
      }
      pendingFiles.forEach((p) => URL.revokeObjectURL(p.preview));
      setPendingFiles([]);
      setForm({ logDate: todayStr(), notes: '', weather: '', crewCount: '', buildingId: buildingId || '', stageId: '' });
      addToast({ title: 'Log posted', color: 'success' });
      onPosted?.();
    } catch (e) {
      // With photos attached nothing is queued: they need a connection to upload, so the
      // text and the photos stay in the composer for another try.
      const offlineWithPhotos = pendingFiles.length > 0 && !(e as any)?.response;
      const msg = offlineWithPhotos
        ? 'No signal. Photos need a connection — your update and photos are still here, try again when you have signal.'
        : errMsg(e, 'Failed to post log');
      setLogFeedErr(msg);
      addToast({ title: msg, color: 'danger' });
    } finally {
      setUploading(false);
    }
  };

  const isPosting = create.isPending || uploading;

  const body = (
    <>
        <PermissionGate permission="dailylog:edit">
          <div className="rounded-lg border border-gray-100 p-3 space-y-2 bg-gray-50/50">
            <SiteOutboxNotice projectId={projectId} unitId={unitId} />
            <FormError message={logFeedErr} />
            <MentionBox
              label={unitId ? 'What happened on this unit?' : 'What happened on site today?'}
              value={form.notes} users={mentionUsers}
              onChange={(v) => { setForm((f) => ({ ...f, notes: v })); setLogFeedErr(null); }}
              placeholder={unitId
                ? 'Cabinets delivered, countertop template still not scheduled… type @ to notify someone'
                : 'Poured foundation for Building A, inspection passed… type @ to notify someone'}
            />

            {/* Photo previews */}
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {pendingFiles.map(({ preview }, idx) => (
                  <div key={idx} className="relative group w-16 h-16 rounded-lg overflow-hidden border border-gray-200 bg-gray-100 shrink-0">
                    <img src={preview} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removePending(idx)}
                      className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5 can-hover:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
                      aria-label="Remove photo"
                    >
                      <FiX className="w-2.5 h-2.5 text-white" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-0.5 text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors shrink-0"
                  aria-label="Add more photos"
                >
                  <FiPlus className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className={`grid gap-2 ${unitId ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-4'}`}>
              <Input size="sm" type="date" label="Date" value={form.logDate} onChange={set('logDate')} />
              {!unitId && (
                <Input size="sm" label="Weather" value={form.weather} onChange={set('weather')} placeholder="Sunny, 78°F" />
              )}
              {!unitId && (
                <Input size="sm" type="number" label="Crew" value={form.crewCount} onChange={set('crewCount')} />
              )}
              {/* Pin to a checklist stage — unit scope only, and only once the unit HAS a
                  checklist. Expected to stay empty most of the time: most updates are about
                  the unit, not one step of it. */}
              {unitId && stages.length > 0 && (
                <Select
                  size="sm"
                  label="Pin to stage (optional)"
                  selectedKeys={form.stageId ? new Set([form.stageId]) : new Set()}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0] as string ?? '';
                    setForm((f) => ({ ...f, stageId: val }));
                  }}
                >
                  {stages.map((st: any) => (
                    <SelectItem key={st.id} textValue={st.label}>{st.label}</SelectItem>
                  ))}
                </Select>
              )}
              {/* Building tag — show selector only when the feed is at project scope */}
              {!unitId && !buildingId && buildings.length > 0 && (
                <Select
                  size="sm"
                  label="Building (optional)"
                  {...wideSelectProps}
                  selectedKeys={form.buildingId ? new Set([form.buildingId]) : new Set()}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0] as string ?? '';
                    setForm((f) => ({ ...f, buildingId: val }));
                  }}
                >
                  {buildings.map((b) => (
                    <SelectItem key={b.id} textValue={b.name}>{b.name}</SelectItem>
                  ))}
                </Select>
              )}
            </div>

            <div className="flex gap-1.5">
              <Button
                size="sm" variant="flat" className="h-10 min-w-10 px-3"
                onPress={() => photoInputRef.current?.click()}
                aria-label="Attach photos"
              >
                <FiImage className="w-4 h-4" />
                {pendingFiles.length > 0 && (
                  <span className="ml-1 text-xs font-semibold text-blue-600">{pendingFiles.length}</span>
                )}
              </Button>
              <Button color="primary" className="h-10 flex-1" onPress={submit} isLoading={isPosting} startContent={<FiPlus />}>
                Post
              </Button>
            </div>

            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handlePhotoSelect}
            />
          </div>
        </PermissionGate>

        {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
        {showList && !isLoading && logs.length === 0 && (
          <p className="text-sm text-gray-500">
            {unitId
              ? 'No updates on this unit yet. Post progress and photos from the site.'
              : 'No daily logs yet. Field crews can post progress + photos from their phone.'}
          </p>
        )}

      {showList && (
        <div className="space-y-3">
          {logs.map((log) => (
            <DailyLogCard key={log.id} log={log} showUnit={!unitId} projectId={projectId} />
          ))}
        </div>
      )}
    </>
  );

  // `bare` drops the Card so this can sit inside another section's chrome without the
  // page ending up with a card inside a card inside a card.
  if (bare) return <div className="space-y-4">{body}</div>;

  return (
    <Card shadow="sm">
      <CardHeader className="pb-2 flex items-center gap-2">
        <FiClipboard className="text-blue-600" />
        <p className="font-semibold text-sm text-gray-600">
          {title ?? (unitId ? 'Site Updates' : 'Daily Logs')} {logs.length > 0 && `(${logs.length})`}
        </p>
      </CardHeader>
      <CardBody className="pt-0 space-y-4">{body}</CardBody>
    </Card>
  );
}

function DailyLogCard({ log, showUnit = true, projectId, isReply = false }: {
  log: any; showUnit?: boolean; projectId: string; isReply?: boolean;
}) {
  const del = useDeleteDailyLog();
  const create = useCreateDailyLog();
  // Delete rule (client, 2026-10-16): your own update, or anyone's with siteTracker:manage
  // (Founder / Super Admin). It used to be anyone with dailylog:edit, one click, no confirm.
  const me = useAuthStore((s) => s.user?.id);
  const canManage = useAuthStore((s) => s.hasPermission('siteTracker:manage'));
  const authorId = log.author?.id ?? log.authorId;
  const mayDelete = canManage || (!!authorId && authorId === me);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const removeLog = () => del.mutate(log.id, {
    onSuccess: () => { setConfirmingDelete(false); addToast({ title: 'Update deleted', color: 'success' }); },
    onError: (e) => addToast({ title: errMsg(e, 'Could not delete the update'), color: 'danger' }),
  });
  // Editing an update, rather than deleting and re-posting it.
  //
  // PATCH /daily-logs/:id existed with a DTO covering notes, weather and crew, and no
  // screen reached it — so fixing a typo meant deleting the update and writing it again,
  // which loses its place in the feed and takes its photos with it. This is the feature
  // people use on a phone, on site, one-handed.
  const update = useUpdateDailyLog();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [editErr, setEditErr] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState('');
  const mentionUsers = useMentionUsers();
  const mentionNames = mentionUsers.map((u) => u.name ?? '').filter(Boolean);
  const outbox = useSiteOutbox();
  const addPhoto = useAddDailyLogPhoto();
  const removePhoto = useRemoveDailyLogPhoto();
  const presigned = usePresignedUpload();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const photos: any[] = log.photos ?? [];

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { storagePath } = await presigned.mutateAsync({ file, category: 'daily-logs' });
      await addPhoto.mutateAsync({ id: log.id, storagePath });
      addToast({ title: 'Photo added', color: 'success' });
    } catch (err: any) {
      addToast({ title: err?.message || 'Upload failed', color: 'danger' });
    }
  };

  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Avatar size="sm" name={log.author?.name} src={log.author?.avatarUrl} className="w-6 h-6 text-[11px]" />
          <div>
            <p className="text-sm font-medium">{fmtDate(log.logDate)}</p>
            <p className="text-xs text-gray-500">{log.author?.name}</p>
          </div>
        </div>
        <PermissionGate permission="dailylog:edit">
          <div className="flex items-center gap-0.5">
            <Button
              size="sm" variant="light" isIconOnly className="h-6 w-6 min-w-6"
              aria-label="Edit this update"
              onPress={() => { setEditing(true); setDraft(log.notes ?? ''); setEditErr(null); }}
            >
              <FiEdit2 className="text-xs" />
            </Button>
            {mayDelete && (
              <Button size="sm" variant="light" color="danger" isIconOnly className="h-6 w-6 min-w-6" aria-label="Delete this update" onPress={() => setConfirmingDelete(true)}>
                <FiTrash2 className="text-xs" />
              </Button>
            )}
          </div>
        </PermissionGate>
      </div>

      {/* Inline, not a modal: it is one sentence and two buttons, on a phone, on site. */}
      {confirmingDelete && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
          <span className="mr-auto">
            Delete this update{photos.length ? ` and its ${photos.length} photo${photos.length === 1 ? '' : 's'}` : ''}? This can't be undone.
          </span>
          <Button size="sm" variant="light" onPress={() => setConfirmingDelete(false)} isDisabled={del.isPending}>Cancel</Button>
          <Button size="sm" color="danger" onPress={removeLog} isLoading={del.isPending}>Delete</Button>
        </div>
      )}

      {editing ? (
        <div className="mt-2 space-y-2">
          <FormError message={editErr} />
          <MentionBox label="Update text" hideLabel value={draft} onChange={setDraft} users={mentionUsers} />
          <div className="flex items-center gap-2">
            <Button
              size="sm" color="primary" isLoading={update.isPending}
              onPress={async () => {
                const notes = draft.trim();
                // The DTO rejects an empty string; say so here rather than letting a
                // 400 come back for something the form can see.
                if (!notes) { setEditErr('An update needs some text. Delete it instead if it should go.'); return; }
                if (notes === (log.notes ?? '')) { setEditing(false); return; }
                try {
                  await update.mutateAsync({ id: log.id, data: { notes } });
                  setEditing(false);
                  addToast({ title: 'Update edited', color: 'success' });
                } catch (err) {
                  setEditErr(errMsg(err, 'Could not save the edit'));
                }
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="light" onPress={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-700 whitespace-pre-wrap mt-2"><MentionText text={log.notes ?? ''} names={mentionNames} /></p>
      )}

      {/* Chips: building tag + weather + crew */}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {SOURCE_MARKS[log.source] && (
          <Chip
            size="sm" variant="flat" color={SOURCE_MARKS[log.source].color}
            startContent={SOURCE_MARKS[log.source].icon}
          >
            {SOURCE_MARKS[log.source].label}
          </Chip>
        )}
        {showUnit && log.unit?.unitNumber && (
          <Chip size="sm" variant="flat" color="secondary" startContent={<FiGrid className="text-xs" />}>
            Unit {log.unit.unitNumber}
          </Chip>
        )}
        {showUnit && log.building?.name && (
          <Chip size="sm" variant="flat" color="primary" startContent={<FiHome className="text-xs" />}>
            {log.building.name}
          </Chip>
        )}
        {log.weather && <Chip size="sm" variant="flat" startContent={<FiCloud className="text-xs" />}>{log.weather}</Chip>}
        {log.crewCount != null && <Chip size="sm" variant="flat" startContent={<FiUsers className="text-xs" />}>{log.crewCount} crew</Chip>}
        {log.stage?.label && (
          <Chip size="sm" variant="flat" color="warning" startContent={<FiCheckSquare className="text-xs" />}>
            {log.stage.label}
          </Chip>
        )}
      </div>

      {/* Only when the update actually has photos. The add-button used to sit on every card
          as an empty 80x80 box, which is a lot of furniture for something most updates never
          use — the first photo is attached in the composer when the update is written. */}
      {photos.length > 0 && (
      <div className="flex flex-wrap gap-2 mt-2 items-center">
        {photos.map((p) => (
          <div key={p.id} className="relative group rounded border border-gray-200 overflow-hidden w-20 h-20 bg-gray-100">
            <img
              src={photoUrl(p)} alt={p.caption || ''}
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
            />
            {mayDelete && (
              <button
                type="button" aria-label="Remove photo"
                onClick={() => removePhoto.mutate(p.id, {
                  onError: (e) => addToast({ title: errMsg(e, 'Could not remove the photo'), color: 'danger' }),
                })}
                className="absolute top-0.5 right-0.5 bg-white/80 rounded p-0.5 can-hover:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
              >
                <FiTrash2 className="text-[11px] text-red-600" />
              </button>
            )}
          </div>
        ))}
        <PermissionGate permission="dailylog:edit">
          <Button
            size="sm" variant="flat" className="h-20 w-20 min-w-20 flex-col"
            onPress={() => fileRef.current?.click()}
            isLoading={presigned.isPending || addPhoto.isPending}
          >
            <FiCamera />
            <span className="text-[11px]">Photo</span>
          </Button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
        </PermissionGate>
      </div>
      )}

      {/* Replies. One level only — a reply carries no reply button of its own, matching the
          server rule. Threading a site update is for answering a question, not a forum. */}
      {!isReply && (
        <>
          {(log.replies ?? []).length > 0 && (
            <div className="mt-3 space-y-2 border-l-2 border-gray-100 pl-3">
              {log.replies.map((r: any) => (
                <DailyLogCard key={r.id} log={r} showUnit={false} projectId={projectId} isReply />
              ))}
            </div>
          )}
          <PermissionGate permission="dailylog:edit">
            {replying ? (
              <div className="mt-3 space-y-2 border-l-2 border-gray-100 pl-3">
                <MentionBox
                  label="Reply" hideLabel value={replyText} onChange={setReplyText} users={mentionUsers}
                  placeholder="Reply to this update… type @ to notify someone"
                />
                <div className="flex gap-1.5">
                  <Button
                    size="sm" color="primary" isDisabled={!replyText.trim()} isLoading={create.isPending}
                    onPress={async () => {
                      try {
                        const r = await outbox.postOrQueue(
                          { projectId, parentId: log.id, notes: replyText.trim() },
                          { send: create.mutateAsync },
                        );
                        setReplyText(''); setReplying(false);
                        if (r.status === 'queued') addToast({ title: 'No signal — reply saved on this device. It will post on its own.', color: 'warning' });
                      } catch (e) {
                        addToast({ title: errMsg(e, 'Could not post the reply'), color: 'danger' });
                      }
                    }}
                  >
                    Reply
                  </Button>
                  <Button size="sm" variant="light" onPress={() => { setReplying(false); setReplyText(''); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button" onClick={() => setReplying(true)}
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-blue-600"
              >
                <FiCornerDownRight /> Reply
                {(log.replies ?? []).length > 0 && ` (${log.replies.length})`}
              </button>
            )}
          </PermissionGate>
        </>
      )}
    </div>
  );
}
