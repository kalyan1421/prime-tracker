---
name: data-reaches-the-ui
description: Find data this app saves, serves or computes that never reaches a screen — orphaned hooks, API params nobody sends, response fields nothing renders, thresholds nothing enforces. Use before calling a feature done, when reviewing a feature someone else built, or when a client says "that field isn't showing".
---

# Does the data actually reach the UI?

This codebase's most expensive recurring bug is not broken code. It is **code that works,
runs, persists, and is never seen**. A field gets written, stored, selected, typed and
permission-gated — and no component renders it. Everything passes. Nothing shows.

Four instances were found and fixed on 2026-09-02 alone:

| Built and working | Never reached a screen |
|---|---|
| `tenantName` — lease sub-query per row, `lease:view` redaction, `null` vs `undefined` handled deliberately | The grid had seven columns and none was Tenant |
| `workType`, `sitePriority`, `buildingId` API filters | No UI control sent them |
| `PATCH /custom-options/:id` + `useUpdateCustomOption` | Nothing in Admin called either |
| `STALE_DAYS = 7` | No cron, no notification — one tile, and it was miscounting |

Earlier sessions hit the same shape: `DailyLogFeed` shipped orphaned, the building document
card never queried its endpoint, notification types were built and never triggered.

**Dead-code tools cannot find any of this.** They look for *unreferenced symbols*. Every
example above is referenced — in a type, a select block, a DTO, a permission check. The
symbol is alive. The pixel is missing.

## When to run this

- Before calling a feature done — especially one where backend landed before frontend.
- Reviewing a feature you did not build.
- A client says "I entered that and it's not showing anywhere."
- After deleting or redesigning a screen, to catch what it used to be the only reader of.

## The four checks

Run them from the repo root. Each is calibrated below — read the false-positive note before
reporting anything, because a check that cries wolf gets ignored, and then the next
`tenantName` ships.

### 1. Hooks nothing calls

The highest-signal check. An exported hook that talks to the API and has no caller is a
feature with no door.

```bash
grep -oE '^export function (use[A-Za-z0-9_]+)' apps/web/src/hooks/useApi.ts | awk '{print $3}' | sort -u |
while read -r h; do
  n=$(grep -rl --include='*.ts' --include='*.tsx' -w "$h" apps/web/src | grep -v 'hooks/useApi.ts' | wc -l | tr -d ' ')
  [ "$n" = "0" ] && echo "$h"
done
```

**Measured here:** 26 of 330 hooks, including `useCorrectRentPeriod`, `useMilestoneCanStart`,
`useUpdateDailyLog`, `useUnitRentInvoices`. Triage each: a genuinely unwired feature, or
deliberate API surface kept for a screen that is coming. Say which.

### 2. Request params nobody sends

An endpoint that accepts a filter no client passes is a control that was never built.

```bash
grep -rhoE "@Query\('([a-zA-Z0-9_]+)'\)" apps/api/src/modules | sed -E "s/@Query\('(.*)'\)/\1/" | sort -u |
while read -r p; do
  n=$(grep -rE --include='*.ts' --include='*.tsx' "\b$p\b" apps/web/src | wc -l | tr -d ' ')
  [ "$n" = "0" ] && echo "$p"
done
```

**Search the whole of `apps/web/src`, not just `useApi.ts`.** Several hooks take a generic
`Record<string, string|undefined>` and the param names live in the page. Narrowing to
`useApi.ts` reported five params that were correctly wired.

**Measured here:** 2 of 43 — `includeUntracked` (superseded by `untrackedOnly`) and
`realmId` (QuickBooks OAuth, server-to-server, genuinely not a client param).

### 3. Response fields nothing renders

The `tenantName` check. Take the keys of the object a service builds per row, and count how
often each is referenced by the components that consume that endpoint.

