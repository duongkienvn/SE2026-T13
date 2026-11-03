# P4-02 — ACL-safe Global Search backend

Implements [Issue #188](https://github.com/duongkienvn/SE2026-T13/issues/188),
CX-04 in the [Post-MVP roadmap](../../roadmap/post-mvp.md), the
[personal productivity blueprint](../../design/product-ux-blueprint.md#7-personal-productivity-ux)
and [App Shell UX](../../design/post-mvp/app-shell/ux-spec.md).
This records backend implementation and local verification, not deployment.
P4-08 owns the command palette UI, shortcuts and browser integration.

## REST contract

`GET /api/search` requires an existing verified-user JWT with a valid session.
Identity comes from the token, not query input. Successful responses send
`Cache-Control: no-store` and the standard envelope:

```text
{ success: true, statusCode: 200, message: "OK", data: { query, type, groups } }
```

| Parameter                    | Default      | Rules                                                                                                                                                          |
| ---------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `q`                          | empty string | Trim whitespace; 0–120 Unicode code points after trim. Literal case-insensitive substring. Null bytes, lone UTF-16 surrogates, arrays and objects are invalid. |
| `type`                       | `all`        | `all`, `workspaces`, `boards`, `cards`                                                                                                                         |
| `limit` with `type=all`      | `5`          | Integer 1–10, independently applied to every group                                                                                                             |
| `page` with `type=all`       | forbidden    | Any supplied value, including `1`, returns 400                                                                                                                 |
| `limit` with a specific type | `20`         | Integer 1–50                                                                                                                                                   |
| `page` with a specific type  | `1`          | Positive safe integer; `(page - 1) * limit` must also be safe                                                                                                  |

Numeric query strings use the repository's strict positive-integer grammar;
fractions, signs, leading zeroes and exponent notation are rejected. Unknown
fields (including `userId`, `sort`, `workspaceId`, `offset`, `pageSize` and
`pageNumber`), repeated fields and malformed values return 400
`VALIDATION_FAILED`. Missing/invalid/expired/invalidated/unverified authentication
returns 401; existing HTTP throttling returns 429. Unexpected errors return the
standard safe 500 without SQL, parameters, credentials or stack traces.

Empty/whitespace-only `q`, including omitted `q`, returns all three empty groups
with total 0 and `hasMore: false`. It performs **no business-data queries or read
transaction**. Authentication still validates the user/session. Invalid parameters
are rejected even when `q` is empty.

Example requests:

```http
GET /api/search?q=review
GET /api/search?q=review&type=all&limit=1
GET /api/search?q=review&type=cards&page=2&limit=20
GET /api/search?q=%25_%5C&type=boards
GET /api/search
```

The fourth request searches for literal `%_\`, not a wildcard expression.
Use `URLSearchParams` to encode input, especially `%`, `+` and backslash.

## Results, counts and pagination

`data` always contains `query` (the trimmed input), `type`, and `groups` with
`workspaces`, `boards` and `cards`. Every group has `{ items, total, hasMore }`.
Non-selected groups in a specific-type request are always
`{ items: [], total: 0, hasMore: false }`. No outer pagination `meta`, global total
or cross-type page is added.

Each total counts **all authorized matches** for that type, independently of its
page limit. For grouped search, `hasMore = total > limit`; for a specific type,
`hasMore = total - offset > limit`. An out-of-range page has no items, the real
total and `hasMore: false`. Separate page requests can shift after mutations;
refetch/reset paging after invalidation rather than treating them as one snapshot.

The following grouped response is an illustrative fixture, not production data.
It corresponds to `q=review&type=all&limit=1`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "OK",
  "data": {
    "query": "review",
    "type": "all",
    "groups": {
      "workspaces": {
        "items": [
          {
            "type": "workspace",
            "id": "33333333-3333-4333-8333-333333333333",
            "title": "Review Team",
            "subtitle": null,
            "path": "/workspaces/33333333-3333-4333-8333-333333333333"
          }
        ],
        "total": 1,
        "hasMore": false
      },
      "boards": {
        "items": [
          {
            "type": "board",
            "id": "22222222-2222-4222-8222-222222222222",
            "title": "Review",
            "workspaceId": "33333333-3333-4333-8333-333333333333",
            "workspaceName": "Review Team",
            "subtitle": "Review Team",
            "path": "/boards/22222222-2222-4222-8222-222222222222"
          }
        ],
        "total": 2,
        "hasMore": true
      },
      "cards": {
        "items": [
          {
            "type": "card",
            "id": "11111111-1111-4111-8111-111111111111",
            "title": "Review API contract",
            "boardId": "22222222-2222-4222-8222-222222222222",
            "boardName": "Review",
            "workspaceId": "33333333-3333-4333-8333-333333333333",
            "workspaceName": "Review Team",
            "subtitle": "Please review the API contract.",
            "path": "/boards/22222222-2222-4222-8222-222222222222/cards/11111111-1111-4111-8111-111111111111"
          }
        ],
        "total": 4,
        "hasMore": true
      }
    }
  }
}
```

These are the exact public item fields. `Workspace.subtitle` is always null.
Board `subtitle` equals the separately authorized Workspace name, otherwise null.
Card `subtitle` uses a matched-description snippet, otherwise bounded plain-text
Board context. No full description, timestamp, rank, assignment, member roster,
email or internal database fields are returned. Paths are server-built relative
routes from stored UUIDs, preserving existing Workspace/Board/Card navigation.

## Matching and ordering

Workspaces search their name; Boards search their name; Cards search title **or
description**. Query parameters are bound, and `%`, `_`, and backslash are escaped
for SQL `ILIKE`. They never act as SQL wildcards or regex. Exact-title ranking
compares lowercase title/name with lowercase input. Rank order within each type:

1. Case-insensitive exact title/name.
2. Title/name begins with the literal query.
3. Title/name contains the literal query.
4. Description-only Card match.

Every rank sorts by `updatedAt DESC`, then UUID ascending. An exact-title hit
stays above a newer prefix hit; a newer description-only hit stays below title
hits. There is no score comparison between entity types. Updated timestamps and
rank are internal ordering inputs, not new response fields.

Case matching follows PostgreSQL's configured collation. Local tests exercise
Vietnamese, accented Latin, emoji and Chinese. Accent folding, Unicode
normalization equivalence, fuzzy/semantic search and external search engines are
not promised. A short query is valid; there is no invented minimum length.

For a description match, SQL selects at most 240 source characters around its
first lowercase occurrence, with up to 40 preceding characters. The application
removes HTML tags/script/style blocks, common Markdown link/formatting syntax,
control characters and bidi overrides, collapses whitespace, and returns at most
160 Unicode code points. An empty sanitized fragment falls back to Board context.
The search reader never fetches the unbounded description column into a result;
only the bounded fragment is returned for snippet projection.
Snippets and all other text fields remain **untrusted display text**: P4-08 must
render text nodes, never interpret them as HTML/Markdown or derive external links.

## Authorization, privacy and consistency

Workspace search requires actual `workspace_members` membership. Board search
uses the existing
[canonical SQL read predicate](../../../apps/backend/src/api/board-members/board-permissions.ts),
active-Board filter and literal match before counting/ranking/paging. Card search
adds active-Card eligibility on the same active readable Board. Search covers
readable Cards regardless of assignment; it does not implement My Tasks.

| Actor                                                 | Workspace results/name    | PRIVATE Board/Card                  | WORKSPACE_VISIBLE Board/Card        |
| ----------------------------------------------------- | ------------------------- | ----------------------------------- | ----------------------------------- |
| Workspace member/ADMIN, no Board membership           | Only joined Workspaces    | Denied                              | Readable                            |
| Explicit Board OWNER/MEMBER with Workspace membership | Joined Workspace readable | Readable                            | Readable                            |
| Board Guest without Workspace membership              | No Workspace hit/name     | Readable under explicit Board grant | Readable under explicit Board grant |
| Unrelated or revoked actor without another grant      | No hit/name               | Denied                              | Denied                              |

Workspace ADMIN never overrides PRIVATE. Workspace-directory membership is
checked independently in the **SQL join** that supplies Workspace context. A
Guest Board result has both `workspaceName: null` and `subtitle: null`; a Guest
Card result has `workspaceName: null` while retaining authorized Board context
or matched description. The contract's `workspaceId` remains an identifier, not
a directory read grant. Workspace names cannot influence Board/Card matching or
ranking. Removing a Workspace grant can leave an independent explicit Board
grant intact, with its Workspace name now null.

Membership uses `EXISTS`; directory joins target unique Workspace rows. Labels,
assignees and members do not multiply results or totals. No frontend masking or
post-query filtering establishes access. Private phrases in inaccessible Cards
return no hit/count/snippet. Archived Boards and their Cards, plus archived Cards
on active Boards, are excluded. Existing deletion, restore and visibility behavior
remains authoritative; subsequent requests reread the grants and current tables.

Nonempty searches run in one `REPEATABLE READ` transaction, so counts, page rows,
the three groups and Workspace-name projection agree on one snapshot. A request
already reading before a revocation can finish from that earlier authorized
snapshot; the next request sees the committed change. Consumers must cancel or
discard late responses when session/access changes. Search performs no writes,
view recording, background indexing or Socket.IO broadcasts. Existing request
logging omits query strings and SQL logging is disabled; the new service logs no
query text, results or descriptions. Existing safe error serialization is retained.

## P4-08 frontend integration

Shared ESM/CommonJS exports are `GlobalSearchType`, `GlobalSearchQuery`,
`GlobalSearchResults`, `GlobalSearchResponse`, `GlobalSearchItem`,
`WorkspaceSearchResult`, `BoardSearchResult`, `CardSearchResult` and `SearchGroup`.
The existing `apiRequest` helper unwraps this endpoint's `data` correctly;
`apiRequestPage` is unnecessary because pagination lives inside the selected group.

Example for a future `features/search/api.ts` module:

```ts
import type { GlobalSearchQuery, GlobalSearchResults } from '@kanban/shared';
import { apiRequest } from '../../lib/api-client';

export function globalSearch(
  accessToken: string,
  input: GlobalSearchQuery,
  signal?: AbortSignal,
): Promise<GlobalSearchResults> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return apiRequest<GlobalSearchResults>(`/search?${query}`, {
    accessToken,
    signal,
  });
}

// Grouped first page: omit page entirely.
// globalSearch(token, { q: 'review', type: 'all' }, signal);
// More Cards: preserve query, request a specific type and its next page.
// globalSearch(token, { q: 'review', type: 'cards', page: 2, limit: 20 }, signal);
```

Use authenticated-user/session-generation cache keys containing trimmed query,
type, page and limit, e.g. `['search', userId, generation, q, type, page, limit]`.
Debounce and cancel obsolete requests; prevent an older response from replacing
the current query. Empty groups are legitimate, and empty input must not trigger
fake recent items/history. Navigate the returned relative `path` and let existing
route authorization recheck access. Never invent a Workspace label when its name
is null or link to a Guest-inaccessible Workspace directory.

Clear results on logout/account switch and relevant Board/Workspace access loss.
Invalidate/refetch for existing Board/Card/Workspace rename, description, archive,
restore, deletion, move, visibility and membership changes; resync after reconnect.
No new realtime event taxonomy is required. Do not persist query text or cached
protected titles as search history. Keyboard shortcuts, palette UI, loading/error
states, focus management and accessibility belong to P4-08.

## Source placement, persistence and performance

`apps/backend/src/api/search/` owns the module/controller/service, DTOs, type
readers, fixed rank/pagination helper and snippet projection. `AppModule`
registers it. Shared contracts live in `packages/shared/src/search.ts`; tests
live in `apps/backend/test/search/`. Existing Board discovery and Board-local
filtering implementations/contracts are unchanged. Search does not import or
modify P4-01 implementation. Older architecture snapshots predate the current
Workspace ACL/discovery/filtering code; source and verified tests define this read
path. No new entities, dependencies, migrations, extensions or external services
were introduced; runtime database configuration retains `synchronize: false` and
`migrationsRun: false`.

There are two SELECTs per selected type (authorized count and bounded page), six
for nonempty grouped search, independent of Board/result count. Transaction control
statements and JWT authentication are separate. Empty searches use zero business
SELECTs. PostgreSQL performs matching/ranking/pagination; the application only maps
bounded page rows and bounded snippets, without per-Board/Card/member requests.

The disposable fixture contains 4,000 Cards across 40 Boards, long descriptions,
many assignments and unauthorized retained assignments. It traverses all 80 Card
pages with deterministic UUID tie-breaking and checks no omissions/duplicates.
Actual `EXPLAIN (ANALYZE, BUFFERS)` of every type's count/page query measured
approximately 0.1–36 ms locally (Card count about 3 ms, Card page about 36 ms).
This is fixture evidence, not a production SLA or capacity claim. The measured
plans did not justify a new trigram/functional index or extension requirement.
Revisit indexes with production-scale evidence through a separately reviewed
forward migration rather than speculative schema changes here.

## Verification

The new integration script requires explicit `SEARCH_DATABASE_TESTS=local-only`,
a loopback `DATABASE_HOST` and caller-supplied connection settings. It never loads
dotenv and refuses production mode. It creates a random database on the designated
test server, applies the existing migration chain, verifies zero ORM schema drift,
and closes/drops the database in `finally`.

```sh
pnpm --filter @kanban/shared build
pnpm --filter @kanban/backend test:search:database
```

The local test server is a dedicated PostgreSQL 16.15 Docker container bound to
`127.0.0.1:55488`. Development/production databases are not used. The seven
PostgreSQL groups cover the full access matrix, directory masking, discovery and
deep-link parity, visibility/revocation/archive/restore, independent Board grants,
rank/pagination/counts, wildcards/SQL injection strings, Unicode/case, long snippets,
empty-query query counts, mid-request separate-connection commits and scale/plans.
Unit/HTTP tests add malformed inputs, safe errors/logging, real JWT/session and
rate limiting, response allowlists and Swagger.

Local verification on November 3, 2026 used Node 22.17.0 and pnpm 10.18.3:

| Command / check                                                                       | Result                                                                                                       |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm lint`                                                                           | PASS; targeted ESLint also passes after adding the final cross-Workspace privacy case                        |
| Focused search DTO/service/HTTP Jest run                                              | PASS: 3 suites, 64 tests                                                                                     |
| `pnpm --filter @kanban/backend test`                                                  | PASS: 96 suites, 1,014 tests, including unit and HTTP E2E                                                    |
| `pnpm --filter @kanban/shared test`                                                   | PASS: 19 tests, including global-search ESM/CommonJS exports                                                 |
| `pnpm --filter @kanban/frontend test --maxWorkers=1`                                  | PASS: all 122 files / 1,297 tests, unchanged tests and timeouts                                              |
| `node apps/backend/test/search/search.integration.mjs` after workspace build          | PASS: seven PostgreSQL/HTTP groups, including the final cross-Workspace privacy case                         |
| `node apps/backend/test/boards/boards.integration.mjs`                                | PASS: Board discovery, state, ACL, lifecycle, concurrency, migration compatibility and query-plan regression |
| `node apps/backend/test/cards/cards.integration.mjs`                                  | PASS: 14 groups, including Board-local filtering, assignments, archive/restore and races                     |
| `node apps/backend/test/workspaces/workspace-api.integration.mjs`                     | PASS: lifecycle, ACL, rollback, races and compatibility                                                      |
| `pnpm build`                                                                          | PASS: all workspace packages                                                                                 |
| `pnpm test`                                                                           | FAIL: default parallel frontend execution has seven timing-sensitive failures in unchanged frontend files    |
| `pnpm format:check`                                                                   | FAIL: 1,075 unchanged files flagged; none of this task's changed paths were flagged                          |
| Changed-file `pnpm exec prettier --check` and `git diff --check`                      | PASS                                                                                                         |
| Task-record/index relative links                                                      | PASS                                                                                                         |
| P4-08 TypeScript example compiled against actual shared types and frontend API helper | PASS; temporary check file removed                                                                           |

The focused command was:

```sh
pnpm --filter @kanban/backend test --runTestsByPath test/search/search.dto.spec.ts test/search/search.service.spec.ts test/search/search.e2e-spec.ts
```

The default root run's frontend failures concern Workspace activity/navigation,
Card route navigation, Settings, Board discovery views, Guests keyboard navigation,
invitations and Workspace Settings. The complete one-worker frontend run passes
without adjusting any test or timeout. No frontend source/configuration changed.
The complete standalone backend run passes, including existing P4-01 tests.

Repository-wide formatting drift remains outside this issue. Sampled unchanged
files (`README.md`, `.prettierrc.json`) have LF in Git and CRLF in the checkout.
Every changed file passes formatting; unrelated files were left intact. Existing
frontend build warnings about `NODE_ENV` and bundle size, pg schema-inspection
deprecation warnings and expected injected transport-error logs remain.

All disposable databases were verified removed, then the task's test container
was stopped/removed. No development/production data or infrastructure was changed.
Infrastructure/deployment checks and production verification were not run because
this change affects neither deployment contracts nor dependencies. There is no
unresolved P4-02 implementation blocker. Review readiness includes the explicitly
reported default parallel frontend-test and repository-formatting limitations.
