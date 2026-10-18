/**
 * Site updates written with no signal (2026-10-17) — see hooks/useSiteOutbox.
 *
 *   SiteOutboxSync       mounted once in the layout: sends what is waiting when the app
 *                        opens, when the phone gets signal back, and every 30 s while
 *                        anything is waiting.
 *   SiteOutboxIndicator  the top-bar badge, so a waiting update is never invisible.
 *   SiteOutboxNotice     inside the composer: what is waiting for THIS unit, Send now,
 *                        and Discard for anything the server refused.
 */
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Popover, PopoverContent, PopoverTrigger, addToast } from '@heroui/react';
import { FiCloudOff, FiSend, FiTrash2 } from 'react-icons/fi';
import { flushSiteOutbox, useSiteOutbox } from '../hooks/useSiteOutbox';
import type { OutboxItem } from '../store/siteOutboxStore';

const RETRY_MS = 30_000;

/** Send what is waiting, then refresh every feed that shows site updates. */
function useFlush() {
  const qc = useQueryClient();
  const { userId } = useSiteOutbox();
  return useCallback(async () => {
    const n = await flushSiteOutbox(userId);
    if (n) {
      qc.invalidateQueries({ queryKey: ['daily-logs'] });
      qc.invalidateQueries({ queryKey: ['site-tracker'] });
    }
    return n;
  }, [qc, userId]);
}

export function SiteOutboxSync() {
  const { items } = useSiteOutbox();
  const flush = useFlush();
  const waiting = items.filter((i) => !i.error).length;

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const n = await flush();
      if (alive && n) {
        addToast({ title: `Sent ${n} update${n === 1 ? '' : 's'} written while offline`, color: 'success' });
      }
    };
    run();
    window.addEventListener('online', run);
    const timer = waiting ? window.setInterval(run, RETRY_MS) : undefined;
    return () => {
      alive = false;
      window.removeEventListener('online', run);
      if (timer) window.clearInterval(timer);
    };
  }, [flush, waiting]);

  return null;
}

const excerpt = (i: OutboxItem) => {
  const t = String(i.payload.notes ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
};

function ItemRow({ item, onDiscard }: { item: OutboxItem; onDiscard: (ref: string) => void }) {
  return (
    <li className="flex items-start gap-2 py-1.5">
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-gray-800">{excerpt(item)}</span>
        {item.error
          ? <span className="block text-[11px] text-red-700">Not sent: {item.error}</span>
          : <span className="block text-[11px] text-gray-500">Waiting for signal · written {new Date(item.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
      </span>
      {item.error && (
        <Button size="sm" variant="light" color="danger" isIconOnly aria-label="Discard this update" onPress={() => onDiscard(item.clientRef)}>
          <FiTrash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </li>
  );
}

function useSendNow() {
  const flush = useFlush();
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    const n = await flush();
    setBusy(false);
    addToast(n
      ? { title: `Sent ${n} update${n === 1 ? '' : 's'}`, color: 'success' }
      : { title: 'Still no signal — they will send as soon as there is', color: 'warning' });
  };
  return { send, busy };
}

export function SiteOutboxIndicator() {
  const { items } = useSiteOutbox();
  return items.length ? <IndicatorPopover /> : null;
}

function IndicatorPopover() {
  const { items, discard } = useSiteOutbox();
  const { send, busy } = useSendNow();
  const failed = items.some((i) => i.error);
  return (
    <Popover placement="bottom-end" offset={8}>
      <PopoverTrigger>
        <Button
          size="sm" variant="flat" color={failed ? 'danger' : 'warning'}
          startContent={<FiCloudOff className="h-3.5 w-3.5" />}
          aria-label={`${items.length} site update${items.length === 1 ? '' : 's'} not sent yet`}
        >
          {items.length}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3">
        <p className="text-sm font-semibold text-gray-900">Saved on this device</p>
        <p className="text-[11px] text-gray-500">Written with no signal. They send automatically when there is.</p>
        <ul className="mt-1 divide-y divide-gray-100">
          {items.map((i) => <ItemRow key={i.clientRef} item={i} onDiscard={discard} />)}
        </ul>
        <Button size="sm" color="primary" className="mt-2 w-full" startContent={<FiSend className="h-3.5 w-3.5" />} isLoading={busy} onPress={send}>
          Send now
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** What is waiting for this unit (or, with no unit, this project's site-wide feed). */
export function SiteOutboxNotice({ projectId, unitId }: { projectId: string; unitId?: string }) {
  const { items } = useSiteOutbox();
  const here = items.filter((i) => (unitId ? i.payload.unitId === unitId : i.payload.projectId === projectId && !i.payload.unitId));
  // The inner part needs the query client; with nothing waiting, nothing else is mounted.
  return here.length ? <NoticeBody here={here} /> : null;
}

function NoticeBody({ here }: { here: OutboxItem[] }) {
  const { discard } = useSiteOutbox();
  const { send, busy } = useSendNow();
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <div className="flex items-center gap-2">
        <FiCloudOff className="h-4 w-4 shrink-0 text-amber-700" />
        <span className="flex-1 text-xs font-medium text-amber-700">
          {here.length} update{here.length === 1 ? '' : 's'} saved on this device, not sent yet
        </span>
        <Button size="sm" variant="flat" startContent={<FiSend className="h-3.5 w-3.5" />} isLoading={busy} onPress={send}>Send now</Button>
      </div>
      <ul className="mt-1 divide-y divide-amber-100">
        {here.map((i) => <ItemRow key={i.clientRef} item={i} onDiscard={discard} />)}
      </ul>
    </div>
  );
}
