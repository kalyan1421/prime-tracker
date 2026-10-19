import { useCallback, useMemo, useRef } from 'react';
import type { AxiosError } from 'axios';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useSiteOutboxStore, type OutboxItem } from '../store/siteOutboxStore';
import { errMsg } from '../utils/fmt';

/**
 * Posting a site update from a phone with no signal (roadmap "PWA/offline", 2026-10-17).
 *
 * A post that fails because the request never got an answer — no signal, a timeout, or the
 * server briefly unreachable (502/503/504) — is kept on the phone and sent later, instead of
 * failing. Every post carries a `clientRef`; if the first attempt actually reached the server
 * before the signal dropped, the retry gets that post back rather than making a duplicate.
 *
 * A post the server REFUSES (validation, permission) is not a signal problem and is never
 * queued — it fails as it always did. Photos need a connection to upload, so a post with
 * photos is not queued either; its composer keeps the text and the photos for a retry.
 */

export function newClientRef() {
  try { if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID(); } catch { /* old browser */ }
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** No answer at all, or the box was unreachable — worth trying again later. */
export function isRetryable(err: unknown) {
  const e = err as AxiosError;
  if (!e || typeof e !== 'object') return false;
  if (!('isAxiosError' in e) && !('response' in e) && !('code' in e)) return false;
  const status = e.response?.status;
  if (status === undefined) return true; // network error / timeout: no response came back
  return status === 502 || status === 503 || status === 504;
}

let flushing = false;

/**
 * Send every waiting update of this user, oldest first. Stops at the first signal failure
 * (the rest would fail the same way); a refusal is recorded on that item and skipped.
 * Returns how many were sent.
 */
export async function flushSiteOutbox(userId: string): Promise<number> {
  if (flushing || !userId) return 0;
  flushing = true;
  let sent = 0;
  try {
    const store = useSiteOutboxStore.getState();
    const mine = store.items.filter((i) => i.userId === userId && !i.error).sort((a, b) => a.createdAt - b.createdAt);
    for (const item of mine) {
      try {
        // logDate is stamped when an update is kept (postOrQueue); the fallback covers anything
        // kept before that stamp existed.
        await api.post('/daily-logs', {
          ...item.payload,
          logDate: item.payload.logDate ?? new Date(item.createdAt).toISOString(),
          clientRef: item.clientRef,
        });
        useSiteOutboxStore.getState().remove(item.clientRef);
        sent += 1;
      } catch (err) {
        if (isRetryable(err)) {
          useSiteOutboxStore.getState().patch(item.clientRef, { attempts: item.attempts + 1 });
          break;
        }
        useSiteOutboxStore.getState().patch(item.clientRef, { attempts: item.attempts + 1, error: errMsg(err, 'The server refused this update') });
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}

/**
 * One clientRef per post the user is trying to make, kept across retries of the SAME content.
 *
 * A post whose answer was lost may have landed. Retrying it with a fresh ref would make the
 * server create it again — with photos, the composer keeps everything for a retry (they are
 * never queued), so that is exactly the retry it invites. Reusing the ref gets the first post
 * back instead, and the photos attach to it.
 *
 * Keyed on the content, not just "the last failure": once the text, photos, stage or date
 * change it is a different post, and reusing the old ref would hand back the OLD post and
 * silently drop the new one. Call `done()` once a post is accepted or kept.
 */
export function useAttemptRef() {
  const current = useRef<{ key: string; ref: string } | null>(null);
  return useMemo(() => ({
    refFor(key: string) {
      if (current.current?.key !== key) current.current = { key, ref: newClientRef() };
      return current.current.ref;
    },
    done() { current.current = null; },
  }), []);
}

export function useSiteOutbox() {
  // Tolerates a mocked store that ignores the selector (component tests).
  const u = useAuthStore((st) => st.user?.id ?? '');
  const userId = typeof u === 'string' ? u : '';
  const all = useSiteOutboxStore((st) => st.items);
  const items: OutboxItem[] = all.filter((i) => i.userId === userId);

  /**
   * Post now through `send` (the composer's own create mutation, so its refresh behaviour is
   * unchanged); if there is no signal, keep the post on this device and say so. Resolves to
   * 'posted' or 'queued'; rejects for anything else (a refusal, or no signal with photos).
   */
  const postOrQueue = useCallback(async (
    payload: Record<string, any>,
    opts: {
      send: (body: Record<string, any>) => Promise<any>;
      hasPhotos?: boolean;
      /** The composer's ref for this content (useAttemptRef), so a retry cannot duplicate. */
      clientRef?: string;
    },
  ) => {
    const clientRef = opts.clientRef ?? newClientRef();
    const writtenAt = Date.now();
    try {
      const log = await opts.send({ ...payload, clientRef });
      return { status: 'posted' as const, log };
    } catch (err) {
      if (!isRetryable(err) || opts.hasPhotos || !userId) throw err;
      // The server dates a post with no logDate at the moment it ARRIVES (DailyLogsService.create).
      // For a post that waited for signal that is when the signal came back, not when the work
      // was recorded — so it is dated now, as it would have been had it gone straight through.
      const kept = { ...payload, logDate: payload.logDate ?? new Date(writtenAt).toISOString() };
      useSiteOutboxStore.getState().add({ clientRef, userId, payload: kept, createdAt: writtenAt, attempts: 1, error: null });
      return { status: 'queued' as const, log: null };
    }
  }, [userId]);

  const discard = useCallback((clientRef: string) => useSiteOutboxStore.getState().remove(clientRef), []);

  return { items, userId, postOrQueue, discard };
}
