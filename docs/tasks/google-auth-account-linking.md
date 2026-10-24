# Google Sign-In and account linking — Issue #79

## Decisions before implementation

- Keep the existing Kanvexa JWT, AuthProvider, REST envelope, verification flow
  and BoardMember authorization. Google tokens only enter the two Google REST
  endpoints; they never authorize business APIs or Socket.IO.
- `google_identities` has a UUID primary key, immutable `google_sub` (255 chars),
  unique `google_sub`, unique `user_id`, creation timestamp and a User foreign key
  with `ON DELETE NO ACTION`. Identity deletion/transfer is outside this issue.
- A new migration makes `users.password_hash` nullable without changing existing
  hashes. Google-only accounts have NULL passwords. Down migration refuses before
  destructive changes if any identity or NULL password exists. Deploy migration
  before restarting the application; old application code never sees newly
  created Google-only users until the new release starts accepting Google login.
- Use the official `google-auth-library` verifier with server-configured
  `GOOGLE_CLIENT_ID`; verify signature, issuer, audience, expiry and strict
  subject/email/verified claims. Missing configuration disables Google safely;
  a malformed nonempty client ID fails startup. No client secret is needed.
- A verified Gmail address or verified Workspace hosted domain can create an
  immediately verified account. Other Google email domains create a pending
  account and use Kanvexa's existing verification email; no JWT before mailbox
  verification. Returning subjects retain their original User ID and profile.
- Unknown subject plus existing email returns `409 ACCOUNT_LINK_REQUIRED`;
  there is no implicit link, even to an unverified local account.
- Linking requires a verified local Kanvexa JWT, current password, a verified
  Google credential and matching normalized email. Same user/subject is
  idempotent. Other ownership or a second subject is a conflict. Return 204;
  preserve the JWT, password, user ID and all business records.
- Transactions serialize Google subjects and new-account emails with PostgreSQL
  transaction advisory locks, then recheck unique constraints. Linking locks the
  User row and rechecks the password hash after external verification. Network
  verification and email delivery never run while holding database locks.
- `POST /api/auth/google { credential }` returns the existing LoginResponseDto;
  `POST /api/auth/google/link { credential, password }` returns 204;
  `GET /api/auth/linked-providers` returns only `googleLinked` and `hasPassword`.
  Stable errors include INVALID_GOOGLE_CREDENTIAL, GOOGLE_AUTH_UNAVAILABLE,
  ACCOUNT_LINK_REQUIRED, GOOGLE_ACCOUNT_CONFLICT and existing auth/mail errors.
- Frontend uses one GIS script and one initialization per page, official rendered
  buttons, popup callbacks and per-button opaque state to reject callbacks from
  unmounted buttons. Auth session scopes also gate requests and their results.
  No One Tap, auto sign-in, Google token persistence or provider API scopes.
- VITE_GOOGLE_CLIENT_ID is public build-time configuration. GOOGLE_CLIENT_ID is
  backend runtime configuration. Both must identify the same Web OAuth client.
  CD reads a repository variable for the public build argument; EC2 runtime env
  is configured separately by the operator. No live cloud configuration changes.

## Authentication flows and contracts

| Request                                                 | Result                                            | Auth                      |
| ------------------------------------------------------- | ------------------------------------------------- | ------------------------- |
| POST `/api/auth/google` `{ credential }`                | 200 LoginResponseDto in existing success envelope | Public, 10/min/IP         |
| POST `/api/auth/google/link` `{ credential, password }` | 204; unchanged session                            | Kanvexa Bearer, 5/5min/IP |
| GET `/api/auth/linked-providers`                        | `{ googleLinked, hasPassword }` in envelope       | Kanvexa Bearer            |

All DTOs reject extra fields, client audience/user IDs and oversized values:
credential is 1–8192 characters; current password is 1–128, without trimming or
new-registration policy checks. Swagger documents the endpoints and error codes.
No provider IDs, hashes or provider credentials appear in response DTOs.

| Situation                                                              | Stable outcome                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Missing/invalid claims, wrong signature/audience/issuer, expired token | 401 INVALID_GOOGLE_CREDENTIAL                                             |
| Google disabled or certificate service unavailable                     | 503 GOOGLE_AUTH_UNAVAILABLE                                               |
| Unknown subject and existing email (verified or pending)               | 409 ACCOUNT_LINK_REQUIRED                                                 |
| Pending third-party mailbox                                            | 403 EMAIL_NOT_VERIFIED; verify through K2 then click Google again         |
| New pending account mail delivery fails                                | 503 MAIL_DELIVERY_UNAVAILABLE; account remains recoverable through resend |
| Wrong/missing local password proof                                     | 403 INVALID_CREDENTIALS on link; current session remains valid            |
| Different email, second subject or identity owned elsewhere            | 409 GOOGLE_ACCOUNT_CONFLICT                                               |
| Missing/invalid Kanvexa Bearer                                         | 401 UNAUTHORIZED                                                          |
| Route/IP quota exceeded                                                | 429 TOO_MANY_REQUESTS                                                     |

