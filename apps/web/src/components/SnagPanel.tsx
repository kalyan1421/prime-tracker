/**
 * SnagPanel — Full-featured snagging / punch-list panel.
 *
 * Replaces the minimal inline SnagList in InteriorPanel.
 * Shows per-item cards with room, assignee, status, progress summary,
 * and inline add form.
 */

import { useState } from 'react';
import {
  Button, Chip, Input, Progress, Select, SelectItem,
  Textarea, Tooltip, addToast,
} from '@heroui/react';
import {
  FiAlertCircle, FiCheckCircle, FiClock, FiFilter,
  FiPlus, FiUser, FiMapPin,
} from 'react-icons/fi';
import { useAddSnag, useResolveSnag, useUpdateSnag, useUsers } from '../hooks/useApi';
import { errMsg } from '../utils/fmt';
import { FormError } from './FormError';

// ─── types ────────────────────────────────────────────────────────────────────

export type SnagStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

interface Snag {
  id: string;
  description: string;
  room?: string;
  assignee?: string;
  status: SnagStatus;
  createdAt?: string;
  resolvedAt?: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const STATUS_META: Record<SnagStatus, {
  label: string;
  color: 'danger' | 'warning' | 'success';
  icon: React.ReactNode;
}> = {
  OPEN:        { label: 'Open',        color: 'danger',  icon: <FiAlertCircle className="text-red-500" /> },
  IN_PROGRESS: { label: 'In Progress', color: 'warning', icon: <FiClock className="text-amber-500" /> },
  RESOLVED:    { label: 'Resolved',    color: 'success', icon: <FiCheckCircle className="text-green-500" /> },
};

const EMPTY_FORM = { description: '', room: '', assigneeId: '' };

// ─── main component ───────────────────────────────────────────────────────────

export function SnagPanel({
  projectId,
  snags = [],
}: {
  projectId: string;
  snags: Snag[];
}) {
  const add     = useAddSnag();
  const resolve = useResolveSnag();
  const update  = useUpdateSnag();
  const { data: usersData } = useUsers();
  const users: any[] = Array.isArray(usersData) ? usersData : [];

  const [filter, setFilter] = useState<SnagStatus | 'ALL'>('ALL');
  const [adding, setAdding] = useState(false);
  const [form, setForm]     = useState(EMPTY_FORM);
  const [snagErr, setSnagErr] = useState<string | null>(null);

  const set = (f: keyof typeof EMPTY_FORM) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((p) => ({ ...p, [f]: e.target.value }));
      if (f === 'description') setSnagErr(null);
    };

  // ── counts ──────────────────────────────────────────────────────────────────
  const total      = snags.length;
  const openCount  = snags.filter((s) => s.status === 'OPEN').length;
  const wipCount   = snags.filter((s) => s.status === 'IN_PROGRESS').length;
  const doneCount  = snags.filter((s) => s.status === 'RESOLVED').length;
  const pct        = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const visible = filter === 'ALL' ? snags : snags.filter((s) => s.status === filter);

