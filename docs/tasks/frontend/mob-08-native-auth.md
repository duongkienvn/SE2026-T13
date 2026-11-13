# MOB-08 — Native email/password authentication

Implementation record for [issue #257](https://github.com/duongkienvn/SE2026-T13/issues/257),
on `feat/mobile-auth-ui` from clean, freshly fetched `main`. The base already
contained MOB-02/03/04/05/06. Backend, database, Web UI and production configuration
are unchanged. No dependencies were added.

## Delivered behavior and confirmed contracts

Native Sign in, Sign up, Check/Verify Email, resend verification, Forgot Password
and Reset Password replace the public scaffolds. They reuse the official K,
MOB-02 semantic tokens/components, safe areas, scrolling keyboard layout, 48 dp
actions, accessible labels/status, autofill, Next/Done and password visibility.
Password drafts clear on blur, cancellation and submission outcomes.

Rechecked current Auth/PasswordSecurity controllers, DTOs, password policy,
AuthService, EmailVerificationService and PasswordSecurityService, Web auth
adapters/screens, and native transport/session source.

| API-relative operation           | Exact body                     | Successful response                  |
| -------------------------------- | ------------------------------ | ------------------------------------ |
| `POST /auth/login`               | `{email,password}`             | `200` envelope: bearer, expiry, user |
| `POST /auth/register`            | `{email,password,displayName}` | `201` envelope: user, no JWT         |
| `POST /auth/verify-email`        | `{token}`                      | `204` empty                          |
| `POST /auth/resend-verification` | `{email}`                      | `202` envelope, `data:null`          |
| `POST /auth/forgot-password`     | `{email}`                      | `202` envelope, `data:null`          |
| `POST /auth/reset-password`      | `{token,newPassword}`          | `204` empty                          |

Public adapters use the same MOB-04 transport without bearer/cookies, query cache,
persisted mutation variables or automatic POST retries. Email/name are trimmed;
passwords are preserved exactly. Validation follows server code-point lengths,
ASCII uppercase/digit and Unicode punctuation/symbol rules; spaces are not symbols.
Registration, resend and forgot use a 45-second deadline. Both resend and forgot
controllers deliberately wait at least 10.5 seconds.

Login calls MOB-05 `establishSession(response, signal)`. Only that manager verifies
`/users/me`, stores credentials and publishes authenticated state. Optional AbortSignal
cancels an unfinished establishment without affecting a newer generation or an
already authenticated session. MOB-03 retains canonical return-target resume;
MOB-04/06 retain cache/socket teardown. There is no second logout owner.

Registration `201` enters Check Email without a session. Post-commit
`MAIL_DELIVERY_UNAVAILABLE` enters the same flow with account-created/resend guidance.
Ambiguous registration network/server outcomes offer the existing-account path and
block resubmission within that form. Resend/recovery copy is conditional and does
not promise delivery or disclose account eligibility. Cooldowns last at least 60
seconds, extended by a longer finite Retry-After on `429`.

Verification offers Sign in and never establishes a session. Successful reset
scrubs password/proof and returns to Sign in with fresh-login guidance. Invalid,
expired, reused or interrupted proofs have a new-link recovery path. Public forms
remain locked during restore, verification and offline-uncertain states; Sign in
offers the existing verification retry. The foundation navigation-preview bypass
is retired in all builds and its obsolete EAS flag is removed. Existing tab/Home
scaffolds are preserved without fabricated business content.

## Email-link and privacy boundary

Default delivery remains the existing HTTPS Web verification/reset page followed
by return to native Sign in. App/Universal Link association is not configured or
claimed; it belongs to MOB-46. No production link was opened for QA.

`parseTrustedAuthLink` is separate from MOB-03 `parseLink`. It accepts only raw,
exact `https://kanvexa.tech/verify-email?token=<43 base64url characters>` or
`https://kanvexa.tech/reset-password?token=<43 base64url characters>` forms. It
rejects alternate origins/schemes, ports, credentials, encodings, traversal,
fragments, duplicate/additional parameters and trailing whitespace. Native intent
intake stores the proof privately and returns only the public pathname to Router.
Generic resource links continue rejecting query-bearing URLs.

Proofs never enter observable snapshots, navigation params, query keys, persistent
storage or logging. Outstanding identical callbacks deduplicate. A monotonic
version fences superseded requests and cleanup. Consuming, canceling, superseding,
session start/end and provider teardown scrub memory. Unused proofs also expire
locally after ten minutes, checked at claim time after suspended timers. This
retention bound does not advertise the server's email-link expiry. Local proof
claims are single-use; subsequent delivered replays receive the backend's safe
single-use rejection and actionable error UI.

## Design decisions and variances

Authority: [Design Spec §4.9 and §5–7](../../mobile/KANVEXA_MOBILE_DESIGN_SPEC.md),
[Authentication image](../../mobile/assets/09-authentication.png),
[roadmap](../../mobile/KANVEXA_MOBILE_ROADMAP.md),
[architecture §6](../../mobile/KANVEXA_MOBILE_ARCHITECTURE.md), and #257 decisions.

| Reference element                                     | State / implementation                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Official K/wordmark, violet lower wave, spacious form | Available; official artwork/tokens and native geometric wave                                   |
| Icon fields, eye toggles, indigo CTA and inline links | Available; existing primitives extended with opt-in inline toggle/link variant; visible labels |
| Check-email illustration/instructions                 | Available; native envelope motif and conditional server-grounded copy                          |
| Google/divider                                        | Omitted as allowed by #257; no dead OAuth CTA                                                  |
| Mandatory legal checkbox/new agreement fields         | Excluded; no established contract or speculative legal destination                             |
| Mockup delivery/30-minute claims                      | Replaced with conditional acknowledgement and browser-return instructions                      |
| Gradient CTA/light-only reference                     | Existing MOB-02 solid semantic CTA and Light/Dark/System colors preserved                      |

## Verification

Recorded 2026-11-13. Isolated test fixtures are not production users or live-backend
acceptance evidence.

| Check                                            | Result                                                                                                                                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                 | Pass; unchanged lockfile; existing ignored `@parcel/watcher` build-script warning                                                                                                                                                          |
| `pnpm --filter @kanban/mobile test`              | Pass: 159 Node tests, 80 component tests / 15 suites, including prior navigation/transport/session/query/realtime regressions                                                                                                              |
| `pnpm --filter @kanban/mobile typecheck`         | Pass                                                                                                                                                                                                                                       |
| `pnpm exec eslint apps/mobile`; `pnpm lint`      | Pass                                                                                                                                                                                                                                       |
| `pnpm build`                                     | Pass: shared/backend/frontend/mobile; existing Web large-chunk warning                                                                                                                                                                     |
| `pnpm bundle:mobile`                             | Pass: Android Metro/Hermes export and shared ESM/official-logo/gallery-exclusion audit                                                                                                                                                     |
| `pnpm --workspace-concurrency=1 test`            | Failed in frontend default-worker stage: 23 files / 43 tests failed, predominantly UI timeouts; shared 20 and backend 1,283 tests passed; mobile passed separately                                                                         |
| Frontend bounded-worker rerun                    | 157/158 files and 1,675/1,677 tests passed; the two unchanged CardDetailV2 cases exceeded the suite's 5-second timeout. The affected file passes all 18 tests with 15 seconds; frontend auth regression subset passes 227 tests / 22 files |
| `pnpm test:infra`                                | Pass: 25 infrastructure tests                                                                                                                                                                                                              |
| Exact changed-file Prettier / `git diff --check` | Pass (verified separately after final edits)                                                                                                                                                                                               |
| `pnpm format:check`                              | Fails on 1,445 repository files; unrelated baseline formatting preserved                                                                                                                                                                   |
| Live local backend / actual mail journey         | Not run: no designated running local backend; local Docker daemon unavailable. No production traffic/accounts/emails, migrations or load test                                                                                              |
| iOS / standalone Android / App Links             | Not run: Windows host; no iOS simulator, signed binary or configured association in this task                                                                                                                                              |

New tests cover exact DTO/status/envelope-vs-empty handling, policy/masking,
`401/403/409/429/503`, delayed forgot/resend, offline/timeout/abort, duplicate taps,
post-commit delivery failure, stale login/proof callbacks, canonical return resume
and logout cache isolation. The existing manager suite covers SecureStore failure,
restore, account replacement and token expiry/invalidation. Router integration uses
the real public transport/adapters and manager against controlled network responses.
Its existing test-only React `useEffectEvent` shim and development
`ROUTE_NAMES_CHANGED` warnings remain limited to the harness.

## Native visual evidence

Android API 37 emulator, Expo Go 58.0.5, actual production screens. Expo's floating
Tools control is development chrome. Temporary sizes: 375×812 dp and 320×568 dp;
font scales 100% and 160%. Light/system-dark, scrolling, masked entry and keyboard
dismissal were inspected. Large-text content scrolls to actions; dragging
deliberately dismisses the keyboard. These captures do not prove iOS, standalone
link delivery or actual mail.

- [Sign in, light 375 dp](../../design/screens/implementation/mob-08-native-auth/sign-in-light-375.png)
- [Sign in, dark 375 dp](../../design/screens/implementation/mob-08-native-auth/sign-in-dark-375.png)
- [Sign up, dark 375 dp](../../design/screens/implementation/mob-08-native-auth/sign-up-dark-375.png)
- [Sign in, 320 dp large text](../../design/screens/implementation/mob-08-native-auth/sign-in-dark-320-large-top.png)
- [Large-text actions after scrolling](../../design/screens/implementation/mob-08-native-auth/sign-in-dark-320-large-actions.png)
- [Large-text masked native keyboard entry](../../design/screens/implementation/mob-08-native-auth/sign-in-dark-320-keyboard.png)

Windows Expo Go startup initially failed resolving the pnpm symlink entry path.
Visual QA used an ignored `.expo/mob08-entry.js` containing only
`import 'expo-router/entry'`, temporarily selected as package entry. The normal
entry was restored for production Android export and final delivery. No gallery,
synthetic session or resolver workaround is shipped.

## MOB-09 handoff and remaining acceptance

Use `nativeTransport`, the MOB-05 manager and scoped request cancellation for a
real, independently approved Google exchange. Pass its verified response contract
to `manager.establishSession(response, signal)` and let RootStack resume the
canonical return target. Do not write credentials/create sessions in OAuth UI.
Client audiences, redirect state/nonce and provider setup remain MOB-09; native
HTTPS association remains MOB-46.

Live acceptance still needs designated local/staging backend and captured mail:
register → browser verify → native login → Home, actual delayed forgot response →
browser/native reset → fresh login, expired/replayed proofs, standalone Android,
TalkBack and iOS. Home remains its guarded scaffold pending MOB-10. No push, PR,
merge, cloud/store build or deployment occurred.
