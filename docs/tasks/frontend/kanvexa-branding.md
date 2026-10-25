# Kanvexa brand integration

Branch: `chore/kanvexa-branding`, based on `main` at `af4608d`.

## Scope and decisions

The user-approved PNG/ICO originals live in `branding-assets/`. The
transparent 1024 px logo is served unchanged at
`/branding/kanvexa-logo-v1.png`; the supplied favicon, Apple touch icon
and Android icon are also copied unchanged into the frontend public
directory. Preview/source-only images are not published. No new
dependency, image font, base64 image or JavaScript asset import is
needed. The main PNG is about 323 KiB and is requested once per URL for
all placements; it retains the supplied pixels rather than using a lossy
conversion. Explicit image dimensions and square `object-contain` sizing
preserve layout/proportions.

`Brand` combines a decorative image with a separate readable Kanvexa
wordmark. `BrandLogo` alone has the accessible name “Kanvexa”. Both use
the original transparent artwork, with no filter, tint or
theme-dependent image swap. The wordmark inherits its surrounding text
color for use on light/dark surfaces. The app currently uses the
approved light theme; this task does not add a global dark theme. The
provided light/dark preview remains the artwork reference.

Integrated locations:

- Login, Register, Check Email and Verify Email through the shared auth
  layout, including the mobile wordmark and desktop product preview.
- Authenticated header and navigation rail, including Boards, board
  detail, Members and Profile through the shared application shell.
- Route titles, initial browser title, app/description metadata, browser
  favicon, Apple touch icon and web manifest (browser display; no
  service worker).
- HTML verification email header, with a presentation table, inline
  styles, explicit 64×64 dimensions and a text wordmark if images are
  blocked.

“Kanban” remains the functional name of boards and internal code/package
names. Authentication logic, email transport, token lifecycle/cooldown,
API contracts, database, realtime behavior and deployment infrastructure
are unchanged.

## Public email image

Email HTML references the absolute HTTPS image URL
`https://kanvexa.tech/branding/kanvexa-logo-v1.png`, served by the
frontend static site. This intentionally does not derive from
`PUBLIC_APP_URL`: local verification links may point to loopback while
email clients still need a publicly accessible image. No token,
recipient, private path, data URI or CID attachment is included in the
image URL. Plain text email and both verification links stay unchanged.

After an authorized release, check the public URL returns HTTP 200 with
`Content-Type: image/png`, without authentication. The image cannot be
verified publicly before these local changes are released. Keep this
versioned path available for old email; use a new filename for future
artwork revisions. No production release or real email is part of this
task.

## Verification and remaining manual QA

Automated coverage checks branding on all four auth routes, route
titles, the authenticated shell, existence of browser/manifest assets,
exact preservation of the transparent artwork, and email image/link
safety using mocked transport.

Verification executed locally:

| Check                                             | Result                                                                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                       | Passed.                                                                                                                                                  |
| `pnpm test`                                       | Passed: backend 44 suites / 362 tests, frontend 55 files / 416 tests, shared 6 tests (784 total).                                                        |
| `pnpm build`                                      | Passed. Vite reports a local `NODE_ENV` configuration warning and a JavaScript chunk over 500 kB; no environment file was changed.                       |
| `pnpm format:check`                               | Failed on 418 unchanged CRLF files; none of the task's changed files are in that warning list.                                                           |
| `pnpm exec prettier --check . --end-of-line auto` | Passed across the repository.                                                                                                                            |
| Prettier default check of changed text files      | Passed using `node node_modules/prettier/bin/prettier.cjs --check`.                                                                                      |
| `git diff --check`                                | Passed.                                                                                                                                                  |
| Built site via local Vite preview, HTTP requests  | Passed: PNG logo, favicon, PNG favicon, Apple/Android icons, manifest and `/login` all return 200 with expected MIME types; image bytes match originals. |

Real browser QA is pending: Chrome DevTools MCP is unavailable in this
session. HTTP and jsdom checks do not verify visual layout or
email-client rendering.

- Check auth pages and authenticated header/sidebar at 320/390 px mobile
  and 1280×600 / 1366×657 / 1920×945 desktop, including long board names
  and user menu. Confirm no overflow or clipping, readable wordmark,
  intact logo and keyboard focus. Verify browser title, favicon and
  Apple home-screen icon.
- Check the original logo on white and dark navy surfaces, without
  recoloring the gradient. Where a dark container is used, supply a
  contrasting text color for the inherited wordmark. The light
  application layout remains unchanged.
- After an authorized release, inspect the public PNG response and a
  real inbox in Gmail, Outlook and Apple Mail, with light/dark
  appearance and remote images enabled/blocked. Confirm the text
  wordmark and both verification links remain usable. Do not send real
  email from automated tests.
