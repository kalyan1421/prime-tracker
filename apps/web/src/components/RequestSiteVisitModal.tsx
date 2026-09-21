import { useMemo, useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Select, SelectItem,
  Textarea, Chip, addToast,
} from '@heroui/react';
import { FiCalendar, FiClock, FiInfo, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import {
  useVisitSlots, useVisitPolicy, useRequestSiteVisit, useRescheduleSiteVisit,
  useAssignableUsers, useVisitAvailability,
} from '../hooks/useApi';
import { errMsg } from '../utils/fmt';
import { LoadingState } from './ui';

/**
 * Book an open slot against a host's published availability.
 *
 * The picker only ever shows slots the server says are bookable — the notice period,
 * blocked days and already-held slots are all subtracted server-side, so there is no
 * second copy of that logic here to drift out of step.
 */

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Month cells, Monday-first, padded so weekday columns line up. */
function monthCells(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<{ day: number; key: string } | null> = Array(lead).fill(null);
  for (let d = 1; d <= count; d++) {
    cells.push({ day: d, key: `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * What a day square says. Order matters: a day is only "full" or "blocked" once we know
 * nothing on it is bookable, and "too soon" outranks both because it resolves itself.
 */
function dayState(st: any): { label: string; kind: 'open' | 'full' | 'blocked' | 'soon' | 'none' } {
  if (!st || st.generated === 0) return { label: '', kind: 'none' };
  if (st.open > 0) return { label: `${st.open} free`, kind: 'open' };
  if (st.notice > 0 && st.taken === 0 && st.blocked === 0) return { label: 'Too soon', kind: 'soon' };
  if (st.blocked > 0 && st.taken === 0) return { label: 'Blocked', kind: 'blocked' };
  if (st.taken > 0) return { label: 'Full', kind: 'full' };
  return { label: 'Blocked', kind: 'blocked' };
}

const DAY_STYLE: Record<string, string> = {
  open: 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200',
  full: 'bg-rose-50 text-rose-700 border-rose-200 cursor-not-allowed',
  blocked: 'bg-gray-100 text-gray-600 border-gray-200 cursor-not-allowed',
  soon: 'bg-amber-50 text-amber-800 border-amber-200 cursor-not-allowed',
  none: 'bg-white text-gray-500 border-gray-100 cursor-not-allowed',
};

function timeOnly(s: any) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: s.timezone, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(s.startsAt));
}

/**
 * `rescheduleOf` turns this into the move-a-visit flow. Same picker, same slot rules,
 * different verb — duplicating the picker for reschedule would have meant two places to
 * keep the notice period and blocked-day handling in step.
 */
export function RequestSiteVisitModal({
  isOpen, onClose, lead, rescheduleOf,
}: { isOpen: boolean; onClose: () => void; lead: any; rescheduleOf?: any }) {
  const isReschedule = !!rescheduleOf;
  // On a reschedule the host is fixed: moving a visit is a new time with the same person,
  // and changing both at once is a different decision the rep should make deliberately.
  const [hostId, setHostId] = useState(rescheduleOf?.hostId ?? '');
  const [picked, setPicked] = useState<any>(null);
  const [note, setNote] = useState('');
  // Month the calendar is showing. Replaces the old "look ahead N weeks" dropdown: people
  // book against a date they have in mind, and a flat list of 60 times never said which
  // days were blocked, full, or simply outside the host's hours.
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  const [openDay, setOpenDay] = useState<string | null>(null);

  const { data: users } = useAssignableUsers();
  const { data: policy } = useVisitPolicy();
  // Every host's rules in one read, so the picker can mark the ones with nothing published
  // BEFORE somebody picks them and hits an empty calendar.
  const { data: allAvailability } = useVisitAvailability();
  const hostsWithHours = useMemo(
    () => new Set(((allAvailability as any[]) || []).map((r: any) => r.hostId)),
    [allAvailability],
  );
  const request = useRequestSiteVisit();
  const reschedule = useRescheduleSiteVisit();
  const pending = request.isPending || reschedule.isPending;

  // Any active user can host (client, 2026-09-22) — this was leadership-only. Whoever has
  // published hours is who you can actually book, which the "no hours published" marker
  // below makes obvious without shortening the list.
  const hosts = useMemo(
    () => ((users as any[]) || []).filter((u: any) => u.isActive !== false),
    [users],
  );

  const hostName = hosts.find((h: any) => h.id === hostId)?.name as string | undefined;

  const range = useMemo(() => {
    const first = new Date(Date.UTC(month.year, month.month, 1));
    const last = new Date(Date.UTC(month.year, month.month + 1, 0));
    return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
  }, [month]);

  const stepMonth = (delta: number) => {
    setOpenDay(null);
    setPicked(null);
    setMonth((c) => {
      const m = c.month + delta;
      return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  };

  const { data: slotData, isLoading: slotsLoading } = useVisitSlots({ hostId, ...range });
  const slots: any[] = (slotData as any)?.slots ?? [];
  const diag = (slotData as any)?.diagnostics;
  const days: any[] = (slotData as any)?.days ?? [];
  const dayStatus = useMemo(
    () => new Map(days.map((d: any) => [d.date, d])), [slotData],
  );
  // Slots keyed by their LOCAL date, so opening a day shows exactly that day's times.
  const slotsByDay = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const sl of slots) {
      const k = new Intl.DateTimeFormat('en-CA', {
        timeZone: sl.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date(sl.startsAt));
      (m.get(k) ?? m.set(k, []).get(k)!).push(sl);
    }
    return m;
  }, [slotData]);

  const submit = async () => {
    if (!picked) {
      addToast({ title: 'Pick a time first', color: 'warning' });
      return;
    }
    try {
      if (isReschedule) {
        await reschedule.mutateAsync({
          id: rescheduleOf.id,
          startsAt: picked.startsAt,
          endsAt: picked.endsAt,
          reason: note.trim() || undefined,
        });
        addToast({
          title: 'Visit moved — the new time needs confirming',
          color: 'success',
        });
      } else {
        await request.mutateAsync({
          leadId: lead.id,
          hostId,
          startsAt: picked.startsAt,
          endsAt: picked.endsAt,
          requestNote: note.trim() || undefined,
        });
        addToast({ title: 'Site visit requested — the slot is held until it is confirmed', color: 'success' });
      }
      setPicked(null); setNote('');
      if (!isReschedule) setHostId('');
      onClose();
    } catch (e) {
      // A 409 here is the double-booking race, and its message already says what to do.
      addToast({ title: errMsg(e, `Could not ${isReschedule ? 'move' : 'request'} the visit`), color: 'danger' });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <span className="text-base">{isReschedule ? 'Move this site visit' : 'Request a site visit'}</span>
          <span className="text-xs font-normal text-gray-500">
            {lead?.name || 'Unnamed lead'}
            {lead?.unit ? ` · Unit ${lead.unit.unitNumber}` : lead?.building ? ` · ${lead.building.name}` : ''}
          </span>
        </ModalHeader>
        <ModalBody className="gap-3">
          <Select
            size="sm"
            label="Host"
            labelPlacement="outside"
            placeholder="Who will show the property?"
            selectedKeys={hostId ? new Set([hostId]) : new Set()}
            onSelectionChange={(keys) => { setHostId((Array.from(keys)[0] as string) || ''); setPicked(null); }}
            isRequired
            isDisabled={isReschedule}
            description={isReschedule ? 'Moving a visit keeps the same host.' : undefined}
          >
            {hosts.map((u: any) => {
              const published = hostsWithHours.has(u.id);
              return (
                // textValue is mandatory — multi-expression children otherwise render a
                // blank trigger.
                <SelectItem key={u.id} textValue={u.name}>
                  <span className="flex items-center justify-between gap-2">
                    {u.name}
                    {!published && (
                      <span className="text-[11px] text-gray-500">no hours published</span>
                    )}
                  </span>
                </SelectItem>
              );
            })}
          </Select>

          {hostId && (
            <div className="flex items-center justify-between">
              <Button isIconOnly size="sm" variant="light" aria-label="Previous month"
                className="h-8 w-8 min-w-0" onPress={() => stepMonth(-1)}>
                <FiChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-semibold text-gray-800">
                {new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
                  .format(new Date(month.year, month.month, 1))}
              </span>
              <Button isIconOnly size="sm" variant="light" aria-label="Next month"
                className="h-8 w-8 min-w-0" onPress={() => stepMonth(1)}>
                <FiChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}

          {policy && (
            <p className="flex items-center gap-1.5 text-xs text-gray-500">
              <FiInfo className="w-3 h-3 shrink-0" aria-hidden="true" />
              Slots need at least {policy.minNoticeHours}h notice and run {policy.slotMinutes} minutes.
            </p>
          )}

          {!hostId && (
            <div className="text-sm text-gray-500 py-6 text-center">
              Choose a host to see when they are free.
            </div>
          )}

          {hostId && slotsLoading && <LoadingState />}

          {/* Host published nothing at all — a calendar of empty squares would not say
              why, so this replaces it outright. */}
          {hostId && !slotsLoading && diag && !diag.hasAvailability && (
            <div className="text-center py-6 px-4 rounded-lg bg-gray-50 border border-gray-200">
              <FiCalendar className="mx-auto text-gray-400 mb-2" size={20} aria-hidden="true" />
              <p className="text-sm font-medium text-gray-700">
                {hostName || 'This host'} has not published any availability
              </p>
              <p className="text-xs text-gray-600 mt-1">
                There is nothing to book against them yet. Pick another host, or ask them to
                publish their hours on the Site Visits page.
              </p>
            </div>
          )}

          {hostId && !slotsLoading && diag?.hasAvailability && (
            <>
              <div className="grid grid-cols-7 gap-0.5">
                {DOW.map((d, i) => (
                  <div key={i} className="text-center text-[11px] font-medium text-gray-500 pb-0.5">{d}</div>
                ))}
                {monthCells(month.year, month.month).map((c, i) => {
                  if (!c) return <div key={`pad-${i}`} />;
                  const st = dayStatus.get(c.key);
                  const { label, kind } = dayState(st);
                  const selectable = kind === 'open';
                  const isOpenDay = openDay === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      disabled={!selectable}
                      onClick={() => { setOpenDay(isOpenDay ? null : c.key); setPicked(null); }}
                      aria-pressed={isOpenDay}
                      aria-label={`${c.key}${label ? `, ${label}` : ', no hours'}`}
                      className={`rounded border px-1 py-1 text-center transition-colors ${DAY_STYLE[kind]} ${
                        isOpenDay ? 'ring-2 ring-blue-500' : ''
                      }`}
                    >
                      <span className="block text-xs font-medium tabular-nums">{c.day}</span>
                      <span className="block text-[11px] leading-tight">{label || '\u00A0'}</span>
                    </button>
                  );
                })}
              </div>

              {/* Legend: the squares carry four meanings and none of them is guessable. */}
              <div className="flex items-center gap-3 flex-wrap text-[11px] text-gray-600">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-blue-100 border border-blue-200" /> Free
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-rose-100 border border-rose-200" /> Full
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-gray-200 border border-gray-300" /> Blocked
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-amber-100 border border-amber-200" /> Inside {diag.minNoticeHours}h notice
                </span>
              </div>

              {!openDay && (
                <p className="text-xs text-gray-600">
                  Pick a day with free slots to choose a time.
                </p>
              )}

              {openDay && (
                <div>
                  <p className="text-xs font-semibold text-gray-700 mb-1.5">
                    {new Intl.DateTimeFormat('en-US', {
                      weekday: 'long', day: 'numeric', month: 'long',
                    }).format(new Date(`${openDay}T12:00:00`))}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(slotsByDay.get(openDay) ?? []).map((sl: any) => {
                      const active = picked?.startsAt === sl.startsAt;
                      return (
                        <button
                          key={sl.startsAt}
                          type="button"
                          onClick={() => setPicked(active ? null : sl)}
                          aria-pressed={active}
                          aria-label={`Select ${timeOnly(sl)}`}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                            active
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          {timeOnly(sl)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {picked && (
            <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <FiClock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Selected: <strong>{picked.label}</strong></span>
              <Chip size="sm" variant="flat" color="warning" className="ml-auto">Needs confirmation</Chip>
            </div>
          )}

          {picked && (
            <Textarea
              size="sm"
              label={isReschedule ? 'Why is it moving?' : 'Note for the host'}
              labelPlacement="outside"
              placeholder={isReschedule
                ? 'e.g. host travelling, lead asked to push it back'
                : 'e.g. flexible on timing, wants to see the corner unit too'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              description={isReschedule
                ? 'The original stays on the record as moved, so the lead history shows both.'
                : undefined}
            />
          )}
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button
            size="sm" color="primary" onPress={submit}
            isLoading={pending} isDisabled={!picked}
          >
            {isReschedule ? 'Move visit' : 'Request visit'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
