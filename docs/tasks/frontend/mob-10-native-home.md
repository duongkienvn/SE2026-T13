# MOB-10 — Native Home Dashboard

Implementation of [issue #258](https://github.com/duongkienvn/SE2026-T13/issues/258).
The starting point was freshly fetched main at
`f29de50a8f582575e3e297be6bc408ebac84c878`. Git history confirms that
[PR #264](https://github.com/duongkienvn/SE2026-T13/pull/264) merged MOB-08 and
that `e4df10ed30cff5a2dac694816bf72b2a3327e313` is an ancestor of main.

## API and session behavior

`ProductivityController` reads the authenticated JWT subject for
`GET /api/users/me/home`. It returns a no-store success envelope containing
the shared `HomeDashboard`. The service computes counts and selects task and
Board previews in one repeatable-read snapshot, applying Board read access,
archive exclusions, the saved server timezone and the server's ordering.
Up Next contains due-dated active assigned Cards and all three lists have a
six-item limit. Home reads do not record Board visits.

The mobile adapter projects the shared contract and validates counts, UUIDs,
canonical path shape, Board presets, full UTC instants, task groups, labels,
list limits and uniqueness within each list. It preserves order and overlap
between Starred and Recent because those are distinct server facts. Invalid
aggregates become the transport's safe invalid-response error. There are no
separate section requests. A background refresh error can leave the previous
authorized aggregate visible with an inline notice, while an initial error
shows Retry.

Home uses `queryKeys.home(identity)` on the existing data layer. Each read
passes the captured identity, TanStack signal and resource key. The query is
active only on the focused route. Pull-to-refresh forces one read, shares
in-flight work, honors manual Retry-After and throttles repeat gestures.
MOB-04 manages app focus and network recovery. The existing MOB-06 coordinator
handles Board and Card hints where subscribed, direct access hints and
reconnect. Home does not join all displayed Boards. Without a receive grant
for a Board, routine Board-room changes can appear on the next authoritative
refresh. An access-loss hint or loss of an established socket evicts
protected snapshots and fences outstanding reads. A failed first socket
handshake leaves an already authorized REST snapshot available.

A second account generation remounts Home and the data layer clears private
queries on session end. An offline notice can show same-generation memory
only while the session remains verified and the data layer still owns the
snapshot. Resource denials clear the Home snapshot so Back cannot reveal
a revoked title. Card and Board presses rebuild the canonical destination
from IDs. The destination GET verifies current access and retains only a
boolean marker in its resource key. The response never provides navigation
targets or UI detail copy.

## Design and ownership

Compared with [Screen 01](../../mobile/assets/01-home-dashboard.png) and
[Design Spec §4.1 and §5–7](../../mobile/KANVEXA_MOBILE_DESIGN_SPEC.md).
The roadmap's MOB-10 entry and architecture §9.1 describe the API and the
issue defines the exact navigation and screen scope.

| Reference element                    | Native implementation                                                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branded shell and greeting           | Existing Kanvexa K header, Search and Settings actions, verified profile avatar or initials, local time greeting and existing four tabs               |
| Two featured tiles                   | My tasks shows assigned active count and Due soon shows the next-seven-day count. Both open My Tasks                                                  |
| Up next                              | Server order, Card title, Board and Workspace names, present labels and server due group with device-local date presentation. View all opens My Tasks |
| Your boards                          | Starred and Recent groups, real star/viewed metadata, local preset artwork and accessible full names. See all opens Boards                            |
| Decorative banner and mockup actions | Banner omitted per approved variant. Completion controls, overflow menus, Board list/Card counts and star writes are outside the issue                |

The four photo presets use thumbnail versions of the same existing Web
assets. A missing or unreadable local photo falls back to its preset color
and Board icon. An unknown wire preset fails validation. Board and Card
routes show a safe unavailable state on denial and an explicit Coming soon
state after a successful check. Full details, My Tasks, Board directory and
Search remain owned by their follow-up issues.

## Android evidence

Expo Go 58.0.5 on Android API 37 used the real native routes, a disposable
loopback Nest/PostgreSQL instance and dedicated test accounts. Checked the
MOB-08 sign-in journey, Home values and order, Board and Card routes,
hardware Back, the My Tasks tile, pull-to-refresh, scrolling, light and
dark themes, and 320 dp with 160% system text. A second authenticated
client removed a private Board membership while the viewer stayed on
Home. The viewer refreshed automatically and removed the Board and Card
while changing both counts to match the backend.

- [Light Home at 375 dp](../../design/screens/implementation/mob-10-native-home/home-light-375.png)
- [Light Board lists at 375 dp](../../design/screens/implementation/mob-10-native-home/boards-light-375.png)
- [Dark Home at 320 dp and 160% text](../../design/screens/implementation/mob-10-native-home/home-dark-320-large.png)
- [Dark Board rows after scrolling](../../design/screens/implementation/mob-10-native-home/boards-dark-320-large.png)

At 320 dp and 160% text, the two tiles stack and sections remain scrollable.
The existing Android tab renderer abbreviates the visible My Tasks label
at that size. Expo's floating Tools control is development chrome. Visual
QA used the same ignored Windows Expo Go entry wrapper documented in
MOB-08. The release export used the normal Expo Router entry.

## Verification

| Check                                                                 | Result                                                                                                                                   |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:mobile`                                                    | Pass, 169 Node tests and 86 component tests in 16 suites                                                                                 |
| `pnpm --filter @kanban/mobile typecheck`, `pnpm lint`, `pnpm build`   | Pass. Web build reports its environment and large chunk warnings                                                                         |
| `pnpm --filter @kanban/mobile bundle:android`                         | Pass, 2.4 MB Hermes bytecode and 1,312 native source entries. Audit confirmed shared ESM and official branding                           |
| `pnpm --filter @kanban/backend test:productivity:database`            | Pass, 9 PostgreSQL 17 groups on a disposable instance                                                                                    |
| Real local authenticated Home smoke                                   | Pass, populated and empty accounts, exact count/order, no-store, unauthenticated 401 and post-revocation 404                             |
| `pnpm --filter @kanban/mobile test:realtime:local`                    | Pass, two native controllers using real Nest/Socket.IO and repository doubles                                                            |
| `pnpm --workspace-concurrency=1 test`                                 | Shared 20 and backend 1,283 passed. Frontend passed 1,676 of 1,677 with one existing email-change case timing out at five seconds        |
| Frontend reruns with 15-second timeout                                | Pass, all 1,677 tests in 158 files with four workers. The focused productivity and affected regression subset passed 86 tests in 9 files |
| `pnpm test:infra`                                                     | Pass, 25 tests                                                                                                                           |
| Changed-file Prettier and `git diff --check`                          | Pass                                                                                                                                     |
| Repository-wide `pnpm format:check`                                   | Fails on existing repository formatting                                                                                                  |
| Physical Android, standalone build, iOS and screen-reader walkthrough | Not run. Layout and interaction evidence is from Expo Go on the Android emulator                                                         |

The integration suite measures Home HTTP calls for pull refresh, duplicate
hints, focus/network/socket recovery and access revocation. It also verifies
that late responses cannot restore the previous account or a revoked
snapshot. The router test exercises the real auth and Home adapters through
canonical Board/Card entries, including Back after a denied detail read.