First-time Gmail/Workspace users get a verified Google-only account. Third-party
users get a pending Google-only account and the existing K2 token/cooldown/email
flow. Returning subjects always resolve their stored User, even when Google email
changes to another user's email. Stored profile/email is never overwritten and
pending users never receive JWTs simply because a later Google email is Gmail.

To connect a local account, log in normally, open Profile → Connected accounts,
enter the current password and click Google's button. Choose the same verified
email. Google-only users see their provider status without a password form.
Unlinking, transfers, password creation/reset and multiple providers are outside
this issue.

## Security and concurrency boundaries

The official SDK verifies Google's rotating signing keys and server-configured
audience, issuer and lifetime. Additional strict checks reject empty/malformed
subjects, invalid email, nonboolean verification, future issue time and expiry
inside the SDK's clock-skew allowance. Google remains an external authority;
claims are never trusted from browser decoding. Workspace authority additionally
requires hosted domain to match the normalized email domain; aliases without that
match follow the safer mailbox verification path.

Profile names are stripped of control characters and capped at 80 characters;
React renders them as text. Provider pictures must be bounded HTTPS URLs without
credentials. This is client display data, never an identity/authorization key.
Google tokens/passwords are not persisted, placed in router/query cache or logged.
The existing request logger excludes bodies/headers and additionally redacts
`credential` fields. SDK errors are replaced with safe stable errors.

GIS is loaded only from Google's official script. A singleton initialization
routes responses by opaque, random button `state`; only the clicked, still-mounted
button can consume a callback. Duplicate responses are dropped. Both the request
and its eventual session/cache effect check the captured auth scope and mount.
No One Tap/prompt/automatic sign-in is invoked. Script failure, closed/blocked
popup or disabled configuration leaves local forms available. GIS does not offer
a button-popup cancellation callback here: no credential means no API request,
and the user can click again or continue locally.

This is the GIS JavaScript callback + JSON REST + explicit Kanvexa Bearer model,
not Google's HTML POST/cookie flow. No ambient auth cookie is introduced. CORS
admits exact configured origins, JSON requests require browser preflight, and a
link also requires JWT/password proof. The opaque button state correlates popup
callbacks; it is not a server-issued nonce or a replay cache. Google ID tokens
remain bearer proofs until expiry: TLS, no persistence/logging and short-lived
verification are essential; no claim is made that a stolen unexpired Google
token is single-use. A server challenge/replay registry is outside this contract.

Transactions lock `google-sub:<sub>` first; new users also lock
`google-email:<normalized email>`. These PostgreSQL transaction advisory locks
work across connections/processes. Linking then locks the current User row and
rechecks the previously verified hash. Unique constraints remain final guards.
A local registration bypassing those locks can cause 23505; one bounded retry
starts a fresh transaction and re-reads ownership/email. Serialization/deadlock
conflicts also get one retry, then stable 409. No Google/mail network call runs
inside these transactions. Local passwords, membership/ownership and all business
records remain intact. Existing single-process HTTP quotas still have the
documented multi-instance limitation.

## Local setup and Google Cloud owner checklist

1. In Google Auth Platform, create/select a project and a **Web application**
   OAuth client. Configure Kanvexa branding, support contact, authorized domain,
   homepage/privacy links and audience/test users. Review Google verification
   requirements before making the consent configuration public.
2. Authorized JavaScript origins: `http://localhost`,
   `http://localhost:5173`, `https://kanvexa.tech`. Add another exact origin only
   when actually testing it (for example `http://localhost:8080` for local Caddy).
   Origins have no path/trailing slash. Do not assume `127.0.0.1` is the same origin.
3. This implementation uses popup JS callbacks. It has no redirect receiver and
   needs no invented `/auth/google/callback` redirect URI. Request only basic
   identity; do not enable Gmail/Drive/Calendar access or create a client secret
   for this code.
4. Set the same public Web client ID as `GOOGLE_CLIENT_ID` and
   `VITE_GOOGLE_CLIENT_ID` in the local root env. Restart backend and Vite after
   changing them. Empty disables the feature; nonempty malformed backend config
   fails startup. Keep mail fake unless deliberately testing third-party mailbox
   delivery using the existing documented Resend opt-in.
5. Apply local migrations normally, then test Login/Register, first/returning
   accounts, local email collision, Profile connection, wrong password, wrong
   Google account and popup close/block. Verify old user ID/boards remain the same.
   Complete third-party mailbox verification and then click Google again.

