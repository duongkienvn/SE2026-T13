# P2-03 — Workspace members, roles and secure invitations

Backend slice of WS-01/WS-02 in the [roadmap](../../roadmap/post-mvp.md), using
the [access model](../../design/product-ux-blueprint.md#3-workspace-domain-and-migration-decisions) and
[Workspace UX spec](../../design/post-mvp/workspace/ux-spec.md). Builds on
[P2-01](workspace-data-foundation.md) and [P2-02](workspace-core-api.md).
This record describes source behavior, not a production rollout.

## Scope and policy

- Workspace roles remain ADMIN/MEMBER, separate from Board OWNER/MEMBER.
- Only an authenticated Workspace ADMIN manages Team membership/invitations.
  Membership reads require Workspace membership. Board Guests receive safe 404.
- Invitations create MEMBER grants only. ADMIN invitations are rejected with 400;
  an ADMIN may promote a joined member through the member endpoint.
- Self-demotion and self-removal through admin endpoints return 409. Use leave
  when another ADMIN remains, or ask another ADMIN to change your role.
- Personal Workspace membership cannot be changed through these mutations.
- All member/invitation mutations lock the Workspace row first. Last-admin
  counts and writes occur in one PostgreSQL transaction, including accept,
  remove, revoke and leave. Unique membership and open-email indexes provide
  additional database integrity. Direct SQL writers must use this same lock
  protocol; the API does not protect against privileged out-of-band SQL edits.
- No Board permission, role, entity, user account, content or explicit Board
  membership is deleted by Workspace removal/leave. Removal also revokes open
  invitations addressed to the removed member or issued by that member.
- Existing member acceptance consumes the invitation without changing their
  role, so a MEMBER invitation cannot demote an existing ADMIN.

## HTTP contract

All routes have the `/api` prefix, existing JWT/session-version guards,
validation rejecting unknown properties, and standard success/error envelopes.
List pagination adds the usual `meta` (including authorized total). Read and
body-bearing mutation responses use `Cache-Control: no-store`. A 204 has no body.

| Method / route                                              | Actor / request                                                                                    | Success                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| GET `/workspaces/:workspaceId/members`                      | Joined member; `page`, `limit`, optional literal `search` on display name and `role=ADMIN\|MEMBER` | 200, paginated members                                        |
| PATCH `/workspaces/:workspaceId/members/:userId`            | Team ADMIN; `{ "role": "ADMIN" }` or MEMBER                                                        | 200, member                                                   |
| DELETE `/workspaces/:workspaceId/members/:userId`           | Team ADMIN, another user                                                                           | 204; already absent target is also 204                        |
| POST `/workspaces/:workspaceId/leave`                       | Current user only; no other actor ID                                                               | 204; already absent membership/Workspace is also 204          |
| POST `/workspaces/:workspaceId/invitations`                 | Team ADMIN; `{ "email": "target@example.com", "role": "MEMBER" }`; role defaults to MEMBER         | 202, invitation with truthful `sendState`                     |
| GET `/workspaces/:workspaceId/invitations`                  | ADMIN; `page`, `limit`, optional `status=PENDING\|ACCEPTED\|EXPIRED\|REVOKED`                      | 200, paginated invitation history                             |
| DELETE `/workspaces/:workspaceId/invitations/:invitationId` | Team ADMIN                                                                                         | 204, including repeated revoke; accepted invitation gives 409 |
| POST `/workspace-invitations/accept`                        | Verified authenticated recipient; `{ "proof": "<43 base64url characters>" }`                       | 200, member; subsequent replay gives 410                      |

`page` defaults to 1, maximum 1,000,000; `limit` defaults to 20, maximum 100.
Member search is trimmed, at most 120 characters, parameterized and escapes
PostgreSQL LIKE wildcards. No cross-Workspace search is exposed.

Member DTO: `userId`, `displayName`, `avatarUrl`, `avatarRevision`, `role`,
`joinedAt`. It contains no email, credential, auth version or Board grants.
Private avatar descriptors follow the existing user avatar route and its ACL.

Invitation DTO (ADMIN-authorized): `id`, `workspaceId`, normalized `email`,
`role`, `status`, `sendState`, `invitedById`, `expiresAt`, `createdAt`,
`updatedAt`, nullable `consumedAt`/`revokedAt`. No proof, URL or hash is exposed.
Terminal status takes precedence over computed expiry; no expiry scheduler
is needed to enforce TTL.

| Error status | Meaning / recovery                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 400          | Invalid input, extra fields, unsupported role, malformed bounded proof/pagination                                                |
| 401          | Missing, expired, invalidated JWT, or unverified account rejected by existing auth guard                                         |
| 403          | Joined MEMBER attempting ADMIN action; Personal mutation; service also rechecks verified email                                   |
| 404          | Unknown/unjoined Workspace, missing target member/invitation; Guests cannot infer metadata                                       |
| 409          | Self-demotion/removal, last-admin exit, revoke after acceptance, or delivery not confirmed                                       |
| 410          | `INVALID_WORKSPACE_INVITATION`: unknown, tampered, expired, revoked, consumed or wrong-account invitation; same generic response |
| 429          | Existing HTTP limiter, acceptance 20/minute/IP, cooldown or durable invitation quota                                             |

Creation never looks up the target account. Registered users, unknown emails
and existing members receive the same response shape/status and delivery
policy. Only ADMIN can see the address they invited. Acceptance gives a generic
410 without returning target email, Workspace name, members or Board details.

## Proof and concurrency

Proof is 32 cryptographically random bytes encoded as base64url, expires after
seven days and is stored only as SHA-256 hex (`select: false`). It is never a
JWT/auth credential. Accept locks the Workspace, re-reads invitation state,
locks and checks the current User's verified normalized email, inserts at most
one membership and conditionally consumes proof using PostgreSQL wall-clock
expiry in the same transaction. Failure rolls membership insertion back.
One of concurrent accept/revoke operations wins; a stale request cannot revive
the proof. Merely viewing a link creates no membership.

Repeat POST is the reinvite/resend request: after cooldown it revokes any prior
open proof and creates a fresh invitation ID/proof. History remains available.
There is at most one unconsumed/unrevoked row per Workspace/email (expired rows
are revoked when replaced). A consumed row never becomes pending again.

Durable rolling-hour limits include revoked/failed/unavailable attempts:
30 per inviter across Workspaces, 100 per Workspace, 5 per normalized recipient
across Workspaces. PostgreSQL transaction advisory locks for actor/recipient,
then Workspace row locks, serialize quota checks across instances. The same
Workspace/email has a 60-second cooldown. Active dispatch blocks replacement
for five minutes; after that a crashed/stuck attempt may be replaced with a
fresh proof. Lock collisions cause extra serialization, not privilege changes.

## Typed mail handoff to P2-10

`WorkspaceInvitationMailer` is the sole typed port. The original P2-03 slice
left it unwired. [P2-10](workspace-invitation-email-delivery.md) now registers
Fake/Resend through `MailModule`, visible to `WorkspaceApiModule`, behind an
explicit acceptance-destination rollout gate. No table changes are needed.
Existing verification/recovery mail is unchanged. Gate-off still means
UNAVAILABLE; fake-mode SENT is a local simulation, not live delivery.

`send(payload)` receives only in process: `invitationId`, `workspaceId`,
`workspaceName` (snapshot at issuance), `recipient`, `role`, ephemeral `proof`,
`expiresAt`, and `idempotencyKey=workspace-invitation/<invitationId>`. It returns
`SENT | FAILED | UNKNOWN`; SENT means provider accepted this attempt, never an
inbox/deliverability guarantee. Adapter errors must not contain logged payloads.
The domain catches transport errors without logging them and records UNKNOWN.

| State       | Transition / acceptance                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| UNAVAILABLE | No adapter wired. Request is stored, proof discarded, no send is claimed. Reinvite after cooldown once P2-10 is available.        |
| DISPATCHING | Reservation committed before calling adapter outside any transaction; proof only in memory. Acceptance gives 409 until confirmed. |
| SENT        | Adapter explicitly confirmed provider acceptance. Only this state permits consumption.                                            |
| FAILED      | Adapter confirms no accepted send. No same-proof retry; reinvite rotates proof.                                                   |
| UNKNOWN     | Transport throws, times out after 30 seconds, or outcome is uncertain. No same-proof retry; reinvite rotates proof.               |

Completion updates only the same still-open, unexpired DISPATCHING row; revoke,
removal and rotation win over late completion. A process crash can leave
DISPATCHING; lease expiry permits rotation without persisting raw proof.
The transport must bound its own I/O and use the provided idempotency key for
any internal retry. Domain timeout does not cancel an already accepted email;
late email can contain only an expired/revoked/otherwise unusable old proof.
No DB lock is held across a mail network call. No production no-op sender
returns success. P2-10 owns URL construction, Resend, templates, credentials,
dispatch/deliverability tests, and the decision to register the real adapter.
Human agreement with the P2-10 owner is still required before final handoff;
this task does not message teammates or claim their approval.
The user chose to keep the current contract as a proposal and forward it to
P2-10 for confirmation. This is approval to retain the proposal, not a claim
that the P2-10 owner has agreed.

## Migration and integration boundaries

`WorkspaceInvitationLifecycle1793232000000` adds `send_state`, its CHECK, an
hourly-count index, and a partial unique open-email index. Existing rows get
UNAVAILABLE; no historical delivery is invented and no row/proof is deleted
or revoked by migration. Duplicate open rows cause an atomic failure requiring
explicit operator remediation; migration never chooses a survivor. Up/down/up
preserves proof/terminal history. Down removes send-state metadata, so pause
writers, back up, and prefer roll-forward once dispatch is enabled. Do not
roll application code back while new invitation writers remain active.

P2-08/P2-09 may consume these routes and permissions. Guests tab is deferred:
do not infer guest counts/identities by querying PRIVATE Boards the actor cannot
read, and do not display fabricated guest rows. No Guests endpoint is added by P2-03.
The later [P2-C01 Guests Directory API](workspace-guests-directory-api.md) supplies
the ACL-limited read contract and local verification evidence for Issue #135.
Signed-out return intent and account-switch UI belong to P2-08; keep proof in
ephemeral browser state/URL fragment, exclude it from logs/analytics and send it
only in the authenticated accept body. P2-10 owns the actual public link format.
Recipient decline was deferred by P2-03. The later
[P2-C03 decline lifecycle](workspace-invitation-decline.md) adds the explicit
recipient endpoint, DECLINED status/declinedAt history contract and safe migration
for #136; ADMIN revoke and TTL remain available.

P2-04 must add workspace-derived Board authorization and invalidation/Socket.IO
eviction at the existing Board coordination boundary before enabling
WORKSPACE_VISIBLE. Today Board access is explicit, so removal preserves those
valid rooms/grants; future derived-only grants must be evicted after commit,
with no broadcast inside the Workspace transaction. Clients must invalidate
Workspace member/invitation/overview caches after commands and clear protected
Workspace state on 403/404, logout or session change; no frontend changes here.

Workspace audit events are deferred: existing Activity requires a Board FK and
Board-scoped readership. Recording Workspace invitations there would leak
private Board context. No generic notification/audit infrastructure is added.

## Verification

The dedicated command `pnpm --filter @kanban/backend test:workspace-members:database`
builds backend and owns a disposable PostgreSQL Docker container with random
credentials, loopback-only port, migrations and cleanup. It never reads app DB
credentials or sends real mail. Use
`pnpm --filter @kanban/backend test:workspace-members:database --regressions`
to run the selected existing PostgreSQL suites on disposable databases/containers.

Coverage includes REST contracts and allowlists; roles/Personal/Guests/private
Boards; last-admin demote/remove/leave races; proof hash/TTL/replay/wrong email;
verified local/Google/unverified/expired and invalidated sessions; duplicate
creation, accept/revoke, rotation and late dispatch; durable quotas;
unavailable/failed/uncertain sends; migration duplicate preflight, preservation,
up/down/up and metadata drift. Jest additionally checks bounded validation and
uses controlled time for mail timeout/late success.

Initial implementation verification snapshot: 2026-10-28, checkout `main`, 27 changed/new files,
all unstaged; no branch, commit, push, PR, production migration or deployment.

| Command / check                                                                   | Result                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                                       | PASS                                                                                                                                                                                                                  |
| `pnpm test`                                                                       | PASS: backend 60 suites / 601 tests; frontend 93 files / 855 tests; shared 7 tests                                                                                                                                    |
| `pnpm build`                                                                      | PASS: shared, backend and frontend                                                                                                                                                                                    |
| `pnpm --filter @kanban/backend test:workspace-members:database --regressions`     | PASS: P2-03 plus 13 existing PostgreSQL suites (Workspace foundation/core, database foundation, Boards, Board Members, Cards, Columns, Comments, Activities, email verification, Google auth, realtime, Board events) |
| `node test/workspaces/workspace-members-invitations.integration.mjs` from backend | PASS after adding real AppModule/unwired-mail HTTP verification; no successful default/no-op sender                                                                                                                   |
| `pnpm --filter @kanban/backend test:password-security:database`                   | PASS: 16 PostgreSQL/REST/Socket.IO security checks                                                                                                                                                                    |
| `pnpm format:check`                                                               | FAIL: 489 untouched files already differ from formatter output; left outside scope                                                                                                                                    |
| Prettier `--check` on changed/new files                                           | PASS                                                                                                                                                                                                                  |
| Local Markdown link/path checks for this task record                              | PASS                                                                                                                                                                                                                  |
| `git diff --check`                                                                | PASS                                                                                                                                                                                                                  |

Initial new-test harness issues (SQL parameter inference, Jest's existing
Nest-TypeORM ESM mock convention and pnpm context for the auth regression)
were corrected and the affected checks rerun successfully. A shared build
overlapped an early targeted Jest run; the final full test run avoided shared
output rebuilds while tests read it.

Environment: Node 22.12.0/pnpm 10.18.3. The repository requires Node >=22.13.0,
so commands report an engine warning; no runtime or dependency changes were made.
Existing Nest-TypeORM ESM/pg deprecation warnings and the frontend bundle-size
warning remain. Mail/Google providers were fake/mocked. CI, production,
deliverability and frontend visual QA were not run; no UI code changed.
Dedicated P2-03 containers were verified removed after the checks.

### Follow-up after requirement review

The user authorized continuing the missing tests while keeping the mail/DTO
contract proposed pending P2-10 confirmation. No production application code,
DTO, schema, permission or mail policy changed in this follow-up.

- Cross-Workspace actor and recipient quotas now have actual concurrent
  last-allowance contenders through independent DataSource pools. Tests observe
  the real PostgreSQL advisory-lock wait and prove exactly one request wins.
- Dispatch lease tests attempt reinvite after two minutes without revoke
  (429), then after six minutes (new proof), complete the original send late,
  and prove old-proof rejection and replacement-proof acceptance for the same
  verified recipient.
- Accept versus removal tests observe real row-lock waiters in both acquisition
  orders, verify final membership absence/terminal invitation state, and read
  the separately granted Board successfully afterward.
- Last-admin races now assert exact losing 403/404/409 statuses and error codes,
  so an unexpected 500 cannot pass.
- A fresh real AppModule proves acceptance requests 1–20 reach generic invalid
  invitation handling, and request 21 returns 429/TOO_MANY_REQUESTS.

Follow-up checks: `pnpm lint` PASS;
`pnpm --filter @kanban/backend test:workspace-members:database` PASS, including
backend build, all original domain scenarios and the strengthened cases.
Focused DTO/dispatch Jest also PASS (2 suites / 9 tests); formatting of all
changed files and `git diff --check` PASS. A fresh reviewer accepted the
test-strengthening delta after fixing lease-test teardown: reservation errors
now propagate, and failed assertions restore the sender and drain in-flight
dispatch. Injected reservation/assertion failure probes PASS, followed by a
successful full dedicated PostgreSQL rerun. Production files remain unchanged
from the reviewed implementation snapshot.
Current scope is 29 modified/new files. Full application/regression results
above are earlier evidence for unchanged production code, not rerun claims for
this test-only follow-up. Contract owner agreement remains outstanding.

## Changed files

- `apps/backend/src/api/workspaces/`: member controller/service, invitation
  management/acceptance controller/service, issuance service, typed mail port,
  Workspace lock/Team guard helper, member/invitation DTOs, invitation entity,
  and `workspace-api.module.ts` registration.
- `apps/backend/src/database/migrations/1793232000000-WorkspaceInvitationLifecycle.ts`:
  additive state/index migration with duplicate preflight and safe failure.
- `apps/backend/src/common/dto/api-error.ts` and
  `apps/backend/src/decorators/swagger-response.decorators.ts`: named invitation
  error and 202 success documentation support.
- `apps/backend/test/workspaces/`: validation/dispatch Jest tests, isolated
  PostgreSQL runner, member/invitation lifecycle, concurrency and migration
  checks, plus cross-Workspace quota and lease/removal boundary tests; existing
  foundation migration fixtures updated for the added migration.
- `apps/backend/test/database/database-foundation.integration.mjs`: migration
  discovery/count and rollback fixture updates.
- `apps/backend/package.json`: dedicated PostgreSQL test command.
- `docs/architecture/database-design.md`, `docs/tasks/README.md` and this record:
  persistence contract, task index, frontend/mail/security handoff and evidence.
