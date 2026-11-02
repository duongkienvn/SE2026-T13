# Auth pages redesign — Forward, together

This records the initial Direction A iteration. The later approved
[Auth V2 reference refinement](auth-v2-reference-refinement.md) supersedes its
illustration, desktop composition, scroll policy, and entry-page logo behavior.
The implementation and verification below remain historical evidence.

## Approved scope and design

Direction A was approved for Login and Sign Up, borrowing Kanban geometry from
Direction C. This supersedes the original Login reference for `/login` and
`/register` only. Mode: **operate**; the authentication task leads the composition.

- Preserve the official logo artwork, Inter, canonical indigo `#615CF7`, both
  themes, and the existing authentication contracts.
- Use a flat lavender/deep brand hero alongside an opaque form surface. The
  bespoke static SVG contains three lanes, cards, and an advancing arrow; it has
  no pretend navigation, people, metrics, or business data. It is decorative and
  excluded from keyboard and assistive-technology navigation.
- Cap the frame at 1280px and form content at 400px. Enable the approximately
  42.5/57.5 split only when the containing block has 56rem available: 22rem hero,
  25rem form, 6rem form padding, and breathing room. At the default font size and
  gutters, 944px supports the split while 943px uses a single column.
- Keep the desktop frame stable between pages, capped at 800px or viewport
  height minus 48px. Short forms center; long forms start from the top and scroll
  in the form pane. Scroll padding/margins keep focused controls clear of edges.
- Below the split budget, use natural document flow. Below 640px, remove the
  outer card and keep 24px side gutters. At heights of 480px or less, switch to
  document flow even on wide screens; the hero cannot consume the task's space.
- Set form headings at 32px (28px on mobile), labels at 14px, and input text at
  16px. Inputs and password reveal targets are 44px. Keep account switching as
  wrapping text rather than another bordered control.
- Arrange registration fields sequentially. Keep the persistent password rules
  directly beneath the new password, before confirmation. Preserve the checklist
  status announcements, count, descriptions, and validation associations.
- Auth input borders use `#8890A6` on white and `#65708E` on the current dark
  surface: calculated contrast approximately 3.19:1 and 3.44:1. Focus has a solid
  2px outline; errors retain semantic colors. Placeholder text uses the full
  muted token rather than reduced opacity.
- Limit motion to short control feedback. Reduced motion disables transitions
  and animation throughout the scoped entry surface. There is no entrance or
  looping illustration animation.

## Implementation boundaries

`AuthEntryLayout` is opt-in. `AuthLayout` and the existing decorative preview
remain unchanged for Check Email, Verify Email, Forgot Password, and Reset
Password. Shared field primitives default to their previous appearance.

The Login/Register handlers, API requests, session guards, redirect state,
Google Identity Services integration, verification, recovery, error mapping,
and password policy are unchanged. In particular, registration does not sign
the user in, confirmation is not sent, passwords are not trimmed, and Login
continues to accept legacy credentials. No backend, migrations, routes,
dependencies, or deployment configuration changed.

## Changed source and regression coverage

- `apps/frontend/src/features/auth/components/AuthEntryLayout.tsx`
- `apps/frontend/src/features/auth/components/ForwardTogetherIllustration.tsx`
- `apps/frontend/src/features/auth/components/AuthEntryLayout.test.tsx`
- `apps/frontend/src/features/auth/components/AuthSwitch.tsx`
- `apps/frontend/src/features/auth/components/PasswordRequirements.tsx`
- `apps/frontend/src/features/auth/pages/LoginPage.tsx`
- `apps/frontend/src/features/auth/pages/RegisterPage.tsx`
- `apps/frontend/src/components/TextField.tsx`
- `apps/frontend/src/components/PasswordField.tsx`
- `apps/frontend/src/app/branding.test.tsx`
- `apps/frontend/src/style.css`

Regression coverage checks opt-in scope, unchanged recovery/verification
presentation, decorative illustration semantics, autocomplete/property handling,
and password-guidance order/association after validation. The existing branding
test now locates the semantic hero landmark rather than assuming the logo and
statement share a direct parent.

