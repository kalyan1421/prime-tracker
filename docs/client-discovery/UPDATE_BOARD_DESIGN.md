# Global Update Board — Design & Plan

**Status:** Phases 1–3 and 5 DELIVERED (2026-08-26) — schema, migration, permissions, full `update-board`
module, all 4 notification triggers, the full frontend, and the open-creation + "Leadership Only"
restriction rework (§8), all verified live in the running app. Phase 4 (dedicated tests) still open.
**Date:** 2026-08-26
**Scope:** New, org-wide "Prime Tracker Update Board" — a chat-style feed of updates/announcements that is
**not** scoped to any single project (distinct from the existing per-project Construction Updates Board, which
is `Task` with `kind='CONSTRUCTION'`).
**Grounded against:** `Task`/`TaskComment`/`TaskAttachment`/`TaskAssignment` (comment + mention + attachment +
assignment plumbing), `mentions.ts` `resolveMentions()`, `CustomOption` (status/priority label config),
`notifications.service.ts` + `scheduled-notifications.service.ts` (8AM CT cron), `usePresignedUpload`.

---

## 1. Problem framing

The client wants a single, org-wide place to post updates/announcements — with due dates, status, priority,
document/image/link attachments, a chat thread per post, and notifications — that anyone across Prime
Developers can see, but only admin-tier roles can post to. This is explicitly **not** the per-project
Construction Updates Board (`ConstructionBoard.tsx`, a `Task`-backed kanban scoped to one project's site work).
It's the org-wide equivalent: a running feed rather than a work-assignment board.

**Why not reuse `Task`:** `Task.projectId` is required (non-null), and every permission check, query, and
notification in that module assumes a project. Forcing a global feed into `Task` means making `projectId`
nullable everywhere and bolting an incompatible access model (org-wide visibility vs. project-membership
visibility) onto one table. The codebase has already made this call before — `UnitConstructionStage` was
deliberately built as a **new** model instead of extending `Task` once the semantics diverged (see schema
comment at `apps/api/prisma/schema.prisma:2460`). Same call here: new model, but reuse every shared subsystem
(comments/mentions, presigned uploads, `CustomOption`, notifications) instead of writing them twice.

**The real job:** *A founder/admin posts an update — with an optional due date, priority, and optional tags to
a project/building/unit for context — and the team sees it, discusses it in a thread, and gets notified.*

---

## 2. Schema

```prisma
enum UpdateBoardPostStatus {
  OPEN
  IN_PROGRESS
  DONE
  BLOCKED
}
// Actually stored as CustomOption category "update_board_status" (String on the model), not a
// hard enum — same pattern as task_status/task_priority, so orgs can relabel without a migration.
// The enum above documents the seeded default values only.

model UpdateBoardPost {
  id          String    @id @default(cuid())
  title       String
  body        String?

  status      String    @default("OPEN")     // CustomOption "update_board_status"
  priority    String    @default("MEDIUM")   // CustomOption "update_board_priority" (reuse task_priority values)
  dueDate     DateTime?
  pinned      Boolean   @default(false)      // admin-only; keeps important posts at top of the feed

  // Optional tags — independent of each other, NOT enforced as "exactly one" (unlike Sale/Lease/Loan's
  // Unit-XOR-Building polymorphism). A post can be tagged to none, one, or all three. Tagging is for
  // filtering/context only — it does NOT restrict visibility; the board stays org-wide flat-permission.
  projectId   String?
  project     Project?  @relation(fields: [projectId], references: [id], onDelete: SetNull)
  buildingId  String?
  building    Building? @relation(fields: [buildingId], references: [id], onDelete: SetNull)
  unitId      String?
  unit        Unit?     @relation(fields: [unitId], references: [id], onDelete: SetNull)

  links       Json[]    // [{ url: string, label: string }] — plain links, no join table needed

  createdById String
  createdBy   User      @relation("UpdateBoardPostCreator", fields: [createdById], references: [id])
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?                       // soft delete, consistent with the rest of the app

  assignments UpdateBoardAssignment[]
  attachments UpdateBoardAttachment[]
  comments    UpdateBoardComment[]

  @@index([projectId])
  @@index([buildingId])
  @@index([unitId])
  @@index([status])
  @@index([pinned, createdAt])
  @@map("update_board_posts")
}

model UpdateBoardAssignment {                 // optional "tag people" — mirrors TaskAssignment
  id         String    @id @default(cuid())
  postId     String
  post       UpdateBoardPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  userId     String
  user       User      @relation(fields: [userId], references: [id])
  notifiedAt DateTime?                        // spam guard, same pattern as TaskAssignment
  createdAt  DateTime  @default(now())

  @@unique([postId, userId])
  @@map("update_board_assignments")
}

model UpdateBoardAttachment {                 // documents/images — mirrors TaskAttachment + presigned upload
  id           String   @id @default(cuid())
  postId       String
  post         UpdateBoardPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  storagePath  String
  fileName     String
  mimeType     String
  uploadedById String
  uploadedBy   User     @relation(fields: [uploadedById], references: [id])
  createdAt    DateTime @default(now())

  @@map("update_board_attachments")
}

model UpdateBoardComment {                    // the "chat"
  id        String   @id @default(cuid())
  postId    String
  post      UpdateBoardPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
  content   String
  createdAt DateTime @default(now())

  // Reuses the existing mentions.ts resolveMentions() — do not write a second @mention parser.

  @@index([postId, createdAt])
  @@map("update_board_comments")
}
```

**Design choices, spelled out:**

- **`onDelete: SetNull` on the three tags, not `Cascade`.** If a tagged project/building/unit is later deleted,
  the post and its chat thread survive — they just become untagged. Losing a discussion because someone
  deleted a unit would be the wrong failure mode for a communication log.
- **Tags don't gate visibility.** A post tagged to Project X is still visible on the global `/updates` board to
  everyone with `updateBoard:view` — the tag is metadata for filtering/context, not an access boundary. This
  is what keeps the board *not* a duplicate of `Task`'s per-project membership access model.
- **No enforced cascade between the three tags.** Not validating `unit.buildingId === buildingId` at the DB
  layer for v1 — Unit → Building → Project auto-fill is a UI convenience, not a constraint.
- **`status`/`priority` as `CustomOption`-backed strings**, not hard enums — zero-migration relabeling, same as
  `task_status`/`task_priority`. Recommend seeding `update_board_priority` as an alias of `task_priority`
  (same four values) rather than a second copy, unless the client wants different priority labels here.

---

## 3. Access control

| Action | Who |
|---|---|
| **View + comment (chat)** | All internal roles — everyone except `CLIENT` (this board is explicitly internal) |
| **Create post** (the restricted button) | New permission `updateBoard:create` — `SUPER_ADMIN`, `FOUNDER`, `EXECUTIVE` |
| **Edit/delete a post** | Post creator, or `SUPER_ADMIN`/`FOUNDER` |
| **Pin/unpin** | Same as create — `updateBoard:create` holders only |

- Frontend gates the "+ New Update" button with the existing `PermissionGate` component.
- Backend enforces via `@RequirePermissions('updateBoard:create')` on the controller — same
  `JwtAuthGuard + PermissionsGuard + AuditInterceptor` pattern as every other module. No new guard logic.
- `EXECUTIVE` is included alongside `FOUNDER`/`SUPER_ADMIN` because it's founder-tier in every other
  permission set in this app. One-line change (`RequirePermissions('updateBoard:create')` role list) if the
  client wants it tighter to just `SUPER_ADMIN`/`FOUNDER`.

---

## 4. Notifications

Reuse `notifications.service.ts` rather than building a parallel channel:

- **`UPDATE_BOARD_POSTED`** — fires when a post is created. Recipients: all internal users who have this
  preference on (opt-in default **on** for in-app, **off** for email — avoid inbox spam for a chat feed). Add
  the toggle row to `/settings/notifications` like every other type.
- **`UPDATE_BOARD_COMMENT_MENTION`** — reuses the existing `COMMENT_MENTION` mechanics (`resolveMentions()`)
  for whoever is @mentioned in a chat reply. Do not write a second mention parser.
- **`UPDATE_BOARD_ASSIGNED`** — fires when someone is tagged via `UpdateBoardAssignment`, same shape as
  `TASK_ASSIGNED`; spam-guarded by `notifiedAt` on the join row (not old-vs-new comparison), same trap
  documented for `TaskAssignment` — compare against the *stored* value, never `data.x !== undefined`.
- **`UPDATE_BOARD_DUE_SOON`** — added to the existing 8AM CT cron in `scheduled-notifications.service.ts`,
  same shape as the lease/loan/milestone due-date checks already there.
- Remember the two compile-time guards in `notifications.service.ts` (`_Unclassified` /
  `_UnclassifiedRecurrence`) — the build fails until each new `NotificationType` value is classified into a
  tier and recurrence bucket. There is also an exact-count assertion in
  `scheduled-notifications.service.spec.ts` that must be bumped alongside the enum, never alone (bit the team
  before on `TASK_ASSIGNED`).

---

## 5. Frontend

- New top-level sidebar nav item — **"Updates"** → `/updates` (own route, not a tab under any project).
- `UpdateBoardPage.tsx`: feed sorted `pinned desc, createdAt desc`. Filter bar: status, priority, due date,
  project/building/unit tag, assignee, free-text search.
- Post card shows: title, status/priority chips, due date, pin indicator, tag chips for
  Project/Building/Unit (clickable → navigates to that entity's detail page), comment count.
- Click a post → drawer/modal with: title, editable status/priority/due-date chips (admin-only edit),
  editable tags, links list, attachments grid (`usePresignedUpload`, category `update-board`), and the chat
  thread at the bottom (`UpdateBoardComment` list + mention-aware input).
- Create/edit form: title, body, status, priority, due date, pin toggle, Project → Building → Unit cascading
  selects (UI-only cascade, not DB-enforced), link add/remove rows, tag-people multiselect.
- "+ New Update" button — `PermissionGate permission="updateBoard:create"`.
- No real-time push exists in this app yet (notifications poll every 30s). The chat thread follows the same
  pattern: refetch on interval / on drawer focus, not a WebSocket. Set expectations accordingly — it's a
  fast-refresh feed, not live chat.

---

## 6. Phased build

| Phase | Scope | Est. |
|---|---|---|
| 0 | Lock: `EXECUTIVE` in create-role set? seed `update_board_priority` as alias of `task_priority` or separate? default notify-all-on-post vs opt-in-only? | — |
| 1 | ✅ **DELIVERED 2026-08-26.** Migration `20260826000000_add_update_board` (`UpdateBoardPost` + 3 child tables, optional Project/Building/Unit FKs, `onDelete: SetNull`) + `apps/api/src/modules/update-board/` (controller/service, CRUD, comments, attachments, permissions, filters incl. `?projectId=`/`?buildingId=`/`?unitId=`). `updateBoard:view`/`updateBoard:create` wired into `ROLE_PERMISSIONS`. Smoke-tested end-to-end via demo-mode auth; full suite 2205/2206 (1 unrelated pre-existing flake). Decisions locked as documented in §2/§3: `EXECUTIVE` included in create-role set; `task_status`/`task_priority` reused as-is (zero new `CustomOption` config). See [[prime-tracker-update-board-phase1]]. | 4–5d |
| 2 | ✅ **DELIVERED 2026-08-26.** Migration `20260826010000_add_update_board_notification_types` adds the 4 `NotificationType` values, classified in `notifications.service.ts` (`UPDATE_BOARD_POSTED`=FYI/discrete, `_COMMENT_MENTION`/`_ASSIGNED`=ACTION/discrete, `_DUE_SOON`=ACTION/RECURRING). `UpdateBoardService` fires POSTED/ASSIGNED/COMMENT_MENTION inline (mirrors `TasksService.notifyAssigned`/`notifyMentions` — reuses `resolveMentions()`, never a second parser); `ScheduledNotificationsService.checkUpdateBoardDueSoon()` joins the existing 8AM CT cron, 3-day horizon, excludes DONE/CANCELLED, dedupeKey `update-board:<postId>`. Preferences toggle needed no backend work (`getPreferences()` already lists `Object.values(NotificationType)`); added `TYPE_LABELS`/`TYPE_TIER` entries to `SettingsPage.tsx` for polish. All 4 paths verified live (demo-mode create/comment/assign + a direct cron invocation via `NestFactory.createApplicationContext`). Full suite 2205/2206 (same pre-existing flake). See [[prime-tracker-update-board-phase1]]. | 1d |
| 3 | ✅ **DELIVERED 2026-08-26.** `UpdatesPage.tsx` (feed + filters + paginated list, mirrors `TasksPage.tsx`'s structure closely), sidebar nav entry gated on `updateBoard:view`, route in `App.tsx` gated the same way. Create/edit modal: title/body/status/priority/due-date/pin toggle, cascading Project→Building→Unit selects, multi-select "Tag People" (`selectionMode="multiple"`), add/remove link rows. Detail side panel: quick status chips (disabled for non-managers), tag chips that navigate to the tagged Project/Building/Unit, links list, attachments (via the shared `usePresignedUpload` → `/update-board/:id/attachments`), and the chat thread. "+ New Update" gated with `PermissionGate permission="updateBoard:create"`. Verified live in the running app (not just typechecked): created a pinned post tagged to a real project with a link, confirmed it sorted to the top with the tag chip showing and the link navigating correctly; switched to `VIEWER` via Dev Quick Login and confirmed the create button is hidden, status chips are disabled, but chat reply still works and posts; confirmed the notification bell shows all 4 Update Board notification types live. One real bug caught and fixed during verification: wrapping a bare `FiBookmark` icon in HeroUI's `Tooltip` threw a "function components cannot be given refs" console error (react-icons components don't forward refs) — fixed by wrapping the icon in a `<span>` inside the tooltip, confirmed via direct DOM inspection. `apps/web` typecheck clean, all 66 vitest tests pass (including `design-system.test.ts`). | 3.5–4.5d |
| 4 | Tests (service specs, RBAC role coverage per the existing role-testing pattern) + seed data | 1–2d |

**Total: ~9.5–12.5 eng days.**

---

## 7. Open questions

- Should tagging a post to a Project also notify that project's members (in addition to whoever's opted into
  `UPDATE_BOARD_POSTED`), or is tagging purely a filter/context convenience with no notification side-effect?
  **(product)**
- `EXECUTIVE` in the create-role set, or restrict to `SUPER_ADMIN`/`FOUNDER` only? **(product)**
- Reuse `task_priority` `CustomOption` values for `update_board_priority`, or does the client want different
  priority labels on this board? **(product)**
- Should the Unit picker auto-constrain to the selected Building/Project in the UI, even though the DB doesn't
  enforce it? **(eng — low cost, recommend yes)**

---

## 8. Phase 5 — Open creation + "Leadership Only" restriction ✅ DELIVERED 2026-08-26

Triggered by a post-launch design critique that surfaced a real bug (see below) plus a product change: creation
was too narrow (only `SUPER_ADMIN`/`FOUNDER`/`EXECUTIVE`), and Finance/Accounting need to post their own
updates — but some of what they'd post (numbers, sensitive detail) shouldn't broadcast to the whole company.

### Locked decisions
1. **Create access** → all roles except `CLIENT` and `VIEWER`. VIEWER stays read-only everywhere else in the
   app ("Read-only access to projects, buildings, units, and milestones" — its own role description), so it
   stays read-only here too rather than becoming the one place it can write.
2. **Who can flip "Leadership Only"** → anyone creating/editing a post, not just leadership. The toggle only
   *narrows* the audience below what the post would otherwise reach, so letting the poster self-restrict their
   own sensitive content needs no extra authority — same logic as why nothing stops you from not saying
   something in the first place.
3. **What "Leadership Only" means for everyone else** → fully hidden. Excluded from the feed, search, and
   filters; a guessed direct link 404s (`NotFoundException`, not `ForbiddenException`) — matches how
   `ProjectAccessGuard` hides projects a scoped role isn't staffed on, existence itself isn't revealed.
4. **Who can Pin** → leadership only (`SUPER_ADMIN`/`FOUNDER`/`EXECUTIVE`), regardless of who created the post.
   Now that anyone can post, "pinned" needs to stay a curated signal rather than something any poster can
   self-apply to their own item.

### The visibility rule (designed during planning, not asked verbatim but falls out of the decisions above)
A restricted post is visible to: **leadership, OR its creator, OR anyone tagged on it (`assignments`)**.

Creator inclusion is obvious (you can always see your own post). Tagged-assignee inclusion is the load-bearing
call: if a Finance user restricts a post but explicitly tags one Sales person on it, that person needs to be
able to open it — otherwise `notifyAssigned` sends them a link that 404s, which is a broken notification, not a
security feature. This also means comments/attachments need no special-casing: `getComments`/`addComment`/
`addAttachment` already call `findById` first for existence, so threading the same visibility check through
`findById` protects them for free — and since only people who can already SEE the post can reach its comment
box, an @mention inside a restricted post's chat can never be an escalation path (the mentioner had to already
be authorized to be typing there).

### Bug fixed in the same pass
The design critique on 2026-08-26 found that `PUT`/`DELETE /update-board/:id` gate on `updateBoard:create` at
the route level — so a post's creator who is later moved to a role without that permission (e.g. demoted from
`EXECUTIVE` to `SALES`) gets 403'd trying to edit or delete their OWN post, even though the service-level
`assertCanManage` assumes ownership always grants manage rights. Comments/attachments don't have this bug
(their routes gate on the much broader `updateBoard:view`). Fix: loosen the post `PUT`/`DELETE` route gate to
`updateBoard:view` and let `assertCanManage` do the real authorization, consistent with comments/attachments.

### Implementation plan

**Schema** — one field, one migration:
```prisma
model UpdateBoardPost {
  ...
  restricted Boolean @default(false) // "Leadership Only" — see UpdateBoardService.assertVisible
  ...
  @@index([restricted])
}
```

**Permissions** (`packages/shared/src/types/index.ts`) — add `PERMISSIONS.UPDATE_BOARD_CREATE` to `FINANCE`,
`ACCOUNTING`, `AR_AP`, `PROJECT_MANAGER`, `CONSTRUCTION`, `SALES`, `MARKETING`, `LEGAL` (8 roles). `VIEWER`
keeps `updateBoard:view` only. No new permission constant needed for the restrict/pin toggles — those are
role checks inside the service (`LEADERSHIP_ROLES`, reused from `notifications.service.ts` rather than a new
constant), not permission-string gates.

**`UpdateBoardService`**:
- `assertVisible(post, viewerId, viewerRole)` — throws `NotFoundException` unless `!post.restricted ||
  LEADERSHIP_ROLES.includes(viewerRole) || post.createdById === viewerId || post.assignments.some(a =>
  a.userId === viewerId)`. Called from `findById` (used internally by `getComments`/`addComment`/
  `addAttachment`/`update`/`delete`, so they inherit the check for free once `findById` takes a viewer).
- `findAll` — gains a `viewer: { userId, role }` param; when not leadership, ANDs in `{ OR: [{ restricted:
  false }, { createdById: viewer.userId }, { assignments: { some: { userId: viewer.userId } } }] }` alongside
  the existing filters (composed via `where.AND`, not overwriting the existing search `where.OR`).
- `create`/`update` — accept `restricted` pass-through (no extra authority check, per decision #2). Both gain
  a pin-authority check: attempting to set `pinned: true` (create) or actually CHANGE `pinned` (update) while
  `!LEADERSHIP_ROLES.includes(actorRole)` throws `ForbiddenException('Only leadership can pin an update')`.
  `update` compares against the post's current value first so a non-leadership creator saving unrelated edits
  to an already-pinned post isn't blocked by resending the unchanged field.
- `notifyPosted` — when `post.restricted`, recipients narrow from "all active non-CLIENT users" to
  `LEADERSHIP_ROLES` only.

**`UpdateBoardController`** — thread `@CurrentUser('sub')`/`@CurrentUser('role')` through `findAll`, `findOne`,
`getComments`, `addComment`, `addAttachment` (several don't carry viewer context today). Loosen `PUT`/`DELETE
:id` from `updateBoard:create` to `updateBoard:view` (the bug fix above).

**Frontend (`UpdatesPage.tsx`)**:
- "+ New Update" needs no code change — it's already `PermissionGate permission="updateBoard:create"`, so it
  just starts showing for the newly-granted roles once the permission table changes.
- New "Leadership Only" `Switch` in the create/edit form, same pattern as the existing "Pin to top" one.
- "Pin to top" switch: rendered disabled (with a tooltip) unless `LEADERSHIP_ROLES.includes(user?.role)` —
  UI-level convenience; the service enforces it regardless.
- A small lock icon / "Leadership Only" chip on the row and detail panel for posts where `restricted` is true
  (only ever rendered for someone who could see the post in the first place).
- No new hide logic needed beyond that — restricted posts a viewer can't see simply never appear in
  `useUpdateBoardPosts()`'s response, and `PostSidePanel` already renders "Update not found" on a 404.

**Testing** — re-run `route-permissions.spec.ts` (permission roster changed), full API + web suites, then a
live pass mirroring Phase 3's: create as `SALES` (should now work), restrict a post, confirm `VIEWER`/other
non-tagged roles can't see it in the feed or via direct link, confirm a tagged non-leadership person CAN see
it, confirm a non-leadership pin attempt is rejected with a clear error.

**Est.:** ~1.5–2 eng days (mechanical but touches every method in the service/controller).

### Delivered

Migration `20260826020000_add_update_board_restricted` (one field + index). All 9 non-leadership,
non-`VIEWER`/`CLIENT` roles now hold `updateBoard:create`. `UpdateBoardService` and `UpdateBoardController`
rewritten with the `Viewer` type threaded through every read/write path; `assertVisible` enforces the
leadership-or-creator-or-tagged rule; pin authority is checked in both `create` and `update` (the latter only
when the value is actually changing, so a non-leadership creator can still save unrelated edits to an
already-pinned post). `PUT`/`DELETE :id` now gate on `updateBoard:view` — the critique's bug fix, landed in
the same pass. Frontend: "Leadership Only" `Switch` in the create/edit form, "Pin to top" disabled with a
tooltip for non-leadership, a lock icon on restricted rows/detail panels.

Verified live end-to-end against a real running instance (not just typechecked): `SALES` creating a post
(previously 403, now 201) while `VIEWER` still correctly 403's; a `SALES` pin attempt rejected with "Only
leadership can pin an update"; a `FINANCE`-created restricted post invisible in a `SALES` list AND 404ing on
direct link AND 404ing on a direct comment-POST attempt, while the explicitly-tagged `VIEWER` could open it
and `FOUNDER` saw it in their feed; and the actual bug-fix scenario — `SALES` (who never held
`updateBoard:create` before this phase) successfully editing and deleting the post their own now-broadened
role created, which would have 403'd under the old route gate. Full suite: **2206/2206** (the one flake from
Phases 1–3 didn't reproduce this run). `apps/web` typecheck + all 66 vitest tests clean.
