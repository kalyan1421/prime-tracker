import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Site updates written with no signal (2026-10-17). They live on the phone until they can be
 * sent — see hooks/useSiteOutbox. Persisted, so closing the browser or the phone dying does
 * not lose them. Each carries its author: a shared device only ever sends its own user's.
 */
export interface OutboxItem {
  /** Sent with the post; the API returns the existing post if this ref already landed. */
  clientRef: string;
  userId: string;
  /** The POST /daily-logs body (without clientRef). */
  payload: Record<string, any>;
  createdAt: number;
  attempts: number;
  /** Set when the server REFUSED it (not a signal problem) — it will not be retried. */
  error?: string | null;
}

interface OutboxState {
  items: OutboxItem[];
  add: (item: OutboxItem) => void;
  remove: (clientRef: string) => void;
  patch: (clientRef: string, p: Partial<OutboxItem>) => void;
}

export const useSiteOutboxStore = create<OutboxState>()(
  persist(
    (set) => ({
      items: [],
      add: (item) => set((s) => ({ items: [...s.items.filter((i) => i.clientRef !== item.clientRef), item] })),
      remove: (clientRef) => set((s) => ({ items: s.items.filter((i) => i.clientRef !== clientRef) })),
      patch: (clientRef, p) => set((s) => ({ items: s.items.map((i) => (i.clientRef === clientRef ? { ...i, ...p } : i)) })),
    }),
    { name: 'prime-site-outbox' },
  ),
);
