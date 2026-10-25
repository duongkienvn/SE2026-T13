# P1-06 — Password Recovery & Account Security

Implemented locally on `feat/password-recovery-security` for [Issue #93](https://github.com/duongkienvn/SE2026-T13/issues/93), based on `cea6d1c` (verified against fetched main). This is implementation/QA evidence, not a production deployment record. No push, PR, merge, production migration or real email delivery was performed.

## Implementation and integration

`PasswordSecurityService` owns issuance, reset and change transactions; a separate controller owns HTTP/Swagger/throttling. `NewPasswordField` is shared with registration, preserving its 8–128 Unicode-character policy, ASCII uppercase/digit and punctuation/symbol requirement. Passwords are neither trimmed nor normalized. Local passwords use Argon2id.

Public `/forgot-password` and `/reset-password` work independently of #91/#92 and do not alter `/` or existing auth/board routes. Login has a real recovery link. `AccountSecurity` is functional in the authenticated `/profile` page, reads `GET /auth/linked-providers`, and shares that query with Connected Accounts. No Settings shell or placeholder Settings route was added.

**#92 integration contract:** mount `<AccountSecurity />` inside its existing authenticated `/settings/security` content and remove the temporary Profile mount when that route lands. Retain `AuthProvider`, QueryClient and `useAuthSession` ancestors. The component owns provider loading/retry and password change; it takes no account/provider props. Its local form resets at session-generation boundaries. Google-only accounts get `Set password via email` leading to the real public flow. Do not render a current-password form when `hasPassword=false`. The shared public routes must remain outside `PublicOnly` so signed-in Google-only users can recover/set passwords. No UserMenu changes are required.

## API contract

All routes below use the configured `/api` prefix. Unknown fields are rejected. The usual success/error envelope applies except bodyless 204 responses.

| Endpoint                                  | Input                                                             | Success                                                                                                             | Failure                                                                                                                                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/forgot-password` (public)     | `{ email }`, trimmed/lowercased, max 254, strict email validation | 202 with `data:null` and the same conditional acknowledgement for every eligible/ineligible/provider/cooldown state | Malformed input 400; IP limit 429                                                                                                                                                                                         |
| `POST /auth/reset-password` (public)      | `{ token, newPassword }`                                          | 204; no JWT, account state or automatic login                                                                       | Invalid/malformed/expired/used/superseded proof: 400 `INVALID_PASSWORD_RESET_TOKEN`; policy: 400 `VALIDATION_FAILED`; reused password: 400 `PASSWORD_REUSED`; limit 429; storage failures sanitized 500                   |
| `POST /auth/change-password` (Bearer JWT) | `{ currentPassword, newPassword }`                                | 204; fresh login required                                                                                           | Invalid/revoked JWT 401; wrong current password 403 `CURRENT_PASSWORD_INCORRECT`; passwordless account 403 `PASSWORD_RECOVERY_REQUIRED`; reused password 400 `PASSWORD_REUSED`; policy 400 `VALIDATION_FAILED`; limit 429 |

Password field errors have stable codes and field-prefixed `details`. The public reset-token error does not distinguish rejection causes. OpenAPI documents request DTOs, auth requirements and success/error statuses. Public user DTOs whitelist existing public fields; password hashes and auth versions are not serialized.

## Persistence and credential safety

New migration: `1792922400093-PasswordRecoverySecurity.ts`. Existing migrations are immutable. `synchronize:false` and `migrationsRun:false` remain unchanged. The timestamp is distinct from existing migrations and includes issue 93; it does not change preferences (#88).

`users.auth_version` is a non-null integer, default zero. `password_reset_tokens` has UUID primary key, unique user FK with cascade deletion, unique 64-character SHA-256 hash, created/expiry/consumption/sent timestamps, indexed expiry and persistent issuance-window/attempt metadata. There is at most one current row per user. Rotating replaces the hash and clears consumption/sent timestamps while retaining the quota window. Consumed/expired rows remain to preserve quota; do not purge them during an active window. This feature does not add a scheduler.

All issuance, reset and change operations lock **User first**, then read the current recovery row. Reset discovers only the candidate owner before entering its transaction and rechecks hash, expiry, consumption and verified status under the user lock. Two consumes serialize: one succeeds, the other sees consumption or a changed hash. An old hash cannot become valid after rotation. Transactions update credential fields only. Reset updates password + consumption + version atomically; change updates password + outstanding-proof consumption + version atomically. Current-password verification/hashing for change occurs before locking; the locked transaction rechecks both the password-hash snapshot and the JWT version, preventing change/reset and change/change races. Password hashing for reset occurs before locking; same-password verification occurs under the lock. No network call spans a transaction.

Profile writes now update only permitted profile fields, preventing a concurrent stale full-User save from restoring old password/version values. Email verification and Google linking retain their original identity/reauthentication rules.

## Recovery and mail security

Proofs use 32 CSPRNG bytes (256 bits), encoded as 43 base64url characters, with 30-minute TTL. Only SHA-256 is persisted; proofs are opaque, never JWTs. Verification and recovery use separate tables, mailers and templates. Unverified accounts cannot receive a recovery proof or become verified via reset. A verified Google-only account may consume recovery to set a local password while preserving user ID, Google subject/identity and business ownership. A Google-only JWT alone cannot set a password.

Issuance is serialized per account in PostgreSQL: 60-second cooldown, maximum five issues per one-hour window, including failed/ambiguous delivery attempts. Concurrent requests cannot send duplicate proofs. Public forgot schedules issuance and delivery in an in-process background promise and awaits only a separate 10.5-second timer before returning the same generic 202. Database connection waits, issuance, provider delivery and the final token annotation do not gate HTTP completion. Unknown/unverified accounts, cooldown and database/provider failures retain the same acknowledgement. The whole background promise handles rejections, including synchronous invocation failures and errors after the response, without logging account state or sensitive error details. The issuance transaction still bounds statement/lock waits. Timer scheduling, event-loop load and network overhead can add jitter; this removes the delivery-completion timing dependency, not every possible timing signal or a strict constant-time guarantee.

The 202 is an acknowledgement, not proof of token persistence or mail delivery. Background work is best effort within the current process, without a durable queue or automatic retry. Process shutdown/crash can abandon work before persistence or after issuance; after issuance, the persisted cooldown/quota and valid proof remain. A later explicit request can retry after cooldown. More robust shutdown draining or durable delivery requires a separate lifecycle/infrastructure change.

HTTP throttles are forgot 5/5 minutes/IP, reset 10/minute/IP, change 5/5 minutes/IP plus an additional authenticated-account bucket across IPs. The account guard runs **after** JWT authentication. HTTP throttling uses existing per-process storage; distributed enforcement requires ingress protection before running multiple backend instances. Recovery's account quota is database-backed and shared across instances/restarts.

`PasswordRecoveryMailer` selects fake/Resend using existing configuration. The dedicated branded template contains `/reset-password?token=...` built from `PUBLIC_APP_URL`, neutral copy, expiry and ignore instructions. It uses table/inline-style layout and no external images/tracking resources. Production Resend has a 10-second abort deadline and deterministic per-proof idempotency key. SDK errors are sanitized. No automatic retry occurs; ambiguous delivery retains the valid proof and charges quota. After cooldown a user may explicitly request rotation. `sent_at` is informational and updated after delivery using a hash predicate so delayed provider completion cannot overwrite a rotated proof. Failure of that annotation does not invalidate an already delivered proof.

Request logging excludes bodies, raw queries and credentials; no new token/password/provider-error logging was added. Frontend captures the incoming recovery proof in bootstrap memory, replaces the URL before React mounts, and clears the bootstrap reference on use. In-app query links receive the same replacement. Proofs are never put in router state or browser storage. Referrer policy is `no-referrer`. After the URL has been stripped, refreshing the bare page requires reopening the original email link (or requesting a fresh one). Initial navigation URLs can still reach browsers, mail providers and ingress/access logs; deployments must redact query strings, avoid analytics on auth pages and preserve TLS. JavaScript memory is not a defense against an XSS-compromised origin.

## JWT and realtime behavior

New JWTs carry the database `authVersion`. Existing authentication verifies signature, algorithm, issuer, audience, expiration, verified-user existence and exact persisted version on each REST authentication or Socket.IO handshake. Missing version means zero only; malformed/negative/fractional/null/string versions are rejected. Unchanged users keep working with legacy tokens at version zero. Successful credential changes increment the persisted version, so old versioned and versionless tokens are rejected. Login after reset/change issues a valid current version. Other users are unaffected.

Socket.IO reuses `AuthService.authenticateAccessToken`: old credentials fail new handshake and reconnect. Existing board membership checks and room isolation remain intact.

**Residual limit, explicitly tested:** already-connected sockets retain their existing grants until disconnect or their original JWT expiry (up to the remaining hour). They may receive board events and use their existing authorized connection during that interval. This feature does not claim instant active-device/socket logout, add a session registry, or cancel unrelated REST operations already authenticated before the change. Instant distributed socket revocation remains a separate implementation decision. The PostgreSQL integration test proves both the rejection on reconnect and continued delivery to a pre-existing socket.

Frontend password change signs out only the submitting session after actual API success, clears protected query data and navigates to Login with one-time feedback. It skips a redundant logout API call because the credential-changing operation already revoked that JWT. Ordinary logout behavior is unchanged. An explicit UI flush settles RequireAuth's redirect before passing success feedback. Stale success/401/403 responses cannot end or redirect a newer session. Public reset never automatically logs in.

## Test matrix and QA

Primary real-database runner: `pnpm --filter @kanban/backend test:password-security:database`. It creates/removes its own PostgreSQL 16 Docker container, ignores repository `.env`, uses synthetic accounts, and substitutes fake mail/Google proof verification. Actual TypeORM transactions, Argon2id, REST DTOs/guards and Socket.IO transport run against PostgreSQL. No live OAuth, Resend or production database is contacted.

| Coverage                                                                                                      | Evidence                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Policy, generation/hash/TTL, eligible/unknown/unverified accounts, cooldown/quota, provider failure           | 14 service unit tests; registration-policy regression tests; real issuance/rotation/quota checks |
| Dedicated template, fake selection, Resend deadline/idempotency/error/no-retry                                | 7 recovery mail tests plus transport configuration tests                                         |
| Validation, strict fields, JWT requirement, IP throttling and account bucket across IPs                       | 8 password-security HTTP tests                                                                   |
| Invalid/malformed/expired/replayed/superseded proof; weak/reused password preserves proof                     | PostgreSQL + HTTP integration                                                                    |
| Reset/reset, change/reset, change/change races                                                                | Real concurrent transactions; exactly one successful old-proof operation                         |
| Rollback of password, consumption and version                                                                 | PostgreSQL trigger failure after password update, for both reset and change                      |
| Old password rejected/new password accepted; version increment/legacy compatibility/isolation                 | Auth unit tests and real REST login/guard checks                                                 |
| Socket handshake/reconnect, other-user room access/isolation and active-socket boundary                       | Real Socket.IO integration plus existing realtime regression suites                              |
| Migration on populated accounts/Google identities, empty down/up, unsafe-down guard and entity/schema drift   | PostgreSQL migration rehearsal                                                                   |
| Google-only set-password preserves identity and supports local/Google login                                   | Real password/identity persistence and both HTTP login paths with fake Google verifier           |
| Existing registration, verification, explicit Google linking                                                  | Real HTTP regression flow, separate token namespaces                                             |
| Provider pending call holds no user lock                                                                      | Reset commits while fake delivery is deliberately blocked                                        |
| Forgot/reset forms, focus, URL handling, errors/retry, routing, Google-only messaging, password-change logout | 16 new frontend flow/component tests; existing auth tests                                        |
| Session switch during password change                                                                         | Old success/401/403 cannot change the replacement session                                        |
| Swagger                                                                                                       | All three endpoints and success statuses checked against generated OpenAPI                       |

Browser QA used Chrome against the real isolated API and Vite, with fake captured mail. CSS viewports **1280×800** and **375×812**: Forgot, Reset and Profile security show no horizontal overflow/clipping; labels, masking, requirements, pending/disabled actions, empty-submit focus and Tab/Enter submit were checked. The browser completed forgot → captured email link → reset → manual login → incorrect current-password error → valid password change → Login confirmation. Reopening/using the consumed link produced safe recovery guidance; reloading a stripped link showed the expected invalid-link state. Network 403/400 responses for intentional negative cases are expected; no application JavaScript exception was observed. Live Google OAuth and Gmail delivery were not tested; fake-provider integration and inline-email tests cover the implemented contracts.

Real screenshots are under [implementation/password-recovery-security](../../design/screens/implementation/password-recovery-security/): `forgot-desktop.png`, `forgot-mobile.png`, `reset-desktop.png`, `reset-mobile.png`, `security-desktop.png`, `security-mobile.png`. Security screenshots capture the actual rendered section within Profile; no mockups were used as implementation evidence.

Final validation on 2026-10-25:

| Command / check                                                 | Result                                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                     | PASS                                                                                                                             |
| `pnpm test` with `VITEST_MAX_WORKERS=2`                         | PASS: 50 backend suites / 484 tests; 68 frontend files / 624 tests; 6 shared tests (1,114 total)                                 |
| `pnpm build`                                                    | PASS; existing Vite `.env` NODE_ENV and bundle-size warnings remain                                                              |
| `pnpm --filter @kanban/backend test:password-security:database` | PASS: 14 grouped PostgreSQL/REST/Socket.IO/OpenAPI checks; container removed                                                     |
| `pnpm format:check`                                             | FAIL: Windows checkout line endings in 459 untouched files; `core.autocrlf=true` converts them to CRLF while Prettier expects LF |
| `pnpm format:check --end-of-line auto`                          | PASS after correcting formatting in the changed activity fixture; confirms remaining root failures are line-ending differences   |
| Task files, Prettier check                                      | PASS; no unrelated repository-wide normalization performed                                                                       |
| `git diff --check`                                              | PASS                                                                                                                             |
| Browser                                                         | PASS: desktop/mobile screenshots and real recovery/change flows; clean console after final reload                                |

Final local commit hashes are reported in the delivery message. The initial broad runs exposed missing auth-version values in old repository doubles, now updated without weakening real database checks. Two registration tests also assumed there could be only one status region despite configured Google loading UI; they now target the actual password-requirements announcement. An overlapping shared build/test run caused a transient missing shared artifact and Vite reload errors; final checks run sequentially and browser reload was clean. On this machine `VITEST_MAX_WORKERS=2` avoids resource-contention timeouts without skipping tests or changing committed configuration. The PostgreSQL driver emits an existing concurrent-query deprecation warning during TypeORM migration/schema work; it does not fail the integration suite.

## Rollout, rollback and remaining integration notes

1. Back up and rehearse restore; inspect pending migrations including #88. Apply the new migration explicitly on the intended environment. No migration runs at app startup. There are no changes to old users' hashes, verification state, IDs or Google identity rows.
2. Deploy/restart the version-aware backend consistently. Do not expose credential-change endpoints while older backend instances that ignore `auth_version` still serve requests. The current single-instance deployment can use a coordinated restart; mixed-version rolling deployment requires gating those operations.
3. Deploy frontend public routes with SPA fallback, `PUBLIC_APP_URL`, CORS and no-referrer/query-redaction protections aligned to the actual environment. Fake transport is enforced for tests; production requires the existing validated Resend setup. Browser QA's `--serve` harness is loopback-only and always owns disposable data/fake delivery; its `/__qa/*` handlers are test-script code, absent from the production app.
4. Migration `down` locks users/recovery tables and refuses if **any** recovery row or nonzero auth version remains. Do not delete tokens or reset versions to force rollback: doing so could discard proofs/quota/revocation history or revive old JWTs. Preserve additive schema and deploy a compatible version-aware fix. Rollback to pre-feature authentication is unsafe after credential changes; use the reviewed backup/restore plan if needed, with explicit authorization.
5. Merge #88's independent user migration without renaming an applied migration. #91 must preserve current board/profile and public-auth routes. #92 owns Settings shell/routing; consume the integration contract above. No preferences, board/card logic, new global-state library or infrastructure was introduced.

Existing standalone email/Google/database-foundation runners contain older hardcoded entity/migration counts (some already stale on this base). They were not used as acceptance evidence here. The dedicated #93 runner checks the current complete migration set and the real Google/verification regressions; `pnpm test` still runs all existing Jest/Vitest suites. Modernizing every historical standalone runner is outside this change.

## Profile scrolling follow-up — shared App Shell

The longer Account Security form exposed an existing AppShell containment defect.
`h-dvh`, the padded `h-full` frame, column flex sizing and main's `min-h-0` were
already correct: at 1280×800 the shell was 800px high and main was 716px high.
However, `main` was statically positioned. The absolute `sr-only` spans/live region
in Password Requirements used BODY/the initial containing block instead of the
main scroller. Their static positions below the viewport escaped the intervening
overflow clips, growing document height to 1046px and producing a second scrollbar
and lavender area below the shell. At 375×812 document height was 1287px.

The fix adds only `relative` to AppShell's existing main scroller, making it the
containing block for those announcements. Main retains its original size and
scrollable content; document stays at viewport height. No global overflow lock,
height change, form redesign or changes to AuthenticatedLayout, PageContainer,
Profile, AccountSecurity, NewPasswordForm or style.css are needed. The live regions
remain in the accessibility tree. **#91 / Mylecute:** preserve this positioned
scroll-container boundary when integrating App Shell V2; the defect belongs to
shared shell containment, while #93 supplied the long content that exposed it.

`apps/frontend/test/app-shell-scroll.browser.mjs` contains native-browser regression
assertions, deliberately separate from JSDOM tests (which cannot measure layout).
With Vite running, import `/test/app-shell-scroll.browser.mjs` in the browser and
call `verifyProfileScrolling()` on a loaded local-password Profile. It checks
natural and bottom scrolling, fixed header/sidebar positions, horizontal bounds,
focus reaching the final control, and a temporary long-content/absolute-live-region
probe. The assertions failed before the fix at all three target sizes (1920×1080
needed the stress probe, which grew the document to 3430px), then passed after it.
`verifyPublicAuthScrolling()` guards public form scrolling without a global lock;
`verifyDialogScrolling()` guards body-portaled dialog scrolling and background
isolation. These browser functions run explicitly during QA, not inside `pnpm test`.

| Profile CSS viewport | Document height after fix | Main viewport height | Natural main content height |
| -------------------- | ------------------------- | -------------------- | --------------------------- |
| 375×812              | 812                       | 756                  | 1448                        |
| 1280×800             | 800                       | 716                  | 1198                        |
| 1920×1080            | 1080                      | 996                  | 1198                        |

At every size, scrolling/focusing bottom controls left `window.scrollY=0`; only
main scrolled. Mobile empty-submit focus reached Current Password while keeping
the document fixed. Bottom screenshots: [375×812](../../design/screens/implementation/password-recovery-security/profile-scroll-375x812.png),
[1280×800](../../design/screens/implementation/password-recovery-security/profile-scroll-1280x800.png),
[1920×1080](../../design/screens/implementation/password-recovery-security/profile-scroll-1920x1080.png).
Browser smoke checks also covered sidebar collapse/expansion, a real Board Detail,
keyboard column drag/drop with viewport-fixed overlay and persisted reorder after
reload, mobile Kanban horizontal scrolling, long dialog content, Escape/focus
restoration and public auth scrolling. All QA data lived in an owned disposable
PostgreSQL container with fake mail; no production data or real mail was used.

Follow-up validation: `pnpm lint`, `pnpm test` (484 backend + 624 frontend + 6
shared tests), `pnpm build`, changed-file Prettier checks and `git diff --check`
passed. Targeted shell/navigation/Profile/Dialog and Kanban suites passed 41 tests.
The native-browser regressions above passed; final Profile/public-auth reloads
had no console errors or warnings. Plain `pnpm format:check` still reports CRLF
differences in 457 untouched files; the full check with `--end-of-line auto`
passed. Those unrelated files were not normalized. The temporary QA servers and
disposable database were stopped after verification.

## PR #94 timing review follow-up

The CodeRabbit finding in `PasswordSecurityController.forgot()` was valid:
`Promise.allSettled([send(), delay(10_500)])` waited for both promises. The
provider's 10-second deadline did not bound database acquisition, the sum of
issuance statements and delivery, or the final `sent_at` update. Eligible-account
work could therefore extend the HTTP response beyond the common timer.

The controller now schedules `send()` through a promise with a terminal rejection
handler and awaits only the timer. The promise bridge also catches synchronous
invocation errors. No email, proof, account state or provider/database error is
logged. Generic 202, DTO validation, HTTP rate limits, database cooldown/quota,
proof lifecycle, provider deadline/idempotency and mail delivery are unchanged.
No service, schema, frontend or infrastructure change is required. See the
in-process reliability and timing limits under Recovery and mail security above.

Eight controller tests independently control the timer and delivery, including
pending work, ineligible/successful outcomes, synchronous errors and early/late
rejections. HTTP/database integration no longer treats 202 as completed delivery:
it gates a provider past the response and checks eventual mail and `sent_at`,
exhausts the application connection pool past the response and checks eventual
issuance, and injects real PostgreSQL failures during issuance and final token
annotation. Provider rejection and annotation failure are deliberately released
after 202. Eligible, missing, unverified, cooldown and failure responses retain
the same envelope; failed/ambiguous delivery retains quota, and a delivered proof
still resets successfully when its final annotation fails. Test-only gates and a
30-second pool acquisition deadline make these assertions deterministic without
changing production deadlines. The harness drains background work before teardown.

Validation on 2026-10-25:

- Targeted controller/HTTP/service/mailer suites: **37 tests passed**.
- `node --unhandled-rejections=strict apps/backend/test/auth/password-security.integration.mjs`
  after backend build: **16 grouped checks passed**; disposable container removed.
- `pnpm lint`: passed.
- `pnpm test` with `VITEST_MAX_WORKERS=2`: **51 backend suites / 492 tests,
  68 frontend files / 624 tests, 6 shared tests (1,122 total)** passed.
- `pnpm build`: passed; existing Vite environment and bundle-size warnings remain.
- `pnpm format:check`: still fails on **457 untouched CRLF files**;
  `pnpm format:check --end-of-line auto`, standard Prettier checks on all four
  changed files, and `git diff --check` pass. No unrelated normalization was made.

This follow-up is a local fix only. No push, new PR, remote review reply/resolution,
merge, deployment, production database or live Resend delivery was performed.