Local Docker: development `docker-compose.yml` still supplies PostgreSQL only;
host Vite/Nest read root configuration. Full-image Compose builds accept the
public client ID build argument; `compose.local.yml` uses port 8080 and fake mail
test mode. Automated tests mock Google and mail; do not expect a real inbox there.

## Production configuration and rollout gates

| Where                              | Variable / action                             | Owner verification                                                     |
| ---------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| GitHub repository variable         | VITE_GOOGLE_CLIENT_ID                         | Public Web client ID, available to publish before environment approval |
| EC2 protected external runtime env | GOOGLE_CLIENT_ID                              | Same Web client ID; not a Vite runtime setting                         |
| Operator local image build only    | VITE_GOOGLE_CLIENT_ID in selected Compose env | Build-time value; changing it requires rebuilding frontend             |
| Google Cloud                       | Web client origins / branding / audience      | Owner-managed; no live settings changed by this task                   |
| Existing mail configuration        | Resend key, sender, public HTTPS URL          | Remains server-only; required for third-party mailbox verification     |

Before approving a release:

1. Confirm the merged base includes #76 and #77; review exact release SHA, backup,
   off-instance restore rehearsal and the new migration on a copy of legacy data.
2. Verify both client IDs match and the published frontend actually embeds the
   intended public ID. Empty configuration is safe disablement, not successful
   Google rollout. Keep secrets out of Vite/build arguments and logs.
3. Keep existing CD sequence: quality → publish SHA-tagged amd64 images → production
   approval → stop app/backup → explicit migration → start/smoke. Only deploy uses
   the protected production environment; no migration interruption or parallel
   deployments. Existing deployment scripts remain unchanged.
4. Verify HTTPS outbound access to Google signing certificates and Resend; check
   server clock, exact CORS and Google JavaScript origins. Caddy popup/referrer
   headers are included. If adding a CSP later, use Google's documented GIS
   script/frame/connect/style allowlist; backend Helmet is not a frontend CSP.
5. Run real Google popup E2E on authorized local and production origins, including
   Gmail, Workspace where available, third-party email, collision/linking, popup
   cancel, blocked popup, browser privacy modes, mobile and keyboard access.
6. Compare User ID, board ownership/membership/history before and after linking;
   verify both sign-in methods and unchanged local password policy/email template.

Migration up is additive/relaxes NOT NULL and preserves all hashes. It can run
while the previous release still handles local users, but new Google traffic must
not reach old code; current deployment already stops the app before migrating.
Down acquires table locks and refuses before destructive statements when **any**
identity or NULL password exists. After first use, keep the schema and deploy a
compatible forward fix/rollback. Disabling OAuth does not restore passwordless
users' ability to use an old release. Never delete identity/users to force down.
Restore backup only through an explicitly approved recovery plan with accepted
data-loss window.

## Verification record

Local base: `ba99763` (main/origin/main after fetch), including merged #76/#77.
Branch: `feat/google-auth-account-linking`. No existing worktree edits were present.

| Check                                               | Actual result                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Google verifier targeted Jest                       | 24 passed; locally RSA-signed tokens exercise the actual Google SDK, certificate retrieval stubbed                                                     |
| Google HTTP contract/throttle tests                 | 9 passed; guards, strict DTOs, safe serialization and per-route quotas                                                                                 |
| AuthService regression tests                        | 10 passed, including NULL-password and weak legacy password cases                                                                                      |
| Full `pnpm test`                                    | 942 passed: backend 447 / 47 suites, frontend 489 / 61 files, shared 6                                                                                 |
| Google PostgreSQL suite                             | 14 checks passed: real disposable PostgreSQL, mocked verifier/mail; migrations, unique constraints, pending email/recovery and parallel signup/linking |
| K2 PostgreSQL/HTTP/Socket.IO suite                  | 16 checks passed, including database foundation schema drift and three-migration run/revert/rerun                                                      |
| `pnpm lint`                                         | Passed after final changes                                                                                                                             |
| `pnpm build`                                        | Passed; existing local NODE_ENV warning and >500 kB chunk warning remain                                                                               |
| `pnpm test:infra`                                   | 16 passed; Compose public IDs/disabled state plus unchanged CI/CD dependencies, permissions, main gates and concurrency                                |
| actionlint 1.7.12                                   | Passed for CI/CD through the versioned Docker image                                                                                                    |
| Docker frontend build                               | Passed for linux/amd64 with synthetic public client ID; embedded ID checked, Caddy config validated                                                    |
| `pnpm format:check`                                 | Fails on 420 untouched checkout files; no changed file appears among the warnings                                                                      |
| Changed-file Prettier                               | Passed for every changed supported file                                                                                                                |
| Whole-repository Prettier with `--end-of-line auto` | Passed, confirming checkout line endings cause the default check failure                                                                               |
| `git diff --check`                                  | Passed                                                                                                                                                 |

