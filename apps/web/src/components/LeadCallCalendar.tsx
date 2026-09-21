import { useMemo, useState } from 'react';
import {
  Card, CardBody, Button, Select, SelectItem, Textarea, Chip, Tooltip,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, addToast,
} from '@heroui/react';
import { FiPhone, FiChevronLeft, FiChevronRight, FiPlus } from 'react-icons/fi';
import { useLeadCalls, useAddLeadActivity } from '../hooks/useApi';
import { errMsg } from '../utils/fmt';

/**
 * Call history for a lead, plus the month calendar the client asked for: tap a date and
 * log what happened on THAT day.
 *
 * Back-dating is the whole point — a rep catching up on Friday should be able to record
 * Tuesday's call as Tuesday's. That is what LeadActivity.occurredAt exists for; createdAt
 * still records when the row was written, so the audit trail stays honest.
 */

const ACTIVITY_TYPES = [
  { value: 'CALL', label: 'Call' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'MEETING', label: 'Meeting' },
  { value: 'SITE_VISIT', label: 'Site visit' },
  { value: 'FOLLOW_UP', label: 'Follow-up' },
  { value: 'NOTE', label: 'Note' },
];

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Calendar cells for a month, Monday-first, padded so the weekday columns line up. */
function monthGrid(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  // getUTCDay is 0=Sun; shift so Monday is column 0.
  const lead = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<{ day: number; key: string } | null> = Array(lead).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      day: d,
      key: `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    });
  }
  return cells;
}

const todayKey = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

export function LeadCallCalendar({ leadId }: { leadId: string }) {
  const { data } = useLeadCalls(leadId);
  const addActivity = useAddLeadActivity();

  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [logDate, setLogDate] = useState<string | null>(null);
  const [type, setType] = useState('CALL');
  const [note, setNote] = useState('');

  const cells = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const byDate: Record<string, {
    calls: number;
    total: number;
    items?: Array<{ type: string; note: string; by: string | null }>;
  }> = data?.byDate ?? {};
  const today = todayKey();

  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
    .format(new Date(cursor.year, cursor.month, 1));

  const step = (delta: number) => setCursor((c) => {
    const m = c.month + delta;
    return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
  });

  const submit = async () => {
    try {
      const label = ACTIVITY_TYPES.find((t) => t.value === type)?.label ?? 'Activity';
      await addActivity.mutateAsync({
        leadId,
        data: {
          type,
          // Logging that a call HAPPENED is useful on its own — the note is colour. The
          // API still needs a body, so fall back to the activity's own name.
          note: note.trim() || `${label} logged`,
          // Noon local, not midnight: a date-only value stored at midnight can land on the
          // previous day once it is read back in another timezone.
          occurredAt: new Date(`${logDate}T12:00:00`).toISOString(),
        },
      });
      addToast({ title: 'Logged', color: 'success' });
      setLogDate(null); setNote(''); setType('CALL');
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not log it'), color: 'danger' });
    }
  };

  const lastCall = data?.lastCall;
  const recent: any[] = data?.recent ?? [];

  return (
    <div className="mb-4">
      <Card shadow="none" className="border border-gray-200">
        <CardBody className="p-3 gap-2">
          {/* Summary — the two numbers the client asked to see on every lead. */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Hovering the summary shows WHICH calls, so the common question — "when did
                we last speak and what came of it" — is answered without opening the
                timeline. Focusable so it is reachable by keyboard, not mouse-only. */}
            <Tooltip
              isDisabled={recent.length === 0}
              content={
                <div className="max-w-[260px] py-1">
                  <p className="text-[11px] font-semibold text-gray-700 mb-1">
                    {recent.length === (data?.callCount ?? 0)
                      ? 'All calls'
                      : `Last ${recent.length} of ${data?.callCount} calls`}
                  </p>
                  <ul className="space-y-1">
                    {recent.map((c: any) => (
                      <li key={c.id} className="text-[11px] text-gray-700">
                        <span className="font-medium tabular-nums">
                          {new Date(c.occurredAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                        </span>
                        {c.by && <span className="text-gray-500"> · {c.by}</span>}
                        {c.note && <div className="text-gray-600">{c.note}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              }
            >
              <span
                tabIndex={recent.length ? 0 : -1}
                className="flex items-center gap-1.5 text-sm font-medium text-gray-900 rounded focus:outline-2 focus:outline-blue-600"
              >
                <FiPhone className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                Called {data?.callCount ?? 0} time{(data?.callCount ?? 0) === 1 ? '' : 's'}
              </span>
            </Tooltip>
            {lastCall && (
              <Chip size="sm" variant="flat">
                Last {new Date(lastCall.occurredAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              </Chip>
            )}
            <Button
              size="sm" variant="flat" color="primary"
              className="ml-auto h-7 min-w-0 px-2 text-[11px]"
              startContent={<FiPlus className="w-3 h-3" />}
              onPress={() => { setLogDate(today); setType('CALL'); setNote(''); }}
            >
              Log a call
            </Button>
          </div>

          {lastCall?.note && (
            <p className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1.5">
              “{lastCall.note}”
              {lastCall.by && <span className="text-gray-500"> — {lastCall.by}</span>}
            </p>
          )}

          {/* Month grid */}
          <div className="flex items-center justify-between mt-1">
            <Button isIconOnly size="sm" variant="light" aria-label="Previous month"
              className="h-6 w-6 min-w-0" onPress={() => step(-1)}>
              <FiChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <span className="text-xs font-semibold text-gray-700">{monthLabel}</span>
            <Button isIconOnly size="sm" variant="light" aria-label="Next month"
              className="h-6 w-6 min-w-0" onPress={() => step(1)}>
              <FiChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {DOW.map((d, i) => (
              <div key={i} className="text-center text-[11px] font-medium text-gray-500 pb-0.5">{d}</div>
            ))}
            {cells.map((c, i) => {
              if (!c) return <div key={`pad-${i}`} />;
              const entry = byDate[c.key];
              const isToday = c.key === today;
              const isFuture = c.key > today;
              const cell = (
                <button
                  key={c.key}
                  type="button"
                  disabled={isFuture}
                  onClick={() => { setLogDate(c.key); setType('CALL'); setNote(''); }}
                  aria-label={`${c.key}${entry ? `, ${entry.total} logged` : ', nothing logged'}${isFuture ? ' (future)' : ''}`}
                  className={`relative aspect-square rounded text-[11px] transition-colors ${
                    isFuture
                      // gray-500 rather than gray-300: WCAG exempts disabled controls, but
                      // these are calendar DATES people scan to find a day, and at 1.47:1
                      // the future half of the month was effectively invisible. Cursor and
                      // the disabled attribute still signal that they are not clickable.
                      ? 'text-gray-500 opacity-60 cursor-not-allowed'
                      : isToday
                        ? 'bg-blue-600 text-white font-semibold'
                        : entry
                          ? 'bg-blue-50 text-blue-700 font-medium hover:bg-blue-100'
                          : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {c.day}
                  {entry && !isToday && (
                    <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-600" aria-hidden="true" />
                  )}
                </button>
              );
              // A dot said something happened but not WHAT. Hovering a dated square now
              // names each entry's type and shows its note, so the month reads as history
              // rather than a scatter of marks.
              if (!entry?.items?.length) return cell;
              return (
                <Tooltip
                  key={c.key}
                  content={
                    <div className="max-w-[240px] py-1">
                      <p className="text-[11px] font-semibold text-gray-700 mb-1">
                        {new Date(`${c.key}T12:00:00`).toLocaleDateString(undefined, {
                          weekday: 'short', day: 'numeric', month: 'short',
                        })}
                      </p>
                      <ul className="space-y-1">
                        {entry.items.map((it: any, idx: number) => (
                          <li key={idx} className="text-[11px] text-gray-700">
                            <span className="font-medium">
                              {ACTIVITY_TYPES.find((t) => t.value === it.type)?.label
                                ?? String(it.type).replace(/_/g, ' ')}
                            </span>
                            {it.by && <span className="text-gray-500"> · {it.by}</span>}
                            {it.note && <div className="text-gray-600">{it.note}</div>}
                          </li>
                        ))}
                      </ul>
                      {entry.total > entry.items.length && (
                        <p className="text-[11px] text-gray-500 mt-1">
                          +{entry.total - entry.items.length} more
                        </p>
                      )}
                    </div>
                  }
                >
                  {cell}
                </Tooltip>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-500">
            Tap any past date to log what happened that day.
          </p>
        </CardBody>
      </Card>

      <Modal isOpen={!!logDate} onClose={() => setLogDate(null)} size="sm">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-0.5">
            <span className="text-base">Log activity</span>
            <span className="text-xs font-normal text-gray-500">
              {logDate && new Date(`${logDate}T12:00:00`).toLocaleDateString(undefined, {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
              })}
              {logDate === today && ' (today)'}
            </span>
          </ModalHeader>
          <ModalBody className="gap-3">
            <Select
              size="sm" label="Type" labelPlacement="outside"
              selectedKeys={new Set([type])}
              onSelectionChange={(k) => setType((Array.from(k)[0] as string) || 'CALL')}
            >
              {ACTIVITY_TYPES.map((t) => (
                <SelectItem key={t.value} textValue={t.label}>{t.label}</SelectItem>
              ))}
            </Select>
            <Textarea
              size="sm" label="What happened?" labelPlacement="outside"
              placeholder="e.g. spoke to Rahul, wants a second viewing"
              value={note} onChange={(e) => setNote(e.target.value)}
              description="Optional — leave it blank to just record that it happened."
            />
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={() => setLogDate(null)}>Cancel</Button>
            <Button size="sm" color="primary" onPress={submit} isLoading={addActivity.isPending}>
              Log it
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
