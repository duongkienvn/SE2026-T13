# Workspace activity (WS-04)

This backend contract supports [frontend issue #137](https://github.com/duongkienvn/SE2026-T13/issues/137). It starts at migration deployment; no prior history is invented. Board activity remains separate.

`GET /api/workspaces/:workspaceId/activity?page=1&limit=20` requires a joined Workspace member and returns `Cache-Control: no-store`. The standard envelope contains `data` and `meta` (`page`, `limit`, `total`, `totalPages`); limit is at most 100. Rows are ordered by database creation time descending, then UUID descending. Offset pages can shift as events arrive. For example:

```json
{
  "data": [
    {
      "id": "00000000-0000-4000-8000-000000000001",
      "eventType": "BOARD_MOVED",
      "createdAt": "2026-10-30T10:00:00.000Z",
      "actor": {
        "id": "00000000-0000-4000-8000-000000000002",
        "displayName": "Alex",
        "avatarUrl": null
      },
      "board": {
        "id": "00000000-0000-4000-8000-000000000003",
        "name": "Launch"
      }
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

No free-form metadata is stored or returned. Actor is null if deleted or no longer a Workspace member; board is null for general events. The current name and avatar are returned only for currently joined actors. A Board event uses the current Board name and current read grant; no old Workspace or Board names are stored.

| Event type             | Effective operation                                            |
| ---------------------- | -------------------------------------------------------------- |
| `WORKSPACE_CREATED`    | Team creation or first Personal creation                       |
| `WORKSPACE_UPDATED`    | Workspace name, description, or icon changed                   |
| `POLICY_UPDATED`       | One or more Workspace policies changed                         |
| `MEMBER_JOINED`        | Invitation accepted and new membership created                 |
| `MEMBER_ROLE_CHANGED`  | Existing Workspace role changed                                |
| `MEMBER_REMOVED`       | ADMIN removed a member                                         |
| `MEMBER_LEFT`          | Member left                                                    |
| `INVITATION_REQUESTED` | Issuance accepted and reserved, independent of delivery result |
| `INVITATION_REVOKED`   | Explicit revoke changed an open invitation                     |
| `INVITATION_DECLINED`  | Verified recipient declined an invitation                      |
| `BOARD_MOVED`          | Board moved into this Workspace                                |

| Caller                       | General events | Invitation events | Board events                          |
| ---------------------------- | -------------- | ----------------- | ------------------------------------- |
| Joined ADMIN                 | Yes            | Yes               | Only if current Board ACL grants read |
| Joined MEMBER                | Yes            | No                | Only if current Board ACL grants read |
| Board-only guest or outsider | 404            | 404               | 404                                   |

Visibility is filtered in SQL before counting and paging. Board move version is advanced by a database trigger whenever the Board's Workspace changes; only the current version is visible, including if the Board later returns. Archived Boards follow the same read ACL. Reads use the existing repeatable-read Workspace snapshot; a read already in flight can finish against its authorized snapshot, while fresh reads after revocation fail.

Workspace deletion cascades its activity in the deletion transaction; actor deletion sets actor to null; Board deletion removes its Board-linked rows. Other history is retained. The down migration locks Boards, Workspaces and Activity in that order before checking for history, and refuses to discard populated history: use a backup or forward fix. Personal creation uses an insert trigger because the legacy Board bridge also calls the shared PostgreSQL provisioning function, and this ensures exactly one entry under concurrent first use. All other writes use the caller's transaction. No external notification is emitted.

For #137, scope caches to the authenticated session and Workspace. Clear activity immediately on logout or access loss; invalidate or clear it on Workspace membership, role, policy, Board access or move changes, and refetch after reconnect. Treat a 404 as revoked access and remove cached rows. Do not infer invitation events from page gaps or count differences. There is no new realtime event taxonomy; use existing access reconciliation and refresh on relevant confirmed mutations.

## Local verification

- `pnpm build`, `pnpm lint`, changed-file Prettier check and `git diff --check`: passed in this checkout.
- `workspace-api.integration.mjs` against a disposable local PostgreSQL database: migration up/down/up, SQL-filtered ACL, pagination, rollback, lifecycle FKs and move visibility passed.
- The follow-up WS-04 integration also checks real Board-only Guests, explicit Board membership grants/revocation, equal-timestamp UUID ordering, snapshot-consistent paging, failed activity-write rollback, membership revocation races and migration rollback waiting for a concurrent writer.
- `workspaces.integration.mjs`: 19 PostgreSQL regression checks passed; `database-foundation.integration.mjs` passed schema and migration checks; `workspace-members-invitations.integration.mjs --invitations-only` passed invitation regression and activity assertions in a disposable PostgreSQL container.
- `activities.integration.mjs`: existing Board Activity persistence, HTTP feed, rollback, archived reads and isolation passed against a disposable PostgreSQL database.
- `board-events.integration.mjs`: 10 PostgreSQL and Socket.IO regression groups passed, including rollback, revocation and delivery failure.
- The initial full `pnpm test` run was stopped after sandbox loopback/cache errors. A retry with loopback access encountered frontend timeouts under concurrent load and was stopped; it is not a full-suite pass. Full `pnpm format:check` reports pre-existing formatting differences across the repository.
- A follow-up `pnpm test` with Node 24 was also stopped after frontend tests and the Board bootstrap wrapper timed out while running concurrently; it is not a full-suite pass. A follow-up `pnpm format:check` reported 631 files with formatting differences, including untouched files.
- A separate `vitest run --maxWorkers=2` frontend run was stopped without a final result after a prolonged run; no frontend files were changed.
- `pnpm --filter @kanban/backend test`: 69 suites and 707 tests passed; the Board module bootstrap suite timed out while other integration tests were running. This is not a full backend suite pass.
- Running `node -r ts-node/register test/boards/boards-module.bootstrap.mjs` directly completed successfully, including real Nest module wiring and protected route checks with a mock DataSource; the time-limited Jest wrapper still timed out on retry.
- The initial local Node runtime was 22.12.0, below the repository's declared 22.13.0 minimum. Follow-up build, lint and Workspace API PostgreSQL checks passed with the bundled Node 24.22.1 runtime. CI and deployment were not verified.
- Subsequent isolated runs with Node 24.22.1 and loopback access passed: `pnpm --filter @kanban/backend test` (70 suites, 708 tests) and `pnpm --filter @kanban/frontend exec vitest run --maxWorkers=2` (102 files, 1,075 tests). The shared package's seven tests also passed in the earlier root run. These runs cover all three workspace test suites; the default parallel `pnpm test` command itself has not passed in this environment.
