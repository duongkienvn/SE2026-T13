# P4-09 — Notification Center, Bell and Preferences UI

Implements the frontend portion of [issue #198](https://github.com/duongkienvn/SE2026-T13/issues/198),
[CX-01](../../roadmap/post-mvp.md), the
[Settings & Notifications spec](../../design/post-mvp/settings-notifications/ux-spec.md) and the
[P4-03 handoff](../backend/p4-notification-foundation.md). Local implementation and verification
only; nothing was pushed or deployed.

## API and realtime mapping

| UI                        | Request                                                    | Notes                                                |
| ------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| Bell badge                | `GET /api/notifications/unread-count`                      | Authoritative; never counted from loaded rows        |
| Bell popover              | `GET /api/notifications?filter=unread&page=1&limit=5`      | Five newest unread                                   |
| `/notifications`          | `GET /api/notifications?filter=all\|unread&page=N&limit=5` | Server pages; `filter`/`page` in the URL             |
| Open item / Mark as read  | `PATCH /api/notifications/:id/read`                        | Only `readAt` is updated; then inbox+count refetch   |
| Mark all as read          | `POST /api/notifications/read-all`                         | Shows the returned `updatedCount`                    |
| `/settings/notifications` | `GET` / `PATCH /api/users/me/notification-preferences`     | PATCH = changed boolean leaves only                  |
| Realtime                  | `notifications:changed` on the existing session socket     | Payload ignored; one coalesced (150 ms) REST refetch |

All types come from `@kanban/shared` (`NotificationResponse`, `NotificationPreferences`, …).
`features/notifications/api.ts` checks responses at the trust boundary: unknown kinds are
rejected, an `isUnavailable` item is reduced to `actor/context/target = null`, a target whose
path is not an internal `/…` route is dropped, and preferences keep only the six in-app and
three email leaves.

## Bell and popover

- `AppHeader` gained one optional `notifications` slot; `AppShell` forwards it and
  `AuthenticatedLayout` passes `<NotificationBell />`. Without the prop the original static
  "coming soon" slot still renders (its tests are unchanged). Header height, spacing, Search
  slot and avatar are untouched; the bell keeps the same 40×40 footprint.
- Badge: hidden at 0, `1`–`99`, then `99+`; the button's name always has the exact number
  ("Notifications, 120 unread"), or says the count is loading/unavailable.
- Popover: non-modal `role="dialog"`, focus moves into it, Escape / outside click / tabbing
  away close it, Escape and the close return focus to the bell. On phones it is a full-width
  sheet under the header. Header "Mark all as read" (pending + error/Retry), list, "View all
  notifications" → `/notifications`.
- Opening an available item starts mark-read and follows only `target.path`; the Board/Card
  route then runs its own access check. Items with `target: null` (e.g. an invitation without
  a recoverable proof) and unavailable stubs are not links; they get an icon-only
  "Mark as read" button.

## Inbox `/notifications`

All / Unread tabs (Unread shows the server count), five rows per server page with numbered
pagination, both kept in the URL (`?filter=unread&page=2`; a filter change restarts at page 1;
Back/Forward work; a page that no longer exists after reads steps back). Rows keep server
order and are labelled Today / Yesterday / date in the saved time zone and date format; the
exact time is the `title` of each relative time. Unavailable history stays listed, muted, in
italics, with no link or names. Empty, loading, offline and error-with-Retry states exist.
Summaries are plain React text (an HTML-looking summary is shown literally — tested).

## Preferences `/settings/notifications`

- `settings/sections.ts`: Notifications `soon` → `available` (`path: 'notifications'`); Data &
  Privacy stays Soon. Route added under the existing `SettingsLayout`, so the desktop rail and
  the phone list + "Back to Settings" work unchanged.
- In-app: six switches (`role="switch"`). **Board invitations** says "Not sent yet — boards
  add members directly today", because P4-04 reserves `BOARD_INVITED` but nothing emits it;
  adding a Board member is `MEMBERSHIP_CHANGED`.
- Email: the three optional task-email leaves plus a static "Security and account — Always
  on" row with no switch.
- **Email readiness:** the UI cannot detect whether the server's
  `TASK_NOTIFICATION_EMAIL_ENABLED` sender is on, and must not infer it from the PATCH
  endpoint. The email switches are therefore disabled with "Task email is not turned on for
  this Kanvexa server yet" unless the frontend build sets `VITE_TASK_EMAIL_ENABLED=true`
  (documented in `.env.example`). When on, the note says delivery is best effort and the
  choice is saved either way. Saved values are always shown.
- Save sends only changed leaves, reconciles the form from the full server response, keeps
  the draft on failure, has Cancel, a saving state and the existing `UnsavedChangesGuard`.
- A failed background preferences refetch keeps the mounted form, draft and unsaved-changes
  guard, with a non-blocking retry notice. Initial-load failures keep the full-page error.

## Session, privacy and cache

Query keys: `['notifications', userId, sessionGeneration, 'count' | 'list' | 'preferences', …]`,
and data is only rendered while the session scope is current. Nothing is written to browser
storage. Invalidation:

- `notifications:changed` → coalesced refetch of inbox + count (not preferences).
- Socket reconnect, window focus, network reconnect → refetch.
- `revokeBoardAccess`, `revokeWorkspaceAccess`, `receiveWorkspaceRevocation` and
  `refreshAccessSnapshots` (`access:changed`, reconnect) call `clearNotificationDetails`:
  rendered rows are dropped at once, then REST returns the unavailable stubs. The unread count
  is kept (history and count do not change on revocation).
- Mark-read responses update only `readAt` on existing rows, so a delayed response cannot
  restore summaries, actors, context or links removed by an access-change refetch.
- Realtime connection loss does **not** clear the inbox; it stays readable while offline.

## Global Search (P4-08) coexistence

This branch was rebased onto `main` after P4-08 (#204) merged. The header now holds
`SearchTrigger`, then the bell, then the avatar; the conflicts in the realtime and
revocation files were resolved by keeping both `refreshSearch` and
`clearNotificationDetails`. Opening the search palette (Ctrl/⌘ K) moves focus into its
modal, which closes the bell popover (tested).

## Files touched outside the feature folder

| File                                                                                                               | Why                                                     |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `app/layout/AppHeader.tsx`, `AppShell.tsx`                                                                         | Optional bell slot, forwarded; fallback unchanged       |
| `app/layout/AuthenticatedLayout.tsx`                                                                               | Passes the bell                                         |
| `app/routes.tsx`                                                                                                   | `/notifications`, `/settings/notifications`             |
| `features/settings/sections.ts` (+ layout test)                                                                    | Activate the section; tests assert the real link        |
| `features/realtime/RealtimeProvider.tsx`                                                                           | Subscribe to `notifications:changed`; reconnect refetch |
| `features/realtime/access-revocation.ts`, `boards/revoke-board-access.ts`, `workspaces/revoke-workspace-access.ts` | One `clearNotificationDetails` call each                |
| `lib/env.ts`, `vite-env.d.ts`, `.env.example`                                                                      | `VITE_TASK_EMAIL_ENABLED`                               |
| `test/mock-api.ts`                                                                                                 | Default `unread-count` 0 for every signed-in test       |

No shared tokens, global CSS or other pages were restyled; new styles live in
`features/notifications/notifications.css`.

## Visual reference and differences

Matched panels 2 (inbox), 3 (preferences), 4 (popover) and 8 (mobile inbox) of the
[approved reference](../../design/post-mvp/settings-notifications/approved-visual-reference-v1.png):
bell with red count badge; popover with title, Mark all as read, tinted kind icons, bold
unread title, summary, meta line, blue unread dot and "View all notifications →"; inbox with
icon header, All / Unread (N) underline tabs, Mark all as read on the right and Today /
Yesterday groups; preferences with In-app and Email cards, icon + label + description +
switch rows and a non-toggle security row.

Deliberate differences: kind titles are fixed labels and the second line is the server
summary (no invented context lines such as Board names, which the API does not return); the
meta line shows the actor when the server discloses one; there is no "Card updated" or
"Comment added" kind (not in the six-kind contract); the popover has no "…" menu or close
button (no actions behind them); preferences use two columns on wide screens and a short-laptop
density step so the page fits without scrolling; the mobile bottom tab bar is not adopted.

Evidence (mocked-API captures, not production data) is in
[implementation screenshots](../../design/screens/implementation/p4-notifications-ui/).
Fit (`main` scroll overflow) on the built app: 0 px for the inbox, popover and preferences at
1280×800 and 1366×657 and at 768×1024, light and dark; phones stack and scroll. No horizontal
overflow anywhere. Main-vs-branch pixel diffs of Boards and Settings Profile (1280/768/375,
light/dark) differ only in the bell glyph (now active instead of muted; same 40 px box) and
the Settings rail Notifications item (now a link).

## Verification

Local, November 4–5, 2026:

| Check                                                 | Result                                  |
| ----------------------------------------------------- | --------------------------------------- |
| `vitest run src/features/notifications`               | PASS: 5 files, 39 tests                 |
| Full frontend `vitest run --maxWorkers=2`             | PASS: 135 files, 1,387 tests            |
| Mutation: no `clearNotificationDetails` on revocation | Caught (inbox revocation test)          |
| Mutation: no hint coalescing                          | Caught (burst test expects one refetch) |
| Mutation: link unavailable/null-target rows           | Caught (3 inbox tests)                  |
| `pnpm lint`                                           | PASS                                    |
| Frontend `vite build`, `tsc --noEmit`                 | PASS                                    |
| Changed files `prettier --check --end-of-line auto`   | PASS                                    |

Not verified end to end against a running backend with real producers or the email worker;
the behavior is covered by HTTP fixtures that use the P4-03 response shapes.
