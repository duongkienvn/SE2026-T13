# P4-01 — Cross-board My Tasks and Home API

Implements [Issue #187](https://github.com/duongkienvn/SE2026-T13/issues/187),
[CX-02/CX-03](../../roadmap/post-mvp.md), the
[personal productivity blueprint](../../design/product-ux-blueprint.md#7-personal-productivity-ux)
and [Home/My Tasks UX](../../design/post-mvp/home-tasks/ux-spec.md).
This is backend implementation and local verification evidence, not deployment.
P4-06/P4-07 frontend implementation remains separate.

## REST contracts

Both routes require the existing verified-user JWT/session checks and return
`Cache-Control: no-store`. Identity comes exclusively from the authenticated
session. Responses use existing success/error conventions and explicit DTO
allowlists. Swagger documents both endpoints under `productivity`.

### `GET /api/users/me/tasks`

| Query         | Default   | Rules                                                                    |
| ------------- | --------- | ------------------------------------------------------------------------ |
| `page`        | `1`       | Positive safe integer; computed offset must also be safe                 |
| `limit`       | `20`      | Integer, 1–100                                                           |
| `group`       | `ALL`     | `ALL`, `OVERDUE`, `NEXT_7_DAYS`, `LATER`, `NO_DUE_DATE`                  |
| `workspaceId` | omitted   | UUID, intersects other filters                                           |
| `boardId`     | omitted   | UUID, intersects other filters                                           |
| `labelIds`    | omitted   | CSV of 1–50 distinct UUIDs, case-normalized, match **any**               |
| `dueFrom`     | omitted   | Inclusive RFC3339 timestamp with seconds and explicit `Z`/numeric offset |
| `dueTo`       | omitted   | Exclusive RFC3339 timestamp; strictly after `dueFrom` when both exist    |
| `sort`        | `dueDate` | `dueDate`, `updatedAt`, `board`                                          |

UUID validation follows the repository's UUID-v4 DTO convention. Repeated
parameters, empty/malformed values, duplicate labels, unsupported enums, unknown
Task query fields and unsafe pagination produce the standard 400
`VALIDATION_FAILED` envelope. Date-only/local-clock values and impossible dates
are rejected. Instant filters compare the original offsets in PostgreSQL,
including native microsecond precision; returned timestamps follow the existing
JavaScript ISO UTC millisecond representation. Date windows exclude null dates.

Eligibility requires a current assignment, active Card, active Board and current
Board read grant. SQL `EXISTS` predicates avoid duplicate Cards from assignments,
membership or matching labels. Authorization applies to the base query before
aggregation, group selection, ordering and pagination. A mismatching Board and
Workspace, inaccessible ID, valid nonexistent ID or nonmatching filter returns
an empty page without foreign metadata. No separate existence lookup occurs.

`groupCounts` counts all four groups **after non-group filters, before the group
filter**. `meta.total` and `totalPages` describe only the selected group (or all
groups for `ALL`). Empty results have total/totalPages 0. Out-of-range pages keep
the real total and return an empty `data` array. Counts and data are flat siblings,
not another nested envelope.

Ordering always starts with group priority: Overdue → Next 7 Days → Later → No
Due Date. Within each group:

- `dueDate`: earliest due timestamp first, null last.
- `updatedAt`: newest update first.
- `board`: case-insensitive Board name, then earliest due timestamp, null last.

Card UUID ascending breaks every remaining tie. A single-group request uses the
same group-local order. Stable ordering does not freeze separate offset-page
requests across future mutations; consumers should reset paging on invalidation.

The following is an illustrative fixture response, not production data:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "OK",
  "data": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "boardId": "22222222-2222-4222-8222-222222222222",
      "workspaceId": "33333333-3333-4333-8333-333333333333",
      "title": "Review API contract",
      "boardName": "Delivery",
      "workspaceName": "Engineering",
      "columnId": "44444444-4444-4444-8444-444444444444",
      "startDate": null,
      "dueDate": "2026-03-09T12:00:00.000Z",
      "updatedAt": "2026-03-08T10:00:00.000Z",
      "group": "NEXT_7_DAYS",
      "permalink": "/boards/22222222-2222-4222-8222-222222222222/cards/11111111-1111-4111-8111-111111111111",
      "labels": [
        {
          "id": "55555555-5555-4555-8555-555555555555",
          "name": "Backend",
          "color": "#615CF7"
        }
      ]
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 },
  "groupCounts": {
    "OVERDUE": 0,
    "NEXT_7_DAYS": 1,
    "LATER": 0,
    "NO_DUE_DATE": 0
  }
}
```

`TaskCardSummary` has exactly the fields shown. Labels contain only `id`, `name`,
`color`, ordered by lowercase name then UUID and bounded by the existing catalog
limit of 200 per Card. There are no descriptions, member lists, email addresses,
positions, assignment internals or completion flags. The relative Card permalink
retains the existing Board/Card routes and independent detail authorization.

### `GET /api/users/me/home`

Home accepts no identity or productivity-filter input. It returns:

- `summary.assignedActiveCount`: all eligible assigned Cards, including no due date.
- `summary.overdueCount` / `dueNext7DaysCount`: the same buckets as unfiltered Tasks.
- `summary.workspaceCount`: actual current Workspace memberships, including Personal;
  Guest-readable Boards do not add a Workspace membership.
- `upNext`: at most six eligible, due-dated `TaskCardSummary` objects, overdue first
  then upcoming by due timestamp and Card UUID. No-due Cards are excluded.
- `starredBoards` / `recentBoards`: at most six actual, authorized, active Boards
  joined to this user's existing `board_user_states`. Recent requires an explicit
  stored visit. Both use `lastViewedAt DESC NULLS LAST, Board UUID DESC`; stars
  without visits remain eligible after viewed stars. There is no starred-at field.

The following illustrative empty-task fixture also shows `HomeBoardSummary`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "OK",
  "data": {
    "summary": {
      "assignedActiveCount": 0,
      "overdueCount": 0,
      "dueNext7DaysCount": 0,
      "workspaceCount": 1
    },
    "upNext": [],
    "starredBoards": [
      {
        "id": "22222222-2222-4222-8222-222222222222",
        "workspaceId": "33333333-3333-4333-8333-333333333333",
        "name": "Delivery",
        "backgroundPreset": "blue",
        "isStarred": true,
        "lastViewedAt": null,
        "path": "/boards/22222222-2222-4222-8222-222222222222"
      }
    ],
    "recentBoards": []
  }
}
```

