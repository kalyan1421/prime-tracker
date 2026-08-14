# Rent History — what every part of it does

**Unit Detail → Rent History.** Written 2026-08-12, after the H0–H1c build.

Everything below is per **tenancy**. A unit with three past tenants has three of these
blocks, newest first, each collapsed to a one-line header until you open it.

---

## The shape of it, and why

Four stacked sections that answer four different questions. They are separate because
they genuinely disagree with each other, and each disagreement is information:

| Section | Answers | Source |
|---|---|---|
| **Tenancy header** | Who is/was here, on what terms | `Lease` |
| **Rent schedule** | What is *owed*, month by month | `LeaseRentPeriod` |
| **Rent ledger** | What was *collected* | `LeaseRentInvoice` |
| **Deposits & allowances** | One-off money in both directions | `LeaseObligation` |

The schedule says a tenant owes $3,400. The ledger says they paid $2,000. Reading either
alone is how a tenant gets chased for an abated month, or a missed payment hides behind a
healthy-looking schedule.

---

## 1 · Tenancy header

`Cream Stone · CURRENT · Aug 12 2026 – Jul 13 2027 · $3,400/mo`

The brand name (falling back to the legal entity), a status chip, the term dates, and the
contracted headline rent. Click to expand.

**Legal name vs brand** — a lease is signed by `ABC Holdings LLC` but the shopfront says
`Cream Stone`. Both are stored; the brand is what shows, because that is what people
recognise walking past the unit.

---

## 2 · Rent schedule — what is owed

### The four stat tiles

- **Effective monthly rent** — total contracted rent ÷ **full term**, including free
  months at zero. Free rent therefore pulls this *down*, which is the point: it is the
  number to compare two deals with.
- **Free rent** — months abated, and how many paying months remain.
- **First paying month** — rent commencement, which is **not** always the lease start.
- **Total contracted rent** — the whole term's value.

### The table

One row per rent period, colour-coded: **grey = billed and locked**, **blue = in effect
today**, **dashed = scheduled**.

Columns: period dates, length, base rent, total/month, escalation %, and source
(`Initial`, `Escalation`, `Manual`).

**Periods are append-only.** Rows are never edited or deleted — a rent change is a *new*
period from the date it takes effect. That is what makes "what were we billing in March
2025" answerable at all; if rows were editable the answer would be whatever someone last
typed.

**Escalation compounds** off the previous period's rent, not the original. 3% a year on
$10,000 gives 10,300 → 10,609, not 10,300 → 10,600.

### The two buttons

- **Regenerate future** — re-cuts only periods that start *after today*. Anything running
  or finished is frozen.
- **Add rent change** — appends a manual period from a date, with a **mandatory reason**.

Both are disabled, with the reason shown, when the unit has been **sold** — its rent
schedule is closed, and the API refuses these writes regardless of what the UI does.

---

## 3 · Rent ledger — what was collected

One row per **calendar month**, generated from the schedule. Never hand-created.

Tiles: **billed**, **collected** (as a % of billed), **outstanding**, **overdue months**.

Rules worth knowing:

- **Free-rent months still get a row**, at $0, marked `FREE` — so the payment history has
  no unexplained gaps.
- **Partial first/last months are pro-rated by day count**, and the day counts are stored,
  so a prorated figure can be explained to a tenant later.
- **Generation is append-only and idempotent.** Re-running it can never overwrite a
  payment someone recorded. Safe to press twice.
- **A month is billed at one rate** — the period in force on its first billed day. An
  escalation landing mid-month takes effect the *following* month.
- **Rent due day is per-lease** (the 5th, the 10th) and clamps to month end, so a "31st"
  lease bills 28 Feb rather than rolling into March.

Recording a payment needs `rent:collect` — deliberately **not** `lease:edit`, so an AR
clerk can bank rent without being able to rewrite lease terms.

---

## 4 · Deposits & allowances — money owed both ways

Two tiles: **money in** (tenant → Prime) and **money out** (Prime → tenant). They are
never netted against each other; a deposit held and a TI allowance owed are different
obligations pointing in opposite directions.

Four kinds:

| Kind | Direction | Meaning |
|---|---|---|
| `SECURITY_DEPOSIT` | Tenant → Prime | One per lease |
| `NNN` | Tenant → Prime | Charged **once at signing**, not monthly |
| `TI_ALLOWANCE` | Prime → Tenant | Usually disbursed in phases |
| `OTHER` | Either | Anything else agreed |

Each is an agreed total paid down by discrete payments, each carrying date, method,
reference and an optional receipt from the doc vault.

**All three agreed sums typed on the lease form appear here automatically** — security
deposit, NNN and TI allowance (fixed 2026-08-12 — see below).

**Overpayment is refused unless confirmed.** A payment above the agreed total is usually a
typo, and it used to be accepted in silence, flipping the panel to "refund due". You now
get the overshoot stated and a second click to record it deliberately.

---

## The timeline above, for contrast

