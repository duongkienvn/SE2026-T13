# P2-POL-04 — Board Member added email

Local implementation and verification for
[#149](https://github.com/duongkienvn/SE2026-T13/issues/149), 2026-10-31.
This record describes source behavior and local fake-transport QA, not a deploy
or inbox-delivery verification.

## Scope and compatibility

The issue's ENH-P01 notification and mandatory ENH-P02 failure isolation extend
[Board membership](board-members-management.md) under
[BD-02](../../roadmap/post-mvp.md) and the approved
[Board/Workspace access model](../../design/product-ux-blueprint.md#3-workspace-domain-and-migration-decisions).
The roadmap does not itself enumerate ENH-P01/ENH-P02; the issue supplies these
acceptance conditions. Historical architecture documents describe earlier
Workspace foundations; current authorization/services already enforce
PRIVATE/WORKSPACE_VISIBLE and Guest access.

Only an existing user directly added by a mutable Board OWNER qualifies. The
current API creates MEMBER rows; subsequent role changes, including promotion
to OWNER, do not notify. Existing routes, payloads, public response DTOs, conflict
statuses, policy checks, activity and realtime events remain compatible. Board
Guests gain no Workspace membership or protected Workspace access. Workspace
ADMIN alone does not confer Board OWNER authority.

The frontend already reports that the member was added, without promising mail
delivery. No frontend files or #136/#137 UI were changed. There are no new
tokens, acceptance endpoints, roles, configuration variables, dependencies,
migrations, queues, outboxes, preferences or production changes.

## Commit boundary and failure isolation

1. `BoardMembersService.add` retains the existing Board row lock, OWNER/archive
   authorization, Workspace policy check, normalized account lookup, duplicate
   conflict, membership insertion and activity record in one transaction.
2. The transaction returns a public member DTO and an internal notification
   snapshot: committed membership ID, Board ID/name, actual recipient and display
   names resolved from backend User records. The snapshot is never returned in
   the REST response or broadcast.
3. Only after TypeORM resolves the transaction (including commit), the existing
   `BoardEventPublisher` publishes `member:added`. The notification service then
   checks that the same membership ID still exists and calls the mail adapter.
   No email IO runs in a transaction or the Board coordinator queue.
4. `BoardMemberAddedNotificationService` awaits dispatch with a ten-second total
   deadline covering its membership recheck and mail send. Deadline expiry aborts
   the adapter. `Promise.race` also bounds an adapter/read ignoring cancellation,
   observes late rejection and prevents a late read from starting a send. All
   notification exceptions/outcomes are isolated; HTTP 201 still returns the
   committed membership. Nothing compensates by deleting membership.

Logs contain only a fixed notification label and FAILED/UNKNOWN category, never
recipient, Board/actor data, raw provider errors, URLs or credentials. The Resend
adapter uses the invitation adapter's per-client SDK error-logging suppression;
the real-SDK fetch-interception test guards this version-specific privacy seam.

## Delivery and duplicate guarantees

This is bounded **best-effort** delivery in the request process. It is not durable
and has no automatic retries. A process crash after commit can lose notification;
timeout/network failure may mean the provider accepted mail but its response was
lost. SENT requires an acceptance ID and does not prove inbox arrival. Definite
4xx rejection maps to FAILED; 408/409, 5xx, malformed responses, network failure
and timeout map to UNKNOWN. Rendering/configuration failure before IO is FAILED.

The Board row lock and existing `(board_id,user_id)` unique constraint serialize
duplicate additions. Only the successful insertion reaches dispatch; duplicate
requests, including retries after an uncertain HTTP response, retain HTTP 409
and send nothing. The adapter uses `board-member-added/<membershipId>` as the
provider idempotency key. No claim of permanent provider deduplication is made.
A genuine remove → re-add creates a new membership ID and a distinct notification
attempt. The fake adapter retains at most 20 process-local rendered messages and
deduplicates only retained keys; it never sends or exposes a debug endpoint.

Removal observed by the post-commit recheck suppresses mail, including an old
membership replaced by a re-add. Removal after that check, process termination
and already-accepted provider mail cannot be atomically fenced without additional
durable coordination. Email may arrive after revocation; the Board URL always
uses current server authorization and safely denies a revoked Guest. No network
request holds a database lock to attempt a stronger guarantee.

## Content and configuration

`MailModule` selects the new Board mail port using the existing validated
MAIL_TRANSPORT, MAIL_FROM, RESEND_API_KEY and PUBLIC_APP_URL conventions. Test
environments force fake transport. Missing/unsafe production mail configuration
continues to fail startup; the pure renderer additionally rejects unsafe origins
and invalid Board IDs before provider IO.

The HTML follows the existing Kanvexa invitation email layout, logo, colors,
mobile and dark-mode rules, with a plain-text alternative. It includes the Board
name, actor, neutral greeting fallback and **Open Board** link to
`<PUBLIC_APP_URL>/boards/<boardId>`. There is no token, recipient, Workspace ID,
roster or Workspace link in that destination. Existing protected-route/login
redirect handling is unchanged. Names are normalized, stripped of control/bidi
characters, bounded to 200 Unicode code points and escaped in HTML. The subject
is static. Long text wraps rather than expanding the layout.

## Local verification

All database checks use disposable local Docker PostgreSQL 16 containers and
fake mail or mocked SDK/fetch. The Board Membership runner now owns its local
container rather than loading an application's `.env`; it runs migrations only
there and removes the container in `finally`.

- `pnpm --filter @kanban/shared build`: PASS, consumer prerequisite.
- Focused backend membership/email Jest run: PASS, 4 suites / 61 tests.
- `pnpm --filter @kanban/backend test:board-members:database`: PASS. A separate
  PostgreSQL connection observes committed membership AND activity inside the
  adapter. Covers one send, correct recipient/actor/content/link, actual rollback
  after insertion, unauthorized/invalid/duplicate/no-op additions, network failure,
  real ten-second abort with HTTP 201, concurrent 201/409 uniqueness, remove/re-add,
  revocation before dispatch, Guest Workspace isolation, visibility, archive/move
  and subsequent link denial. Existing membership/assignment cleanup cases pass.
- `pnpm --filter @kanban/backend test:workspace-invitations:database`: PASS.
  Existing invitation create/accept/decline/revoke, mail, migration, privacy and
  race checks pass. The expected duplicate-open-invitation migration rejection
  is a negative test, not a failed suite. Existing pg concurrent-query deprecation
  output is outside this change.
- Browser QA using Chrome DevTools: PASS at desktop 1000px dark and mobile 375px
  light. Normal and malicious/long Unicode fixtures have no horizontal overflow,
  clipping or script nodes; branding loads, Open Board points to the configured
  route, and console/network checks show no errors. This is browser rendering QA,
  not Outlook/Gmail inbox-client certification.

- `pnpm --filter @kanban/backend test:unit`: PASS, 54 suites / 612 tests.
  The initial run found the existing transport binding test's four-client
  expectation; it now verifies the fifth Board mail adapter in development,
  test and production configuration, with all delivery mocked. Full rerun passes.
- `pnpm --filter @kanban/backend test:e2e`: PASS, 18 suites / 137 tests,
  including membership, realtime delivery failures, presence and auth flows.
  Expected injected realtime error logs do not represent failed tests.
- `pnpm exec eslint apps/backend/src apps/backend/test apps/backend/scripts`:
  PASS (backend scope; no backend lint script exists).
- `pnpm --filter @kanban/backend exec tsc --noEmit`: PASS.
- `pnpm --filter @kanban/backend build`: PASS, including both database runners'
  prerequisite builds.
- Changed-file `pnpm exec prettier --check <changed files>`: PASS.
- `pnpm format:check`: FAIL on 834 unchanged files. The checkout uses CRLF while
  the existing Prettier configuration expects LF; sampled flagged files
  (`AGENTS.md`, `.prettierrc.json`, Board authorization) match HEAD after Git's
  line-ending normalization. No unrelated files were reformatted.
- Task/index relative-link checks and `git diff --check`: PASS.

The root monorepo test suite was not run, as requested. Production resources,
real mail and email-client inbox rendering were not exercised. No remaining
implementation blocker was identified; best-effort delivery, cancellation races
and the pre-existing repository formatting failure remain the stated limitations.
