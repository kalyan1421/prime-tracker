import { useState, useEffect, type DependencyList } from 'react';

/**
 * Shared "collapsible group with a manual override" state machine — one canonical
 * implementation for every grouped-list rollup in the app (per-building sections, etc).
 *
 * Each group's expanded state is `manual[key] ?? defaultExpanded` — the caller supplies
 * its own domain-specific `defaultExpanded` per group (e.g. "has a blocked item" for
 * construction, "has an available unit" for units), this hook only owns the override map.
 *
 * `resetDeps` clears every manual override when it changes — pass the search/filter state
 * that narrows the underlying list. Without this, a section a user collapsed earlier stays
 * collapsed even after a search narrows it down to a single matching row, making the search
 * silently appear to return nothing.
 */
export function useCollapsibleGroups(resetDeps: DependencyList = []) {
  const [manual, setManual] = useState<Record<string, boolean>>({});

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setManual({}); }, resetDeps);

  const isExpanded = (key: string, defaultExpanded: boolean) => manual[key] ?? defaultExpanded;
  const toggle = (key: string, currentlyExpanded: boolean) =>
    setManual((prev) => ({ ...prev, [key]: !currentlyExpanded }));

  return { isExpanded, toggle };
}
