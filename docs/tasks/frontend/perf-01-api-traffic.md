# PERF-01 API traffic and realtime — working record

This record describes work on [issue #233](https://github.com/duongkienvn/SE2026-T13/issues/233). It is not a production measurement or a claim that the issue is complete.

## Controlled measurement

Run `pnpm --filter @kanban/frontend exec vitest run src/features/realtime/traffic-baseline.test.ts src/features/cards/traffic-summary-hook.test.tsx --maxWorkers=1` for the current probes. Run `node scripts/perf01-replay-baseline.mjs` to replay the same controlled scenarios with the original queue and preview hook from Git; it creates and removes four temporary files. The tests use a real loopback HTTP server and active TanStack Query observers. Initial loading is excluded from the counts.

| Action                                        | Query starts before / after | Cancellations before / after | HTTP requests before / after |
| --------------------------------------------- | --------------------------- | ---------------------------- | ---------------------------- |
| Mutation success plus an earlier queued hint  | 2 / 1                       | 0 / 0                        | 2 / 1                        |
| Slow unprotected mutation; hint flushes first | 2 / 2                       | 0 / 0                        | 2 / 2                        |
| Board B hint while Board A move is pending    | 0 / 1                       | 0 / 0                        | 0 / 1                        |
| Card event with 201 visible preview summaries | 1 / 1                       | 0 / 0                        | 3 / 1                        |

The protected-move before result was run before implementation in commit `b26806d`. The other before results were reconstructed afterward by replaying the original queue from `9c00f5407295`; they are not recordings made before editing. In the slow-mutation scenario, the changed queue's first GET is allowed to finish before the mutation response; the original queue waits for the mutation, so its GETs occur afterward. These probes do not use the application backend, browser, real socket, or PostgreSQL. Board idle, create/edit, comments, checklists, attachments, Card Detail, Search, navigation, focus/reconnect, two tabs and two users have **not** been measured end to end. At baseline time, Docker Desktop's Linux engine was unavailable and local ports 3000 and 5433 did not accept connections.

In the cross-Board probe, the Board B request starts and completes while the Board A mutation is still pending; Board A refreshes after that mutation settles. The two GETs use the respective `['boards', 'detail', 'board-b', 'cards']` and `['boards', 'detail', 'board-a', 'cards']` keys. Each query starts once, each sends one request, and neither is cancelled.

In the 201-Card preview probe, the original key contains all 201 IDs and its single queryFn issues three HTTP requests sequentially. The changed hook uses keys with at most 100 IDs; the event invalidates only the key containing the changed Card, so one queryFn sends one HTTP request. Both measurements use the real hook and queue against loopback; the original result was reconstructed after implementation.

## Local browser comparison

Chrome headless ran the Vite development build against a localhost Nest API and a disposable PostgreSQL database. Two newly created Boards each contained two Columns and one Card. The baseline checkout was `9c00f5407295`; the changed run included Card-list coordination, field-only hint and comment correlation described below. A temporary QueryCache subscription recorded `fetch` actions and Chrome DevTools recorded actual HTTP requests and cancellations. Counts below exclude CORS OPTIONS and include the mutation request; the idle window was 2.5 seconds. These runs used React StrictMode and separate equivalent fixtures, so they are controlled local observations rather than production measurements.

The normalized [browser event evidence](perf-01-browser-evidence.json) retains per-action query keys, query state transitions and HTTP starts/cancellations. Fixture UUIDs are replaced with `<fixture-id>`; no request headers or tokens were recorded. `fetch` here means a QueryCache fetch transition; the record does not separately instrument abort signals at the queryFn boundary, so queryFn cancellation counts are **NOT VERIFIED**.

| Action                       | HTTP starts before / after | Cancelled HTTP before / after | Query starts before / after |
| ---------------------------- | -------------------------: | ----------------------------: | --------------------------: |
| Board idle                   |                      0 / 0 |                         0 / 0 |                       0 / 0 |
| Open Card Detail             |                    10 / 10 |                         5 / 5 |                     10 / 10 |
| Edit Card title              |                     10 / 3 |                         0 / 0 |                       9 / 2 |
| Create comment               |                      5 / 3 |                         0 / 0 |                       4 / 2 |
| Close Card Detail            |                      1 / 1 |                         0 / 0 |                       1 / 1 |
| Open Search and enter a term |                      1 / 1 |                         0 / 0 |                       1 / 1 |

For the title edit, the Card list key `['boards', 'detail', boardId, 'cards']` started twice before and once after, with the same GET counts; the preview key started twice before and zero times after; Card child queries also did not restart after. For comment creation, both the Card comments page key and preview key started twice before and once after. Opening Card Detail started each of the Card, labels, checklists, attachments and comments queries twice, with one corresponding HTTP cancellation each in both runs. Other requested browser scenarios remain **NOT VERIFIED**. The temporary database, Chrome profile and session fixture were removed after measurement.

## Changes and limitations

- The queue waits only for queries protected by optimistic changes or a Card success handler's list write, and can treat a successful exact-query fetch started after a hint as covering that hint. A later hint remains pending. Comment mutations correlate their own hint through a short-lived per-tab operation ID; failures replay it, while other tabs and unrecognized IDs use normal invalidation. The slow unprotected mutation probe still duplicates a request, so F1 is **not complete** for all resources and timings. Generic, prefix and failed refreshes also require further verification.
- Preview summaries are cached in sequentially loaded chunks of up to 100 Cards; Card-specific events and mutations invalidate only chunks containing that Card. Unknown/legacy key shapes and Board-wide label changes retain a broad fallback. Card moves no longer invalidate preview counters or unchanged Card Detail child queries, and comment text edits do not invalidate unchanged counts. A backwards-compatible `card:updated` hint identifies Card field changes; events without it still refresh the affected summary and child queries. The browser comparison above includes this hint.
- Search clears snapshots on Board/Workspace invalidation and schedules one refresh for a synchronous burst. Direct realtime Search hints remain as a freshness fallback, and dedicated access-loss handlers still clear immediately. Longer bursts and all pagination/concurrency cases remain to be measured.
- Board visits refresh Workspace Board/overview and Home recency data without invalidating the Workspace directory. Retry and access-version checks remain in place.

## Remaining verification

The issue's multi-user, multi-tab, offline/reconnect, simultaneous edit, session change, archive, ACL and full before/after HTTP scenarios require a controlled running application and test data. Verify these before declaring PERF-01 complete. Do not use production for this task.

Focused frontend tests covered the queue, loopback probe, move events, Card hooks, Board visits, Search and access loss. After comment correlation, `pnpm test` passed: backend 115 suites / 1,268 tests and frontend 151 files / 1,571 tests (with `VITEST_MAX_WORKERS=2`). This run started before the final session guard and two test additions; focused session/access and realtime tests passed afterward. Shared tests passed separately (20 tests). `pnpm lint` and `pnpm build` passed. `pnpm format:check` reported 1,140 files initially, 1,155 after the baseline checkout, and 1,125 after normalizing changed files; a separate check of changed files passed. An earlier default `pnpm test` run was interrupted after frontend timeouts under concurrent checks; the bounded rerun completed successfully. Against a disposable localhost-only PostgreSQL container, realtime integration passed 16 scenarios before the field hint; after it, the Board events and Card dates suites each passed 11 groups. Board events passed 11 groups again with comment correlation; the container was removed. Several browser traffic scenarios were measured as above; the remaining scenarios were not run.

A subsequent `pnpm --filter @kanban/frontend exec vitest run --maxWorkers=3` completed with 146 files / 1,552 tests passing and two failures: a Calendar Board test timed out at five seconds, and a Board Navigation test observed an extra socket join. Both files passed when run individually afterward; the suite failure and join discrepancy remain unresolved. Additional probe tests were added after that run started and were run separately.

For one unrelated formatting failure, `apps/backend/package.json`, the `main` Git blob passes Prettier and uses LF, while the checked-out file uses CRLF. This establishes a checkout line-ending discrepancy for that file; the other reported files were not individually audited.

For owner-led production verification after a separately authorized release, use DevTools Network with Preserve log and a HAR for each identical action, record actual request counts and route timing, compare equivalent users/data/network conditions, and redact tokens and private data before sharing. Separate cancellation, retries and background focus/reconnect traffic from completed requests; do not infer production improvement from the loopback probe.