Home never records visits, updates stars or fabricates activity/artwork/analytics.
Use the existing preset catalog for artwork. Discovery retains archived state,
but Home V1 explicitly excludes archived Boards from both collections.

## Calendar and permission rules

One server request timestamp and the persisted `user_preferences.time_zone`
(UTC when no preference row exists) establish both boundaries inside the response
snapshot. PostgreSQL's IANA rules project today's local date, add seven **calendar
days**, and convert the starts back to UTC. Repeated midnight uses its first
occurrence; skipped midnight/day follows the timezone transition. No elapsed
168-hour assumption is used. This projection is intentionally different from
the existing instant-based Card detail due-status helper.

| Group         | SQL boundary                                             |
| ------------- | -------------------------------------------------------- |
| `OVERDUE`     | Non-null due timestamp before the start of local today   |
| `NEXT_7_DAYS` | Start of today inclusive to start of today + 7 exclusive |
| `LATER`       | Start of today + 7 inclusive onward                      |
| `NO_DUE_DATE` | Null due timestamp                                       |

An earlier hour today remains Next 7 Days. For New York on March 8, 2026,
the window is `[2026-03-08T05:00Z, 2026-03-15T04:00Z)` (167 hours).
On November 1 it is `[2026-11-01T04:00Z, 2026-11-08T05:00Z)` (169 hours).
Changing timezone changes projection only, never stored Card timestamps.
Column names (including `Done`), checklist progress and position do not imply
completion or remove an assigned active Card.