  // ── actions ─────────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!form.description.trim()) {
      setSnagErr('Description is required');
      return;
    }
    setSnagErr(null);
    try {
      await add.mutateAsync({
        id: projectId,
        data: {
          description: form.description.trim(),
          room:        form.room.trim() || undefined,
          assigneeId:  form.assigneeId || undefined,
        },
      });
      setForm(EMPTY_FORM);
      setAdding(false);
      addToast({ title: 'Snag added', color: 'success' });
    } catch (e) {
      setSnagErr(errMsg(e, 'Failed to add snag'));
      addToast({ title: errMsg(e, 'Failed to add snag'), color: 'danger' });
    }
  };

  const handleResolve = async (id: string) => {
    try {
      await resolve.mutateAsync(id);
      addToast({ title: 'Snag resolved ✓', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to resolve'), color: 'danger' });
    }
  };

  const handleSetWIP = async (id: string) => {
    try {
      await update.mutateAsync({ id, data: { status: 'IN_PROGRESS' } });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to update'), color: 'danger' });
    }
  };

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* ── progress header ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Punch List
            </span>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                <FiAlertCircle size={11} /> {openCount} open
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                <FiClock size={11} /> {wipCount} in progress
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                <FiCheckCircle size={11} /> {doneCount} resolved
              </span>
            </div>
          </div>
          <Button
            size="sm" variant="flat" color="primary"
            startContent={<FiPlus size={13} />}
            onPress={() => { setAdding((v) => !v); setSnagErr(null); setForm(EMPTY_FORM); }}
          >
            Add snag
          </Button>
        </div>

        {total > 0 && (
          <div className="flex items-center gap-2">
            <Progress
              aria-label="snag resolution progress"
              value={pct}
              size="sm"
              color={pct === 100 ? 'success' : 'warning'}
              className="flex-1"
            />
            <span className="text-xs text-gray-500 shrink-0 w-10 text-right">{pct}%</span>
          </div>
        )}
      </div>

      {/* ── add form ── */}
      {adding && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 space-y-2.5">
          <FormError message={snagErr} />
          <Textarea
            size="sm" label="Description" placeholder="e.g. Paint peel on west wall corner"
            value={form.description} onChange={set('description')}
            minRows={2}
            isInvalid={!!snagErr && !form.description.trim()}
            errorMessage="Required"
          />
          <div className="flex gap-2">
            <Input
              size="sm" label="Room / Location" placeholder="e.g. Reception"
              value={form.room} onChange={set('room')}
              startContent={<FiMapPin size={13} className="text-gray-400" />}
            />
            <Select
              size="sm" label="Assignee" placeholder="Unassigned"
              selectedKeys={form.assigneeId ? [form.assigneeId] : []}
              onChange={set('assigneeId')}
              startContent={<FiUser size={13} className="text-gray-400" />}
            >
              {users.map((u) => <SelectItem key={u.id}>{u.name}</SelectItem>)}
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="light" onPress={() => { setAdding(false); setForm(EMPTY_FORM); setSnagErr(null); }}>
              Cancel
            </Button>
            <Button size="sm" color="primary" isLoading={add.isPending} onPress={handleAdd}>
              Add snag
            </Button>
          </div>
        </div>
      )}

      {/* ── filter bar ── */}
      {total > 0 && (
        <div className="flex items-center gap-1.5">
          <FiFilter size={12} className="text-gray-400" />
          {(['ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {f === 'ALL' ? 'All' : f === 'IN_PROGRESS' ? 'In Progress' : f.charAt(0) + f.slice(1).toLowerCase()}
              {f === 'ALL' && ` (${total})`}
              {f === 'OPEN' && ` (${openCount})`}
              {f === 'IN_PROGRESS' && ` (${wipCount})`}
              {f === 'RESOLVED' && ` (${doneCount})`}
            </button>
          ))}
        </div>
      )}

      {/* ── snag list ── */}
      {total === 0 && !adding && (
        <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center">
          <FiCheckCircle className="mx-auto mb-2 text-2xl text-gray-300" />
          <p className="text-sm text-gray-400">No snags logged yet.</p>
          <p className="text-xs text-gray-300 mt-0.5">Add items during site walk-through.</p>
        </div>
      )}

      <div className="space-y-2">
        {visible.map((snag) => {
          const meta = STATUS_META[snag.status];
          return (
            <div
              key={snag.id}
              className={`rounded-xl border p-3 transition-colors ${
                snag.status === 'RESOLVED'
                  ? 'border-gray-100 bg-gray-50/60 opacity-70'
                  : snag.status === 'IN_PROGRESS'
                  ? 'border-amber-100 bg-amber-50/30'
                  : 'border-red-100 bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2 min-w-0">
                  <span className="mt-0.5 shrink-0">{meta.icon}</span>
                  <div className="min-w-0">
                    <p className={`text-sm font-medium leading-snug ${snag.status === 'RESOLVED' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                      {snag.description}
                    </p>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {snag.room && (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <FiMapPin size={10} /> {snag.room}
                        </span>
                      )}
                      {snag.assignee && (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <FiUser size={10} /> {snag.assignee}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Chip size="sm" color={meta.color} variant="flat" className="text-[10px]">
                    {meta.label}
                  </Chip>

                  {snag.status === 'OPEN' && (
                    <Tooltip content="Mark in progress">
                      <Button
                        size="sm" isIconOnly variant="light"
                        onPress={() => handleSetWIP(snag.id)}
                        isLoading={update.isPending}
                        aria-label="Mark in progress"
                      >
                        <FiClock size={13} className="text-amber-500" />
                      </Button>
                    </Tooltip>
                  )}

                  {snag.status !== 'RESOLVED' && (
                    <Tooltip content="Mark resolved">
                      <Button
                        size="sm" isIconOnly variant="light" color="success"
                        onPress={() => handleResolve(snag.id)}
                        isLoading={resolve.isPending}
                        aria-label="Mark resolved"
                      >
                        <FiCheckCircle size={13} />
                      </Button>
                    </Tooltip>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
