# Welcome Email & New User Onboarding

## Scope and implementation

Standalone improvement on `feat/welcome-email-onboarding`, based on the latest
`origin/main` when work began. This implements transactional welcome email and
email-based getting-started guidance. It adds no onboarding wizard, marketing
subscription, permission, demo content or Phase 2 backend feature.

The existing Personal Workspace provisioning from #110 runs inside both signup
transactions. Welcome eligibility is inserted **after** that provisioning in the
same transaction. The implemented frontend route `/workspaces` supports the
primary CTA; authentication redirects unauthenticated visitors through login.
The older overview/database prose about absent Workspace API/UI is historical;
the source checkout already includes Workspace routes and UI. This change does
not import code from ongoing feature branches.

## Email design and final copy

Subject: **Welcome to Kanvexa — Let's Get Started!**

The HTML uses the official versioned PNG and a separate text wordmark, a
`#615CF7` accent/CTA, a 600px fluid card, generous table-cell spacing, inline
fallback styles, Outlook conditional tables and explicit mobile/dark overrides.
All layout tables are presentational; the decorative logo has empty alt text
because the adjacent wordmark provides the identity. There are no web fonts,
tracking pixels, scripts or remote dependencies other than the public logo.
The copy and CTA remain usable with images blocked or media queries unsupported.

The plain-text alternative contains the same guidance and destinations:

```text
Welcome to Kanvexa!

We're excited to have you here. Bring your projects, tasks and teamwork together in one collaborative workspace.

Your Personal Workspace is ready. Start small and build a workflow that works for you:

1. Explore your Workspace — a home for your projects and Boards.
2. Create your first Board — give your next project a place to take shape.
3. Add tasks and keep work moving — organize cards into columns, one step at a time.

Explore Your Workspace: https://kanvexa.tech/workspaces

Thanks for joining us. We can't wait to see what you'll organize.
The Kanvexa Team

Kanvexa — Shared boards. Clear tasks. Real-time collaboration.
Visit Kanvexa: https://kanvexa.tech/
You're receiving this account email because you signed up for Kanvexa.
```

Destinations are generated from the existing validated `PUBLIC_APP_URL`, not
hardcoded to production. Template validation also rejects unsafe origins, paths,
credentials, queries and fragments; HTML attributes/fallback links are escaped.
The Personal Workspace claim is supported by atomic signup provisioning, without
claiming a pre-created Board or tasks.

## Lifecycle and durable delivery

- Email signup commits User + Personal Workspace/ADMIN + an unready welcome row.
  It sends only the existing verification email. Successful verification consumes
  the token and activates that row atomically; welcome dispatch follows commit.
- First Google signup with an authoritative email commits User + GoogleIdentity
  - Personal Workspace/ADMIN + a ready welcome row, then dispatches. A Google
    account requiring local verification remains unready until verification.
- Existing login, JWT authentication and identity linking do not enroll accounts
  or request a welcome. Duplicate verification retains the existing invalid-token
  response; it cannot create another delivery. The unique User primary key on
  `welcome_email_deliveries` also prevents duplicate eligibility.
- Migration `1793188800000-WelcomeEmailOutbox` creates an **empty** ledger.
  Existing verified and pending accounts are never enrolled, including when a
  pre-deployment pending account verifies later. There is no startup backfill.

The Nest-managed worker drains at startup and every 30 seconds, up to ten rows
per sweep, with immediate best-effort dispatch after eligible auth commits.
PostgreSQL `FOR UPDATE SKIP LOCKED` claims and a persisted 60-second lease
coordinate processes. The adapter aborts requests after ten seconds. No account
transaction or row lock spans a provider call; late completion writes are fenced
by a random lease token. Shutdown waits for active work and still closes database
connections if a dispatch failed.

The ledger freezes the rendered subject/HTML/text, sender and recipient when it
becomes ready. Every attempt uses `welcome/<userId>` and the frozen message,
including after restarts, profile edits or configuration/template changes. A
successful selected-adapter completion sets `sent_at`; in Resend mode the adapter
requires a successful response with a message ID. In Fake mode it means only an
in-memory capture, not a provider request. The timestamp alone is not proof of
Resend acceptance or inbox delivery. An interrupted/failed bookkeeping write
leaves recoverable state.

Failures use persisted exponential backoff (one minute to one hour). Ambiguous
timeouts can still deliver. [Resend retains idempotency keys for 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys),
so automatic attempts stop after 23 hours from the first claim and set
`stopped_at` for operator reconciliation. Pending mail that has never been
attempted can still send after a longer outage. This deliberately prefers a
possibly missed welcome over blindly resending after provider deduplication
expires. It does **not** promise exactly-once delivery, protection against arbitrary
process suspension beyond the provider window, or successful inbox delivery.

Provider/dispatch errors never escape to verification or Google login. Generic
warnings omit recipients, provider errors, credentials and message content.
Eligibility/readiness persistence remains part of the account transaction; a
database failure rolls that transaction back normally. Existing verification
email delivery semantics, including its recoverable registration error, remain
unchanged.