The canonical `readableBoardPredicate` / `readableBoardParameters` govern both
APIs, exactly as in discovery. Explicit Board OWNER/MEMBER and Guests can read;
Workspace members can read WORKSPACE_VISIBLE Boards. Workspace ADMIN alone
cannot read PRIVATE Boards. Stale assignments, label filters or recorded stars/
visits cannot resurrect revoked access. Guest task summaries include only the
contract's authorized Board/Workspace names and IDs; they do not grant access to
Workspace directories, membership information or other Boards.

Each response uses a PostgreSQL `REPEATABLE READ` transaction. Counts, page rows,
labels, preferences and Home collections refer to the same snapshot. A change
committed during a response is observed on the next request; an in-flight response
may reflect its earlier authorized snapshot. Existing session/access-revocation
client handling must discard late responses and clear protected cache entries.
These endpoints add no writes or new Socket.IO taxonomy.

## P4-06 / P4-07 integration

Shared exports include `MyTasksFilters`, `MyTasksResponse`, `TaskCardSummary`,
`TaskGroup`, `TaskGroupCounts`, `TaskSort`, `HomeBoardSummary`, `HomeDashboard` and
`HomeResponse` in ESM and CommonJS builds.

The current frontend `apiRequestPage` helper returns only `items`/`meta`, so it
would discard `groupCounts`. P4-06 should introduce a scoped envelope reader (or
an explicitly reviewed extension of that helper). Do not change the server wire
shape to accommodate the existing helper. The example below demonstrates the
complete wire response; use the existing API error/session handling in the UI.

```ts
import type {
  HomeDashboard,
  MyTasksFilters,
  MyTasksResponse,
} from '@kanban/shared';
import { apiRequest } from '../../lib/api-client'; // Example features/productivity/api.ts

function taskSearch(filters: MyTasksFilters): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return search.toString(); // Encodes '+' in numeric date offsets correctly.
}

async function readTasks(
  apiBase: string, // Existing configured API base, including /api.
  accessToken: string,
  filters: MyTasksFilters,
  signal: AbortSignal,
): Promise<MyTasksResponse> {
  const response = await fetch(
    `${apiBase}/users/me/tasks?${taskSearch(filters)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal,
    },
  );
  if (!response.ok) throw new Error(`Tasks request failed: ${response.status}`);
  return (await response.json()) as MyTasksResponse;
}

