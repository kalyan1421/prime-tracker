/**
 * Dividing one deal's money across the units it covers.
 *
 * Extracted from the rent-history importer so the importer and the create-a-deal endpoint
 * cannot drift apart on the one question that decides what every unit is billed. The rules
 * here are not arbitrary — each of the three came from a defect found in live data:
 *
 *  1. Proportional by area needs a usable figure on EVERY part. One part's area alone
 *     would hand it the entire total and leave the rest at zero, so it is all or nothing.
 *  2. The part carrying the total takes a SHARE of it like any other. Splitting only the
 *     blank parts left that one holding the whole total on top of the others' shares, so
 *     the group billed more than the deal was worth — RRC-B7-700-701 went in as
 *     8,641.66 + 4,456.83 against a real base rent of 8,641.66 (confirmed 2026-08-25).
 *  3. The remainder lands on the LARGEST part, reached by allocating as you go rather than
 *     computing each share independently. That makes the shares sum to the total exactly,
 *     and puts the stray cent where it matters least in percentage terms.
 */

/** Money is only ever split or compared at 2dp, the precision it is stored and billed at. */
const round2 = (n: number) => Math.round(n * 100) / 100;

export type ApportionPart<K> = { key: K; area?: number | null };

export type ApportionResult<K> = {
  /** 'sqft' is the real answer; 'even' is a stated assumption the caller must surface. */
  basis: 'sqft' | 'even';
  shares: Array<{ key: K; amount: number }>;
};

export function apportion<K>(total: number, parts: ApportionPart<K>[]): ApportionResult<K> {
  if (parts.length === 0) return { basis: 'even', shares: [] };

  const totalArea = parts.reduce((sum, p) => sum + (p.area ?? 0), 0);
  const bySqft = parts.every((p) => p.area != null && p.area > 0) && totalArea > 0;

  // Largest last, so the remainder lands there. Stable for the 'even' case: the input
  // order is preserved, so a caller's unit ordering survives.
  const ordered = bySqft ? [...parts].sort((a, b) => (a.area ?? 0) - (b.area ?? 0)) : [...parts];

  let allocated = 0;
  const shares = ordered.map((p, i) => {
    const amount = i === ordered.length - 1
      ? round2(total - allocated)
      : round2(bySqft ? total * ((p.area as number) / totalArea) : total / ordered.length);
    allocated = round2(allocated + amount);
    return { key: p.key, amount };
  });

  return { basis: bySqft ? 'sqft' : 'even', shares };
}
