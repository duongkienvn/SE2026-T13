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

## Verification and rollout record

Implementation and verification results will be recorded here as work completes.
Real Google popup E2E requires an owner-configured Web client and remains a rollout
gate independently of mocked automated tests.