function readHome(accessToken: string, signal: AbortSignal) {
  return apiRequest<HomeDashboard>('/users/me/home', { accessToken, signal });
}
```

Key caches by user ID and authentication generation, e.g.
`['productivity', userId, generation, 'tasks', filters]` and
`['productivity', userId, generation, 'home']`. Invalidate after assignment,
Card date/update/archive/restore, label changes, Board rename/archive/visibility/
move, Workspace membership changes, star/view and timezone changes. Reuse existing
Card/Board/Workspace events, refetch on reconnect, and reset protected queries on
logout/account change/access loss. Avoid keeping a stale aggregate after revocation.
No new browser integration or event subscriptions are implemented in P4-01.

## Persistence, source placement and verification

`apps/backend/src/api/productivity/` owns the controller, service, module and
request/response DTOs. `AppModule` registers it; `packages/shared/src/productivity.ts`
owns cross-application contracts. Existing entities, ACL, assignments, preferences,
discovery state and indexes are reused. No dependencies, entities, migrations,
background jobs or production settings changed. Existing historical architecture
snapshots predate Workspace-visible ACL/discovery/dates; this implementation uses
the current source and tests, not those older skeleton claims.

Database tests require explicit `PRODUCTIVITY_DATABASE_TESTS=local-only`, local
`DATABASE_HOST`, and caller-provided `DATABASE_PORT`, `DATABASE_NAME`,
`DATABASE_USER`, `DATABASE_PASSWORD`. They never load `.env`, create a random
temporary database, run the existing migrations there, and close/drop it in
`finally`. The local run used an isolated PostgreSQL 16.15 Docker container bound
only to `127.0.0.1:55487`; no development or production data was accessed.

```sh
pnpm --filter @kanban/shared build
pnpm --filter @kanban/backend test:productivity:database
```

The nine PostgreSQL groups cover the full access matrix, cross-Workspace/Board
isolation, label privacy and match-any behavior, UTC filters, empty/large pages,
all groups/sorts, actual discovery parity, write lifecycle regression, JWT/Swagger,
UTC/Bangkok/New York DST, midnight gaps/folds, Kathmandu, Samoa's skipped day,
year rollover, microseconds and timezone preference changes. Separate-connection
commits between aggregates and rows exercise unassignment, ACL revocation,
archive and preference changes; Home has its own mid-response unassignment check.

The scale fixture uses 4,000 assigned Cards across 40 Boards, 200 labels per Card
on one Board, and unauthorized retained assignments. Nonempty Tasks uses four
SELECTs (boundaries, counts, page, labels); Home uses seven, independent of result
size. Empty results skip the label query. SQL transaction-control statements are
excluded from those counts. `EXPLAIN (ANALYZE, BUFFERS)` on the actual aggregate
query measured approximately 8 ms locally; this is a fixture measurement, not a
production capacity claim. Existing indexes were sufficient for this evidence,
so no speculative index migration was added.

Local verification on November 3, 2026 used Node 22.17.0 and pnpm 10.18.3:

| Command / check                                                   | Result                                                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                       | PASS, including the final source revision                                                                        |
| `pnpm --filter @kanban/backend test`                              | PASS: 93 suites, 950 tests, including unit and HTTP E2E                                                          |
| `pnpm --filter @kanban/shared test`                               | PASS: 18 tests, including ESM/CommonJS productivity exports                                                      |
| `pnpm --filter @kanban/frontend test --maxWorkers=1`              | PASS: all 122 files / 1,297 tests, unchanged tests and timeouts                                                  |
| `pnpm --filter @kanban/backend test:productivity:database`        | PASS: nine PostgreSQL/HTTP groups, including scale and separate-connection concurrency                           |
| `node apps/backend/test/boards/boards.integration.mjs`            | PASS: discovery, state, ACL, lifecycle, populated upgrade, concurrency and query-plan regression                 |
| `node apps/backend/test/cards/cards.integration.mjs`              | PASS: 14 groups, including assignments, filtering, archive/restore and races                                     |
| `node apps/backend/test/workspaces/workspace-api.integration.mjs` | PASS: lifecycle, ACL, rollback, races and compatibility                                                          |
| `node apps/backend/test/cards/dates/dates.integration.mjs`        | PASS: 11 PostgreSQL/HTTP/Socket.IO groups                                                                        |
| `pnpm build`                                                      | PASS: all workspace packages                                                                                     |
| `pnpm test`                                                       | FAIL: default parallel frontend run has timing-sensitive failures in unchanged frontend files; see details below |
| `pnpm format:check`                                               | FAIL: 1,064 unchanged files flagged; none of this task's changed paths were flagged                              |
| `pnpm exec prettier --check` over every changed file              | PASS                                                                                                             |
| Relative links in this record and `docs/tasks/README.md`          | PASS                                                                                                             |
| `git diff --check`                                                | PASS                                                                                                             |

The initial default monorepo test run had ten frontend failures; a second run,
without parallel database jobs, had three (Card route navigation, legacy Profile
redirect and invitation UI timing). All 1,297 frontend tests pass with one worker.
No frontend source, test, timeout or configuration changed. The final standalone
backend run is entirely green; a Swagger field-type defect found during testing
was corrected and its new regression assertion passes.

Full-repository Prettier failures are outside this change. Sampled unchanged
files (`README.md`, `.prettierrc.json`, existing Card service) are stored as LF in
Git but checked out as CRLF. Every changed path passes Prettier; no unrelated
formatting cleanup was performed. Build warnings about the existing frontend
`NODE_ENV` setting and bundle size remain. Existing schema inspection emits a pg
deprecation warning; injected transport failures in existing tests log expected
sanitized errors without failing the checks.

Temporary databases were verified removed and the task's Docker container was
stopped/removed after the PostgreSQL suites. Infrastructure/deployment checks and
production verification were not run: no infrastructure, dependency or deployment
contract changed, and this issue does not authorize production operations.
There is no unresolved P4-01 implementation blocker; review readiness includes
the explicitly reported repository-wide formatting and parallel-test limitations.
