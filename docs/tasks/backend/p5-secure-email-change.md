# P5-02 — Verified email change and identity security

Implements [Issue #217](https://github.com/duongkienvn/SE2026-T13/issues/217), the
AC-01 verified email change backend slice. This record describes local code and
synthetic verification, not production deployment. P5-08 owns frontend integration.
No frontend, identity provider, dependency, infrastructure, session registry,
account merge or invitation retargeting is added.

## API contract

All routes require the existing verified-user Bearer JWT guard. There is no
userId selector or administrator override. Unknown body properties are rejected.
Successful request/pending responses use the normal REST success envelope;
confirmation is bodyless. Success responses carry `Cache-Control: private, no-store`.
Swagger describes the DTOs, authentication, responses and error statuses. Shared
request/pending contracts are in
[`packages/shared/src/email-change.ts`](../../../packages/shared/src/email-change.ts).

### Request

`POST /api/auth/email-change/request`, exactly one credential method:

```json
{ "newEmail": "new@example.com", "currentPassword": "CurrentPassword1!" }
```

```json
{ "newEmail": "new@example.com", "googleCredential": "<fresh Google ID token>" }
```

New email uses the registration `EmailField`: trim, lowercase, syntax validation,
maximum 254 characters. Current password is 1–128 characters and is neither trimmed
nor normalized, preserving existing password/legacy-password semantics. Google
credential is 1–8192 characters. Both or neither proof methods, null/empty/invalid
fields and arbitrary identity properties fail schema validation.

After JWT authentication and successful fresh reauthentication, response is
always HTTP **202** with exactly:

```json
{
  "success": true,
  "statusCode": 202,
  "message": "If this email change is eligible, a confirmation link may arrive. Delivery may be delayed or unavailable; try again after 60 seconds.",
  "data": null
}
```

That acknowledgement covers available/occupied targets, same-email no-op,
cooldown/quota and provider or processing failures. It contains no proof,
destination, delivery status or account-existence flag. Password reauthentication
reuses `AuthService.reauthenticate` and Argon2. A linked Google subject can instead
reauthenticate, including for passwordless users; dual-provider accounts can use
either method. Matching a Google email claim alone never authorizes this change.

Google verification reuses the official SDK, audience/issuer/signature/expiry and
verified-email checks. This flow additionally requires `iat` within **300 seconds**
and at most 30 seconds in the future. Ordinary Google login retains its existing
acceptance rules. The verified `sub` must equal the current stored GoogleIdentity
subject, regardless of whether Google's email differs from the account email.

The existing account throttle is reused after JWT authentication: 5 requests per
5 minutes per account across IPs, in addition to the 5-per-5-minute IP throttle.
Persistent issuance is separately limited to 5 attempts in a true rolling hour.
HTTP buckets remain per process; database quotas survive restarts and instances.

Only reauthentication gates initial acceptance. Afterwards a separate 10.5-second
timer gates the HTTP acknowledgement; issuance/delivery run in a caught in-process
promise, following the existing recovery architecture. Destination eligibility,
database waits, provider completion and final `sentAt` annotation do not gate the
response. This removes the obvious delivery timing oracle, not all event-loop or
network jitter. A 202 is not a persistence or inbox-delivery guarantee. Shutdown
can abandon queued/in-flight work; there is no durable delivery queue or retry.

### Pending

`GET /api/auth/email-change/pending` returns HTTP **200**, with `data: null` or:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "OK",
  "data": {
    "maskedNewEmail": "n***@e***",
    "issuedAt": "2026-11-05T00:00:00.000Z",
    "expiresAt": "2026-11-05T00:30:00.000Z"
  }
}
```

Both the local part and domain are masked. The single SQL query checks current
User email/version/verification and unconsumed/unexpired intent. Expired,
consumed, superseded or credential-stale requests are not shown. Polling cannot
extend expiry or alter quota. No cleartext target, token/hash, quota state or
`sentAt` is exposed; pending state is not a mail delivery receipt.

**Privacy resolution:** persisting nothing for an occupied destination while
exposing pending state would disclose destination eligibility through polling.
After valid reauthentication and quota checks, non-no-op targets therefore create
the same hash-only pending-intent shape and consume the same quota even when
already occupied. Such targets receive **no mail**. The random plaintext proof is
discarded and cannot be retrieved. Available and occupied targets both produce a
masked summary. Same-current-email requests leave the existing state unchanged.
Only a proof actually obtained from the new mailbox can authorize confirmation.
The normal uniqueness and no-op checks still apply during confirmation.

### Confirm

`POST /api/auth/email-change/confirm`:

```json
{ "token": "<43-character base64url proof>" }
```

Success is HTTP **204 No Content**, without a JWT, login response or automatic
sign-in. It requires an active verified session for the **same User** as the proof.
The mailbox link by itself never changes an account; GET/prefetch is not a consume.

| Condition                                                                              | Result                                                                          |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Invalid request schema / extra body properties                                         | `400 VALIDATION_FAILED`                                                         |
| Missing/expired/unverified/invalidated JWT                                             | `401 UNAUTHORIZED`                                                              |
| Incorrect password, unlinked or mismatched Google subject                              | `403 INVALID_CREDENTIALS`                                                       |
| Invalid/stale Google credential                                                        | `401 INVALID_GOOGLE_CREDENTIAL`                                                 |
| Google verifier operationally unavailable                                              | `503 GOOGLE_AUTH_UNAVAILABLE`                                                   |
| Malformed, missing, unknown, expired, consumed, rotated or cross-account mailbox proof | `400 INVALID_EMAIL_CHANGE_TOKEN`                                                |
| Proof email/authVersion no longer matches the current account                          | `400 INVALID_EMAIL_CHANGE_TOKEN` with an otherwise valid current JWT            |
| Destination claimed before/during confirmation                                         | `409 EMAIL_CHANGE_UNAVAILABLE`; consume intent, preserve original email/version |
| IP/account abuse                                                                       | `429 TOO_MANY_REQUESTS`                                                         |
| Unexpected persistence failure                                                         | Existing sanitized 5xx error; atomic rollback                                   |

An old JWT is rejected by the guard with 401 before token evaluation. A fresh JWT
combined with a proof issued for an older authVersion receives the generic 400.
Two already-authenticated concurrent confirmations yield one success and one
invalid-token result; a later HTTP request may instead fail its JWT guard. Replay
is rejected, not treated as another successful operation.

## Persistence and transaction guarantees

New forward-only migration:
[`1794528000217-EmailChangeSecurity.ts`](../../../apps/backend/src/database/migrations/1794528000217-EmailChangeSecurity.ts).
It adds only `pending_email_changes`; existing rows/tables are not rewritten.
Runtime keeps `synchronize: false` and `migrationsRun: false`.

| Column                        | Contract                                                         |
| ----------------------------- | ---------------------------------------------------------------- |
| `id`                          | Generated UUID primary key                                       |
| `user_id`                     | Unique User FK, cascade only on explicit User deletion           |
| `token_hash`                  | Unique lowercase 64-character SHA-256; no plaintext proof        |
| `new_email`, `original_email` | Normalized email strings, max 254                                |
| `original_auth_version`       | Nonnegative original User version                                |
| `created_at`, `expires_at`    | Finite UTC instants, exact 30-minute interval                    |
| `consumed_at`, `sent_at`      | Nullable finite UTC timestamps, not before creation              |
| `issuance_attempts`           | Non-null one-dimensional timestamptz array, 1–5 non-null entries |

Expiry is indexed. The unique User key bounds storage to one intent row/account.
Do not delete expired/consumed rows to reset limits: retained timestamps preserve
the rolling quota. V1 has no cleanup scheduler. New eligible attempts prune only
timestamps outside `(now - 1 hour, now]`, then append the current database clock.
Ambiguous and occupied-target attempts count. Cooldown is exactly 60 seconds from
issuance, independent of consumption or delivery status.

Issuance and confirmation use short transactions with two-second lock and
three-second statement timeouts. **User is always locked first**, then its pending
row. Request rechecks verified status, email/authVersion, JWT expiry and the
password-hash or linked-subject snapshot before rotation. Cryptography/network
reauthentication occurs before locks; all mail provider calls occur after commit.
The database clock determines issuance and expiry. Proofs use 32 CSPRNG bytes,
encoded as 43 base64url characters; only SHA-256 is stored. Rotation replaces the
hash, clears consumed/sent timestamps, and retains quota history.

Confirmation discovers the candidate owner by hash, then re-reads the current
pending row under the User-first lock. It checks every proof, owner, original
email/version, verification, expiry, consumption and target predicate. Success
updates **only** `email`, `emailVerifiedAt` and `authVersion = authVersion + 1`;
consumes the pending intent and every outstanding password-reset and obsolete
verification token in the same transaction. No stale full-User save occurs.

The existing `users.email` unique index is authoritative. A savepoint surrounds
the identity update so a registration, Google signup or another confirmation
winning after the initial collision check can roll back that update, commit
pending-proof consumption, and return 409. Other database failures roll back the
entire operation, preserving original email/version and unaffected recovery
credentials. Concurrent confirmations cannot both succeed. Password changes and
resets share the User lock and invalidate older pending proof versions.

User UUID, passwords, GoogleIdentity ID/subject, Board/Workspace ownership,
memberships, Card/history relationships, preferences and notification identity
are preserved. Old email no longer logs into that User; new email password login
works where a password exists. Linked-subject Google login resolves the same User
even after account and Google emails diverge. Future new linking retains the
existing same-email guard. No identity is auto-linked, detached, moved or merged.

Old-address recovery stops finding this account. Pre-change recovery/verification
proofs are consumed atomically. Future recovery uses the current address and its
existing independent cooldown/quota. Email-addressed invitations are not rewritten
or silently claimed: acceptance still compares the current verified User email
with the original target, so old-email proofs cannot be accepted after the change.

## Mail, session revocation and operational limits

`EmailChangeMailer` uses the existing MailModule fake/Resend selection and
`PUBLIC_APP_URL`. New mailbox mail has a dedicated branded HTML/plain-text proof
template linking to `/confirm-email-change?token=...`. It contains no password or
Google credential. HTML URLs are escaped; no third-party images/tracking are added.

After the committed change, a dedicated security alert goes to the **old verified
mailbox**, containing neither token nor new email. It is independent of task-email
flags and notification opt-outs. Delivery is best effort: provider failure cannot
roll back the committed change. There is no durable alert outbox/retry guarantee.
Both Resend methods have a 10-second abort deadline, deterministic idempotency
keys and sanitized errors. Ambiguous proof delivery keeps its valid proof and
charged quota. A delayed completion annotates `sentAt` only if the hash still
matches, so it cannot restore/overwrite a rotated proof.

REST and Socket.IO handshake/reconnect check the persisted authVersion. Immediately
after commit, the existing BoardRoomCoordinator revokes old-version sockets in
the **current backend process**: application receive grants are cleared and the
identity removed synchronously, then transport disconnect/presence cleanup run.
Before scanning, it records a server-owned, monotonic minimum authVersion per User.
Authentication checks this watermark after the awaited JWT/database lookup;
connection completion and subsequent `isActive()` checks apply the same fence.
Thus a handshake absent from the scan cannot become an active old-version session,
including when later namespace middleware delays publication after authentication
has already completed. It cannot join Boards or retain the receive grants needed
for Board events and presence. Delayed older revocation callbacks cannot lower the
watermark. One version number per locally revoked User is retained for the process
lifetime and cleared on shutdown; a restart has no surviving in-flight handshakes
and new handshakes still check PostgreSQL. No socket/device registry is added.
New-version sockets and other users are preserved; adapter disconnect failures
cannot restore receive grants. Private notification delivery also retains the
existing database version and immutable-recipient rechecks.

This is not a distributed device/session registry. Already-delivered packets and
unrelated REST mutations authenticated before the change are not cancelled.
Across multiple backend processes, another process's established Board connection
can remain until disconnect/original JWT expiry (at most the remaining hour);
its private notification path rechecks the database on the next delivery. The
existing supported single-process coordinator assumption remains unchanged.

Logs omit request bodies and query strings; new warnings contain no actor/target,
token, password, Google credential or raw provider exception. Initial mail-link
navigation can still reach browser history, email gateways, CDN/ingress logs and
TLS termination. Operators must redact token query strings at every logging layer,
avoid analytics on the confirmation route, preserve TLS and `no-referrer`, and
review link-scanning behavior. No infrastructure configuration was changed here.

## P5-08 frontend handoff

Implement `/confirm-email-change?token=...` without automatically consuming a proof
on GET. Capture the token early, replace the query URL before application/analytics
mount, keep the proof in memory only, and clear it on use. Do not put it in router
state, local/session storage, logging or telemetry. Refresh after URL replacement
may require reopening the mail link. URL replacement does not undo prior ingress
logging and does not protect an origin compromised by XSS.

Require sign-in as the same account, using its **current original email** until
confirmation succeeds; mailbox possession alone is insufficient. Present generic
202 wording and a masked pending summary, not a guaranteed “email sent” state.
Support either password or fresh linked Google proof, never both. Handle 400
invalid/expired/retry, 401 sign-in-required, 403 reauthentication, 409 unavailable
and 429 throttling with accessible status/focus behavior. There is no quota or
delivery-status API. After 204, clear session-scoped protected caches and sockets,
discard proofs and sign out locally, then request fresh authentication. No new JWT
or automatic login is returned. Preserve the existing session-generation checks
so an old completion cannot sign out a newer replacement session.

## Migration and operator handoff

Apply the forward migration through the existing explicitly authorized release
migration gate **before** serving this code. Back up and rehearse restore first;
this implementation performed no deployment or production migration. No new
environment variable or mail flag is required. Use the existing validated
`PUBLIC_APP_URL`, `MAIL_FROM`, `RESEND_API_KEY` and transport configuration; never
put credentials into Vite/public build settings. Do not enable the frontend
handoff until P5-08's confirmation page is available.

`down()` always refuses to discard proofs or rolling quota history. On an
application rollback, retain this additive table and authVersion-aware code;
roll forward with a reviewed corrective migration or restore a reviewed backup.
Restoring an older database can revive consumed credentials and lose session
revocations, so it is not an automatic safe rollback. No migration is run on app
startup. Future account deletion must explicitly review the User FK cleanup and
existing account-retention rules; deletion itself is out of scope.

## Verification

The dedicated runner requires explicit local-only database opt-in, creates a
random temporary database, runs the actual migrations and real Nest/JWT/Argon2/
Socket.IO paths, then drops the database. Config ignores `.env`; mail and Google
verification are fake and storage is disabled. The existing signed Google SDK
unit tests exercise freshness and signature/issuer/audience validation offline.

```powershell
$env:EMAIL_CHANGE_DATABASE_TESTS = 'local-only'
# Configure DATABASE_HOST as loopback and explicit local test port/user/password.
pnpm --filter @kanban/backend test:email-change:database
```

The suite covers populated migration/constraints/FK cleanup; password-only,
Google-only and dual-provider accounts; exact token/TTL/hash and real HTTP generic
acknowledgements; masked pending state and occupied-target privacy; current-email
invitation binding; rolling quota/restart/rotation/expiry; provider ambiguity and
late completions; password changes while mail waits; rollback/recovery survival;
malformed/cross-account/replayed tokens; concurrent confirms/requests; competing
targets; deterministic registration/Google-signup unique-index races; password
change races; old REST/reconnect rejection and active-socket revocation; mandatory
old-mailbox alerts and no secret/new-target disclosure.

Final local results:

| Check                                                                                                            | Result                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                                                                      | **Pass**                                                                                                      |
| `pnpm test`, `VITEST_MAX_WORKERS=2`                                                                              | **Pass:** 110 backend suites / 1,224 tests, 140 frontend suites / 1,472 tests, 20 shared tests                |
| `pnpm build`                                                                                                     | **Pass:** shared ESM/CommonJS, backend, frontend                                                              |
| `pnpm --filter @kanban/backend exec tsc --noEmit -p tsconfig.json`                                               | **Pass**                                                                                                      |
| `pnpm --filter @kanban/shared exec tsc --noEmit -p tsconfig.json`                                                | **Pass**                                                                                                      |
| `test:email-change:database` and final compiled runner                                                           | **Pass:** 16 PostgreSQL/Nest/Socket.IO groups                                                                 |
| `test:password-security:database`                                                                                | **Pass:** 16 groups                                                                                           |
| `test:google-auth:database`                                                                                      | **Pass:** 14 groups; no live OAuth                                                                            |
| `test:email-verification:database`                                                                               | **Pass:** 16 groups, including its database-foundation subprocess                                             |
| `node apps/backend/test/database/database-foundation.integration.mjs`, explicit disposable local server settings | **Pass:** pagination, historical rollback/reapply, full current metadata/schema, both forward-only boundaries |
| `node apps/backend/test/workspaces/workspace-members-invitations.integration.mjs --invitations-only`             | **Pass:** invitation/decline lifecycle, migration, concurrency and privacy                                    |
| `node apps/backend/test/notifications/notifications.integration.mjs`, explicit local-only opt-in                 | **Pass:** 16 persistence/HTTP/socket groups                                                                   |
| Changed-file Prettier, documentation links and `git diff --check`                                                | **Pass**                                                                                                      |
| `pnpm format:check`                                                                                              | **Baseline failure:** 1,208 unchanged files have formatting/CRLF warnings; zero changed files fail            |

The first unrestricted workspace run hit unrelated frontend timeout failures under
worker load. The final two-worker run passes all frontend tests without frontend
edits. Initial mail-provider/entity-count and historical rollback fixture failures
were corrected for the added provider/table/migration; those assertions remain
strict, including full current schema drift and the older notification rollback
boundary. The email-change migration itself remains forward-only.

Existing non-fatal Vite `.env` NODE_ENV/bundle-size warnings and PostgreSQL driver's
schema-inspection concurrent-query deprecation warning remain. They are not failed
checks. Production rollout, real OAuth, real mailbox delivery and P5-08 browser/UI
verification are **not run**, as required by this backend-only scope. Disposable
databases and test containers are cleaned up; no real-user data is used.
