import { useState, useMemo, useEffect, type DependencyList } from 'react';

/**
 * Shared client-side pagination — one canonical implementation for every list in the app
 * that slices an already-fetched array instead of paging server-side.
 *
 * Clamps `page` back down whenever `totalPages` shrinks (e.g. the last item on the current
 * page gets deleted, or a status change moves it out of the current filter) — this is
 * independent of `resetDeps`, which only covers a user-driven filter/search change. Without
 * the clamp, a stale page index slices past the end of the array, silently rendering an
 * empty list with no pagination control left to navigate back.
 */
export function usePagination<T>(items: T[], pageSize: number, resetDeps: DependencyList = []) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, resetDeps);

  useEffect(() => { setPage((p) => Math.min(p, totalPages)); }, [totalPages]);

  const paged = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize],
  );

  return { page, setPage, totalPages, paged, total: items.length, pageSize };
}
