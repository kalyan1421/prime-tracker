import { useRef, useState } from 'react';
import {
  Card, CardBody, CardHeader, Button, Input, Textarea, Avatar, Chip, addToast,
} from '@heroui/react';
import { FiCamera, FiTrash2, FiPlus, FiCloud, FiUsers, FiClipboard, FiX, FiImage } from 'react-icons/fi';
import {
  useDailyLogs, useCreateDailyLog, useDeleteDailyLog, useAddDailyLogPhoto, useRemoveDailyLogPhoto,
  usePresignedUpload,
} from '../hooks/useApi';
import { fmtDate, PermissionGate } from './ui';

const photoUrl = (photo: { url?: string; storagePath: string }) => photo.url || '';

const errMsg = (err: unknown, fallback: string) => {
  const msg = (err as any)?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : typeof msg === 'string' ? msg : fallback;
};

const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * Daily construction log feed for a project (optionally a building).
 * Mobile-first: a compact capture form + a recent-first feed with photo thumbnails.
 */
export function DailyLogFeed({ projectId, buildingId }: { projectId: string; buildingId?: string }) {
  const { data, isLoading } = useDailyLogs(projectId, buildingId);
  const create = useCreateDailyLog();
  const addPhoto = useAddDailyLogPhoto();
  const presigned = usePresignedUpload();
  const logs: any[] = Array.isArray(data) ? data : [];

  const [form, setForm] = useState<Record<string, string>>({ logDate: todayStr(), notes: '', weather: '', crewCount: '' });
  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Pending images selected before posting
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
    if (!form.notes.trim()) return addToast({ title: 'Add what happened on site', color: 'warning' });
    try {
      setUploading(true);
      const log = await create.mutateAsync({
        projectId,
        buildingId: buildingId || undefined,
        logDate: form.logDate ? new Date(form.logDate).toISOString() : undefined,
        notes: form.notes.trim(),
        weather: form.weather || undefined,
        crewCount: form.crewCount ? Number(form.crewCount) : undefined,
      });
      // Upload any pending photos sequentially
      for (const { file } of pendingFiles) {
        try {
          const { storagePath } = await presigned.mutateAsync({ file, category: 'daily-logs' });
          await addPhoto.mutateAsync({ id: (log as any).id, storagePath });
        } catch {
          // non-fatal — log was created, photo upload failed
        }
      }
      pendingFiles.forEach((p) => URL.revokeObjectURL(p.preview));
      setPendingFiles([]);
      setForm({ logDate: todayStr(), notes: '', weather: '', crewCount: '' });
      addToast({ title: 'Log posted', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to post log'), color: 'danger' });
    } finally {
      setUploading(false);
    }
  };

  const isPosting = create.isPending || uploading;

  return (
    <Card shadow="sm">
      <CardHeader className="pb-2 flex items-center gap-2">
        <FiClipboard className="text-blue-600" />
        <p className="font-semibold text-sm text-gray-600">Daily Logs {logs.length > 0 && `(${logs.length})`}</p>
      </CardHeader>
      <CardBody className="pt-0 space-y-4">
        {/* Capture form — gated to editors */}
        <PermissionGate permission="dailylog:edit">
          <div className="rounded-lg border border-gray-100 p-3 space-y-2 bg-gray-50/50">
            <Textarea
              size="sm" minRows={2} label="What happened on site today?"
              value={form.notes} onChange={set('notes')} placeholder="Poured foundation for Building A, inspection passed…"
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
                      className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Remove photo"
                    >
                      <FiX className="w-2.5 h-2.5 text-white" />
                    </button>
                  </div>
                ))}
                {/* Add more */}
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-0.5 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors shrink-0"
                  aria-label="Add more photos"
                >
                  <FiPlus className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Input size="sm" type="date" label="Date" value={form.logDate} onChange={set('logDate')} />
              <Input size="sm" label="Weather" value={form.weather} onChange={set('weather')} placeholder="Sunny, 78°F" />
              <Input size="sm" type="number" label="Crew" value={form.crewCount} onChange={set('crewCount')} />
              <div className="flex gap-1.5 self-end">
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
            </div>

            {/* hidden file input — multiple, no capture so user can pick from gallery too */}
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

        {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
        {!isLoading && logs.length === 0 && (
          <p className="text-sm text-gray-400">No daily logs yet. Field crews can post progress + photos from their phone.</p>
        )}

        <div className="space-y-3">
          {logs.map((log) => (
            <DailyLogCard key={log.id} log={log} />
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function DailyLogCard({ log }: { log: any }) {
  const del = useDeleteDailyLog();
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
          <Avatar size="sm" name={log.author?.name} src={log.author?.avatarUrl} className="w-6 h-6 text-[10px]" />
          <div>
            <p className="text-sm font-medium">{fmtDate(log.logDate)}</p>
            <p className="text-xs text-gray-400">
              {log.author?.name}{log.building?.name ? ` · ${log.building.name}` : ''}
            </p>
          </div>
        </div>
        <PermissionGate permission="dailylog:edit">
          <Button size="sm" variant="light" color="danger" isIconOnly className="h-6 w-6 min-w-6" onPress={() => del.mutate(log.id)}>
            <FiTrash2 className="text-xs" />
          </Button>
        </PermissionGate>
      </div>

      <p className="text-sm text-gray-700 whitespace-pre-wrap mt-2">{log.notes}</p>

      <div className="flex flex-wrap gap-1.5 mt-2">
        {log.weather && <Chip size="sm" variant="flat" startContent={<FiCloud className="text-xs" />}>{log.weather}</Chip>}
        {log.crewCount != null && <Chip size="sm" variant="flat" startContent={<FiUsers className="text-xs" />}>{log.crewCount} crew</Chip>}
      </div>

      <div className="flex flex-wrap gap-2 mt-2 items-center">
        {photos.map((p) => (
          <div key={p.id} className="relative group rounded border border-gray-200 overflow-hidden w-20 h-20 bg-gray-100">
            <img
              src={photoUrl(p)} alt={p.caption || ''}
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
            />
            <PermissionGate permission="dailylog:edit">
              <button
                type="button" aria-label="Remove photo" onClick={() => removePhoto.mutate(p.id)}
                className="absolute top-0.5 right-0.5 bg-white/80 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <FiTrash2 className="text-[10px] text-red-600" />
              </button>
            </PermissionGate>
          </div>
        ))}
        <PermissionGate permission="dailylog:edit">
          <Button
            size="sm" variant="flat" className="h-20 w-20 min-w-20 flex-col"
            onPress={() => fileRef.current?.click()}
            isLoading={presigned.isPending || addPhoto.isPending}
          >
            <FiCamera />
            <span className="text-[10px]">Photo</span>
          </Button>
          {/* capture=environment opens the rear camera on phones */}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
        </PermissionGate>
      </div>
    </div>
  );
}