The **History** panel higher up the page is the *unit's* story — every tenancy, sale,
vacancy, rent change, fit-out gap and **lease edit** in one chronological list, with
lifetime totals. Rent History is the *money detail* for each tenancy in it.

### Lease edits on the timeline (added 2026-08-12)

Any change to the lease terms now appears as its own entry, field by field:

```
Lease updated — Cream Stone
Aug 12, 2026 · Demo Founder
   Monthly rent:      $3,400   → $3,600
   Security deposit:  not set  → $9,000
   TI allowance:      not set  → $45,000
```

**Only genuine changes are recorded.** The lease form posts all ~20 fields on every save,
so the raw audit row cannot tell "the rent moved" from "someone opened the lease and saved
it unchanged". The entry is built from a diff against the stored row, so a no-op save
produces nothing — otherwise the real changes would be buried under noise.

Rent movements still get their own richer `rent_change` entries from the schedule, which
carry the effective date and the escalation reason. This covers everything else: dates,
deposits, tenant details, status, commission terms.

---

## Things that commonly confuse people

**Lease start ≠ rent start.** A lease signed in January with rent starting in April after
fit-out has 90 days where the lease binds but nothing is owed. The schedule and the ledger
both begin at **rent** commencement; the term is measured from there too (so 36 months of
paper is 33 months of rent).

**Free rent sits inside the term.** Three free months on a 36-month lease means 33 paying
months — it does **not** push the end date out, and the escalation clock still runs from
the start. The abated months are forgone, not recovered.

**NNN is charged once, at signing** (confirmed 2026-08-12). It is not part of monthly rent
and does not appear in the schedule table. It lives in Deposits & Allowances.

**Effective rent looks low.** It is straight-lined across the whole term including free
months. That is deliberate — it is the comparable number.

**A sold unit's schedule is closed.** No new periods, no billing past the closing date,
and any scheduled rent dated after the sale is withheld from the timeline as impossible.

---

## Fixed 2026-08-12 — deposit entered on the lease form did not appear

**The bug.** `Lease.securityDeposit` is a field on the lease form. The Deposits &
Allowances panel reads `LeaseObligation`. They were different records, and nothing said
so — you typed a $6,800 deposit while writing the lease, and the panel reported
*"$0 agreed across 0 items"*. The deposit was recorded and simultaneously untracked, with
no way to tell from either screen.

**The fix.** The lease's headline money terms now seed the obligation ledger:

| Situation | Behaviour |
|---|---|
| Amount entered, no obligation yet | Obligation created |
| Amount changed, nothing collected | Agreed total updated to match |
| Amount changed, money already collected | **Left alone** |

That last row is deliberate. Once a payment exists the obligation is a financial record
with its own history; silently re-pointing its total because someone edited a form field
would rewrite what a tenant was recorded as having agreed to. From then on the two are
allowed to diverge and **the panel is the truth**.

Seeding never fails the lease save — a signed agreement must not be lost because a
bookkeeping row could not be written. Failures are logged, and the amount is still on the
lease to seed from later.

Verified end to end:

```
create lease · deposit $6,800 · NNN $1/sqft on 1,000 sqft
   NNN               agreed $1,000  paid $0      PENDING
   SECURITY_DEPOSIT  agreed $6,800  paid $0      PENDING

raise deposit to $7,000 (nothing collected)
   SECURITY_DEPOSIT  agreed $7,000  paid $0      PENDING     <- followed

raise to $9,999 after $3,000 collected
   SECURITY_DEPOSIT  agreed $7,000  paid $3,000  PARTIAL     <- correctly ignored
```

### TI allowance added to the lease form (2026-08-12)

TI was the one agreed sum with no field on the lease: it could only be added from the
obligations panel, so someone writing up a lease with a $45,000 TI had nowhere to put it
and no prompt to record it elsewhere. It now sits beside the security deposit and seeds a
`TI_ALLOWANCE` obligation on save.

**Direction is per-kind, not shared.** TI is the only one of the three that Prime *owes*,
so it seeds as `TO_TENANT`. A shared `FROM_TENANT` would have filed a disbursement under
"money in" and quietly inverted the unit's cash position.

```
one lease, three agreed sums entered on the form:
   NNN               $1,000    Tenant → Prime   PENDING
   SECURITY_DEPOSIT  $6,800    Tenant → Prime   PENDING
   TI_ALLOWANCE      $45,000   Prime → Tenant   PENDING
```

The total is the agreed figure; the phased draw-downs are still recorded as individual
payments against it in the panel.

### Known gaps in the lease form

Audited field-by-field against the schema on 2026-08-12. Everything on the `Lease` model
is now editable from the form except two, both deliberate:

- **`buildingId`** — the form creates UNIT-level leases only. Building-level leases exist
  in the data model (a whole building let as one asset) but must be created from the
  project's Revenue tab. Worth revisiting if Prime does this often.
- **`brokerCommissionPaidAt`** — set by "mark commission paid" in the broker report, where
  the person settling commissions actually works, rather than buried in the lease form.