```bash
# 1. the shape the service returns
sed -n '/let rows = units.map/,/^    });/p' apps/api/src/modules/site-tracker/site-tracker.service.ts |
  grep -oE '^        [a-zA-Z][a-zA-Z0-9_]*:' | tr -d ' :' | sort -u > /tmp/keys.txt

# 2. EVERY consumer of that endpoint — the page, and every component it hands a row to.
#    `set --` then "$@", because in zsh an unquoted $VAR of filenames does NOT word-split
#    and grep receives one long non-existent filename. Ask me how I know.
set -- apps/web/src/pages/SiteTrackerPage.tsx \
       apps/web/src/components/SiteTrackerRowActions.tsx \
       apps/web/src/components/EditUnitModal.tsx

while read -r k; do
  n=$(grep -ohw "$k" "$@" | wc -l | tr -d ' ')
  [ "$n" -le 1 ] && echo "$k  ($n refs)"
done < /tmp/keys.txt
```

**A count of 1 is the signal, not 0.** One reference is almost always the TypeScript type
declaration and nothing else — which is exactly how `tenantName` looked: declared on the
`Row` interface, redacted with care on the server, rendered nowhere.

**Scope per consumer, and list them all.** Two opposite mistakes, both measured here:

- *Too wide* — searching all of `apps/web/src` hides findings. `tenantName` appears on lease
  screens all over the app, so an app-wide count masked it completely.
- *Too narrow* — omitting a consumer invents findings. Leaving `EditUnitModal.tsx` off the
  list produced four false positives (`sqft`, `askingPrice`, `askingRent`, `unitType`): the
  page passes it the whole row, so those names appear only in the modal's own file.

Find the consumers by grepping for the hook name, then for every component the page hands a
row or a field to.

**Measured with the complete consumer set:**

- Against the pre-fix commit: `tenantName` (1 ref) and `workType` (1 ref) — both real, both
  fixed on 2026-09-02 — plus `blockerSince` and `lastUpdateAt`.
- Against the current tree: `blockerSince` and `lastUpdateAt` only. Both genuine, both minor:
  each is a raw value shipped next to the derived form the UI actually renders
  (`blockerDays`, `staleDays`), so the payload carries them and nothing reads them.

### 4. Thresholds and constants nothing enforces

A rule defined in one file and read by nobody is a rule that does not exist. `STALE_DAYS = 7`
drove a summary tile and no notification, no cron, no exception entry.

```bash
grep -rhoE '^export const ([A-Z][A-Z0-9_]+)' apps/api/src | awk '{print $3}' | sort -u |
while read -r c; do
  n=$(grep -rlw "$c" apps/api/src apps/web/src packages 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" = "1" ] && echo "$c"
done
```

**Include specs in the search.** Excluding them turns every export-for-testing into a false
positive — that variant fired 26 times here, mostly noise. Including them gives 13, which is
triageable.

Prisma enum values deserve the same question by hand: a `NotificationType` nobody raises, a
status nothing transitions to. `grep -c` the value across `apps/api/src`; one hit means the
enum declaration only.

## Calibration on this repo

| Check | Fired | Real | Notes |
|---|---|---|---|
| 1 · hooks with no caller | 26 / 330 | most | strongest signal, triage individually |
| 2 · params nobody sends | 2 / 43 | 1 | widen to all of `web/src` or it lies |
| 3 · fields nothing renders | 2 / 27 | 2 | scope per consumer; list every one |
| 4 · constants nothing reads | 13 / 43 | some | include specs, or it is unusable |

## Reporting

Say what is unrendered **and what that costs**, because "an unused field" sounds like tidying
and is usually a missing feature. `tenantName` was not dead weight — it was a lease query
running on every row, a permission redaction protecting nothing, and a search placeholder
promising a tenant you could match but never see.

For each finding give: the symbol, where it is produced, where it stops, and what a user
cannot do because of it. Then ask whether to wire it up or take it out — both are valid, and
which one is right is the product's call, not the detector's.

## Re-validating this skill

The four 2026-09-02 findings are known positives. To confirm a check still catches them,
run it against the commit before the fixes rather than the working tree:

```bash
git grep -ohw tenantName <pre-fix-sha> -- 'apps/web/src/pages/SiteTrackerPage.tsx' | wc -l   # expect 1
```

A detector nobody has seen fire is not a detector. If you change a check, re-run it against
that history before trusting it.
