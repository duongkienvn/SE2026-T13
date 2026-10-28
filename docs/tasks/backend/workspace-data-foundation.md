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
  and Board OWNER atomically. Input cannot select another Workspace or visibility.
- The product-owner eager-signup clarification is authoritative: email registration
  commits User + Personal Workspace + ADMIN together, including unverified accounts.
  Google signup provisions in the same transaction as User + GoogleIdentity.
  Login and account linking do not provision. Lookup remains read-only; ensure is
  retained for recovery/legacy callers and Board creation, not normal onboarding.
  Verification email remains outside the transaction and preserves resend/failure
  semantics. No sample Board/Column/Card data is created.

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
Auth creation also supplies its manager, so provisioning failure rolls back the
new User and, for Google, its identity. AuthModule imports WorkspacesModule in one
direction; WorkspacesModule has no AuthModule dependency. Only the User email
unique constraint maps to EMAIL_ALREADY_EXISTS; a Workspace failure is not reported
as an email collision. Hashing precedes the email registration transaction; mail
is requested only after it commits.

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
Google proof verification; no Google or mail provider is contacted. The eager
follow-up asserts immediate Workspace/ADMIN with zero Boards before verification,
no duplicates after repeat login/link/first Board, concurrent signups, and complete
User/identity/Workspace rollback on an injected ADMIN insertion failure. An independent
database connection in the mailer sees committed User + Workspace + ADMIN.

## Initial foundation verification (before eager-signup clarification)

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

## Eager-signup follow-up verification