## Browser evidence

Production-preview captures are in
[`docs/design/screens/implementation/auth-pages-redesign/`](../../design/screens/implementation/auth-pages-redesign/).
`measurements.json` records viewport, form width, overflow, hero visibility,
44px reveal targets, and synthetic long-error/reduced-motion checks.

| Coverage                                          | Evidence                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| Login, both themes                                | `login-{desktop,tablet,mobile}-{light,dark}.png`                  |
| Sign Up, both themes                              | `register-{desktop,tablet,mobile}-{light,dark}.png`               |
| Split boundary                                    | `register-split-minimum.png`, `register-below-split.png`          |
| Short laptop                                      | `register-short-laptop.png`, `register-short-laptop-scrolled.png` |
| Reduced available height                          | `register-keyboard-height.png`                                    |
| 320px reflow                                      | `register-reflow.png`                                             |
| Synthetic long validation text and reduced motion | `register-long-error-reduced-motion.png`                          |

The main matrix uses 1440×900, 768×1024, and 390×844. Additional checks use
1366×657, 944×768, 943×768, 1024×360, and 320px widths. No horizontal document
overflow was measured. Desktop forms measure 400px; mobile forms fit their
available width. A manual short-laptop scroll check confirmed the account switch
remains reachable. Native keyboard checks confirmed first-field Tab focus and
first-invalid focus; reduced motion produced a computed transition of `0s`.

The 320px checks exercise zoom-equivalent reflow; actual browser zoom and a
physical mobile keyboard were not verified. Reduced-height emulation is a layout
check, not a claim of device testing.

## Verification and limitations

| Check                                                | Result                                                                                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                          | Pass, including the final UI regression tests.                                                                                         |
| `pnpm build`                                         | Pass for shared, backend, and frontend.                                                                                                |
| `pnpm --filter @kanban/frontend build`               | Pass again after the final focus/short-viewport refinements.                                                                           |
| `pnpm --filter @kanban/backend test --runInBand`     | Pass: 91 suites, 886 tests.                                                                                                            |
| Shared suite in `pnpm test`                          | Pass: 17 tests.                                                                                                                        |
| Focused presentation and branding suites             | Pass: 2 files, 11 tests.                                                                                                               |
| `pnpm test`                                          | Failed under unrestricted frontend worker concurrency, with widespread timeout failures. No test configuration was changed.            |
| `pnpm --filter @kanban/frontend test --maxWorkers=2` | Pass: 112 files, 1246 tests on the final implementation.                                                                               |
| `pnpm format:check`                                  | Failed: 994 pre-existing files outside the changed-file set. All changed source/docs/measurement files pass a separate Prettier check. |
| `git diff --check`                                   | Pass.                                                                                                                                  |

The initial broad auth run had two Profile session-race timeouts; its isolated
rerun passed all 20 tests. A subsequent two-worker full frontend run passed
1244/1246 tests; the two failures came from the historical branding test's DOM
parent assumption. After updating that assertion, the focused branding and entry
tests passed. A four-worker attempt again hit unrelated Workspace test timeouts
and was stopped; final verification uses two workers without concurrent backend
tests or browser capture jobs.

Production builds retain existing environment/chunk-size warnings:
`NODE_ENV=production` in the shared environment file and the application chunk
over 500kB. These warnings do not fail the build; environment files and bundling
configuration were not changed.

Impeccable's scoped static detector returned `[]`. Taste's production inspector
for Sign Up at 1440/768/390 returned **0 FAIL, 2 WARN**. Canonical indigo was an
explicit brand allowance. The two warnings are retained and reviewed: Google
owns its button font/loading, and the canvas detector compares the deliberately
narrow form against the whole split composition rather than its own pane.

Google's official button renders and resizes, but the configured client rejects
the localhost origin. OAuth completion was not attempted or claimed. No real
account was created, verification email sent, or recovery request issued.
Backend/database integration and deployment verification are outside this visual
change; local UI results do not establish deployed behavior.
