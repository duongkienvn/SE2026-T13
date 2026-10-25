# Public Landing Page — Issue #84

Implements [issue #84](https://github.com/duongkienvn/SE2026-T13/issues/84) on
`feat/public-landing-page`, based on `cea6d1c` (`main` at task start).
Frontend only: backend, shared contracts, auth/session mechanics, guards for
other routes and deployment are unchanged.

Visual target: [`landing-page-v1.png`](../../design/screens/reference/landing-page-v1.png)
with the V1.1 navigation addendum, described in
[`landing-page-v1.md`](../../design/landing-page-v1.md).

## Routing

| URL                                              | Behavior                                                        |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `/`                                              | `LandingPage` for guests and signed-in users; no redirect       |
| `/login`, `/register`                            | Unchanged (`PublicOnly`; signed-in users still go to `/boards`) |
| `/boards`, board routes                          | Unchanged (`RequireAuth`; guests still go to `/login`)          |
| `/profile`, `/check-email`, `/verify-email`, 404 | Unchanged; 404 "Go to home" now opens the landing page          |

`RootRedirect` was removed from `app/guards.tsx`; nothing else used it.

The page never waits for the session check. `useLandingSession` maps the auth
status to the actions shown:

| Auth status     | Header              | Hero / closing CTA                              | Footer "Account" |
| --------------- | ------------------- | ----------------------------------------------- | ---------------- |
| `anonymous`     | Log in, Get Started | Get started → `/register` (+ Log in in the CTA) | Log in, Sign up  |
| `loading`       | Placeholder box     | Placeholder box                                 | Empty            |
| `authenticated` | Go to Boards        | Go to your boards → `/boards`                   | Your boards      |
| `error`         | Go to Boards        | Go to your boards → `/boards`                   | Your boards      |

`error` keeps a stored session, so the user is offered Boards, whose guard
shows the existing retry screen.

## Anchors

- Header (desktop and mobile menu) and footer link to `#features`,
  `#how-it-works`, `#why-kanvexa`; Hero "Learn more" links to `#features`.
  They are plain `<a href="#…">`, so hash URLs, history and keyboard work
  natively. Each id exists once.
- Sections use `scroll-mt-16`, so a section starts right below the 64px sticky
  header.
- The browser looks for the fragment before React renders it, so
  `LandingPage` scrolls to `location.hash` once on mount (`behavior: 'instant'`).
- Smooth scrolling is scoped to the landing page:
  `html:has([data-landing]) { scroll-behavior: smooth }` inside
  `prefers-reduced-motion: no-preference` in `style.css`.
- Below `lg` the anchors and actions move into a menu panel that overlays the
  page (so anchor offsets do not change) and closes on link click or Escape.

## Sections and honest content

| Section         | Component                              | Notes                                                     |
| --------------- | -------------------------------------- | --------------------------------------------------------- |
| Header          | `LandingHeader`, `LandingActions`      | Official `Brand` / `/branding/kanvexa-logo-v1.png`        |
| Hero            | `LandingHero`, `BoardPreview`          | Tilted board preview on `lg`; 2 columns on phones         |
| `#features`     | `FeaturesSection`                      | 4 cards: 1 / 2 / 4 columns                                |
| `#how-it-works` | `HowItWorksSection`                    | Approved V1.1 addition; 3 steps                           |
| `#why-kanvexa`  | `WhyKanvexaSection`, `ShowcasePreview` | The V1 "Built for real teams" showcase                    |
| Closing CTA     | `ClosingCta`                           | Lavender band; decorative initials are `aria-hidden`      |
| Footer          | `LandingFooter`                        | Anchors, Log in/Sign up or Your boards, GitHub repository |

Decisions agreed with the project owner during the task:

- **Previews are coded miniatures, not screenshots.** They stay sharp, add no
  image weight and only show what Kanvexa has: card title, description, due
  date and assignee initials; presence, Members and Activity in the board
  header; board tiles, role badges and "Updated …" in the Boards list. The
  mockup's card tags, priorities, Share button and star are left out. Sample
  people use neutral invented names (AM, SL, JK).
- **Hand-written notes** are italic Inter + inline SVG arrows (no extra font),
  shown from `xl` only.
- **The landing page scrolls.** It is the one exception to the app's no-scroll
  layout rule; its hero still fits the first screen at 1366×657.

Deliberate copy changes from the mockup:

| Mockup                                | Implemented                          | Why                                                                           |
| ------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| Hero "Secure and reliable"            | "Owner and member roles"             | Board roles exist; "secure and reliable" is not a shipped, verifiable feature |
| "Get started for free"                | "Get started"                        | There are no plans or pricing                                                 |
| Footer Resources/Company, X, LinkedIn | Product / Account / Project (GitHub) | Only links with a working destination                                         |
| "Invite members"                      | "Add teammates"                      | Board members are added by account; no invitation is sent                     |

A test fails if the page text mentions invitations.

## Metadata

`index.html` gains `rel="canonical"` (`https://kanvexa.tech/`), Open Graph
tags and `twitter:card=summary`. The OG image is the deployed
`/branding/kanvexa-logo-v1.png`. `LandingPage` resets the tab title to the
`index.html` title when users navigate back to `/`.

Limitation: this is a client-rendered SPA. Crawlers that do not run
JavaScript only see `index.html`, and because Caddy serves `index.html` for
every route, `/login` and other routes also declare `https://kanvexa.tech/` as
canonical. Prerendering or per-route metadata would need build or deployment
changes and is out of scope.

## Tests

`features/landing/pages/LandingPage.test.tsx` (13 tests): guest and signed-in
actions in header, hero, CTA and footer; three distinct anchors and section
ids; no `href="#"`; features and steps content; showcase heading; no
invitation copy; rendering during a pending session check; `error` status
offers Boards; mobile menu opens and closes on anchor click and Escape.
`App.test.tsx` and `auth-routing.test.tsx` now expect the landing page at `/`.
New tests were mutation-checked (each step broke the code once and confirmed a
failing test).

## Browser QA

Playwright (Chromium) against the dev server and a production build served by
`vite preview` (same SPA fallback as `infra/caddy/routes.caddy`); 54 checks
passed on both. Signed-in runs seed the stored session and mock
`GET /users/me`; no backend was running.

- Viewports 1280×600, 1366×657, 1536×730, 1920×945, 768×1024, 390×844,
  375×812, 320×568: no horizontal overflow; one `h1`; ids unique; every image
  has `alt`. Hero bottom: 508px at 1280×600, 603px at the other desktop sizes.
- Header click (desktop and mobile menu), direct `/#…` load, reload, Learn
  more, back and forward: the target section starts 64px from the top.
- `prefers-reduced-motion: reduce`: `scroll-behavior: auto`, the jump is
  immediate.
- Keyboard: first Tab focuses "Skip to content"; anchors show a focus outline
  and work with Enter; the mobile menu opens with Enter and closes with Escape.
- Guest `/login`, `/register` direct loads; `/boards` → `/login`; 404 "Go to
  home" → landing page.
- `/users/me` delayed 2.5 s: the landing page renders at once with one header
  placeholder, then shows Go to Boards.
- Signed in: stays on `/`, no Log in/Register links, anchors work, Go to Boards
  → `/boards`, `/login` → `/boards`.
- No unexpected console errors (socket and API connection errors from the
  missing backend were filtered as expected).

Screenshots in
[`../../design/screens/implementation/public-landing-page/`](../../design/screens/implementation/public-landing-page/),
all from the production build:

| File                              | Shows                                     |
| --------------------------------- | ----------------------------------------- |
| `guest-1366x657.png`              | First screen, guest                       |
| `guest-1280x600.png`              | First screen on a short laptop            |
| `guest-full-1366.png`             | Whole page, desktop (compare with V1)     |
| `guest-768x1024.png`              | Tablet                                    |
| `guest-full-390.png`              | Whole page, phone                         |
| `member-1366x657.png`             | Signed in                                 |
| `member-menu-390x844.png`         | Mobile menu, signed in                    |
| `anchor-why-kanvexa-1366x657.png` | After loading `/#why-kanvexa`             |
| `session-pending-1366x657.png`    | Placeholders while the session is checked |

Not checked: real Google Sign-In, registration emails and session expiry
(the auth code is unchanged), Safari/Firefox, and a deployed Caddy instance.

## Known issues outside this task

- `app/layout/AppShell.tsx` has the same skip-link styling bug fixed here:
  `not-sr-only` resets padding, so the focused link has no padding.
- `vite build` warns that the main chunk is over 500 kB (901 kB minified).
