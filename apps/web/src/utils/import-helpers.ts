/**
 * A unit number like "700 and 701" or "1001 & 1002" names TWO physical units combined
 * in the sheet's text — not one real unit. Auto-creating a unit literally called that
 * would put nonsense inventory in the system, so these are flagged instead of offered
 * as a normal create. Heuristic, not exhaustive — matches the patterns actually seen in
 * client sheets (R8's discovery data). Shared by the rent- and sale-history importers.
 */
export function looksLikeCombinedUnitRef(unitNumber: string): boolean {
  return /\band\b/i.test(unitNumber) || /&/.test(unitNumber) || /,/.test(unitNumber);
}

/**
 * A source sheet sometimes writes "Entire Building" as the Unit Number for a
 * whole-building sale (e.g. RRC Buildings 7 & 8) rather than naming a real unit.
 * Auto-creating a unit literally called "Entire Building" would be fake inventory, not
 * a workaround — the app's Sale model already supports attaching a sale to a Building
 * directly, but the bulk importer only ever resolves to a Unit, so this needs to be
 * flagged for manual entry (Add Sale, attached to the building) rather than offered as
 * a normal create.
 */
export function looksLikeWholeBuildingRef(unitNumber: string): boolean {
  const v = unitNumber.trim();
  // "Entire Building" is the sale sheets' spelling; the 2026-08-25 lease workbook writes
  // the same idea as "Building 6 (whole)" / "Building 10 (whole)". Both name a building,
  // not a unit. Anchored on the "(whole)" suffix so an ordinary unit number that merely
  // mentions a building ("Building 1 - 104") is untouched.
  return /^entire\s+building$/i.test(v) || /^building\b.*\(\s*whole\s*\)$/i.test(v);
}

/**
 * A Unit Number cell that isn't a unit number at all — a placeholder the sheet's author
 * used because the source didn't record one ("Not recorded", "N/A", "TBD"), or a
 * disambiguating suffix marking an earlier tenancy of a unit that already exists
 * ("101 (prior)", "700-701 (prior)").
 *
 * Both are excluded from the create-missing-units offer for the same reason as
 * looksLikeCombinedUnitRef: creating a unit literally called "101 (prior)" would put a
 * second, fake unit alongside the real 101 and quietly split its history in two. The
 * fix is in the sheet — point the row at the real unit — so these are flagged, never
 * auto-created.
 */
export function looksLikeNonUnitRef(unitNumber: string): boolean {
  const v = unitNumber.trim();
  return /\(\s*prior\s*\)$/i.test(v) || /^(not\s+recorded|n\/?a|none|tbd|unknown|-+)$/i.test(v);
}

/**
 * Awaits `fn` for each item in order, pacing calls to stay under the API's global
 * short-burst throttle (10 requests/second — see ThrottlerModule in app.module.ts).
 * A single missing-units-and-buildings batch from a real import routinely exceeds 10
 * items (43 in the RRC test file), and a plain sequential loop hits that ceiling
 * mid-batch: the first ~10 creates succeed, the rest come back 429 and read as
 * mysterious failures for a request that was never actually wrong. Batching in groups
 * of 8 with a 1s pause between groups keeps every call inside the limit with margin for
 * whatever else the app is doing concurrently (e.g. the notification poll).
 */
export async function createSequentiallyRateLimited<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
): Promise<{ item: T; result?: R; error?: unknown }[]> {
  const results: { item: T; result?: R; error?: unknown }[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i > 0 && i % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      results.push({ item: items[i], result: await fn(items[i]) });
    } catch (error) {
      results.push({ item: items[i], error });
    }
  }
  return results;
}