## Transport and local previews

No new dependencies, provider or environment variables. Welcome uses the same
validated `MAIL_TRANSPORT` as verification and recovery: development defaults to
Fake and explicitly setting `MAIL_TRANSPORT=resend` selects Resend. Production
requires Resend, and `NODE_ENV=test` always forces Fake even if Resend is requested.
Fake captures up to twenty messages in memory without network or logging.
Its short in-memory key cache assists tests; the PostgreSQL ledger is the durable
source of truth. Welcome mail ignores marketing/notification subscription state.

```powershell
pnpm --filter @kanban/backend preview:welcome-email
python -m http.server 8766 --bind 127.0.0.1 --directory .codex/previews/welcome-email
```

Open `http://127.0.0.1:8766/welcome-email.html`. Preview generation imports only
the compiled template: no app, `.env`, database, mail provider, real recipient or
token. It creates HTML, plain text, hidden-logo and long-origin fixtures in
ignored `.codex/previews/welcome-email/`. Only the normal/long preview logo URL is
rewritten to a copied local asset for offline QA; delivered markup uses the public
versioned logo. Stop the local server with Ctrl+C.

## Browser QA

Three representative Chrome screenshots were inspected after layout stabilized:

| Layout                           | Evidence                                                                                                 | Result                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1440 × 1200, light               | [Desktop](../../design/screens/implementation/welcome-email/desktop-light.png)                           | Centered card, clear hierarchy, logo loaded, full-width CTA     |
| 375 × 1000, light                | [Mobile](../../design/screens/implementation/welcome-email/mobile-light.png)                             | Readable wrapping and spacing, 58px CTA, no horizontal overflow |
| 375 × 1000, dark, artwork hidden | [Mobile dark/fallback](../../design/screens/implementation/welcome-email/mobile-dark-images-blocked.png) | Readable text/links, text wordmark and CTA remain usable        |

DOM checks also verified a long origin at 320px without horizontal overflow,
correct CTA/footer destinations, and no console warnings/errors. The offline
preview HTML and local PNG loaded successfully. Browser rendering does not prove
Gmail/Outlook/Apple Mail rendering or client-forced color inversion; no real email
or live provider request was used for QA.

## Initial implementation verification

Integration suites used disposable Docker PostgreSQL on loopback, Fake mail and
synthetic Google profiles; production/development databases were not test targets.

| Command/check                                                    | Final result                                                                                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                      | **PASS**                                                                                                                     |
| `pnpm test`                                                      | **PASS**: 60 backend suites / 590 tests; 93 frontend files / 855 tests; 7 shared tests                                       |
| `pnpm build`                                                     | **PASS**: shared, backend and frontend                                                                                       |
| `pnpm --filter @kanban/backend test:welcome-email:database`      | **PASS**: 12 PostgreSQL/HTTP lifecycle, concurrency, rollback, schema and recovery checks                                    |
| `pnpm --filter @kanban/backend test:email-verification:database` | **PASS**: 16 checks, including existing database foundation, migration discovery/metadata, REST and Socket.IO authentication |
| `pnpm --filter @kanban/backend test:google-auth:database`        | **PASS**: 14 checks                                                                                                          |
| `pnpm --filter @kanban/backend test:workspaces:database`         | **PASS**: 18 checks; explicit `WORKSPACE_DATABASE_TESTS=local-only` on a task-owned disposable Docker server                 |
| `pnpm --filter @kanban/backend preview:welcome-email`            | **PASS**: offline synthetic preview generation                                                                               |
| Chrome desktop/mobile/dark/fallback and 320px long-URL QA        | **PASS**; three screenshots above                                                                                            |
| `pnpm format:check`                                              | **FAIL, pre-existing checkout line endings**: 662 untouched files use CRLF where configuration requires LF                   |
| `pnpm exec prettier --check` with every changed text path        | **PASS**                                                                                                                     |
| `pnpm exec prettier --check . --end-of-line auto`                | **PASS**, confirming the repository-wide difference is line endings                                                          |
| `git diff --check` and task-record link/path checks              | **PASS**                                                                                                                     |
| Live Resend, OAuth, actual mail-client delivery and deployment   | **NOT RUN**, intentionally excluded                                                                                          |

The untouched `README.md` demonstrates the formatting baseline: it has CRLF with
no Git diff. Unrelated files were not normalized. Existing Vite warnings about
`NODE_ENV` in local `.env` and a bundle over 500 kB remain; builds succeed. The
PostgreSQL schema inspection also emits a `pg` concurrent-query deprecation
warning. Expected synthetic provider/realtime/rollback failures are exercised by
tests; there are no remaining failing application tests. Test harnesses were
updated for the new auth dependency and migration inventory without weakening
existing authorization or Workspace assertions.

Changes are limited to backend auth/mail, one additive migration/entity,
focused unit/HTTP/PostgreSQL coverage, preview tooling/screenshots and these
documentation/index/schema notes. No frontend application code, shared contracts,
dependencies or environment files changed. Work is local; no push, PR, merge,
deployment or real email was performed.

