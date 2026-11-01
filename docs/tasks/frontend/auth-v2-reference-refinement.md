# Auth V2 reference refinement and home-logo navigation

## Approved target and scope

The user-supplied [Auth V2 image](../../design/screens/reference/auth-v2.png)
is the primary visual target for Login and Sign Up. It supersedes the illustration
and layout from the initial [Forward, together iteration](auth-pages-redesign.md).
The reference is stored unmodified for comparison; the application never renders
it as a background or flattened interface.

This is frontend presentation and entry-page logo navigation only. Recovery,
verification, authenticated layouts, Google Identity Services components,
authentication handlers, validation, redirects, APIs, dependencies, backend code,
and migrations are unchanged.

## Design and implementation

- Preserve the shared `Brand` and official logo asset, Inter, and canonical
  primary indigo. Wrap only Login/Sign Up's desktop and mobile brand placements
  in React Router links to `/`, with accessible name **Kanvexa home** and visible
  keyboard focus. Other logo behavior stays as implemented previously.
- Recreate the approximately 52/48 composition, oversized product statement,
  lavender secondary line, indigo lighting, corner arc, and curved foreground.
  The desktop frame is capped at 1496px; forms scale from 400px to 480px.
- Replace the minimal arrow diagram with maintainable React task/column
  components, CSS depth and layering, and SVG route, wave, and cursor geometry.
  The three columns contain illustrative tasks, labels, checklist progress,
  completion marks, and a prominent floating Real-time board sync card.
- Illustration counts derive from its task arrays; progress derives from
  completed/total values. This is explicitly approved decorative sample content,
  not demo business state, a live board, or additional controls. The composition
  is `aria-hidden`, has no focusable descendants, and does not intercept input.
  Collaborators use abstract initials instead of extracted reference faces.
- Keep Login's form aligned with the reference: larger desktop typography,
  restored leading field icons, clearer boundaries and focus/error states, and
  a flat canonical indigo primary action. Keep Sign Up sequential and slightly
  denser, with persistent password rules directly beneath the new password.
- Preserve the official Google button exactly. Its existing 400px maximum and
  provider-owned appearance intentionally differ from the larger illustrated
  button in the reference. Only surrounding layout spacing changes.
- Support light and dark with scoped semantic surface/art tokens. Lighting and
  illustration shadows follow the explicitly approved reference; no backdrop
  blur, image-based UI, new animation, or third-party asset/dependency is added.

## Responsive sizing and scrollbar fix

The split begins at 64rem of available container width: a 29rem hero and a 25rem
form plus actual control padding and breathing room. With default font size and
outer gutters, 1072px supports the split and 1071px uses one column. The form
never shrinks to preserve the illustration.

The previous fixed height and `overflow-y: auto` on the form pane are removed.
The frame has a viewport-aware **minimum** height and grows to its content.
Both pages fit normal desktop captures; short screens or long validation use
natural document scrolling. Content is never concealed to suppress a scrollbar.
Below the split budget, only the form and linked brand remain. Below 640px,
the outer card is removed. Inputs stay at least 48px tall, reveal controls remain
44px, input text remains at least 16px, and reduced motion disables transitions.

## Regression and visual verification

`AuthEntryLayout.test.tsx` checks both desktop/mobile logo placements on both
routes navigate to `/`, retain the official asset and accessible link semantics,
and can receive focus. It also verifies the new home link is absent from the four
unchanged recovery/verification routes. Existing auth suites cover credentials,
verification, Google callbacks, redirects, password requirements, and errors.

Real Chrome inspection verifies visible **Kanvexa home** link names, mouse
activation, and Tab + Enter navigation to `/` on Login and Sign Up, including
mobile. The decorative task scene is absent from the accessibility tree.

Production-preview screenshots and layout assertions are in
[Auth V2 implementation evidence](../../design/screens/implementation/auth-v2/).
The main matrix covers both routes and themes at 1696×928 (reference size),
1440×900, 768×1024, and 390×844. Additional captures cover a short laptop,
the split boundary, 320px reflow, and synthetic long errors with reduced motion.
`measurements.json` verifies no horizontal overflow, no independently scrolling
form pane, available form width, and exactly one visible home link per layout.

Actual browser zoom, a physical mobile keyboard, and OAuth completion are not
claimed. The existing Google client rejects localhost as an authorized origin;
the official button still renders, and its implementation is untouched.

## Checks

| Check                                                | Result                                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm --filter @kanban/frontend test --maxWorkers=2` | Pass: 112 files, 1250 tests.                                                           |
| Focused branding/entry suites                        | Pass: 15 tests, including four home-link placement cases.                              |
| `pnpm lint`                                          | Pass.                                                                                  |
| `pnpm build`                                         | Pass across shared, backend and frontend.                                              |
| `pnpm --filter @kanban/frontend build`               | Pass after final CSS refinements.                                                      |
| Production browser capture assertions                | Pass: 21 captures, both routes/themes, no horizontal overflow or inner form scrolling. |
| Impeccable scoped static detector                    | Pass: `[]`.                                                                            |
| Taste production inspector                           | Pass with reference-specific allowances: 0 FAIL, 5 WARN.                               |
| Changed-file Prettier / `git diff --check`           | Pass.                                                                                  |
| Documentation paths                                  | Pass: 89 local links checked.                                                          |
| `pnpm format:check`                                  | Fails on 994 pre-existing files; none are in this change.                              |

Taste allows canonical indigo, the approved illustration lighting gradients, and
its floating-card shadows. Its remaining warnings were reviewed against the
target: Google owns its button font, stronger borders include accessible inputs
and illustrated columns, color coverage and the large desktop heading follow the
reference, and the smallest remaining text belongs to decorative illustration
content. Typography in that illustration has an 11px floor; the primary form
button retains a flat fill without extra glow.

Builds retain the existing environment warning about `NODE_ENV=production` and
the existing application-chunk size warning. No environment or bundling settings
were changed. Backend/database integration suites were not rerun for this
frontend-only follow-up. No real account, email verification, recovery request,
or deployment was used for QA.

## Git delivery

Create **one final local commit** for this follow-up, after implementation,
visual QA, and verification. Existing commits from the earlier iteration remain
intact; do not rewrite history to change their count. Do not push, create a PR,
merge, or deploy. These instructions apply to this Auth Pages Redesign task.
