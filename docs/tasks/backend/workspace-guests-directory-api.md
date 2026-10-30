# P2-C01 — ACL-safe Workspace Guests Directory API

Implements [Issue #132](https://github.com/duongkienvn/SE2026-T13/issues/132), the
Guest-read subset of WS-02 and WS-04 in the [roadmap](../../roadmap/post-mvp.md).
The access model follows the [blueprint](../../design/product-ux-blueprint.md#3-workspace-domain-and-migration-decisions),
[Workspace UX §4](../../design/post-mvp/workspace/ux-spec.md#4-members-page),
[P2-01](workspace-data-foundation.md), [P2-03](workspace-members-invitations-api.md)
and [P2-04](board-visibility-access-control.md). This is local implementation
and verification evidence, not CI or deployment evidence.

## Authorization and scope

A Guest is an existing Board OWNER/MEMBER without current membership in that
Board's containing Workspace. There is no Workspace GUEST role or new grant.

`GET /api/workspaces/:workspaceId/guests` requires an authenticated, current
Workspace member, for both ADMIN and MEMBER. Personal Workspace owners can use
it too. Unknown Workspace, outsider and Board-only Guest all receive the same
404 `NOT_FOUND` / `Workspace not found`. Workspace ADMIN does not override a
PRIVATE Board's roster permission. WORKSPACE_VISIBLE read-only access does not
permit roster inspection either.

Eligible Boards are those in the requested Workspace with an explicit
BoardMember row for the caller, matching `BoardAuthorizationService.requireMember()`
and the existing Board Members endpoint. Active and archived Boards qualify.
No visibility, Workspace role, creator shortcut or policy grants additional
roster access. A user with Guests only on inaccessible Boards contributes
neither an identity, association nor count. A shared Guest exposes only the
eligible associations, even when that Guest also belongs to hidden Boards.

The result is always an **ACL-limited directory**. Neither an empty response nor
any count establishes that the Workspace has no other Guests. There is no
Workspace-wide Guest total or hidden Board count/completeness flag.

## Exact REST contract for P2-C02 / Issue #135

Request: `GET /api/workspaces/<uuid>/guests?page=1&limit=20&search=` using the
existing JWT Bearer authentication and API envelope. Successful responses have
`Cache-Control: no-store`.

| Query    | Validation and semantics                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| `page`   | Integer 1–1,000,000; default 1.                                                                            |
| `limit`  | Integer 1–100; default 20.                                                                                 |
| `search` | Optional trimmed string, maximum 120 characters; case-insensitive display-name substring. Empty means all. |

Search applies only to eligible Guest display names. Email is never searched.
`%`, `_` and `\` are literal characters, not SQL wildcards. Unsupported query
fields (including `sort`, `role`, `status`) and invalid input are rejected with 400. There is no active-only default: archived associations are included.
Guest ordering is fixed to PostgreSQL `displayName ASC, userId ASC`; Board
associations use `name ASC, boardId ASC`. UUID breaks ties. Pages are over users,
never joined membership rows. A page beyond the result is `[]` with the true
scoped, search-filtered total. Dataset changes between requests can shift offset
pages; reset/refetch pages after access or membership changes.

The exact serialized success type is:

```ts
type WorkspaceGuestResponseDto = {
  user: {
    id: string; // UUID
    displayName: string;
    avatarUrl: string | null;
  };
  boards: {
    boardId: string; // UUID
    name: string;
    role: 'OWNER' | 'MEMBER'; // The Guest's role on this Board
    isArchived: boolean;
  }[];
  visibleBoardCount: number; // boards.length, eligible associations only
};

type WorkspaceGuestsResponse = {
  success: true;
  statusCode: 200;
  message: 'OK';
  data: WorkspaceGuestResponseDto[];
  meta: {
    page: number;
    limit: number;
    total: number; // Distinct eligible Guests matching search, before pagination
    totalPages: number; // Math.ceil(total / limit), zero when total is zero
  };
};
```

Example with one Guest on two eligible Boards:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "OK",
  "data": [
    {
      "user": {
        "id": "11111111-1111-4111-8111-111111111111",
        "displayName": "Example Guest",
        "avatarUrl": null
      },
      "boards": [
        {
          "boardId": "22222222-2222-4222-8222-222222222222",
          "name": "Design",
          "role": "MEMBER",
          "isArchived": false
        },
        {
          "boardId": "33333333-3333-4333-8333-333333333333",
          "name": "Research",
          "role": "OWNER",
          "isArchived": true
        }
      ],
      "visibleBoardCount": 2
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

`avatarUrl` is always present and nullable. It follows the existing profile
projection: `/users/:userId/avatar/:assetId` for a private stored photo, otherwise
the legacy avatar URL or null. The path is relative to the API base; private
downloads still enforce their existing shared-explicit-Board authorization.
The directory does not return storage keys, signed URLs, avatarRevision, email,
account timestamps, invitation information or tokens. Nested DTO allowlists
and Swagger schemas enforce these fields independently of entity shape.

UI handoff: describe these as Guests on Boards whose members the caller can
view; never label `meta.total` as all Guests in the Workspace. `200 []` is a
valid scoped empty/search-empty state. Use the existing authenticated avatar
loader and fallback. Key caches by session, Workspace, search and page; clear
protected state on account change, logout or access denial. Invalidate Guests
after Board membership/role changes, Board moves, Workspace join/leave/removal,
and access-change/revocation hints. Reconnect/focus refetch remains necessary.
Do not infer Guests by loading hidden Boards or synthesize a Workspace role.
No frontend implementation is included; Issue #135 owns it.

Errors use the existing safe envelope: missing/expired/invalidated JWT or deleted
account gives 401; invalid UUID/query gives 400 (DTO errors `VALIDATION_FAILED`);
missing/unjoined Workspace gives 404; rate limit gives 429; unexpected failure
gives sanitized 500 without SQL, parameters or stack traces. Consumers must
discard protected state on 401/403/404 rather than render cached results.

## Query and concurrency boundary

`WorkspaceGuestsService` reuses `readWorkspaceSnapshot` (REPEATABLE READ, up to
three attempts for serialization/deadlock failures) and
`WorkspacesService.requireMember` (Workspace and actor membership share locks
held through commit). Authorization, page, count and associations share that
transaction and manager.

The SQL semi-join derives eligibility from actor BoardMember rows and excludes
current workspace_members before paging/counting. User is the pagination root,
so multiple Board memberships cannot duplicate or inflate Guests. Selection
hydrates only ID, display name and avatar projection inputs; it never loads all
PRIVATE Boards/members into application memory. The association query repeats
the same ACL and Workspace boundary and fetches only the page's user IDs. There
are at most three domain SELECTs (page, count, bulk associations), independent
of Guest count; TypeORM can omit COUNT for a complete first page. Existing
foreign keys and unique membership/index constraints are reused. No migration,
dependency, write, event or server response cache is added.

Reads follow the existing Workspace snapshot contract: Board revocation after
the snapshot cannot retroactively retract an already authorized in-flight
response. Such a response keeps its page, total and associations from the same
snapshot. A new request after commit sees the removed grant and cannot return
its identity/association/count. Workspace removal that owns the lock first
forces the waiting read to retry and receive safe 404; a read holding the grant
first completes before removal can commit. Clients must drop late results
after access invalidation, as required by the existing session/cache contract.

## Acceptance coverage and local evidence

The existing disposable PostgreSQL runner now invokes the Guest suites before
the original invitation/access scenarios. It owns a randomly named, loopback-only
PostgreSQL 16 container with random test credentials, runs explicit migrations,
and removes it on exit. It never loads application DB credentials or contacts
a real mail provider. The expected injected migration-failure messages belong
to pre-existing migration rollback tests, not failed test outcomes.

| Issue #132 criterion                                | Automated evidence                                                                                                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADMIN/private and visibility-only roster isolation  | Guest HTTP matrix; zero eligible ADMIN; hidden-only Guest search/count exclusion; existing Board Members denial.                                                 |
| Board A allowed, B hidden, shared Guest scoped      | Exact identity/Board allowlists and eligible-only association/count assertions.                                                                                  |
| Board-only Guest/outsider denied; revocation        | Safe 404 comparison, fresh-request checks, Workspace leave/removal and real PostgreSQL lock-order tests.                                                         |
| Distinct users, stable search/page/count; no N+1    | Duplicate display names with UUID tie pages, many-to-many membership, page beyond data, literal wildcard/injection/email searches and bounded SQL capture.       |
| Archived/moved/multi-Workspace/Personal             | HTTP archive/restore, Board move, destination-specific Guest exclusion, Personal owner/Guest ACL, membership/role/visibility transitions.                        |
| Snapshot concurrency                                | Barrier between user page and count/association queries with committed Board revocation; observed PostgreSQL lock waiters in both Workspace read/removal orders. |
| Existing Members/Board/invitation/realtime behavior | Original Workspace integration runner plus its existing `--regressions` selection.                                                                               |

Verification date: 2026-10-30, Node v22.17.0, pnpm 10.18.3, local Docker.
The requested branch already existed with a clean tree and matched freshly
fetched `origin/main` before changes; no branch reset or discarded work was needed.

| Command/check                                                                                                       | Result                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm --filter @kanban/backend exec jest --runInBand --runTestsByPath test/workspaces/workspace-guests.dto.spec.ts` | PASS: 1 suite / 14 tests.                                                                                                                                                                                                                  |
| `pnpm --filter @kanban/backend test:workspace-members:database --regressions`                                       | PASS: Guest HTTP/ACL/query, lifecycle and concurrency groups; original Workspace Members/Invitations, Board access, policy/move/deletion, Socket.IO and races; all 13 selected PostgreSQL regression suites. Disposable container removed. |
| `pnpm lint`                                                                                                         | PASS.                                                                                                                                                                                                                                      |
| `pnpm test`                                                                                                         | PASS: backend 69 suites / 701 tests; frontend 101 files / 982 tests; shared 7 tests.                                                                                                                                                       |
| `pnpm build`                                                                                                        | PASS: shared, backend and frontend. Existing Vite NODE_ENV-in-env and large-chunk warnings remain.                                                                                                                                         |
| `pnpm format:check`                                                                                                 | FAIL: LF-only check reports 809 existing base files in this CRLF Windows checkout. No unrelated normalization performed.                                                                                                                   |
| `pnpm format:check --end-of-line auto`                                                                              | PASS for the whole repository; the strict failures are line-ending differences.                                                                                                                                                            |
| Local Markdown links/paths                                                                                          | PASS: 72 relative links/paths across the 3 changed documents.                                                                                                                                                                              |
| `git diff --check`                                                                                                  | PASS.                                                                                                                                                                                                                                      |

The initial new SQL-count assertion assumed TypeORM always runs a separate
COUNT; it was corrected to accept its complete-first-page optimization, then
the dedicated suite and full regressions passed. Existing pg concurrent-query
deprecation messages and deliberately injected migration/delivery/eviction
failure logs appeared in successful regression tests. Live mail/OAuth providers,
production, deployment, CI and browser visual QA were not exercised. No UI,
schema, invitation or realtime production code changed. The existing snapshot
boundary and offset-page behavior described above remain the API limitations.

## Files and integration readiness

- `apps/backend/src/api/workspaces/`: new Guests controller/service and DTOs;
  `workspace-api.module.ts` registers them. Existing write/ACL services are unchanged.
- `apps/backend/test/workspaces/`: DTO validation/serialization tests; Guest
  PostgreSQL HTTP/Swagger/query, lifecycle and concurrency suites; the existing
  Workspace members/invitations runner calls them.
- This record, the task index and the P2-03 handoff link document the contract.

Historical P2-03 documents intentionally described Guests as deferred, and the
project overview still reflects earlier Workspace milestones. This scoped
record supersedes only the missing Guests-read handoff; it does not claim a
frontend, phase completion or production rollout. Issue #135 can integrate
against the exact route/schema above once this backend change is made available
in its checkout. No schema rollout is required.
