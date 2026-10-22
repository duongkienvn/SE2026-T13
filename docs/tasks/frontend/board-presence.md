# Board Presence Frontend (G2)

Implements [issue #59](https://github.com/duongkienvn/SE2026-T13/issues/59) on
`feat/board-presence-frontend`, based on `79b3c82`, equal to freshly fetched
`origin/main` and local `main` at task start. G1 was already merged in PR #62.
The initial worktree was clean. The issue and its empty comment thread were read.
The user explicitly authorized eight local commits; no push, PR or merge.

## G1 contract and ownership

The existing `@kanban/shared` contract is consumed unchanged:

```ts
RealtimePresenceEvent.SYNC === 'presence:sync';
// BoardPresenceSnapshot: { boardId: string; userIds: string[] }
```

Every event is a full population replacement. Counts come exclusively from the
snapshot, never from BoardMember totals, tab counters or optimistic additions.
G1 owns multi-tab semantics and authorization. There is no second socket,
Presence REST endpoint, polling, new dependency or persistent Presence cache.
Backend, shared contract, business invalidation, comments and DnD are unchanged.
H1c comment events and H2c Activity UI were not present on this base; their
integration areas were not implemented or redesigned by G2.

## Client state and subscription architecture

`BoardRealtimeClient` retains the session's existing Socket.IO connection and
room watchers. Each room adds an immutable `BoardPresenceState`, a pending join
flag and the latest buffered snapshot. `presence(boardId)` is read-only and
returns stable references. It also resolves canonical REST IDs when the watched
URL uses uppercase. Query keys keep their original F2b spelling.

`useBoardPresence()` observes the existing client's subscription with
`useSyncExternalStore`. It creates neither a room watcher nor a socket.
`BoardDetailPage` still owns exactly one `useBoardRealtime()` call. The hook
masks disabled boards and unauthenticated sessions immediately. Frozen snapshots
and unchanged-population comparisons prevent render loops and needless updates.

| Presence status | Population                   | Meaning                                             |
| --------------- | ---------------------------- | --------------------------------------------------- |
| `connecting`    | `null`                       | No connection/room snapshot yet                     |
| `syncing`       | `null`                       | Join/authoritative snapshot still pending           |
| `live`          | readonly IDs, including `[]` | Successful join and a valid snapshot                |
| `reconnecting`  | `null`                       | Connection was lost; old avatars are cleared        |
| `paused`        | `null`                       | Existing retry budget exhausted                     |
| `unavailable`   | `null`                       | Join denied or hook disabled for inaccessible Board |

Business realtime status retains its existing semantics: ACK success can mark
business synchronization live while Presence is still awaiting a snapshot.
An authoritative empty snapshot means `0 viewing`, not a loading state.

### Snapshot before ACK

1. The connection handler installs a typed Presence listener before any join.
2. Joining clears the old population and buffer and increments the room attempt.
3. Valid snapshots received while that attempt awaits ACK replace its buffer.
4. Matching success ACK publishes the latest buffer; without one, Presence waits
   in `syncing` for a subsequent valid snapshot.
5. Later snapshots replace the population directly. Equivalent sorted/unique
   populations preserve the existing object and do not notify subscribers.
6. Failure, timeout and pause discard pending IDs. Late or duplicate ACKs cannot
   complete an attempt that is no longer pending.

Presence never enters the business-event invalidation queue. Successful joins
still perform the original F2b REST resync; business events remain unchanged.

### Reconnect, board switching and session cleanup

Each connection gets a Presence listener capturing its connection epoch.
Disconnect invalidates that epoch, removes the listener, clears buffers and IDs,
and invalidates outstanding join attempts. Reconnect installs one new listener
and requires a fresh join/snapshot. Captured old callbacks and old ACKs are ignored.

Watcher reconciliation still coalesces in a microtask for StrictMode and rapid
A → B → A transitions. With no watcher, reads and incoming events are immediately
masked; reconciliation removes the room/buffer and sends the existing leave.
Multiple observers retain the room until the final observer leaves.

Dispose clears rooms/timers/listeners and notifies subscribers once about cleared
private data; subsequent late work is silent. The existing dispose regression
now asserts that clear notification separately from rejecting late notifications.

`RealtimeProvider` additionally matches a client to its `runAuthorized` session
identity during render. It exposes `null` immediately on session replacement,
before passive-effect cleanup can run. A layout-effect regression verifies that
the new account never observes the previous account's population. Auth/token
implementation itself is unchanged.

## Security and privacy

Payload validation accepts only the shared shape with valid UUIDs and a bounded
array (at most 10,000 incoming IDs). It rejects malformed, sparse, oversized and
extra-field payloads; accepted IDs are normalized, deduplicated and sorted. This
is a client work bound, not a BoardMember limit or authorization mechanism.

Only connected, currently watched rooms can accept snapshots. No raw UUID or email
is rendered in Presence. Profiles resolve through `member.user.id`, not membership
IDs, plus the current authenticated user. Missing profiles get a neutral `?`
avatar and `Unknown viewer`; their identity is never invented from cached members.

Join denial clears room Presence. Board REST 403/404 already unmounts the header
and stops its watcher. Members REST 403/404 hides Presence immediately even if its
query retains cached data, then invalidates Board detail so the page can leave.
Non-permission profile lookup failures can show neutral placeholders for the
authoritative IDs; they cannot invent viewers.

## Component and design decisions

`features/presence/components/BoardPresence.tsx` adds a compact avatar group next
to the existing realtime status, role, Members link and Board actions. Header
integration is two lines; `PageHeader`, design tokens and the Kanban area are
unchanged. `UserAvatar` supplies both URL rendering and initials/image-error
fallback. No avatar implementation is duplicated.

- Desktop/tablet: at most four overlapping avatars, overflow `+N`, readable count.
- Below 640px: one avatar plus overflow; existing wrapping keeps actions usable.
- A native button opens the viewer-name list; Enter/Space use normal button
  activation, Escape closes and restores focus, outside pointer interaction closes.
- Count, avatar names, expanded state and list label are exposed to accessibility
  APIs. There is no live region announcing every population update.
- Existing border/text/background/shadow tokens and focus styling are reused.
- Archived boards retain Presence while existing mutation restrictions remain.

## Automated verification

Commands from repository root:

```sh
pnpm --filter @kanban/shared build
pnpm --filter @kanban/frontend test
pnpm --filter @kanban/frontend test --maxWorkers=2
pnpm --filter @kanban/frontend test src/features/presence src/features/realtime src/features/boards/pages/BoardDetailPage.realtime.test.tsx
pnpm lint
pnpm test
pnpm build
pnpm format:check
git diff main...HEAD --check
git status --short
git log --oneline main..HEAD
git diff main...HEAD --stat
```

There is no separate typecheck script; frontend build runs `tsc -b` before Vite.
The initial generic Vitest mock typing error found by build was corrected. An
initial dispose assertion was updated to distinguish the required clear
notification from prohibited late notifications. No tests were skipped/deleted.

Coverage includes early/latest snapshots, post-ACK replacement, empty vs unknown,
timeout/retry/pause, stale ACKs/connection callbacks, board case/isolation,
unwatch/dispose, session replacement/logout, multiple observers, StrictMode,
stable references, malformed/oversized input, avatar fallbacks, count/overflow,
keyboard/outside dismissal, inaccessible and archived boards. Existing Board,
Card, Comments, UserAvatar and business-event tests remain in the full suite.

The default full frontend run later failed with 8 timeouts/DOM wait failures
(382 passed / 390 total). Two `pnpm test` attempts also failed in the frontend
(12 then 10 cases), including existing Register/Card/Comments tests and one new
Board Presence integration case. An earlier standalone frontend run passed
389 tests before the last canonical-ID regression was added. The targeted final
run passed 11 files / 110 tests.

The full `--maxWorkers=2` run passed all 51 files / 390 tests in 85.73 seconds,
using the same timeouts and assertions. Together with the changing failure sets
and earlier passing standalone run, this supports resource contention under the
default worker concurrency as the explanation; the default commands are still
reported as FAIL. No claim is made that a baseline checkout reproduced these
runtime failures. No repository test configuration or skipped-test settings were
changed. Backend then passed all 41 suites / 296 tests when run separately;
workspace build passed, including `tsc -b`, with the existing large-chunk warning
(829.06 kB frontend bundle). The final UI QA milestone additionally covers the
connecting and paused indicators explicitly; its component run passed all 9 tests,
and the final bounded full run passed all 51 files / 391 tests in 85.93 seconds.

| Command/check                                        | Result                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm --filter @kanban/shared build`                 | PASS                                                                                             |
| Shared tests (inside workspace run)                  | PASS: 6 tests                                                                                    |
| Targeted Presence/realtime/Board regression command  | PASS: 11 files / 110 tests before the final paused-state case                                    |
| Final Presence component tests                       | PASS: 9 tests                                                                                    |
| `pnpm --filter @kanban/frontend test`                | FAIL on last default-worker run: 8 failed / 382 passed / 390 total                               |
| `pnpm --filter @kanban/frontend test --maxWorkers=2` | PASS: final 51 files / 391 tests, unchanged timeouts/assertions                                  |
| `pnpm --filter @kanban/backend test`                 | PASS: 41 suites / 296 tests                                                                      |
| `pnpm test`                                          | FAIL: frontend timeout/DOM waits under default concurrency on two attempts (12 then 10 failures) |
| `pnpm lint`                                          | PASS                                                                                             |
| `pnpm build`                                         | PASS: shared, backend and frontend, including TypeScript; existing chunk warning                 |
| `pnpm format:check`                                  | FAIL: 388 unchanged CRLF files; no G2 overlap; all pass after LF normalization in memory         |
| Prettier on G2 text files                            | PASS                                                                                             |
| Git whitespace checks                                | PASS                                                                                             |

All workspace suites were therefore exercised successfully in separate runs
(shared 6 + backend 296 + frontend 391 = 693 tests); this does **not** relabel the
failing default `pnpm test` command as a pass. The test-runner concurrency behavior
on this machine remains a review consideration rather than an out-of-scope config
change in G2.

## Browser QA and screenshots

QA used the in-app browser, the actual Vite app, real Nest AppModule/JWT/Socket.IO
and isolated PostgreSQL with real migrations. Fixtures were created outside the
repository; no configured development database was migrated or changed. QA
services were stopped, and all three generated `kanban_g2_qa_*` databases were
dropped only after verifying the fixture Board/user and absence of connections.

Browser tooling interrupted two attempts when closing an active test tab.
The completed run closed background test tabs while keeping a neutral control
tab open. Results below refer only to steps actually observed in that run.

| Browser scenario         | Observed result                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| A opens X alone          | PASS: initial avatar/count without another user joining                                                       |
| B joins X                | PASS: both accounts show the same two viewers                                                                 |
| B opens a second tab     | PASS: three authenticated tabs still count two users                                                          |
| First B tab closes       | PASS: B remains present                                                                                       |
| Last B tab closes        | PASS: A returns to one viewer                                                                                 |
| B switches X → Y → X     | PASS: populations stay isolated and rejoin correctly                                                          |
| B logs out               | PASS: login page replaces Board; A removes B                                                                  |
| Archived Board           | PASS: Presence visible, mutation controls absent                                                              |
| Owner removes B          | PASS: owner sees one viewer; B's next REST access displays Board not found with no private Presence           |
| Enter / Escape / focus   | PASS: list opens, closes and restores trigger focus                                                           |
| Owner page console       | PASS: no captured error-level messages                                                                        |
| Browser offline/online   | NOT RUN: browser API exposes no network-emulation capability; FakeSocket reconnect tests pass                 |
| Wait for live JWT expiry | NOT RUN: QA uses the normal token lifetime; automated session/expiry/cleanup regressions cover the boundaries |

The header was visually checked at 320×740, 390×844, 480×800, 768×1024,
1280×600, 1366×657, 1536×730 and 1920×945. DOM measurements confirmed the
header fits its width at every size; 320px also passed with two viewers and `+1`.
The existing horizontal Kanban scroll area remains unchanged.

Thirteen unmodified browser screenshots are saved as JPEG (the browser's actual
output format) under `docs/design/screens/implementation/board-presence/`:

- [Desktop, two viewers](../../design/screens/implementation/board-presence/two-viewers-desktop.jpg)
- [Mobile 320px, two viewers and overflow](../../design/screens/implementation/board-presence/two-viewers-mobile.jpg)
- [Mobile keyboard disclosure](../../design/screens/implementation/board-presence/mobile-viewers-320.jpg)
- [320px](../../design/screens/implementation/board-presence/mobile-320.jpg),
  [390px](../../design/screens/implementation/board-presence/board-390.jpg),
  [480px](../../design/screens/implementation/board-presence/board-480.jpg),
  [768px](../../design/screens/implementation/board-presence/board-768.jpg)
- [1280×600](../../design/screens/implementation/board-presence/board-1280.jpg),
  [1366×657](../../design/screens/implementation/board-presence/board-1366.jpg),
  [1536×730](../../design/screens/implementation/board-presence/board-1536.jpg),
  [1920×945](../../design/screens/implementation/board-presence/board-1920.jpg)
- [Archived board](../../design/screens/implementation/board-presence/archived-board.jpg)
- [Removed member](../../design/screens/implementation/board-presence/removed-member.jpg)

## Known limitations and review focus

- G1 deliberately sends no access-revoked event to the removed user. Their client
  cannot detect removal instantly; existing REST checks/focus/rejoin discover it.
  Once discovered, private Presence is hidden. No polling or invented event was
  added to mask that backend contract limitation.
- There is no replay, sequence number or join-attempt ID in the Presence payload.
  Epochs fence old connection handlers and attempts fence ACKs; same-connection
  snapshots rely on Socket.IO ordering and G1's board FIFO/current full snapshots.
- Silent network loss still depends on Socket.IO's existing disconnect detection.
  A new snapshot is required after reconnect; old data is never restored optimistically.
- Payloads beyond the defensive client cap are ignored, preserving the last valid
  snapshot until a lifecycle boundary. Large-scale/distributed Presence is not MVP.
- H1c/H2c were absent at this base. Future integration should retain this small
  header insertion and all comment subscriptions/Activity triggers when rebasing.
- Existing overview/architecture prose predates some merged implementation; G2
  follows current source and G1/F2b handoff records without unrelated doc rewrites.

## Local commit grouping and files

Eight real local commits, with staged diffs checked before each commit:

1. `8add612 feat(realtime): add validated board presence state`
2. `faf9d9d feat(realtime): buffer presence before join acknowledgment`
3. `5b015e9 fix(realtime): clear presence across connection epochs and disposal`
4. `1334a68 feat(frontend): expose subscribed board presence hook`
5. `26203f4 feat(frontend): build accessible board presence avatar group`
6. `8729965 feat(frontend): integrate presence into the board header`
7. `c88ee7a fix(frontend): harden presence privacy and regression coverage`
8. `test(frontend): finalize presence QA and handoff documentation`

Added code/tests: `features/realtime/board-presence-state.ts` and its test,
`features/realtime/board-presence-client.test.ts`, `features/presence/useBoardPresence.ts`
and its test, `features/presence/components/BoardPresence.tsx` and its test.

Modified frontend files: `features/realtime/board-realtime-client.ts` and its
existing test, `features/realtime/RealtimeProvider.tsx`,
`features/boards/pages/BoardDetailPage.tsx` and its realtime test, and
`test/fake-socket.ts`. These paths are under `apps/frontend/src/`.
Documentation adds this record, its task-index link and thirteen QA images.
No backend/shared/dependency/configuration changes belong to G2.
