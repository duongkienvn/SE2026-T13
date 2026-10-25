# K2 — Email verification (Issue #72)

Scope: [Issue #72](https://github.com/duongkienvn/SE2026-T13/issues/72).
Resend's HTTPS API replaces the original SMTP proposal. No SMTP
transport, queue, Redis, refresh tokens, password reset, OAuth or
membership changes are introduced. Implementation follows the inspected
source on `main` (`92d7aa9`); older overview documents still describe
skeleton/planned features and are not current auth API contracts. The
existing REST envelopes, Argon2id, JWT issuer/audience/one-hour expiry
and AuthProvider session generation guards remain in place.

## API contracts

| Method/path                          | Result                                                                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/register`            | Existing `{email,password,displayName}` body. `201` public User envelope after provider acceptance; no JWT. Account is initially unverified.                                       |
| `POST /api/auth/verify-email`        | `{token}` body, `204` on success; no JWT or automatic login.                                                                                                                       |
| `POST /api/auth/resend-verification` | `{email}` body, `202` standard envelope with `data: null` and the same conditional message for unknown, verified, cooldown, quota and provider-failure cases.                      |
| `POST /api/auth/login`               | Existing login response only for verified users. Correct password + unverified account: `403 EMAIL_NOT_VERIFIED`. Wrong password/unknown email: generic `401 INVALID_CREDENTIALS`. |

Malformed verification bodies return `400 VALIDATION_FAILED`. Unknown,
expired, consumed or superseded tokens share `400
INVALID_VERIFICATION_TOKEN`. Verification credentials cannot
authenticate as REST bearer tokens or Socket.IO access tokens.
`authenticateAccessToken()` re-reads User verification status from
PostgreSQL; even a correctly signed JWT for an unverified user receives
`401 UNAUTHORIZED`. Socket.IO handshake and reconnect reuse this gate
through RealtimeAuthService.

Registration delivery failure returns `503 MAIL_DELIVERY_UNAVAILABLE`
after the account was saved. The UI opens Check Email with a recovery
explanation; retry via resend, not duplicate registration. Duplicate
account registration still returns the existing `409
EMAIL_ALREADY_EXISTS`. Resend intentionally does not report a provider
failure through an account-dependent status, which would enumerate
pending users. Its acknowledgement promises neither sending nor inbox
delivery.

## Persistence and transaction protocol

Migration `EmailVerification1792843200000` adds nullable
`users.email_verified_at TIMESTAMPTZ`, backfills **all users present
during the migration**, and creates `email_verification_tokens`. New
rows have no verification default. The initial migration is unchanged;
existing users, passwords, boards, cards and JWTs are preserved. Schema
synchronization and automatic migrations remain disabled.

The token table has a UUID primary key, unique User FK with cascade
deletion, unique 64-character SHA-256 `token_hash`,
issuance/expiry/consumption/acceptance timestamps, a rate-window
timestamp and attempt counter. There is one current row per User, so
retention is bounded and a unique constraint enforces one current token.
Rotation replaces its hash and resets consumption/acceptance. Prior
hashes are no longer addressable. No plaintext token or full
verification URL is stored in PostgreSQL.

1. Generate 32 cryptographically random bytes with
   `crypto.randomBytes()` and encode as 43-character base64url. Store
   only SHA-256; expiry is 24 hours.
2. Both issuance/rotation and verification acquire a pessimistic write
   lock on **User first**, then read current token state in the same
   transaction. Verify may discover the owner by hash beforehand, but
   rechecks the hash, expiry, consumption and verified status after
   acquiring the lock.
3. Verify saves `emailVerifiedAt` and `consumedAt` atomically.
   Concurrent verify succeeds once. A racing resend either rotates
   before verify (old link fails) or observes the verified account and
   does not send.
4. Commit issuance before calling mail. No provider call holds a
   transaction or row lock. Only the current matching hash receives
   `sentAt` after acceptance; an old response cannot mark a replacement
   token accepted.

Server-side throttles: registration 5/IP/5 minutes, login 10/IP/minute,
verification 10/IP/minute, resend 5/IP/5 minutes. IP limits retain the
existing per-process Throttler implementation. PostgreSQL additionally
enforces at least 60 seconds between token issuance attempts and at most
5 attempts/User/hour, including failed mail calls. These counters
survive process restarts and serialize concurrent requests.
Unknown/verified accounts do not allocate tokens.

Valid resend requests wait at least 10.5 seconds, including
unknown/verified/quota cases, to reduce the obvious provider-call timing
difference. This exceeds the 10-second provider timeout, but does not
claim mathematically constant timing under database/network load. IP
limits bound this deliberately slower endpoint.

## Mail adapter and privacy

`VerificationMailer` is the provider boundary. Production uses official
`resend` SDK **6.34.1**, `Resend.emails.send()`, HTML plus plain text,
and a per-issuance idempotency key. Check both returned `error` and a
successful response ID. An AbortSignal bounds the network call at 10
seconds. SDK exceptions/details are replaced with a safe error; no
automatic retry is made after an ambiguous timeout. Provider acceptance
is distinct from mailbox delivery. Only a separately authorized
real-inbox smoke can establish deliverability.

A timed-out request might still be accepted remotely, so its token
remains usable until expiry, verification or explicit resend rotation.
Failed attempts retain their cooldown/quota. A resend creates a fresh
token; only the latest link works, even if inbox delivery order differs.
Recovery never creates another User.

The URL comes exclusively from validated `PUBLIC_APP_URL`, never request
Host or forwarded headers. HTML escapes dynamic links. HTTP logging
omits query/body and TypeORM logging remains disabled. Development
defaults to a bounded in-memory fake mailer, with real Resend delivery
available only through explicit `MAIL_TRANSPORT=resend`. The fake mailer
sends/logs nothing; its last 20 messages can be inspected by an
authorized local debugger, not a public endpoint. Test processes always
select fake, even if a developer's local environment requests Resend.
Provider tests mock the SDK or network and never send real email.

Frontend `/check-email` accepts an editable email on direct
navigation/reload, shows pending/error/conditional
acknowledgement/cooldown, and offers login. `/verify-email` captures the
token in memory, replaces address/history before app mount when opened
directly, then removes remaining router query/hash before paint. It
clears bootstrap memory and the token ref after starting one POST. A
shared effect promise prevents StrictMode duplicate submissions. No
automatic token retry, analytics, localStorage or sessionStorage is
used. HTML and Caddy apply `no-referrer`. Verification never signs in or
changes an existing auth session. Login's verified error links to
resend; registration's old immediate-login message is removed.
Navigation callbacks retain the existing session generation checks.

## Environment and local verification

| Variable         | Production                                                                  | Development/test                                                                                                 |
| ---------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `MAIL_TRANSPORT` | Defaults to `resend`; explicitly choosing `fake` fails startup.             | Development defaults to `fake`; explicitly choose `resend` for real email. `NODE_ENV=test` always forces `fake`. |
| `RESEND_API_KEY` | Required server secret from owner; never print or commit it.                | Required and validated when development selects `resend`; discarded for fake/test.                               |
| `MAIL_FROM`      | `Kanvexa <no-reply@kanvexa.tech>`; validated sender format.                 | Required and validated for `resend`; fake uses the Kanvexa identity.                                             |
| `PUBLIC_APP_URL` | `https://kanvexa.tech`; exact HTTPS origin, no credentials/path/query/hash. | Required for `resend`; defaults to `http://localhost:5173` for fake. HTTP restricted to loopback.                |

Only `fake` and `resend` are valid transport values. Selecting Resend in
development validates all three mail variables just as production does,
except that a local HTTP loopback application origin is allowed.
Production still requires HTTPS; neither environment accepts URL
credentials, paths, queries or fragments. Token lifecycle, 24-hour
expiry, quotas, cooldown and REST responses are unchanged by transport
selection.

### Sending real email in local development

Use a local database with the K2 migrations already applied. In the
ignored root `.env`, configure the following values yourself:

```dotenv
NODE_ENV=development
MAIL_TRANSPORT=resend
MAIL_FROM="Kanvexa <no-reply@kanvexa.tech>"
PUBLIC_APP_URL=http://localhost:5173
```

Privately set `RESEND_API_KEY` in that file using the owner-managed key;
do not print it, paste it into terminal commands/logs, commit the file
or use a `VITE_*` variable. Keep the existing local database/JWT
settings. Start or restart the apps with `pnpm dev` so the backend
reloads configuration. No switch to `NODE_ENV=production` is needed.

Register a new account through the local UI using your intended test
inbox. Provider acceptance allows the Check Email page; provider
rejection/timeout returns the existing recoverable `503
MAIL_DELIVERY_UNAVAILABLE`. Check the inbox and spam folder, open the
latest verification link, then log in manually. For an existing pending
account, use Check Email/resend and respect the 60-second cooldown and
five-attempt hourly limit. The generic resend response does not prove
that an email was sent or delivered.

Set `PUBLIC_APP_URL` to the actual local frontend port. A localhost link
works only on the machine hosting that frontend; use a configured HTTPS
origin when opening the email from another device. Reset
`MAIL_TRANSPORT=fake` and restart when finished. The isolated
`compose.local.yml` smoke setup remains in `NODE_ENV=test`, so it
intentionally cannot send real email; use `pnpm dev` for this manual
check. This code change does not itself perform a real-inbox smoke.

Production fails startup validation on missing/invalid mail config.
Compose passes these values only into backend, never frontend/build
args/PostgreSQL/migrate. Place the key in `/etc/kanvexa/production.env`
outside Git, preserving root-owned 0600 permissions and existing
database/JWT secrets. No GitHub secret or AWS change is required. Do not
paste rendered environments or Resend errors into logs.

The explicit `compose.local.yml` override uses `NODE_ENV=test` and the
fake mailer; never include it in production commands. Local
infrastructure smoke explicitly marks only its synthetic User verified
in its own disposable database, then tests authenticated Board
persistence/Socket.IO. It does not prove real email delivery.

```bash
pnpm lint
pnpm test
pnpm build
pnpm format:check
pnpm test:infra
pnpm --filter @kanban/backend test:email-verification:database
git diff main...HEAD --check
```

The dedicated database suite owns a random disposable PostgreSQL Docker
container on a random loopback port, uses generated test credentials,
never reads a live DB connection, and removes only its own container. It
exercises real transactions, fresh and legacy migrations/backfill,
revert/rerun, data preservation, provider failure recovery, quotas,
parallel issuance/verify, actual HTTP guards and Socket.IO
handshake/reconnect. It also runs `pnpm --filter @kanban/backend
migration:show` with that isolated connection and the existing database
foundation suite in another temporary database. It never runs migration
commands against production or the development database.

Initial K2 verification on 2026-10-24 (local only):

| Command/check                                                                       | Actual result                                                                                                                                      |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                                         | PASS                                                                                                                                               |
| `pnpm test`                                                                         | PASS: backend 43 suites / 324 tests; frontend 52 files / 407 tests; shared 6 tests.                                                                |
| `pnpm --filter @kanban/frontend test` after adding bootstrap/history/redirect tests | PASS: 53 files / 410 tests.                                                                                                                        |
| `pnpm build`                                                                        | PASS; Vite warns about local `.env` NODE_ENV and bundle size.                                                                                      |
| `pnpm format:check`                                                                 | FAIL: 380 unchanged CRLF files in this Windows checkout. No unrelated normalization included.                                                      |
| Default Prettier check on all changed/new recognized files                          | PASS                                                                                                                                               |
| `pnpm exec prettier --check . --end-of-line auto`                                   | PASS; supplementary evidence of checkout line endings, not a replacement CI gate.                                                                  |
| `pnpm test:infra`                                                                   | PASS: 15 tests.                                                                                                                                    |
| `pnpm --filter @kanban/backend test:email-verification:database`                    | PASS: 16 PostgreSQL/HTTP/Socket.IO checks, including the existing database foundation suite.                                                       |
| `pnpm --filter @kanban/backend migration:show`                                      | PASS inside the owned disposable database suite; never pointed at production/development.                                                          |
| Backend/frontend Docker builds and `pnpm verify:images`                             | PASS with local-only tag `k2-local-20261024-5147885`.                                                                                              |
| `pnpm test:infra:smoke` using those local images                                    | PASS: migrations, SPA/assets/API, authenticated WebSocket, database failure/readiness, restart and persistence; temporary project/volumes removed. |
| `git diff main...HEAD --check` and working diff check                               | PASS                                                                                                                                               |

The initial broad run found a new test-harness validation ordering
error; the validation pipe was moved before app initialization and the
rerun passed. No business test failure was accepted as a baseline. The
outstanding raw formatting failure is the pre-existing Windows CRLF
checkout condition (also documented in the CI/CD runbook). Real-browser
layout/screenshots remain unverified because Chrome DevTools MCP is
unavailable in this session. No real email, production smoke, AWS
changes or rollout were performed. The checklist below remains for
owner-controlled review, staging and release.

The `MAIL_TRANSPORT` follow-up passed 37 new
configuration/provider-selection tests using a mocked Resend SDK (52
targeted mail tests including existing coverage). The full `pnpm test`
rerun passed 44 backend suites / 361 tests, 53 frontend files / 410
tests and 6 shared tests. Lint, build, changed-file Prettier and diff
whitespace checks passed. The full formatting check still reports the
same 380 unchanged CRLF files. No real email was sent to verify this
configuration fix; the local real-inbox instructions above are a manual
step.

## Production rollout and rollback

The HTML email header uses the official Kanvexa PNG at
`https://kanvexa.tech/branding/kanvexa-logo-v1.png`. The frontend serves
this public, versioned asset; it must remain available for previously
delivered email. Local `PUBLIC_APP_URL` changes only the verification
link, not the public image origin. See [branding integration and
QA](../frontend/kanvexa-branding.md) for image delivery and email-client
checks. The text wordmark remains visible when images are blocked.

1. Review migrations/code and take/export/verify a PostgreSQL backup.
   Rehearse on an isolated clone with legacy users and existing
   board/card data; record the previous app/image SHA and recovery
   point.
2. Owner configures the three variables outside Git and verifies Resend
   domain, sender, SPF/DKIM/DMARC, provider quota and outbound HTTPS. Do
   not approve CD until mail/config and recovery prerequisites have been
   checked.
3. Use the existing reviewed CD process: quality → image publishing →
   production approval → stop app traffic → explicit migrations → app
   start → smoke. Stopping app traffic before backfill prevents old code
   registering accounts during the schema/application transition. Keep
   the existing single deployment/host locks.
4. Migration `show` before and after; execute the new migration exactly
   once via TypeORM's migration history. Inspect backfilled User counts
   and existing data through protected diagnostics. Do not rotate JWT
   secrets or reset data.
5. Only after owner authorization, run the real-inbox and two-session
   checklist. Automated tests do not contact Resend or any production
   service.

Prefer a forward fix. An application image rollback retains the new
schema/data; do not run migration down on production as an automatic
rollback. The previous application does not enforce verification, so
reopening its public auth endpoints would allow new unverified users to
log in. Keep auth/registration traffic in maintenance until an operator
approves a compatible recovery strategy. A deliberate DB restore
requires explicit acceptance of writes lost after the backup. The `down`
migration is tested only on disposable databases and removes
verification state; it must not be used casually to recover mail
delivery.

## Manual QA checklist (requires owner review/authorization)

- [ ] Real desktop/mobile browser, keyboard navigation, readable
      errors/cooldown, no overflow at 320/390/768/1366 widths; record
      implementation screenshots.
- [ ] Direct Check Email navigation and reload; resend
      pending/success/error, server cooldown/quota and IP limits.
- [ ] Owner-specified inbox: new registration, correct sender, HTML/text
      CTA, latest link, 24-hour expiry and spam/deliverability.
- [ ] Verify with StrictMode, back/reload, invalid/expired/replayed
      links; inspect address/history, referrer, logs and storage without
      exposing credentials.
- [ ] Existing user login and existing JWT remain valid; new user cannot
      login or connect/reconnect REST/Socket.IO before verification.
- [ ] Verify → manual login → Board access and two-session realtime
      behavior; no membership changes or automatic login.
- [ ] Provider rejection/timeout: account preserved, conditional resend
      recovery; no repeated registration, credential logging or unattended
      retries.

References: [Resend Node SDK](https://resend.com/docs/send-with-nodejs),
[Send Email
API](https://resend.com/docs/api-reference/emails/send-email),
[Idempotency
keys](https://resend.com/docs/dashboard/emails/idempotency-keys).