The first full test run encountered six existing UI test timeouts during concurrent
Docker build activity. Rerunning `pnpm test` with `VITEST_MAX_WORKERS=2` passed all
942 tests without changing source timeout/worker settings. After final button
markup cleanup, 21 affected frontend tests passed again, followed by the 7 loader
tests after additional callback-state assertions. Google database checks were
rerun after adding mailbox-outage and rollback guard coverage.

The backend Docker build also passed for linux/amd64; the Google SDK and compiled
auth services load successfully in the final Linux runtime without contacting Google.

Commands for reproducing the database suites (both own disposable Docker resources):

```sh
pnpm --filter @kanban/backend test:google-auth:database
pnpm --filter @kanban/backend test:email-verification:database
```

Chrome DevTools MCP was unavailable. An installed headless Chrome with a fresh,
isolated profile rendered the built Docker frontend with synthetic GIS/API only.
25 route/viewport checks covered Login, Register, Check Email, Verify Email and
Profile at 1920×1080, 1366×768, 1280×720, 390×844, plus dark media preference on
mobile (existing application theme retained). No horizontal overflow, missing
input labels, inaccessible local submit CTA or JavaScript/network failure was
observed. Login/Register frames matched exactly on each viewport; mobile Register
scrolls inside the frame. Mocked sign-in reached Boards and Profile showed account
status/password proof. Screenshots and metrics remain local under ignored
`.codex/previews/google-auth/`. This does not verify Google's real button iframe,
FedCM, consent, popup or email delivery. Final disposable QA containers were stopped.

Real Google popup E2E and production configuration/migration rehearsal remain
pending owner gates. No push, PR, merge, production deployment, real Google
authentication or real email delivery is performed by these tests.

Reference: Google's [ID token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token),
[GIS JavaScript API](https://developers.google.com/identity/gsi/web/reference/js-reference),
[button rendering](https://developers.google.com/identity/gsi/web/guides/display-button)
and [client/origin/CSP/COOP setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

## Changed file inventory

53 files relative to the base commit:

```text
.env.example
.env.production.example
.github/workflows/cd.yml
README.md
apps/backend/package.json
apps/backend/src/api/auth/auth.module.ts
apps/backend/src/api/auth/auth.service.ts
apps/backend/src/api/auth/dto/google-auth.dto.ts
apps/backend/src/api/auth/dto/linked-providers.dto.ts
apps/backend/src/api/auth/entities/google-identity.entity.ts
apps/backend/src/api/auth/google-auth.controller.ts
apps/backend/src/api/auth/google-auth.service.ts
apps/backend/src/api/auth/google-token-verifier.service.ts
apps/backend/src/api/users/entities/user.entity.ts
apps/backend/src/common/dto/api-error.ts
apps/backend/src/config/environment.ts
apps/backend/src/database/migrations/1792850400000-GoogleIdentity.ts
apps/backend/src/logging/logger-options.ts
apps/backend/test/auth/auth.service.spec.ts
apps/backend/test/auth/email-verification.integration.mjs
apps/backend/test/auth/google-auth.e2e-spec.ts
apps/backend/test/auth/google-auth.integration.mjs
apps/backend/test/auth/google-token-verifier.spec.ts
apps/backend/test/database/database-foundation.integration.mjs
apps/frontend/Dockerfile
apps/frontend/src/features/auth/api.ts
apps/frontend/src/features/auth/components/ConnectedAccounts.test.tsx
apps/frontend/src/features/auth/components/ConnectedAccounts.tsx
apps/frontend/src/features/auth/components/GoogleAuth.tsx
apps/frontend/src/features/auth/components/GoogleSignInButton.test.tsx
apps/frontend/src/features/auth/components/GoogleSignInButton.tsx
apps/frontend/src/features/auth/google-identity.test.ts
apps/frontend/src/features/auth/google-identity.ts
apps/frontend/src/features/auth/pages/GoogleAuthPages.test.tsx
apps/frontend/src/features/auth/pages/LoginPage.tsx
apps/frontend/src/features/auth/pages/ProfilePage.test.tsx
apps/frontend/src/features/auth/pages/ProfilePage.tsx
apps/frontend/src/features/auth/pages/RegisterPage.tsx
apps/frontend/src/test/fake-google.ts
apps/frontend/src/vite-env.d.ts
apps/frontend/vite.config.ts
compose.prod.yml
docs/architecture/backend-architecture.md
docs/architecture/database-design.md
docs/architecture/frontend-architecture.md
docs/deployment/cicd.md
docs/deployment/production.md
docs/project-overview.md
docs/tasks/google-auth-account-linking.md
infra/caddy/routes.caddy
pnpm-lock.yaml
scripts/deployment/cicd.test.mjs
scripts/deployment/config.test.mjs
```