## Deployment and reconciliation

### Development transport correction

Runtime investigation found a Welcome-only dependency-injection override in
`MailModule`: `NODE_ENV !== production` selected Fake despite validated
`MAIL_TRANSPORT=resend`. Verification/recovery honored the transport, explaining
why verification appeared in Resend while Welcome did not. Fake's resolved
`send()` was accepted by the outbox dispatcher and populated `sent_at` without a
Resend request or provider response. The override has been removed; tests cover
the real Nest binding through mocked Resend acceptance/failure and the outbox
completion write.

Existing completed rows are preserved. Older rows do not store transport or
provider receipt metadata, so do not infer their delivery history from `sent_at`
alone or bulk-clear it. Review affected rows against runtime/provider evidence
before any separately authorized reconciliation. Changing transport does not
automatically replay completed messages, reset retry windows, or re-enroll users.
This correction requires no schema migration or data rewrite. The local backend
was stopped before editing to prevent its watcher from dispatching real mail.
No live provider send is part of verification.

Offline diagnostics loaded the actual local `.env` through the existing validator
without bootstrapping the app or its worker. It resolved to development + Resend,
with no shell overrides for either setting. Before correction, both source and
compiled DI resolved Welcome to Fake and verification to Resend. After correction,
both resolve to Resend; diagnostics made zero provider network calls. A read-only
fingerprint of the local ledger confirmed its single completed row remained
unchanged. No environment file, schema or existing account/delivery data was
rewritten, and the backend remains stopped to avoid live dispatch during review.

Regression coverage now includes validated transport parity for all three mail
types, tests remaining Fake when Resend is requested, and the actual Nest Welcome
binding through mocked SDK success, rejection, missing-ID and timeout responses.
The PostgreSQL suite additionally intercepts HTTP beneath the real SDK and proves
provider acceptance/rejection bookkeeping and preservation of completed rows when
transport changes. Synthetic credentials and disposable databases are used.

Correction verification: **57 focused tests PASS**, **14 welcome PostgreSQL/HTTP
checks PASS**, `pnpm test` **PASS** (594 backend, 855 frontend, 7 shared tests),
`pnpm lint` **PASS**, and `pnpm build` **PASS**. Changed-file Prettier, task-record
links and `git diff --check` pass. Canonical `pnpm format:check` still reports
the same 662 untouched CRLF files. The first full-suite attempt overlapped a
shared-package rebuild and hit transient missing-output errors; the final run
after builds completed passed all suites. No live send, migration, reconciliation,
push, merge or deployment was performed for this correction.

### Single-row claims (PR #124)

The P2 review finding was valid: TypeORM `getOne()` does not add SQL `LIMIT 1`.
The claim now explicitly uses `.limit(1)` while retaining the existing eligibility
filters, ordering and `FOR UPDATE SKIP LOCKED`. Each claim transaction reads and
locks only the next available delivery rather than the full eligible backlog.

The PostgreSQL regression creates three pending deliveries and holds the first
claim open before its lease update commits. A second worker must skip that locked
row and deliver the other two; after release, all three complete with one attempt
each. The test also captures executed claim SQL and checks for
`LIMIT 1 FOR UPDATE SKIP LOCKED`. It failed without the limit because the held
claim locked all three rows, and passes with the fix. The complete Welcome suite
now passes 15 PostgreSQL/HTTP checks using only disposable databases and fake or
mocked mail. This change requires no schema migration or existing-data rewrite.
For this fix, `pnpm lint`, `pnpm test` (594 backend, 855 frontend, 7 shared),
`pnpm build`, changed-file Prettier and `git diff --check` pass. Repository-wide
`pnpm format:check` retains the existing failure on 662 untouched CRLF files.

### Rollout

1. Back up the database and explicitly apply the new migration before starting
   this application version. Automatic startup migrations remain disabled.
   The additive schema permits old binaries to run, but old-binary signups do not
   enroll; there is intentionally no retroactive sweep during a rolling rollout.
2. Reuse verified `MAIL_FROM`, `RESEND_API_KEY`, `MAIL_TRANSPORT` and HTTPS
   `PUBLIC_APP_URL`. Confirm `/workspaces` and the versioned public logo are
   available on the deployed frontend. No live delivery/deployment is verified
   by this task.
3. Monitor generic welcome warnings and inspect operational state without printing
   the stored recipient/body:

   ```sql
   SELECT user_id, ready_at, attempts, first_attempt_at, next_attempt_at,
          lease_until, sent_at, stopped_at
   FROM welcome_email_deliveries
   WHERE sent_at IS NULL
   ORDER BY next_attempt_at;
   ```

4. Investigate `stopped_at` rows against provider evidence before any manual
   reconciliation. Never clear a sent flag, rotate its key or replay outside the
   provider window blindly. Keep the ledger in backups and protect stored mail
   payloads with the same database access controls as account data.
5. Migration down refuses any populated ledger, including pending eligibility.
   Preserve history and roll forward; application rollback can leave the additive
   table in place. Do not drop/recreate populated history to force a rollback.
