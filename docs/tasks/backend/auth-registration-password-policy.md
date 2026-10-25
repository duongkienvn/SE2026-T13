# Registration password policy — Issue #76

Specification: [feat(auth): strengthen registration password
validation](https://github.com/duongkienvn/SE2026-T13/issues/76).
Branch: `feat/registration-password-policy`, from latest `main` at
`e740461`.

## Scope and decisions

Facts: registration previously enforced only 8–128 characters. Login
checks existing credentials independently. The working tree was clean at
task start. Accepted decisions: enforce the issue's policy only on new
registrations; retain the existing login, Argon2id, JWT/session, email
verification and API contracts. No new dependencies or migrations are
introduced. No product decision remains open; browser rendering remains
an unverified acceptance item as noted below.

## Before and after

| Behavior                 | Before                          | After                                                                       |
| ------------------------ | ------------------------------- | --------------------------------------------------------------------------- |
| Registration length      | 8–128 characters                | Same bounds.                                                                |
| Registration composition | No composition requirement      | ASCII uppercase `A–Z`, ASCII digit `0–9`, and a Unicode punctuation/symbol. |
| Lowercase                | Optional                        | Still optional: `ABC1234!` is valid.                                        |
| Whitespace               | Preserved                       | Still preserved; whitespace alone is not a special character.               |
| Invalid registration     | `400 VALIDATION_FAILED`         | Same envelope and field-level details; no input password in messages.       |
| Existing user's login    | Verify stored hash              | Unchanged; weak legacy passwords remain accepted for verified users.        |
| Valid registration       | Email verification before login | Unchanged: Create account → Check Email → Verify Email → manual Login.      |

`12345678`, `Abcdefg1`, `Abcdefg!`, `abcdef1!`, `Ab1!xyz`, `ABC1234 `
and otherwise valid passwords over 128 characters are rejected.
`ABC1234!` and `Kanvexa@2026` are accepted. Spaces, tabs and nonbreaking
spaces do not satisfy the special character condition; punctuation and
symbols are recognized by `\p{P}` / `\p{S}`. Password is never trimmed,
lowercased or Unicode-normalized. Confirm Password must match exactly in
the frontend and is never sent to the API.

Length counting mirrors the existing `class-validator` / `validator.js`
behavior for surrogate pairs and Unicode presentation sequences. The
frontend does not use the input's UTF-16 `maxLength` to truncate
otherwise valid Unicode passwords: it displays the count and blocks an
overlong value on submit. The parity tests cover ASCII, whitespace,
emoji and presentation sequences at both length boundaries. When
upgrading validators, keep those parity cases aligned.

## Implementation and files

- Backend: `apps/backend/src/api/auth/dto/register-request.dto.ts` keeps
  `StringField` length validation and adds one composition `Matches`
  constraint with a safe message and Swagger description.
  `LoginRequestDto` and the auth service implementation are unchanged.
- Frontend: `apps/frontend/src/features/auth/validation.ts` provides
  registration checks and checklist states.
  `components/PasswordRequirements.tsx` in that feature renders four
  stable entries with icons and textual screen-reader state, a polite
  summary and a maximum-length counter.
- `apps/frontend/src/features/auth/pages/RegisterPage.tsx` links
  Password to those descriptions. Display name/Email share a row from
  `sm`, as Password/ Confirm Password already did. The checklist uses
  one column on very narrow screens and two columns from 360 px.
  AuthLayout is unchanged.
- `apps/frontend/src/components/TextField.tsx` merges external
  description IDs with the current hint/error and avoids referencing a
  hidden hint. This keeps both requirements and errors available to
  assistive technology.
- Backend tests: `apps/backend/test/auth/register-request.spec.ts`,
  `auth.e2e-spec.ts`, `auth.service.spec.ts`,
  `auth-rate-limit.e2e-spec.ts`.
- Frontend tests: `apps/frontend/src/features/auth/validation.test.ts`,
  `pages/RegisterPage.test.tsx`, `pages/LoginPage.test.tsx`,
  `session-races.test.tsx`, and
  `apps/frontend/src/components/TextField.test.tsx`.
- Registration-only fixtures in
  `apps/backend/test/auth/email-verification.integration.mjs` and
  `scripts/deployment/local-smoke.mjs` use a guaranteed valid prefix
  before random data. No mail, migration, Docker or deployment behavior
  is changed.
- Related documentation: `docs/tasks/backend/backend-authentication.md`
  and `docs/tasks/frontend/frontend-auth.md` link to this task record.

Verification Email Layout, Board Invitation, H2c #61 and K1 #71 are
outside scope.

## Verification

Targeted checks executed:

- Backend DTO, HTTP contract and rate-limit tests: 37 passed initially.
- Backend HTTP/service regression tests: 25 passed after extending
  coverage.
- Frontend validation/Register/Login/session-race tests: 63 passed.
- Frontend checklist/Register/Login/TextField tests: 36 passed,
  including exact confirmation, no request for invalid input, preserved
  password, safe backend field errors, visibility controls and the
  complete mocked verification flow.
- Syntax checks for both changed integration/smoke scripts passed.

Full verification executed locally:

| Command/check                                                    | Result                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint`                                                      | Passed.                                                                                                                  |
| `pnpm test`                                                      | Passed: backend 45 suites / 406 tests, frontend 57 files / 461 tests, shared 6 tests; 873 total.                         |
| `pnpm build`                                                     | Passed. Existing Vite warnings remain for local `NODE_ENV` configuration and a JavaScript chunk over 500 kB.             |
| Prettier default check on all 19 changed text files              | Passed using `node node_modules/prettier/bin/prettier.cjs --check`. No repository-wide CRLF reformatting.                |
| `pnpm test:infra`                                                | Passed: 15 tests. SSM/AWS calls in these tests are mocks.                                                                |
| `pnpm --filter @kanban/backend test:email-verification:database` | Passed: 16 isolated PostgreSQL/HTTP/Socket.IO checks, fake mail, migration CLI and the nested database-foundation suite. |
| `git diff --check`                                               | Passed.                                                                                                                  |

The new frontend flow test initially counted the expected Boards load as
an extra authentication request; it was corrected to assert the POST
sequence and mock the normal Boards GET. The final targeted/full suites
passed. The first direct-Node integration invocation stopped at its
documented pnpm-entrypoint assertion; rerunning through the official
command above passed completely. Temporary databases/containers were
cleaned up. No real email or production service was involved. No
business test failure was accepted as a baseline.

## Remaining browser QA

Chrome DevTools MCP is unavailable in this session. Browser QA and
screenshots were not run; jsdom tests do not measure layout, clipping,
scrolling, keyboard navigation behavior or actual screen-reader
announcements. No browser pass is claimed. The list stays mounted while
typing; responsive CSS and the existing AuthLayout are preserved, but
these still need a real-browser check:

- Register at desktop 1280×600, 1366×657 and 1920×945; mobile 320×568
  and 390×844. Check the CTA remains reachable, there is no horizontal
  overflow, and the checklist does not clip or overlap other controls.
  Confirm behavior in both normal and validation-error states.
- Type and delete characters, paste a 129-character password, check
  Unicode symbols and the maximum counter, toggle both visibility
  buttons, and submit a valid password with mismatched confirmation.
- Use Tab/Shift+Tab, submit with keyboard, check error focus and
  description IDs, and listen for the polite requirement summary without
  password disclosure.
- Test safe backend errors and a successful registration through
  verification to manual Login. Automated tests use mocked/fake mail and
  send no real email.

## Compatibility and operational limits

No existing hash or account is migrated. Retroactive rejection at Login
would lock users out without a password-change flow, so Login keeps its
old rules. Frontend and backend validation are both tested against the
agreed matrix; the backend remains authoritative for clients that skip
browser validation. No push, pull request creation, merge or deployment
is part of this task.

## Shared Login/Register UI polish

The follow-up preserves the six password-policy commits and changes
presentation only. The card's 1180 px maximum, 440 px form cap and
percentage-based desktop padding left the two-column register fields
narrow. Content-driven card height could also differ between Login and
Register. The accepted follow-up explicitly requires the two pages to
share frame dimensions, padding and responsive behavior.

`AuthLayout.tsx` now uses a shared maximum width of 1380 px and a form
cap of 560 px. The original 48/52 panel split, artwork, branding,
grid/gradient, typography and colors are retained. Horizontal form
padding grows through 24/40/48/64 px at base/`sm`/`lg`/`xl` breakpoints.
The centered outer frame keeps 16 px mobile margins and 24 px from `sm`.

To keep the frame stable across Login/Register, its height follows the
viewport minus those margins and is capped at 720 px from `sm`. It is
not a minimum height: shorter laptop viewports get a shorter frame. CSS
sizing targets (not browser measurements) are 1380×720 at 1920×1080,
1318×720 at 1366×768, 1232×672 at 1280×720, and 358×812 at 390×844. The
right panel can scroll independently for long errors or very small
viewports. Auto margins center short content and resolve to zero when
content overflows, so the top of the form and its CTA remain reachable.
A stable scrollbar gutter avoids changing form width when scrolling is
needed. Content inherits `overflow-wrap: anywhere` to let long unbroken
error text wrap within the form instead of widening its fields or
creating horizontal overflow.

Login/Register keep 24 px between the subtitle and form, then 20 px
between form groups, including checklist → Create account. Register's
paired fields use 16 px gaps. Checklist row spacing increases to 8 px,
with separate maximum length feedback. The existing `short:` variant
reduces form margins/groups to 16/12 px, field gaps to 12 px and
checklist row gaps to 4 px. AuthSwitch and all business logic are
unchanged. Check Email and Verify Email inherit the same shared frame
and retain their own content/behavior.

Changed files:
`apps/frontend/src/features/auth/components/AuthLayout.tsx`,
`components/PasswordRequirements.tsx`, `pages/LoginPage.tsx`,
`pages/RegisterPage.tsx` (the last three under the same auth feature),
`docs/design/design-guidelines.md` and this record. Only CSS classes and
the layout comment change in application code; no dependencies, backend,
validation, state, API calls or verification flow change.

The targeted auth regression run passed 73 tests across six files,
including Login/Register, Check Email/Verify Email, branding, auth
routing and session races. The final text-wrapping adjustment also
passed 46 auth-page tests across four files. `pnpm lint`, `pnpm test`
(873 tests: backend 406, frontend 461, shared 6), `pnpm build`, Prettier
for all six changed files and `git diff --check` passed. The existing
Vite `NODE_ENV` and chunk-size warnings remain. Static review of the
generated CSS confirmed the width/height, scrollbar-gutter and wrapping
rules compile. An AST comparison against `15034d5`, ignoring CSS classes
and comments, confirmed all four application components retain the same
content, structure and logic. These checks are not a substitute for
browser layout QA.

Chrome DevTools MCP is still unavailable. Desktop 1920×1080, laptop
1366×768 and 1280×720, mobile 390×844 and short/error states still need
actual browser QA. Check frame stability while switching Login/Register,
panel scrolling, CTA reachability, long messages, horizontal overflow,
keyboard focus and auth-page regressions. No visual pass or screenshot
measurement is claimed.
