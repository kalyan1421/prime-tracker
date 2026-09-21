import { useEffect, useMemo, useState } from 'react';
import {
  Card, CardBody, CardHeader, Button, Select, SelectItem, Input, Chip, Tooltip,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, addToast,
} from '@heroui/react';
import { FiCalendar, FiPlus, FiTrash2, FiEdit2, FiSlash, FiClock, FiAlertTriangle } from 'react-icons/fi';
import {
  useVisitAvailability, useCreateAvailability, useCreateAvailabilityBulk, useUpdateAvailability,
  useDeleteAvailability, useVisitPolicy, useAssignableUsers,
} from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';
import { LoadingState, EmptyState } from '../components/ui';
import { errMsg } from '../utils/fmt';
import api from '../lib/api';

/**
 * Where the host publishes when they are free. Without this page the slot picker is
 * permanently empty, so it ships with the scheduling core rather than after it.
 *
 * Two kinds of rule, deliberately: a weekly pattern you set once, and one-off dates —
 * including BLOCKED days, which beat the weekly pattern. That is what lets someone remove
 * a travel week without dismantling their standing availability.
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const minToLabel = (m: number) => {
  const h = Math.floor(m / 60), mm = m % 60;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
};
const timeToMin = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const minToTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default function VisitAvailabilityPage() {
  const { user, hasPermission } = useAuthStore();
  const canManage = hasPermission('availability:manage');
  const { data: policy } = useVisitPolicy();
  const { data: users } = useAssignableUsers();

  // ANY active user can host a viewing (client, 2026-09-22) — this was leadership-only.
  // The server still refuses to let one person edit another's calendar unless they are
  // leadership, so opening the list here does not open the permission.
  const hosts = useMemo(
    () => ((users as any[]) || []).filter((u: any) => u.isActive !== false),
    [users],
  );
  // Default to yourself ONLY if you are actually a host; otherwise to the first real host.
  // Sales/Marketing hold siteVisit:view and so reach this page from the nav — defaulting
  // to their own id left the picker blank and the page empty, reading as "broken" when the
  // truth was "this is somebody else's calendar".
  const [hostId, setHostId] = useState<string>('');
  useEffect(() => {
    if (hostId) return;
    if (hosts.length === 0) return;
    setHostId(hosts.some((h: any) => h.id === user?.id) ? (user!.id as string) : hosts[0].id);
  }, [hosts, user?.id, hostId]);
  const { data: rules, isLoading } = useVisitAvailability(hostId || undefined);

  const create = useCreateAvailability();
  const createBulk = useCreateAvailabilityBulk();
  const update = useUpdateAvailability();
  const del = useDeleteAvailability();
  // The row being edited. Without this the only way to change 9-6 to 9-5 was delete and
  // re-add, which silently dropped the note too.
  const [editing, setEditing] = useState<any>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();

  const EMPTY = {
    mode: 'weekly', kind: 'OPEN', dayOfWeek: '1', dayOfMonth: '1', date: '', endDate: '',
    start: '09:00', end: '18:00', slotMinutes: '60', note: '',
  };
  const [form, setForm] = useState(EMPTY);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const [confirmDelete, setConfirmDelete] = useState<any>(null);
  const [impact, setImpact] = useState<any>(null);

  const rows: any[] = (rules as any[]) || [];
  const weekly = rows.filter((r) => r.dayOfWeek !== null && r.dayOfWeek !== undefined);
  const monthly = rows.filter((r) => r.dayOfMonth != null);
  const oneOff = rows.filter((r) => r.date); // includes ranges (date + endDate)

  const openEdit = (r: any) => {
    setEditing(r);
    setForm({
      mode: r.date ? (r.endDate ? 'range' : 'oneoff') : (r.dayOfMonth != null ? 'monthly' : 'weekly'),
      kind: r.kind,
      dayOfWeek: String(r.dayOfWeek ?? 1),
      dayOfMonth: String(r.dayOfMonth ?? 1),
      date: r.date ? String(r.date).slice(0, 10) : '',
      endDate: r.endDate ? String(r.endDate).slice(0, 10) : '',
      start: minToTime(r.startMin),
      end: minToTime(r.endMin),
      slotMinutes: String(r.slotMinutes ?? 60),
      note: r.note ?? '',
    });
    onOpen();
  };

  const openCreate = () => { setEditing(null); setForm(EMPTY); onOpen(); };

  const submit = async () => {
    const startMin = timeToMin(form.start);
    const endMin = timeToMin(form.end);
    if (endMin <= startMin) {
      addToast({ title: 'The window must end after it starts', color: 'warning' });
      return;
    }
    if ((form.mode === 'oneoff' || form.mode === 'range') && !form.date) {
      addToast({ title: 'Pick a date', color: 'warning' });
      return;
    }
    if (form.mode === 'range' && !form.endDate) {
      addToast({ title: 'Pick the last day of the range', color: 'warning' });
      return;
    }
    if (form.mode === 'range' && form.endDate < form.date) {
      addToast({ title: 'The range cannot end before it starts', color: 'warning' });
      return;
    }
    // Exactly one of dayOfWeek/date — sending both is a 400, and switching an existing
    // rule between the two must clear the side it is leaving.
    // Exactly one kind — the other two must be explicitly nulled so switching an existing
    // rule between weekly/monthly/one-off clears the side it is leaving.
    const when = form.mode === 'weekly'
      ? { dayOfWeek: Number(form.dayOfWeek), dayOfMonth: null, date: null, endDate: null }
      : form.mode === 'monthly'
        ? { dayOfMonth: Number(form.dayOfMonth), dayOfWeek: null, date: null, endDate: null }
        : form.mode === 'range'
          ? { date: form.date, endDate: form.endDate, dayOfWeek: null, dayOfMonth: null }
          : { date: form.date, endDate: null, dayOfWeek: null, dayOfMonth: null };
    const payload = {
      kind: form.kind,
      ...when,
      startMin, endMin,
      slotMinutes: Number(form.slotMinutes) || 60,
      note: form.note.trim() || null,
    };
    // "Every weekday" / "Every day" expand into one rule per day, sent as a SINGLE bulk
    // request — a loop of seven posts gets truncated by the throttler.
    const BULK_DAYS: Record<string, number[]> = {
      weekdays: [1, 2, 3, 4, 5],
      everyday: [0, 1, 2, 3, 4, 5, 6],
    };
    try {
      if (!editing && BULK_DAYS[form.mode]) {
        const rules = BULK_DAYS[form.mode].map((d) => ({
          hostId,
          kind: form.kind,
          dayOfWeek: d,
          startMin, endMin,
          slotMinutes: Number(form.slotMinutes) || 60,
          note: form.note.trim() || undefined,
        }));
        await createBulk.mutateAsync(rules);
        addToast({ title: `${rules.length} days published`, color: 'success' });
      } else if (editing) {
        await update.mutateAsync({ id: editing.id, data: payload });
        addToast({ title: 'Availability updated', color: 'success' });
      } else {
        await create.mutateAsync({ hostId, ...payload, note: payload.note ?? undefined });
        addToast({ title: 'Availability added', color: 'success' });
      }
      setForm(EMPTY);
      setEditing(null);
      onClose();
    } catch (e) {
      addToast({ title: errMsg(e, `Could not ${editing ? 'update' : 'add'} availability`), color: 'danger' });
    }
  };

  /**
   * Deleting is gated on seeing what it affects: a rule with confirmed visits against it
   * is not the same decision as an empty one. The visits themselves survive — they are
   * already agreed, and the rule that generated them is only a generator.
   */
  const askDelete = async (rule: any) => {
    setConfirmDelete(rule);
    setImpact(null);
    try {
      const { data } = await api.get(`/visit-availability/${rule.id}/delete-impact`);
      setImpact(data);
    } catch {
      setImpact({ affectedCount: 0, affected: [] });
    }
  };

  const doDelete = async () => {
    try {
      await del.mutateAsync(confirmDelete.id);
      addToast({ title: 'Availability removed', color: 'success' });
      setConfirmDelete(null);
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not remove it'), color: 'danger' });
    }
  };

  const ruleRow = (r: any) => (
    <div key={r.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-200 bg-white">
      {r.kind === 'BLOCKED'
        ? <FiSlash className="text-red-500 shrink-0" size={14} aria-hidden="true" />
        : <FiClock className="text-green-600 shrink-0" size={14} aria-hidden="true" />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-900">
            {r.dayOfWeek !== null && r.dayOfWeek !== undefined
              ? `Every ${DAYS[r.dayOfWeek]}`
              : r.dayOfMonth != null
                ? `Day ${r.dayOfMonth} of every month`
                : r.endDate
                  ? `${String(r.date).slice(0, 10)} → ${String(r.endDate).slice(0, 10)}`
                  : String(r.date).slice(0, 10)}
          </span>
          <span className="text-sm text-gray-700 tabular-nums">
            {minToLabel(r.startMin)} – {minToLabel(r.endMin)}
          </span>
          <Chip size="sm" variant="flat" color={r.kind === 'BLOCKED' ? 'danger' : 'success'}>
            {r.kind === 'BLOCKED' ? 'Blocked' : `${r.slotMinutes}m slots`}
          </Chip>
        </div>
        {r.note && <p className="text-xs text-gray-500 mt-0.5">{r.note}</p>}
      </div>
      {canManage && (
        <Tooltip content="Edit">
          <Button
            isIconOnly size="sm" variant="light"
            aria-label="Edit availability rule"
            onPress={() => openEdit(r)}
          >
            <FiEdit2 className="w-3.5 h-3.5" />
          </Button>
        </Tooltip>
      )}
      {canManage && (
        <Tooltip content="Remove">
          <Button
            isIconOnly size="sm" variant="light" color="danger"
            aria-label="Remove availability rule"
            onPress={() => askDelete(r)}
          >
            <FiTrash2 className="w-3.5 h-3.5" />
          </Button>
        </Tooltip>
      )}
    </div>
  );

  return (
    <div className="p-6 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 flex items-center gap-2">
            <FiCalendar className="text-blue-600" aria-hidden="true" /> Site Visit Availability
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {canManage
              ? 'Publish when you can show properties. Sales books against these windows and you confirm each request.'
              : 'When the host is free to show properties. Book a slot from any lead, and they confirm it.'}
          </p>
        </div>
        {canManage && hostId && (
          <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openCreate}>
            Add availability
          </Button>
        )}
      </div>

      {hosts.length > 0 && (
        <Select
          size="sm"
          label="Host"
          labelPlacement="outside"
          className="max-w-xs"
          selectedKeys={hostId ? new Set([hostId]) : new Set()}
          onSelectionChange={(keys) => setHostId((Array.from(keys)[0] as string) || '')}
        >
          {hosts.map((u: any) => <SelectItem key={u.id} textValue={u.name}>{u.name}</SelectItem>)}
        </Select>
      )}

      {policy && (
        <p className="text-xs text-gray-500">
          Bookings need {policy.minNoticeHours}h notice · default {policy.slotMinutes}-minute slots ·
          working day {minToLabel(policy.dayStartMin)}–{minToLabel(policy.dayEndMin)}
        </p>
      )}

      {isLoading && <LoadingState />}

      {!isLoading && rows.length === 0 && (
        <EmptyState
          title="No availability published"
          message={canManage
            ? 'Until you add a window, the booking picker has nothing to offer and every request has to happen by phone.'
            : 'This host has not published any availability yet, so there are no slots to book against them.'}
          action={canManage ? <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openCreate}>Add availability</Button> : undefined}
        />
      )}

      {weekly.length > 0 && (
        <Card shadow="sm">
          <CardHeader className="pb-2"><p className="font-semibold text-sm text-gray-700">Weekly pattern</p></CardHeader>
          <CardBody className="pt-0 space-y-1.5">{weekly.map(ruleRow)}</CardBody>
        </Card>
      )}

      {monthly.length > 0 && (
        <Card shadow="sm">
          <CardHeader className="pb-2"><p className="font-semibold text-sm text-gray-700">Monthly pattern</p></CardHeader>
          <CardBody className="pt-0 space-y-1.5">{monthly.map(ruleRow)}</CardBody>
        </Card>
      )}

      {oneOff.length > 0 && (
        <Card shadow="sm">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-gray-700">Specific dates</p>
          </CardHeader>
          <CardBody className="pt-0 space-y-1.5">{oneOff.map(ruleRow)}</CardBody>
        </Card>
      )}

      {/* Add rule */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalContent>
          <ModalHeader className="text-base">{editing ? 'Edit availability' : 'Add availability'}</ModalHeader>
          <ModalBody className="gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                size="sm" label="Repeats" labelPlacement="outside"
                // Editing targets ONE existing row, so the multi-day presets are hidden —
                // "every weekday" is a creation shortcut, not a shape a rule can have.
                disabledKeys={editing ? ['weekdays', 'everyday'] : []}
                selectedKeys={new Set([form.mode])}
                onSelectionChange={(k) => set('mode', (Array.from(k)[0] as string) || 'weekly')}
              >
                <SelectItem key="weekly" textValue="One weekday, every week">One weekday, every week</SelectItem>
                <SelectItem key="weekdays" textValue="Every weekday (Mon–Fri)">Every weekday (Mon–Fri)</SelectItem>
                <SelectItem key="everyday" textValue="Every day (Mon–Sun)">Every day (Mon–Sun)</SelectItem>
                <SelectItem key="monthly" textValue="Every month">Every month</SelectItem>
                <SelectItem key="oneoff" textValue="One specific date">One specific date</SelectItem>
                <SelectItem key="range" textValue="A date range (e.g. block a week)">A date range (e.g. block a week)</SelectItem>
              </Select>
              <Select
                size="sm" label="Type" labelPlacement="outside"
                selectedKeys={new Set([form.kind])}
                onSelectionChange={(k) => set('kind', (Array.from(k)[0] as string) || 'OPEN')}
              >
                <SelectItem key="OPEN" textValue="Open for visits">Open for visits</SelectItem>
                <SelectItem key="BLOCKED" textValue="Blocked (beats weekly)">Blocked (beats weekly)</SelectItem>
              </Select>

              {form.mode === 'weekly' ? (
                <Select
                  size="sm" label="Day" labelPlacement="outside"
                  selectedKeys={new Set([form.dayOfWeek])}
                  onSelectionChange={(k) => set('dayOfWeek', (Array.from(k)[0] as string) || '1')}
                >
                  {DAYS.map((d, i) => <SelectItem key={String(i)} textValue={d}>{d}</SelectItem>)}
                </Select>
              ) : form.mode === 'monthly' ? (
                <Select
                  size="sm" label="Day of month" labelPlacement="outside"
                  selectedKeys={new Set([form.dayOfMonth])}
                  onSelectionChange={(k) => set('dayOfMonth', (Array.from(k)[0] as string) || '1')}
                  description={Number(form.dayOfMonth) > 28
                    ? 'Months without this day are simply skipped.'
                    : undefined}
                >
                  {Array.from({ length: 31 }, (_, i) => String(i + 1)).map((d) => (
                    <SelectItem key={d} textValue={`Day ${d}`}>{`Day ${d}`}</SelectItem>
                  ))}
                </Select>
              ) : form.mode === 'weekdays' || form.mode === 'everyday' ? (
                <div className="flex items-end pb-1 text-xs text-gray-600">
                  {form.mode === 'weekdays'
                    ? 'Creates one rule per weekday, Monday to Friday.'
                    : 'Creates one rule per day, Monday to Sunday.'}
                </div>
              ) : form.mode === 'range' ? (
                <Input
                  size="sm" type="date" label="From" labelPlacement="outside"
                  value={form.date} onChange={(e) => set('date', e.target.value)} isRequired
                />
              ) : (
                <Input
                  size="sm" type="date" label="Date" labelPlacement="outside"
                  value={form.date} onChange={(e) => set('date', e.target.value)} isRequired
                />
              )}
              {form.mode === 'range' && (
                <Input
                  size="sm" type="date" label="To (inclusive)" labelPlacement="outside"
                  value={form.endDate} onChange={(e) => set('endDate', e.target.value)} isRequired
                />
              )}

              <Input
                size="sm" type="number" min={5} max={480} step={15}
                label="Slot length (min)" labelPlacement="outside"
                value={form.slotMinutes} onChange={(e) => set('slotMinutes', e.target.value)}
                isDisabled={form.kind === 'BLOCKED'}
              />
              <Input
                size="sm" type="time" label="From" labelPlacement="outside"
                value={form.start} onChange={(e) => set('start', e.target.value)}
              />
              <Input
                size="sm" type="time" label="To" labelPlacement="outside"
                value={form.end} onChange={(e) => set('end', e.target.value)}
              />
            </div>
            <Input
              size="sm" label="Note" labelPlacement="outside"
              placeholder="e.g. site office only"
              value={form.note} onChange={(e) => set('note', e.target.value)}
            />
            {form.kind === 'BLOCKED' && (
              <p className="text-xs text-gray-500">
                A blocked window removes slots even where a weekly rule says you are free.
                {form.mode === 'range' && ' Every day in the range is blocked.'}
              </p>
            )}
            <p className="text-xs text-gray-500">
              Times are in {policy ? 'your' : 'the'} local business timezone (America/Chicago).
            </p>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
            <Button size="sm" color="primary" onPress={submit} isLoading={create.isPending || update.isPending}>
              {editing ? 'Save' : 'Add'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete with impact */}
      <Modal isOpen={!!confirmDelete} onClose={() => setConfirmDelete(null)} size="md">
        <ModalContent>
          <ModalHeader className="text-base">Remove this availability?</ModalHeader>
          <ModalBody>
            {impact === null && <LoadingState />}
            {impact && impact.affectedCount > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-amber-800">
                  <FiAlertTriangle size={14} aria-hidden="true" />
                  {impact.affectedCount} upcoming visit{impact.affectedCount === 1 ? '' : 's'} with this host
                </p>
                <ul className="mt-2 space-y-1">
                  {impact.affected.slice(0, 5).map((a: any) => (
                    <li key={a.id} className="text-xs text-amber-900">{a.when} · {a.leadName}</li>
                  ))}
                </ul>
                <p className="text-xs text-amber-800 mt-2">
                  These stay booked — they are already agreed. Removing the rule only stops
                  NEW slots being offered.
                </p>
              </div>
            )}
            {impact && impact.affectedCount === 0 && (
              <p className="text-sm text-gray-700">Nothing is booked against this window.</p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={() => setConfirmDelete(null)}>Cancel</Button>
            <Button size="sm" color="danger" onPress={doDelete} isLoading={del.isPending}>Remove</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
