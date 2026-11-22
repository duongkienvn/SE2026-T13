# MOB-39 Native Security, password recovery entry and Connected Google

[Issue #319](https://github.com/duongkienvn/SE2026-T13/issues/319)

Built on `main` after MOB-37 (#318) and MOB-38 (#322) were merged. Adds two
private screens, `/security` and `/connected-accounts`, plus two plain entries
in the existing `/settings` list. MOB-41 owns the final grouped Settings
landing; nothing from MOB-37/38 was moved or renamed.

## Backend contracts used (unchanged)

| Route                        | Body                                   | Success                                          |
| ---------------------------- | -------------------------------------- | ------------------------------------------------ |
| `GET /auth/linked-providers` | —                                      | `200 {googleLinked, hasPassword}`                |
| `POST /auth/change-password` | `{currentPassword, newPassword}`       | `204`; authVersion rotated, all sessions revoked |
| `POST /auth/google/link`     | `{credential, password}`               | `204`; **no** session rotation                   |
| `POST /auth/forgot-password` | `{email}` (public, existing MOB-08 UI) | `202` generic acknowledgement after ~10.5 s      |

Verified against `password-security.controller/service.ts`,
`google-auth.controller/service.ts`, `password-policy.ts` and the DTOs.

## What changed

### `features/security/api.ts`

- `passwordDraftErrors()` reuses the MOB-08 `passwordError()` (8–128 code
  points like class-validator, ASCII `A–Z`, ASCII digit, `\p{P}`/`\p{S}`;
  whitespace never counts; no lowercase rule). Adds current-password required
  (≤128), confirmation equality and “different from current”.
- `changePasswordBody()` sends exactly `{currentPassword, newPassword}` —
  never the confirmation, never trimmed. `googleLinkBody()` bounds the ID token
  (≤8192) and password (1–128).
- Both commands use `SessionHttpClient.empty()` (204 only, `retries: 0`), so a
  JSON 200 is an `invalid-response`, not a success.
- `isAmbiguous()` marks a started request that timed out / dropped / returned
  an unusable reply. Error copy is fixed text per code; server messages are
  never shown.

### `SessionHttpClient`

The MOB-37 exemption (“`INVALID_GOOGLE_CREDENTIAL` 401 is a proof failure,
not a session failure”) now also covers `POST /auth/google/link`. It stays
path-specific: the same code on any other route still ends the session
(tested).

### `useChangePassword`

- Provider status from `GET /auth/linked-providers` decides the form. Unknown
  status (offline, 5xx) shows Retry, **never** an assumed password form.
- Secrets leave React state when Submit is pressed, on blur and on session end.
  One in-flight command; no command while offline or during a 429 cooldown
  (Retry-After, min 60 s).
- `204` → `manager.handleSecurityInvalidation(generation)`. That is the
  existing session teardown (SecureStore wipe, private query cache, sockets,
  push scope, private files) and is generation-fenced: a late 204 for User A
  cannot end User B’s session. The sign-in screen then says the password
  changed and a new sign-in is required.
- Ambiguous result → no replay. The hook re-reads provider status with the
  same JWT: a rotated authVersion answers 401 and the normal teardown runs; a
  200 means the old session is still valid.
- `403 CURRENT_PASSWORD_INCORRECT` keeps the session.

### `useGoogleLink`

- **Connect Google** only when the server says `hasPassword && !googleLinked`,
  a native Google provider exists in this build (MOB-09 lazy module) and the
  device is online.
- Order: current password typed first → `freshGoogleProof()` (MOB-37 helper:
  SDK reset, fresh ID token, audience pre-check, SDK reset again) → link.
  `/auth/google` login exchange is never called.
- `204` → stays signed in (same generation), re-reads provider status.
- Cancel/busy/Play services/audience, 401 proof, 403 password, 409 conflict,
  429, 503, offline and ambiguous each get distinct copy.

### Screens

- `SecurityScreen`: description, provider-gated change-password card with
  three secure fields (`current-password` / `new-password` autofill, iOS
  `passwordRules`, separate Show/Hide labels), policy hint, Change password,
  Clear form; recovery card.
- `ConnectedAccountsScreen`: `Google: Connected/Not connected`,
  `Password: Set/Not set` (server-only values), link card, explanations for
  linked (no unlink in this version), Google-only (set a password first) and
  unconfigured builds.
- Both use `useDraftNavigation` (discard prompt clears secrets; Back is held
  while a command is in flight), SafeAreaView, keyboard insets, live-region
  status text and existing tokens/components.
- No 2FA, active sessions, login activity or unlink control exists anywhere.

### Recovery entry (documented variance)

`/forgot-password` is a public route guarded by `PublicAuthGate`; it cannot
open while signed in. The issue allows “an explicit signed-out path”, so the
Security screen offers **Sign out and recover password** (or **… set a
password** for Google-only accounts) behind a confirmation. It calls the
normal `manager.logout()`, then pre-fills the verified email into the existing
MOB-08 flow and opens `/forgot-password`. Nothing is sent automatically; the
user still requests the link and sees the generic 202 acknowledgement. No new
token deep-link handler was added.

## Checks

See the PR for the exact command list and results. Added:

- `test/security/contracts.test.ts` (Node, 11 tests): policy boundaries
  (7/8/128/129, code points, whitespace, non-ASCII uppercase), confirmation,
  reuse, exact bodies, 204-only decoding, 403 keeps session, JWT 401 ends it,
  proof 401 exemption is path-specific, stale 204 after A→B, strict provider
  decoder, error copy, route allowlist.
- `test/security.component.test.js` (Jest, 11 tests): invalid drafts never
  sent, double tap → one POST, no sign-out before 204, 204 teardown
  (security-change, empty cache, socket disconnected), 403, 429 cooldown,
  ambiguous reconciliation, Google-only recovery hand-off, unknown status,
  status combos, link success without rotation, cancel/401/409.

## Not verified

- No Android/iOS device or emulator here: real Google account linking, secure
  keyboard/autofill, TalkBack/VoiceOver, hardware Back, large font and dark
  mode on device are untested.
- No live backend smoke for change-password/link (contracts checked against
  backend source; Node/Jest use fake transport).
