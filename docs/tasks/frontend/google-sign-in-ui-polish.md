# Google Sign-In UI polish — Issue #79

## Scope and root cause

Follow-up on `feat/google-auth-account-linking`, based on `a903bf5`. The owner
reported successful live Google Sign-In on localhost before this polish.

The Google mount was a shrink-to-content child, so its initial measurement fell
back to 280px even when the form had much more space. The `or` divider belonged
to AuthSwitch, placing it after Google instead of between authentication methods.

## Presentation changes

- Login/Register share this order: local form and primary action → one
  `or continue with` divider → official Google button → existing AuthSwitch.
- GoogleAuth owns the full-form-width divider and 20px top spacing (16px on short
  viewports), then a 16px gap to Google (12px on short viewports). AuthSwitch
  retains its bordered appearance with 20px top spacing (16px when short).
- The Google section centers a full-width mount capped at 400px. The SDK receives
  the measured container width clamped to its existing 200–400px range.
  ResizeObserver redraws only when that width changes, preserving the same button
  state/callback registration; cleanup disconnects it. No iframe stretching,
  transforms, overlays, pointer-event workarounds or Google-internal CSS edits.
- Official options remain standard/outline/large/continue_with, with rectangular
  shape and English locale. Google requires both `locale: 'en'` and the official
  script's `hl=en` query for consistent English text; browser QA confirmed the
  button-only locale still used Vietnamese before adding the script language.
- Profile does not opt into the new width/spacing. Its compact presentation and
  linking flow remain intact; the shared GIS script language follows the English
  authentication UI. Script loading concurrency, singleton initialization,
  credential routing, mounted/session guards and auth request handlers are retained.

AuthLayout, panel ratios, frame dimensions, branding, form field spacing and
business validation are unchanged. Backend, migrations, JWT/AuthProvider, OAuth
client IDs/env files and deployment configuration are untouched.

References: [Google button options](https://developers.google.com/identity/gsi/web/reference/js-reference),
[button language](https://developers.google.com/identity/gsi/web/guides/display-button#button_language)
and [branding guidelines](https://developers.google.com/identity/branding-guidelines).

## Verification

- Targeted tests cover divider order, route switching/rerender without duplicates,
  SDK width cap/resize, stable callback state, observer cleanup and compact opt-out.
  Existing StrictMode, loading/failure/unconfigured, local/Google sign-in,
  session-race and Profile tests also run.
- Entire frontend: **493 tests / 61 files passed** with Google disabled in the
  test process and mocked explicitly where needed (`VITEST_MAX_WORKERS=2`). No
  persistent environment configuration was changed for tests.
- `pnpm lint`, `pnpm build` and changed-file Prettier passed. Build retains the
  existing local NODE_ENV warning and >500kB chunk warning.
- `pnpm format:check` reports 419 untouched checkout files. None is part of this
  polish; whole-repository Prettier with `--end-of-line auto` passes. No bulk
  line-ending edits. `git diff --check` passes.

Chrome headless uses a fresh isolated profile against localhost, without a mock
GIS implementation. The official Google script/iframe is rendered in the screenshots
below. No Google account credentials are entered and no token exchange is tested
by this UI pass; the owner's earlier successful login is separate evidence.

| Viewport | Shared outer frame | SDK width after polish |
| -------- | ------------------ | ---------------------- |
| 1280×600 | 1232×552           | 400px                  |
| 1366×657 | 1318×609           | 400px                  |
| 1536×730 | 1380×682           | 400px                  |
| 1920×945 | 1380×720           | 400px                  |
| 390×844  | 358×812            | 310px                  |

Both pages preserve identical frame bounds at every viewport. All cases have one
Google iframe, one divider, no page/form horizontal overflow and an accessible
local submit action. Register can scroll inside the existing form panel on mobile
and at 1366×657; the page/frame does not grow.

Live resizing desktop → mobile → desktop updates SDK width 400 → 310 → 400
without duplicates. Desktop keyboard Tab reaches the real Google control on both
pages. Switching routes twice retains one iframe; a trusted click opens Google's
real popup, which is closed without authenticating. Local submit remains enabled.
This confirms rendering/interaction, not a successful credential exchange or
screen-reader E2E. Google-controlled iframe internals are not edited.

Loading and script failure were exercised by pausing/failing the GIS network
request, for both routes at 1280×600 and 390×844. Unconfigured rendering was
checked on a separate local dev process with an empty public client ID override.
All three states preserve local submit availability and avoid horizontal overflow;
the failure message remains inside the existing scrollable form panel. These
isolated test overrides do not modify the owner's env files or OAuth setup.

## Before / after screenshots

These are real SDK renders of empty public forms, with no signed-in Google account.

| Page / viewport    | Before                                                                                       | After                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Login, 1920×945    | [Before](../../design/screens/implementation/google-sign-in-polish/before-1920-login.png)    | [After](../../design/screens/implementation/google-sign-in-polish/after-1920-login.png)    |
| Register, 1920×945 | [Before](../../design/screens/implementation/google-sign-in-polish/before-1920-register.png) | [After](../../design/screens/implementation/google-sign-in-polish/after-1920-register.png) |
| Login, 390×844     | [Before](../../design/screens/implementation/google-sign-in-polish/before-390-login.png)     | [After](../../design/screens/implementation/google-sign-in-polish/after-390-login.png)     |
| Register, 390×844  | [Before](../../design/screens/implementation/google-sign-in-polish/before-390-register.png)  | [After](../../design/screens/implementation/google-sign-in-polish/after-390-register.png)  |

## Files

- `apps/frontend/src/features/auth/components/AuthSwitch.tsx`
- `apps/frontend/src/features/auth/components/GoogleAuth.tsx`
- `apps/frontend/src/features/auth/components/GoogleSignInButton.tsx`
- `apps/frontend/src/features/auth/google-identity.ts`
- `apps/frontend/src/features/auth/components/GoogleSignInButton.test.tsx`
- `apps/frontend/src/features/auth/google-identity.test.ts`
- `apps/frontend/src/features/auth/pages/GoogleAuthPages.test.tsx`
- This task record and the eight before/after screenshots linked above.
