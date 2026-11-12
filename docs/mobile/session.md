# Mobile session contract (MOB-05)

This page is the hand-off for code that needs the signed-in user on mobile:
route guards (MOB-03), the REST/Query layer (MOB-04), realtime (MOB-06) and the
later Auth screens (MOB-08/09). Source: `apps/mobile/src/infrastructure/auth/`.

## Backend facts it is built on

Checked in source on `main` (`c062cf1`):

| Call                    | Contract                                                                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/login`  | `200` envelope, `data = { accessToken, tokenType: 'Bearer', expiresIn: 3600, user }` (`LoginResponseDto`). Google exchange (`POST /api/auth/google`) returns the same shape. |
| JWT                     | Claims `sub` (user UUID), `authVersion`, `iat`, `exp`, issuer `kanban-api`, audience `kanban-web`. Fixed one-hour lifetime. **No refresh token** exists.                     |
| `GET /api/users/me`     | `200` envelope with `UserResponseDto`. Any expired, revoked (`authVersion` changed by password/email/security change), deleted or unverified token gets `401`.               |
| `POST /api/auth/logout` | Bearer-guarded, `204`, **stateless**: the server revokes nothing. Credential changes revoke tokens through `authVersion`, not through logout.                                |

## States

`restoring → verifying → authenticated | unauthenticated | expired | offline-uncertain`

| Status              | Meaning                                                                           | Guard should show                 |
| ------------------- | --------------------------------------------------------------------------------- | --------------------------------- |
| `restoring`         | Reading SecureStore on cold start                                                 | Neutral auth-check screen         |
| `verifying`         | A token exists; `/users/me` not answered yet                                      | Neutral auth-check screen         |
| `authenticated`     | `/users/me` confirmed the token's own user                                        | Protected routes                  |
| `unauthenticated`   | `reason`: no credential, signed out, invalid, storage error, 401, security change | Sign in                           |
| `expired`           | Local absolute expiry passed (no silent renewal)                                  | Sign in with an "expired" message |
| `offline-uncertain` | Token kept, but offline/timeout/5xx/429 stopped the check                         | Retry; **no** protected content   |

Only `401` signs a stored token out. A timeout or server error never does, but
the content stays locked until a later check succeeds.

`generation` increases every time the credential behind the session changes
(login, account switch, logout, 401, security change, expiry). Snapshots never
contain the token.

## API

```ts
import {
  useSessionManager,
  useGuardSession,
  SessionGate,
} from '…/infrastructure/auth/SessionProvider';

const session = useSessionManager();
session.getAccessCredential(); // { accessToken, generation } | null — call per request
session.isCurrent(generation); // drop responses from older sessions
session.handleUnauthorized(generation); // a 401 seen by a request with this tag
session.handleSecurityInvalidation(generation); // after a server-confirmed password/email change
session.establishSession(loginResponseData); // MOB-08/09 after a successful login API call
session.logout(); // local teardown first, then best-effort POST /auth/logout
session.retryVerification(); // Retry button for offline-uncertain
session.handleNetworkRestored(); // MOB-04: call when the network comes back
session.addLifecycleListener({ onSessionEnd, onSessionStart });
```

`SessionProvider` (mounted in `src/app/_layout.tsx`) starts the restore once and
re-checks expiry on every return to the foreground. `SessionGate` renders its
children only while authenticated and remounts them when `generation` changes.

## What each owner plugs in

MOB-04 now implements the transport/query integration below through the existing
session owner. See [network and MOB-06 integration](network.md). Session verification
and logout use the same HTTP implementation as feature requests; their bootstrap
port still takes an explicit bearer and never recursively calls session guards.

- **MOB-04 transport/Query:** read `getAccessCredential()` immediately before
  sending, never cache the token. Tag the request with its `generation`; after
  the response, ignore it unless `isCurrent(generation)`. On `401` call
  `handleUnauthorized(generation)` — a late `401` from an old session returns
  `false` and changes nothing. `403`/`404` are resource errors, not logouts.
  Register `onSessionEnd` to cancel queries/uploads and clear every private
  cache **synchronously**. Include `generation` in query keys. Call
  `handleNetworkRestored()` from the online manager.
- **MOB-03 navigation:** use `useGuardSession()`; `canShowProtectedContent`
  is true only for `authenticated`, `isResolving` for the two loading states,
  `canRetry` for `offline-uncertain`. Reset the protected stack in
  `onSessionEnd`. The pending deep-link target stays MOB-03's.
- **MOB-06 realtime:** connect in `onSessionStart` (or when a subscriber needs
  it) with a token from `getAccessCredential()` taken at each connect or
  reconnect. Disconnect and drop listeners/rooms in `onSessionEnd`. Ignore any
  socket callback whose captured `generation` is no longer current. A
  `connect_error` that means auth failure should call
  `handleUnauthorized(generation)`.

`onSessionEnd` runs before the new state is published, so nothing from the old
session is visible when the next screen renders.

## Storage

One SecureStore item, `kanvexa.session.v1`, holding
`{ v: 1, accessToken, expiresAt }` with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`
(iOS: no backup migration to other devices). Expiry is
`time of login response + expiresIn` on the device clock, so a device with a
wrong clock can still sign in. A record is written only after `/users/me`
confirms it, and read back to catch partial writes. Corrupted, unknown-version
or unreadable values are deleted. A token kept by the iOS Keychain after
reinstall is still verified with the server before use. No biometric prompt.

## Not included

No refresh token, session registry, 2FA, push, native Google sign-in or Login
UI. With no valid HTTPS `EXPO_PUBLIC_API_BASE_URL` (HTTP is accepted only for
local/LAN hosts in development builds), no request is sent and a stored token
stays unverified.