Implements the updated [product-owner clarification on Issue #110](https://github.com/duongkienvn/SE2026-T13/issues/110) as read on 2026-10-28; the issue body is authoritative over the original lazy-onboarding assumption. The existing eight commits and migration definitions remain intact. One follow-up fix adds eager signup without sample content or new dependencies.

PostgreSQL suites use only disposable local databases/containers. The preceding
table retains the original run's evidence; the table below applies to eager signup.

| Command                                                                                                                                                                                                                                 | Follow-up result                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @kanban/shared build`                                                                                                                                                                                                    | PASS.                                                                                                                                                                                                                                                                                                 |
| `pnpm --filter @kanban/backend exec jest --runInBand --runTestsByPath test/auth/auth.service.spec.ts test/boards/boards.e2e-spec.ts`                                                                                                    | PASS, 50 tests. Covers transaction participation, mail-after-commit and distinguishing Workspace failures from duplicate email.                                                                                                                                                                       |
| `pnpm --filter @kanban/backend test:workspaces:database`                                                                                                                                                                                | PASS, 18 groups. PostgreSQL/API eager signup, before-verification persistence, zero sample content, repeat login/link/first Board, complete signup rollback/retry and concurrent account creation; prior migration/backfill/bridge/access checks also pass.                                           |
| `pnpm --filter @kanban/backend test:google-auth:database`                                                                                                                                                                               | PASS, 14 groups, including pending third-party-email Workspace, mail failure recovery, concurrent signup and existing linking/JWT behavior. Google proof verifier is mocked.                                                                                                                          |
| `pnpm --filter @kanban/backend test:email-verification:database`                                                                                                                                                                        | PASS, 16 groups, including immediate unverified User Workspace/ADMIN, delivery failure/retry, JWT/Socket.IO verification gates and nested database foundation checks.                                                                                                                                 |
| `pnpm --filter @kanban/backend exec node test/boards/boards.integration.mjs`                                                                                                                                                            | PASS, Board CRUD, roles/isolation, archive/restore, transaction rollback and real HTTP module wiring.                                                                                                                                                                                                 |
| `pnpm lint`                                                                                                                                                                                                                             | PASS.                                                                                                                                                                                                                                                                                                 |
| `pnpm build`                                                                                                                                                                                                                            | PASS, all workspace builds; existing Vite NODE_ENV and bundle-size warnings remain.                                                                                                                                                                                                                   |
| `pnpm test` (default and serialized/offline reruns)                                                                                                                                                                                     | FAIL in the frontend suite: existing PreferencesPage 5s timeout; one earlier run also hit RegisterPage's extra Google SDK failure alert. The corrected backend run passes all 57 suites / 565 tests, and shared passes 7 tests. All frontend tests separately pass with one worker as recorded below. |
| `pnpm --filter @kanban/frontend exec vitest run --maxWorkers=1`                                                                                                                                                                         | PASS, all 91 files / 803 tests.                                                                                                                                                                                                                                                                       |
| `pnpm --filter @kanban/frontend exec vitest run src/features/auth/pages/RegisterPage.test.tsx src/features/settings/pages/PreferencesPage.test.tsx --maxWorkers=1` with process-only `VITE_GOOGLE_CLIENT_ID=disabled-for-offline-tests` | PASS, 30 tests; no `.env` or frontend source change.                                                                                                                                                                                                                                                  |
| `pnpm format:check`                                                                                                                                                                                                                     | FAIL, existing Windows CRLF formatting issue (601 unchanged files); no unrelated rewrite.                                                                                                                                                                                                             |

One initial Google-suite invocation failed before executing tests with Windows
EPERM because two package commands built into the same dist directory concurrently.
Builds were then serialized; the complete Google and Email scripts passed. This
was a local execution collision, not a skipped test or application failure.
The first root run hit the existing PreferencesPage 5s frontend timeout. The next
run exposed import-order errors in six mocked HTTP suites introduced while adding
the new Auth dependency; these were corrected, and a targeted rerun passed all
six suites / 40 tests. A subsequent root run passed all 57 backend suites / 565
tests, then failed RegisterPage's single-alert assertion because the locally
configured Google SDK also produced a load-failure alert. Frontend source is
unchanged, and all 803 tests passed with one frontend worker. The final root run
uses process-only `npm_config_workspace_concurrency=1` and
`VITE_GOOGLE_CLIENT_ID=disabled-for-offline-tests`, serializing workspace suites
and disabling the optional external SDK in ordinary offline page fixtures.
Google-specific frontend tests retain their explicit mocked client IDs/proofs;
backend Google integration uses a mocked proof verifier. No repository or `.env`
configuration is changed. The final root run still fails the existing PreferencesPage
5s timeout (802 frontend tests pass), while backend 565 and shared 7 pass. The
standalone frontend run with one worker passes all 803 tests. The root gate is
therefore reported as failed, not replaced by the standalone result. No frontend
code or test configuration is modified to mask this timing issue.

No migrations, shared contracts or WorkspacesService SQL primitive changed in
this follow-up. No sample content, production actions or external mail/Google
requests were performed.

## Handoff

| Owner / issue              | Stable foundation and remaining responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nanromi / P2-02 (#111)     | Ordinary new accounts already have Personal Workspace + ADMIN immediately after signup. P2-02 must not own that onboarding trigger; use ensure defensively for legacy/inconsistent accounts. Import WorkspacesModule/Service and the three entities. Use `createdById` as Personal owner/creator; never infer it from Board members. Call ensure with trusted identity and active manager for atomic workflows. Build authorized Workspace CRUD/listing, Team Board creation and scoped icon contract; preserve the old Personal-create path. |
| Nanromi / P2-03 (#112)     | Use WorkspaceMember and WorkspaceInvitation; roles stay ADMIN/MEMBER. Normalize email before persistence; generate opaque CSPRNG token and persist SHA-256 hex only. Implement verified-email binding, row-locked single-use acceptance/revoke/expiry, admin policy/last-admin checks, rate limits and safe duplicate-pending behavior. Token lookup must explicitly select hash if needed. Workspace roles confer no private Board grant.                                                                                                    |
| P2-04 (#115)               | Add Workspace-visible reads only after consistent REST/list/search/Card/Socket.IO policy and revocation coverage. PRIVATE access remains explicit Board membership. No toggle is delivered here.                                                                                                                                                                                                                                                                                                                                              |
| P2-05 / frontend P2-06–09  | Board Move/settings/policies and Workspace UI remain unimplemented; preserve IDs, guest grants, archive state, private-data isolation and API response allowlists.                                                                                                                                                                                                                                                                                                                                                                            |
| duongkienvn / P2-10 (#119) | Email delivery/Resend/templates are separate. No invitation mail implementation is included in this task.                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Before production: review SQL and application rollback versions, approve off-host
backup/restore rehearsal, production-sized timing/capacity and maintenance window;
drain writers, run migrations explicitly, compare inventories and run authorized
REST/socket smoke. Local work is retained for human review; no push, PR, merge,
production database operation or deployment is authorized by this record.

## Changed-file inventory

Paths relative to repository root:

The inventory covers the full foundation branch, including the eager-signup fix.

```text
apps/backend/package.json
apps/backend/src/api/auth/auth.module.ts
apps/backend/src/api/auth/auth.service.ts
apps/backend/src/api/auth/google-auth.service.ts
apps/backend/src/api/boards/boards.module.ts
apps/backend/src/api/boards/boards.service.ts
apps/backend/src/api/boards/entities/board.entity.ts
apps/backend/src/api/workspaces/entities/workspace-invitation.entity.ts
apps/backend/src/api/workspaces/entities/workspace-member.entity.ts
apps/backend/src/api/workspaces/entities/workspace.entity.ts
apps/backend/src/api/workspaces/workspaces.module.ts
apps/backend/src/api/workspaces/workspaces.service.ts
apps/backend/src/database/migrations/1793145600000-WorkspaceFoundation.ts
apps/backend/src/database/migrations/1793145600001-LegacyBoardWorkspaces.ts
apps/backend/test/activities/activities.e2e-spec.ts
apps/backend/test/activities/activities.integration.mjs
apps/backend/test/auth/auth.service.spec.ts
apps/backend/test/auth/email-verification.integration.mjs
apps/backend/test/auth/google-auth.integration.mjs
apps/backend/test/auth/password-security.integration.mjs
apps/backend/test/board-members/board-members.e2e-spec.ts
apps/backend/test/boards/boards.e2e-spec.ts
apps/backend/test/boards/boards.integration.mjs
apps/backend/test/boards/boards.service.spec.ts
apps/backend/test/cards/cards.e2e-spec.ts
apps/backend/test/columns/columns.e2e-spec.ts
apps/backend/test/comments/comments.e2e-spec.ts
apps/backend/test/database/database-foundation.integration.mjs
apps/backend/test/realtime/realtime.integration.mjs
apps/backend/test/users/avatar.integration.mjs
apps/backend/test/users/user-preferences.e2e-spec.ts
apps/backend/test/users/user-preferences.integration.mjs
apps/backend/test/workspaces/workspaces.integration.mjs
apps/backend/test/workspaces/workspaces.service.spec.ts
docs/architecture/backend-architecture.md
docs/architecture/database-design.md
docs/deployment/production.md
docs/deployment/workspace-foundation.md
docs/tasks/README.md
docs/tasks/backend/workspace-data-foundation.md
packages/shared/src/index.ts
packages/shared/src/workspace.ts
packages/shared/test/workspace.test.mjs
```
