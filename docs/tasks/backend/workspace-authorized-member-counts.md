# Authorized Workspace and Board member summaries (P2-C08)

Local implementation of [Issue #139](https://github.com/duongkienvn/SE2026-T13/issues/139)
on 2026-10-30. Implements the WS-04 summary subset of the
[roadmap](../../roadmap/post-mvp.md) and
[Workspace UX §§1–3](../../design/post-mvp/workspace/ux-spec.md), preserving the
[approved access matrix](../../design/product-ux-blueprint.md#permission-matrix-proposed-baseline).
This is implementation and local verification evidence, not deployment.

## Authorization and contracts

| Caller                                                        | Workspace Overview memberCount                   | Readable Board summary memberCount   |
| ------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------ |
| Joined Workspace ADMIN or MEMBER, explicit Board OWNER/MEMBER | Numeric                                          | Numeric                              |
| Joined ADMIN or MEMBER, Workspace-only Board reader           | Numeric                                          | `null`                               |
| Personal Workspace owner                                      | Explicit Workspace membership count (normally 1) | Numeric for explicitly joined Boards |
| Board-only Guest or outsider                                  | Safe 404 on Workspace endpoints                  | No Workspace summary access          |

Workspace totals count only `workspace_members`; Board Guests are excluded.
Board totals count `board_members`, including valid Guests, only when the actor
has an explicit Board membership. Workspace ADMIN confers no roster authority.
PRIVATE Boards without read permission remain absent, including from totals,
search, pagination, ordering and recents. Archived Boards keep the same roster
gate and gain no mutation rights from a numeric count.

`WorkspaceOverviewDto.memberCount` is now numeric for every joined member.
`WorkspaceBoardResponseDto.memberCount: number | null` is an exposed, documented
Swagger field on both Workspace Boards and `overview.recentBoards`. Numeric
values represent the exact roster total; `null` withholds the count for privacy.
The mapper enforces the null gate even if passed a numeric count without a Board
role. No identities, emails or roster metadata are added. General Board DTOs and
direct Board-member listing authorization are unchanged.

## Database strategy and consistency

`WorkspaceBoardsService` retains `requireMember`, `readableBoardPredicate` and
`readWorkspaceSnapshot` (REPEATABLE READ, existing serialization/deadlock retries).
Pagination/search/sorting run before count aggregation. Only returned Board IDs
whose actor-specific membership join exists enter the batched aggregation:

```sql
SELECT board_id, COUNT(*)::int AS member_count
FROM board_members
WHERE board_id IN (<bound returned, explicitly joined Board IDs>)
GROUP BY board_id;
```

One aggregate query serves the whole page or five recents; it is skipped when
no returned Board has roster authority. The existing `(board_id, user_id)` unique
index supports Board lookup and keeps the actor join singular. Counts do not
introduce ungrouped joins or change list totals. Workspace totals use a separate
`WorkspaceMember.countBy({ workspaceId })` in the same transaction. No schema,
index, migration, service endpoint or dependency changes.

PostgreSQL verification observed exactly one count aggregate for both a one-row
and an eight-row page, with parameters equal to returned authorized IDs. An
after-load subscriber committed membership additions/removals on another real
connection between Board loading and aggregation: the first response retained
its consistent earlier counts, and the next request reflected both commits.
Existing grant-lock revocation tests still pass.

## Frontend and cache behavior

- Workspace wire counts map into the existing Identity and Members statistic;
  those components already handle zero and singular/plural values correctly.
- Board mapping preserves numeric 0/1/N and null, including in `RecentWorkspaceBoard`.
  Board cards and compact recents show `0 members`, `1 member`, `N members` or
  **Board member count private**. No per-Board roster requests or inferred counts.
- Response validation rejects missing, negative, fractional, nonnumeric or unsafe
  counts and numeric Board counts paired with a Workspace-only reader role.
  Unsupported/loading presentation models can still use null; valid Workspace
  Overview HTTP responses require a number.
- `refreshWorkspaceBoardSummaries` identifies affected Workspaces using the known
  Board workspace or cached Board/list/recents associations. It cancels in-flight
  summary reads, immediately hides their snapshots and revalidates only matching
  Workspace Boards/Overview keys, including cached filter pages. Other Workspace
  summaries stay intact.
- Board membership commands invoke that helper only in their current auth scope.
  Session-scoped realtime membership hints also clear summaries before an older
  count/roster entitlement can remain visible. Existing global access hints and
  revocation purges remain unchanged; their identifier-free resync still applies.
- Existing Workspace member commands invalidate their session/Workspace resource
  prefix; acceptance, leave/removal and role changes retain their established
  cache boundaries. Board moves retain source/destination resource invalidation.
  Session generation guards, query cancellation and auth cache clearing prevent
  late old-account results from repopulating protected counts.

Primary changed code: backend `workspace-boards.service.ts`, Workspace Board and
Overview response DTOs; frontend Workspace response/API/models, Board card and
Recent Boards, the summary refresh helper, Board-member hooks and realtime
membership handling. Existing API/DTO/database, Workspace component, membership,
revocation and account-switch tests were extended. DEV fixtures and task links
were updated separately from production code.

## Executed verification

| Check                                                                                                                                                                                                                                                | Result                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @kanban/shared build`                                                                                                                                                                                                                 | Pass, consumer prerequisite                                                                                                                                     |
| `pnpm --filter @kanban/backend build`                                                                                                                                                                                                                | Pass, one Nest/TypeScript build                                                                                                                                 |
| `pnpm --filter @kanban/backend exec node test/workspaces/workspace-api.integration.mjs`                                                                                                                                                              | Pass, real PostgreSQL/HTTP/JWT/Swagger lifecycle, ACL, count matrix, committed changes, moves, paging/search/sort, bounded aggregation and concurrent snapshots |
| `pnpm --filter @kanban/backend test --runTestsByPath test/workspaces/workspace-api.dto.spec.ts`                                                                                                                                                      | Pass, 31 tests including count serialization/allowlist gating                                                                                                   |
| `pnpm --filter @kanban/frontend test src/features/workspaces/api.test.ts src/features/workspaces/api.integration.test.tsx src/features/workspaces/Workspace.test.tsx src/features/workspaces/boards/WorkspaceBoards.test.tsx --maxWorkers=2`         | Initial run: 91 passed, one legacy expected-null mapping assertion failed; corrected to the new server count                                                    |
| `pnpm --filter @kanban/frontend test src/features/workspaces/api.test.ts src/features/workspaces/api.integration.test.tsx src/features/realtime/access-revocation.test.ts src/features/board-members/pages/BoardMembersPage.test.tsx --maxWorkers=2` | Pass, 67 tests, including the corrected mapping and new cancellation/realtime privacy cases                                                                     |
| `pnpm --filter @kanban/frontend test src/features/workspaces/Workspace.test.tsx src/features/workspaces/boards/WorkspaceBoards.test.tsx src/features/workspaces/members/WorkspaceMembers.test.tsx --testNamePattern='accounts switch                 | Account A                                                                                                                                                       | cross-tab logout | removes a member only' --maxWorkers=2` | Pass, 4 selected tests; 91 intentionally filtered out |
| `pnpm --filter @kanban/frontend build`                                                                                                                                                                                                               | Pass, one TypeScript/Vite build                                                                                                                                 |
| `pnpm exec tsc -b apps/frontend`                                                                                                                                                                                                                     | Pass after final fixture/type edits                                                                                                                             |
| Scoped `pnpm exec eslint` for changed TS/TSX/MJS; changed-file Prettier; task link checks; `git diff --check`                                                                                                                                        | Pass                                                                                                                                                            |

The incremental frontend runs cover 129 distinct passing cases; already-passing
unaffected files were not rerun. The first database attempt caught an incorrect
test fixture payload (`userId` instead of the existing email-only Add Member
contract); after correcting the fixture, the complete selected SQL suite passed.
The suite emitted a nonfatal pg deprecation notice. Vite retained the nonfatal
environment `NODE_ENV=production` and bundle-size warnings seen before this task.

The PostgreSQL harness was read before execution. Each attempt used its explicit
`WORKSPACE_DATABASE_TESTS=local-only` opt-in against a newly created, loopback-only
`postgres:16.15-alpine3.24` container, with generated temporary credentials. The
harness created/migrated/dropped a random test database. Containers were removed
in finally blocks; no development/production database or credentials were used.

Intentionally skipped: root/full monorepo tests, full frontend/backend suites,
unrelated SQL/browser/infrastructure suites and production commands. Relevant
Workspace API SQL coverage includes lifecycle, privacy and concurrency in its
existing runner; no independent backend authorization or migration redesign.

## Visual QA and limitations

Chrome DevTools inspected the real Workspace components using existing DEV-only
`qa/workspace.html` and `qa/workspace-boards.html` entries. Checked Board cards and
Overview at **320/375/768/1280px**, Light and Dark: numeric zero, singular/plural,
privacy labels, regular MEMBER Workspace totals, compact recents, accessible link
names and no page/card/recent-panel horizontal overflow. Existing page scrolling
is intentional. New count text creates no extra controls or keyboard stops.
No application console errors/warnings appeared on inspected fixture pages.

- [Desktop Board cards, Light](../../design/screens/implementation/workspace-authorized-member-counts/boards-desktop-light.png)
- [Mobile recents, Dark](../../design/screens/implementation/workspace-authorized-member-counts/overview-mobile-dark.png)
- [QA measurements](../../design/screens/implementation/workspace-authorized-member-counts/qa-results.json)

The visual change is limited to accurate Available summary text and the privacy
state. Existing tokens, layout and Coming soon/excluded scope remain unchanged.
Zero is exercised as a DTO/UI edge value; a persisted explicit Board member or
Workspace owner naturally contributes at least one row to a real authorized count.
Browser fixtures are synthetic and never imported by the production app; live
HTTP/database contracts are verified separately in the disposable SQL suite.
Production scale/load and deployed realtime/browser integration were not tested.

The target branch was already clean at freshly fetched `origin/main`; previously
merged Board owner actions are part of that base. No unmerged feature changes,
push, PR creation, merge or deployment are included. All Issue #139 changes belong
to the single requested local commit.
