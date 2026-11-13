# MOB-09 — Native Google Sign-In and ID-token exchange

Implementation record for [issue #262](https://github.com/duongkienvn/SE2026-T13/issues/262),
on `feat/mobile-google-auth` from freshly fetched `main` (MOB-08 #257 merged via
PR #264, MOB-10 via PR #265). Backend, database, Web UI, production configuration,
app identifiers (`tech.kanvexa.mobile.dev`, scheme `kanvexa-dev`) and MOB-05
credential storage are unchanged.

## SDK choice

| Decision         | Value                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Library          | `@react-native-google-signin/google-signin` **16.1.5** (exact pin), free "original" Google Sign-In API                                |
| Why this version | Stable since 2026-09-03; includes the Android fix for AGP built-in Kotlin. 16.2.0/17.0.0 were ~2 weeks old and 17 changes the iOS SDK |
| Peer range       | `expo >=52.0.40`, any React Native; ships an Expo config plugin                                                                       |
| Runtime          | Native module `RNGoogleSignin`: **development/preview build only, never Expo Go**                                                     |
| Not used         | Web GIS DOM/iframe, WebView, system-browser OAuth, One Tap paid module, server auth code, offline access                              |

`configure({ webClientId, iosClientId?, offlineAccess: false })` asks Google for an
ID token whose `aud` is the **Web/server client ID = backend `GOOGLE_CLIENT_ID`**.
The backend verifier (`google-token-verifier.service.ts`) is therefore used
unchanged: signature, single audience, issuer, `exp`/`iat`, `sub`, verified email.
No backend audience allowlist is needed, so no separate approval decision arises.

## Contract and flow

`POST /api/auth/google` with exactly `{ credential }`, no bearer, never retried
(MOB-04 retries only `GET`). The 200 envelope is decoded with the same strict
`decodeLogin` used by password login, then handed to
`SessionManager.establishSession(response, signal)`. MOB-05 verifies `/users/me`,
persists the Kanvexa JWT in SecureStore and RootStack navigates to the return
target or Home. The Google ID token is held only in memory for the single request.

```
tap → provider.requestIdToken()  (Play services check on Android, account chooser)
    → SDK signOut() (always, best effort)  → current()? else discard
    → aud == Web client && iss is Google?  else stop, nothing sent
    → api.google(token)                    → current()? else discard
    → manager.establishSession(login)      → RootStack → Home
```

`current()` is the shared MOB-08 `usePublicRequest` fence: the attempt's abort
signal (screen blur, navigation, unmount) plus the session generation at start.
A token or response that arrives after cancel, sign-out, account replacement or
leaving the screen is dropped without a request or a session.

| Result                              | Copy / behavior                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| User closes Google                  | Nothing shown; session unchanged                                                    |
| SDK `IN_PROGRESS`                   | Ignored (a prompt is already open)                                                  |
| Play services missing               | Ask to update Play services or use email/password                                   |
| Other SDK error (`DEVELOPER_ERROR`) | Generic "couldn’t be completed"; SDK message never shown or logged                  |
| Token for another audience          | "isn’t set up correctly"; token not sent                                            |
| 400/401 `INVALID_GOOGLE_CREDENTIAL` | "could not be verified"                                                             |
| 403 `EMAIL_NOT_VERIFIED`            | Check inbox + existing "Verify email or resend link" on Sign in                     |
| 409 `ACCOUNT_LINK_REQUIRED`         | Sign in with password first; connect Google later in account settings. No auto-link |
| other 409                           | Use password sign-in                                                                |
| 429                                 | MOB-08 cooldown; both Sign in and Google disabled                                   |
| 503 `GOOGLE_AUTH_UNAVAILABLE`       | Unavailable, use email/password                                                     |
| offline / network / timeout         | Connection / "timed out, try again"                                                 |
| `establishSession` not ok           | Same messages as password login; no half session                                    |

New accounts are created only by the backend transaction (Personal Workspace +
starter Board). The Sign up screen's Google action never calls `/auth/register`.

## UI

"or continue with" divider and an outlined **Continue with Google** button with
the Google "G" mark (same paths as the Web `GoogleGIcon`, exported as 20/40/60 px
PNGs in `apps/mobile/assets/brand/`) below the primary button on Sign in (as in
[09-authentication.png](../../mobile/assets/09-authentication.png)) and Sign up.
It reuses MOB-02 `Button variant="secondary"` and theme tokens, so dark mode,
focus ring, disabled/busy state and font scaling follow the existing system.
Email and Google share one request lock: the other action is disabled while one
runs, double taps open one prompt.

The action is **omitted** (no dead button) when the build has no
`RNGoogleSignin` module (Expo Go, older builds) or no valid public client ID for
the platform (iOS also needs `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`). The SDK is
`require`d lazily after probing `TurboModuleRegistry.get`, because its entry
throws at import time without the native module.

## Files

- `src/features/auth/google-config.ts` — public client ID validation per platform.
- `src/features/auth/google-identity.ts` — provider port, audience pre-check, attempt orchestration.
- `src/features/auth/google-native.ts` — SDK adapter and module probe.
- `src/features/auth/GoogleSignIn.tsx` — divider, button, error copy.
- `api.ts` (`google()`), `runtime.tsx` (`google` provider prop), Sign in/up screens, `_layout.tsx`.
- `app.config.ts` — SDK config plugin only when an iOS client is configured (URL scheme).
- `.env.example`, [development guide](../../mobile/development.md#native-google-sign-in-setup-mob-09).

## Verification

| Check                                                            | Result                                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm --filter @kanban/mobile typecheck`                         | Pass                                                                                            |
| `pnpm --filter @kanban/mobile test`                              | Pass — Node 181/181 (12 new), Jest 17 suites 118/118 (32 new)                                   |
| `pnpm lint`                                                      | Pass                                                                                            |
| `bundle:android` with a dummy public Web client ID               | Pass; SDK in bundle, client ID inlined, no env-name leak                                        |
| `expo config` without / with iOS client                          | Plugin absent / iOS URL scheme added; IDs unchanged                                             |
| Changed-file Prettier (`--end-of-line auto`), `git diff --check` | Pass                                                                                            |
| Mutation check (10 mutants)                                      | 9 killed; survivor = redundant pending guard behind the shared request lock and disabled button |

Tests cover: config parsing, audience/issuer pre-check (native audience, array
aud, wrong issuer, malformed, oversize), exact `{credential}` body without bearer,
strict 200 decoding, 401/403/409/429/503 never retried, cancel/busy/Play
services/SDK failure never calling the backend, late token and late response
after abort or generation change, SDK reset even on exceptions, adapter
`configure`/Play-services/error-code mapping, missing provider hiding the action,
sign-up never registering, 429 cooldown, double tap, unmount, dark theme tokens.

## Not verified here (external)

- **No real Google sign-in was performed.** This machine has no Android SDK or
  emulator and no approved OAuth clients/SHA-1 registration, so the native
  prompt, real ID token, backend 200 exchange, Home landing, stable `sub` on a
  repeat sign-in, account-link conflict and Play-services dialog are untested
  on device. iOS was not built or tested (Windows).
- No device screenshots: the auth screens could not be rendered natively here.
  Visual parity relies on the unchanged MOB-08 frame plus MOB-02 components.
- To finish acceptance: register the Android client (package + debug and EAS
  preview SHA-1), set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` to the staging backend
  `GOOGLE_CLIENT_ID`, build a dev/preview APK, then test sign-in, cancel,
  re-sign-in, a pre-existing password account (409), sign-out → other Google
  account, airplane mode mid-flow, TalkBack, 320 dp and large font, dark mode.

## MOB-39 handoff

`POST /api/auth/google/link` and `GET /api/auth/linked-providers` are not used.
Linking (with current-password reauthentication) and showing linked status
belong to MOB-39; it can reuse `GoogleIdentityProvider` and the audience check
to obtain a fresh credential.
