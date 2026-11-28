# MOB-43 Account timezone and deadline reconciliation

[Issue #328](https://github.com/duongkienvn/SE2026-T13/issues/328)

Phase P7A functional stabilization. Fixes audit findings F01 and F02 on the
mobile client only. Backend, shared contracts and Web are unchanged.

## Two different clocks

| Surface                         | Server rule                                                           | When the result can change                                                |
| ------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Home / My Tasks groups          | `productivity.service.ts`: `OVERDUE` = `dueDate < today` (saved zone) | Only at the saved timezone's midnight                                     |
| Board `dueStatus=OVERDUE`       | `deriveCardDueStatus`: `dueDate < now`                                | At any instant, including Cards not loaded on the client                  |
| Board `DUE_TODAY` / `UPCOMING`  | same day as now in the saved zone                                     | When a loaded Card's instant passes, and at the saved timezone's midnight |
| Board `NO_DUE_DATE` / no filter | not time dependent                                                    | Never (badges still re-render at due instants)                            |

## What changed

- **F01 Home presentation** (`home/presentation.ts`, `HomeScreen.tsx`,
  `sections.tsx`): Home now reads `GET /users/me/preferences` (existing
  `datePreferencesOptions` query). Greeting period uses the account hour
  (Web's `greetingFor` bands, including "evening" before 05:00) and shows
  "Welcome" until preferences are known. Today/Tomorrow compare account civil
  days; absolute labels and "Viewed …" use the saved date format. A failed
  preference read uses the documented UTC/ISO fallback. Server groups are never
  reclassified on the client.
- **Shared clock** (`preferences/useTemporalReconciler.ts`, pure rules in
  `preferences/temporal.ts`): one foreground timer that wakes at each minute
  boundary (account midnights are always on one), at an optional next loaded
  due instant, and on resume. It never fetches by itself. It calls `onStale`
  only while `signature(fetchedAt) !== signature(now)`, where `fetchedAt` is
  the query's `dataUpdatedAt`. A successful refresh moves `fetchedAt`, which ends
  the cycle, so there are no loops. Missed midnights while backgrounded and
  device clock jumps are caught on the next sample. Blur, background, unmount,
  logout and account switch (screens are keyed by session identity) cancel the
  timer and the AppState subscription.
- **Home / My Tasks** reconcile with `query.refetch({ cancelRefetch: false })`
  on the existing keys. Home also refetches once when the saved timezone
  changes, because its key has no timezone. The My Tasks key already includes
  the timezone. Existing session, online, 429 and retry gates still apply.
- **F02 Kanban** (`BoardKanban.tsx`, `boards/useDueReconciler.ts`): Kanban now
  has the same due clock as Table. The badge tone flips at the instant, and an
  active due filter refetches through `refreshDueFilter`, which is now passed
  to Kanban as well as Table. Table's own effect is replaced by the same hook.
  Before, Table refetched every minute for any due filter. Now `OVERDUE` keeps
  Web's minute cadence (unloaded Cards can cross at any instant), `DUE_TODAY` and
  `UPCOMING` reconcile only at loaded instants and at account midnight, and
  `NO_DUE_DATE` never reconciles.

Calendar (`useCalendarClock`) is intentionally untouched; that belongs to MOB-45.

## Verification

- F01 reproduction: with the device zone set to `America/Los_Angeles`, main's
  `dueLabel` for now `2026-11-27T17:30Z` and due `2026-11-28T08:00Z` returns
  `Tomorrow`. With the fix and account `Asia/Bangkok`, it returns `Today`.
- Node: `test/home/contract.test.ts` (F01, all three date formats, account
  midnight, US DST end, greeting bands, fallback) and
  `test/preferences/temporal.test.ts` (account day/hour, staleness, due-filter
  signatures, next instant).
- Jest (fake clock): `temporal-reconciler.component.test.js` (one reconcile at
  midnight, then quiet for an hour; background/blur; resume after a missed
  midnight; unknown zone or no data never requests; failed refresh retries at
  most once a minute), `home-screen.component.test.js` (F01 labels and
  greeting; midnight turns an empty Overdue into a populated one with exactly
  one extra Home read; no reads while backgrounded; one read on resume),
  `my-tasks.component.test.js` (empty Overdue group fills at New York midnight
  with exactly one extra read), `board-kanban-due.component.test.js` and
  `board-table.component.test.js` (instant badge flip, `DUE_TODAY` instant and
  midnight, `OVERDUE` minute cadence, `NO_DUE_DATE` none, listener removal).
- Mutation checks: 11 targeted mutations, all killed.

## Not verified

- Native device transitions (MOB-42 runtime): real resume, OS clock or timezone
  changes, and two-client timing on Android/iOS.
- Live backend smoke for the new Home preferences read (the route and decoder
  are reused unchanged).
