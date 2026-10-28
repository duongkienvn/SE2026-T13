# P2-01 — Workspace data foundation and legacy Board migration

Implements the persistence subset of WS-01, WS-02 and BD-02 from
[Issue #110](https://github.com/duongkienvn/SE2026-T13/issues/110), the
[roadmap](../../roadmap/post-mvp.md), [blueprint](../../design/product-ux-blueprint.md)
and [Workspace spec](../../design/post-mvp/workspace/ux-spec.md).
Local implementation/verification dated 2026-10-28. This is not deployment evidence.

## Implementation and domain decisions

- Shared authority: `WorkspaceType` PERSONAL/TEAM, `WorkspaceRole` ADMIN/MEMBER,
  `BoardVisibility` PRIVATE/WORKSPACE_VISIBLE, `WorkspaceIdentity` and
  `WorkspaceMembershipIdentity`. Values follow existing const/type contracts and
  are exported/tested for ESM and CommonJS. Identity types are not API response DTOs.
- Three new entities under `api/workspaces/entities/`: `Workspace`,
  `WorkspaceMember`, `WorkspaceInvitation`. Existing discovery globs register
  these in source and compiled runtime without changing database options.
- Workspace `createdById` is immutable creation metadata and the durable Personal
  owner association. PostgreSQL partial uniqueness enforces at most one Personal
  per user; different Team Workspaces may have the same creator. Every legacy
  user receives Personal + ADMIN in backfill, including users without Boards.
- Workspace has `name varchar(120)` (nonblank), nullable text description and UTC
  timestamps. Icon representation is deliberately left to the scoped Core API
  contract; no arbitrary URL/blob/icon storage is invented here.
- Workspace membership has UUID identity, unique workspace/user pair, ADMIN/MEMBER
  role, joined/created/updated timestamps, user-listing and workspace/role indexes.
- Invitations store normalized email, intended role, unique SHA-256 hex token
  hash, expiry, consumed/revoked times, inviter and timestamps. CHECKs reject
  unnormalized/invalid basic email shape, unknown roles, malformed hash, invalid
  expiry/terminal dates or mutually consumed/revoked state. Default entity SELECT
  omits the hash. No plaintext proof or future issuance/acceptance/mail behavior.
- Board has required Workspace FK/index and PRIVATE default/check. Every new FK
  uses NO ACTION; no Workspace deletion cascades into Board, Card or User data.
  Existing `created_by_id`, Board membership roles and public DTOs stay intact.
- `WorkspacesModule` exports `WorkspacesService`, with no controllers or network
  events. `BoardsModule` imports it. Existing create supplies the authenticated
  current user, explicitly provisions Personal + ADMIN and writes PRIVATE Board
  - OWNER atomically. Input cannot select another Workspace or visibility.
- Signup/authentication is unchanged. Email and Google accounts created after
  migration bootstrap lazily on their first Board creation, or via an authorized
  future internal ensure call. Lookup is read-only and can return null before use.

See [database schema and ER diagram](../../architecture/database-design.md) for
column/index details and [operator runbook](../../deployment/workspace-foundation.md)
for full rollout, SQL inventories, backup/restore rehearsal and recovery gates.

## Provisioning and migration contracts

```ts
findPersonalWorkspace(userId: string, manager?: EntityManager): Promise<Workspace | null>
ensurePersonalWorkspace(userId: string, manager?: EntityManager): Promise<Workspace>
```

These are **trusted internal** methods, not authorization APIs. Do not pass
unverified client ownership fields. Without a manager, ensure owns one transaction;
with a manager, it requires an active caller transaction and never nests one.
The SQL parameter is bound as UUID. Failures propagate so the owning transaction
rolls back Workspace, owner ADMIN, Board and Board OWNER together.

`public.ensure_personal_workspace(uuid)` is the shared persistence primitive used
by service, migrations and old-binary trigger. SECURITY INVOKER, schema-qualified
tables, no dynamic SQL. It inserts Personal with generic `Personal Workspace` name
(no copy of user email/name), upserts through the partial unique index and returns
the winning UUID. A no-op conflict update locks that Workspace; missing/demoted
owner membership is inserted/repaired as ADMIN. An already correct membership
retains identity/join/timestamps. PostgreSQL uniqueness handles concurrent
processes; an in-memory queue is not involved. No ownership transfer occurs.

Two new migration timestamps follow the merged private-avatar migration:

| Migration                             | Behavior                                                                                                                                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1793145600000-WorkspaceFoundation`   | Expand tables, nullable Board Workspace FK, PRIVATE default/check, indexes and bridge. BEFORE INSERT/UPDATE repairs omitted/NULL Workspace to creator Personal + ADMIN + PRIVATE within the writer's transaction.                              |
| `1793145600001-LegacyBoardWorkspaces` | Require transaction, bound lock wait, take Board exclusive lock; fail closed for inconsistent creator/scope/visibility; ensure all existing users; backfill only NULL Board scope; verify every creator mapping and owner ADMIN; SET NOT NULL. |

No historical migration is edited. Backfill uses raw SQL and changes only the new
Board fields; it does not touch legacy IDs, timestamps, creators, archive state,
positions, membership, cards or related content. Board guests are never copied
into creator Workspace membership. Re-running the supported pre-feature backfill
does not create duplicates, change existing assignments or churn timestamps.

The approved deployment is **maintenance with writers drained**, matching the
existing single-instance release process. With default TypeORM all-migrations
transaction, expand and constrain commit together. Bridge supports previous
Board writers after NOT NULL and across compatible app-only rollback. It must
remain installed; no instant destructive database rollback is promised. Empty
foundation can revert; populated foundation refuses. Legacy down drops only NOT
NULL and preserves data. A future Team/visibility release must not replay this
legacy-only backfill after changing scope semantics.

## Access and data integrity evidence

BoardAuthorizationService, Board queries, JWT/session checks, response allowlists,
Card routes, business events and room coordination remain unchanged. Board
OWNER/MEMBER is still the only access source. WORKSPACE_VISIBLE is a valid stored
value but grants no new read access in P2-01. REST creation/update does not accept
the toggle. Existing guests retain their explicit Board grant while lacking
creator Workspace membership. No Workspace overview/member/settings endpoint
exists here for a guest to access. Socket regression fixtures explicitly give a
non-Board-member Workspace ADMIN and still verify rejected Board joins.

The new PostgreSQL suite compares complete ordered JSON snapshots of all eight
legacy tables, excluding only the two newly added Board columns. Fixtures include
multiple creators, multiple Boards per creator, a zero-Board user, multiple Board
members, guests, archived Board and Card, exact numeric positions, assignments,
comments and structured activity. It injects a SQL failure during Board backfill
after Workspace/ADMIN creation and checks both data and migration-history rollback
before a successful retry. It also proves old-style inserts during nullable expand
and after final NOT NULL, fresh down/up, populated rollback refusal and anomaly
failure with explicit remediation.

Concurrency tests use independent pool connections: simultaneous ensures, first
Board creates, mixed-version writers, and an observed PostgreSQL unique-index lock
wait before the competing insert commits. Rollback tests fail both standalone
provisioning and Board OWNER insertion after Board save, assert no partial rows,
then retry successfully. Team roles and FK/unique/check constraints are exercised
on real PostgreSQL. Auth checks use real email registration/login/JWT and mocked
Google proof verification; no Google or mail provider is contacted.

## Verification record

Node 22.17.0, pnpm 10.18.3. Workspace/domain suites use a task-owned PostgreSQL 16
container bound to `127.0.0.1:55432`, with random databases created/dropped by each
script. Auth/avatar/preferences scripts own separate disposable Docker containers
using `postgres:16.15-alpine3.24`. No development or production database is used.
The new suite requires `WORKSPACE_DATABASE_TESTS=local-only`, a loopback host and
explicit database environment; it never loads `.env`.

Commands below run from the repository root. The task-owned test database settings
are supplied in the process environment; credentials are not committed. For the
new suite, the configured database is only an administrative CREATE/DROP connection.

| Command                                                                                                                                                                             | Result                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @kanban/shared build` and `pnpm --filter @kanban/shared test`                                                                                                        | PASS, 7 shared tests, including ESM/CJS Workspace exports.                                                                                                                                                      |
| `pnpm --filter @kanban/backend exec jest --runInBand --runTestsByPath test/boards/boards.service.spec.ts test/boards/boards.e2e-spec.ts test/workspaces/workspaces.service.spec.ts` | PASS, 58 tests.                                                                                                                                                                                                 |
| `pnpm --filter @kanban/backend test`                                                                                                                                                | PASS, 57 suites / 563 tests, including auth, Card deep-link API/restore, realtime and presence.                                                                                                                 |
| `pnpm --filter @kanban/backend test:workspaces:database`                                                                                                                            | PASS, final suite 15 groups including fresh/legacy/constraints/races/rollback and real auth integration. Default all-migrations failure also proves expand schema/history rollback before retry.                |
| `pnpm --filter @kanban/backend test:database`                                                                                                                                       | PASS, 16 entities, 10 migrations, source/compiled/Nest/CLI discovery, 25 FKs, zero schema drift, rollback guards and reapply.                                                                                   |
| `pnpm --filter @kanban/backend exec node test/boards/boards.integration.mjs`                                                                                                        | PASS, CRUD, roles/isolation, rollback, archive/restore and real HTTP bootstrap.                                                                                                                                 |
| `pnpm --filter @kanban/backend exec node test/board-members/board-members.integration.mjs`                                                                                          | PASS, membership roles, assignment cleanup and revocation.                                                                                                                                                      |
| `pnpm --filter @kanban/backend exec node test/columns/columns.integration.mjs`                                                                                                      | PASS, ordering/rebalance, locks, archive and deletion constraints.                                                                                                                                              |
| `pnpm --filter @kanban/backend exec node test/cards/cards.integration.mjs`                                                                                                          | PASS, 13 groups, concurrent ordering/assignment, member-removal races, archive/restore and HTTP.                                                                                                                |
| `pnpm --filter @kanban/backend exec node test/comments/comments.integration.mjs`                                                                                                    | PASS, persistence, author permissions, soft delete and archived Card rules.                                                                                                                                     |
| `pnpm --filter @kanban/backend exec node test/activities/activities.integration.mjs`                                                                                                | PASS, 15 actions, rollback, post-commit delivery and feeds.                                                                                                                                                     |
| `pnpm --filter @kanban/backend exec node -r ts-node/register test/realtime/realtime.integration.mjs`                                                                                | PASS, 16 scenarios, including Workspace ADMIN without Board grant; authenticated sockets, isolation, revocation, reconnect and quotas.                                                                          |
| `pnpm --filter @kanban/backend exec node -r ts-node/register test/realtime/board-events/board-events.integration.mjs`                                                               | PASS, 10 groups covering all 18 events, SQL commit barriers/rollback, delivery failure and removal races.                                                                                                       |
| `pnpm --filter @kanban/backend exec node test/auth/google-auth.integration.mjs`                                                                                                     | PASS, 14 groups; Google verifier mocked, no live OAuth.                                                                                                                                                         |
| `pnpm --filter @kanban/backend test:email-verification:database`                                                                                                                    | PASS, 16 groups; includes CLI migration discovery and nested foundation suite.                                                                                                                                  |
| `pnpm --filter @kanban/backend exec node test/auth/password-security.integration.mjs`                                                                                               | PASS, 16 groups, including token invalidation, races and rollback.                                                                                                                                              |
| `pnpm --filter @kanban/backend exec node test/users/avatar.integration.mjs`                                                                                                         | PASS; includes nested foundation suite.                                                                                                                                                                         |
| `pnpm --filter @kanban/backend exec node test/users/user-preferences.integration.mjs`                                                                                               | PASS, migration/constraints/concurrency/HTTP/isolation/restart.                                                                                                                                                 |
| `pnpm lint`                                                                                                                                                                         | PASS.                                                                                                                                                                                                           |
| `pnpm test` (final rerun after database suites finished)                                                                                                                            | PASS, 7 shared + 563 backend + 803 frontend tests (1,373 total).                                                                                                                                                |
| `pnpm build`                                                                                                                                                                        | PASS. Vite warns about local NODE_ENV and bundle size; build exits successfully.                                                                                                                                |
| `pnpm format:check`                                                                                                                                                                 | FAIL: existing Windows CRLF checkout (`core.autocrlf=true`). Unchanged AGENTS/config/Auth files match original Git content after newline normalization; original Git blobs pass Prettier. No unrelated rewrite. |
| `pnpm exec prettier --check . --end-of-line auto`                                                                                                                                   | PASS, supplementary diagnostic; does not replace the required formatting gate.                                                                                                                                  |
| Prettier check of all changed/new files; `git diff --check`; local Markdown path check                                                                                              | PASS; 75 local paths resolve across six affected Markdown documents.                                                                                                                                            |

The first root `pnpm test` run had 3 frontend 5s timeouts (CardPermalinkViewport
and PreferencesPage) while database suites ran concurrently; 800 other frontend
tests passed. All 9 tests in those two files passed when rerun with
`pnpm --filter @kanban/frontend exec vitest run src/features/cards/components/CardPermalinkViewport.test.tsx src/features/settings/pages/PreferencesPage.test.tsx --maxWorkers=1`.
The final root rerun passes all tests; no frontend source/config change was needed.

Historical harnesses assumed their subject migration was always last and used
stale total counts. Updated them to isolate the subject boundary or exercise its
real transactional down/up directly, retaining rollback guards and running the
complete latest schema before application checks. No historical migration or auth
business behavior was modified. An initial direct email-suite invocation passed
14 checks then failed its `npm_execpath` precondition; rerunning through its
documented package script completed all 16 checks. Initial new unit invocation
also required the repository's existing Nest TypeORM decorator mock convention;
the corrected tests pass.

Not run: actual production migrations/deployment, live Google/email/S3 operations,
production snapshot restore and production-sized performance/lock rehearsal. These
remain explicit operator gates in the runbook, not local implementation claims.

## Handoff

| Owner / issue              | Stable foundation and remaining responsibility                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nanromi / P2-02 (#111)     | Import WorkspacesModule/Service and the three entities. Use `createdById` as Personal owner/creator; never infer it from Board members. Call ensure with trusted identity and active manager for atomic workflows. Build authorized Workspace CRUD/listing, Team Board creation and scoped icon contract; preserve the old Personal-create path.                                                                                           |
| Nanromi / P2-03 (#112)     | Use WorkspaceMember and WorkspaceInvitation; roles stay ADMIN/MEMBER. Normalize email before persistence; generate opaque CSPRNG token and persist SHA-256 hex only. Implement verified-email binding, row-locked single-use acceptance/revoke/expiry, admin policy/last-admin checks, rate limits and safe duplicate-pending behavior. Token lookup must explicitly select hash if needed. Workspace roles confer no private Board grant. |
| P2-04 (#115)               | Add Workspace-visible reads only after consistent REST/list/search/Card/Socket.IO policy and revocation coverage. PRIVATE access remains explicit Board membership. No toggle is delivered here.                                                                                                                                                                                                                                           |
| P2-05 / frontend P2-06–09  | Board Move/settings/policies and Workspace UI remain unimplemented; preserve IDs, guest grants, archive state, private-data isolation and API response allowlists.                                                                                                                                                                                                                                                                         |
| duongkienvn / P2-10 (#119) | Email delivery/Resend/templates are separate. No invitation mail implementation is included in this task.                                                                                                                                                                                                                                                                                                                                  |

Before production: review SQL and application rollback versions, approve off-host
backup/restore rehearsal, production-sized timing/capacity and maintenance window;
drain writers, run migrations explicitly, compare inventories and run authorized
REST/socket smoke. Local work is retained for human review; no push, PR, merge,
production database operation or deployment is authorized by this record.

## Changed-file inventory

Paths relative to repository root:

```text
packages/shared/src/index.ts
packages/shared/src/workspace.ts
packages/shared/test/workspace.test.mjs
apps/backend/package.json
apps/backend/src/api/workspaces/entities/workspace.entity.ts
apps/backend/src/api/workspaces/entities/workspace-member.entity.ts
apps/backend/src/api/workspaces/entities/workspace-invitation.entity.ts
apps/backend/src/api/workspaces/workspaces.module.ts
apps/backend/src/api/workspaces/workspaces.service.ts
apps/backend/src/api/boards/entities/board.entity.ts
apps/backend/src/api/boards/boards.module.ts
apps/backend/src/api/boards/boards.service.ts
apps/backend/src/database/migrations/1793145600000-WorkspaceFoundation.ts
apps/backend/src/database/migrations/1793145600001-LegacyBoardWorkspaces.ts
apps/backend/test/workspaces/workspaces.service.spec.ts
apps/backend/test/workspaces/workspaces.integration.mjs
apps/backend/test/boards/boards.service.spec.ts
apps/backend/test/boards/boards.e2e-spec.ts
apps/backend/test/boards/boards.integration.mjs
apps/backend/test/activities/activities.integration.mjs
apps/backend/test/database/database-foundation.integration.mjs
apps/backend/test/realtime/realtime.integration.mjs
apps/backend/test/auth/email-verification.integration.mjs
apps/backend/test/auth/google-auth.integration.mjs
apps/backend/test/auth/password-security.integration.mjs
apps/backend/test/users/avatar.integration.mjs
apps/backend/test/users/user-preferences.integration.mjs
docs/architecture/database-design.md
docs/architecture/backend-architecture.md
docs/deployment/production.md
docs/deployment/workspace-foundation.md
docs/tasks/README.md
docs/tasks/backend/workspace-data-foundation.md
```
