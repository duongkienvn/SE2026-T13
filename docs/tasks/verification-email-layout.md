# Verification email layout — Issue #77

Specification: [fix(mail): redesign verification email layout for Gmail and mobile](https://github.com/duongkienvn/SE2026-T13/issues/77).
Branch: `fix/verification-email-layout`, based on latest `main` at `6d5bebb`.
The working tree was clean; the password-policy work was already merged in #78.

## Before, root cause and scope

The old template placed the card's max-width, automatic margins and padding on
`<main>`, with paragraphs and a styled anchor forming the rest of the layout.
Only the brand header used a table. That left centering/padding dependent on
email clients preserving the semantic element's CSS. Issue #77 reports Gmail
rendering that structure too wide and against the left edge. The source
dependency is confirmed; this task did not inspect a real Gmail message or
prove exactly which Gmail transformation caused the reported rendering.

The change replaces that layout dependency with presentation tables and padded
cells. It changes the HTML template only: subject, text/plain, business wording,
verification URLs and authentication/delivery behavior remain unchanged.
No dependency, public endpoint, environment setting, SDK integration, tracking,
token lifecycle, rate limit, database or migration is added or changed.

## Layout and compatibility choices

- A 100% outer table supplies the light gray background. Its center-aligned cell
  has 32 px vertical and 12 px horizontal padding, including on mobile.
- A centered white card is fluid with a 580 px maximum width and fixed table
  layout. Its content cell has 32 px vertical and 24 px horizontal padding.
  HTML `align`, `width`, `bgcolor`, `cellpadding` and `cellspacing` attributes
  supplement inline CSS. An MSO conditional 580 px wrapper supplies an Outlook
  fallback; clients without rounded corners get a normal rectangular card.
- All sections use table rows/cell padding. Header → heading uses 24 px;
  heading → introduction uses 16 px; introduction → CTA and CTA → notes use
  24 px. The CTA has 16×22 px padding, white 16 px bold text and the existing
  Kanvexa blue, with `mso-padding-alt` for Outlook.
- The original transparent PNG remains 64×64 next to a real-text Kanvexa
  wordmark. Empty image alt avoids duplicate announcements; the adjacent text
  stays readable if images are blocked. No base64/CID image or external font.
- The fallback URL uses `word-break:break-all` and `overflow-wrap:anywhere` in
  a fixed-layout table. Both links and fallback text still use the existing
  HTML escape function. No zero-width characters or breaks are inserted into
  the URL/token, and plain text retains the raw original URL.
- All primary layout/color rules are inline. A small optional dark media query
  changes surfaces/text/link colors in supporting clients. Unsupported clients
  retain the inline light design. This is progressive enhancement, not proof
  of Gmail's own dark-mode behavior; no blend-mode or client-specific hacks.

## Logo availability investigation

A read-only request to
`https://kanvexa.tech/branding/kanvexa-logo-v1.png` during this task returned
HTTP 200, `Content-Type: image/png`, 331124 bytes and a valid PNG signature.
SHA-256 was
`9dcb6593a1edef473753ffd36f2939a8035740fa46cc36faba9b7f661af3587f`,
matching the repository's public asset exactly. Chrome previews loaded that
same public URL successfully. There is no evidence of a missing/wrong asset at
the time of this check. Gmail image blocking, proxy/cache or message-specific
behavior remains a separate real-client QA item; CSS alone is not assumed to
explain a missing logo. The image URL contains no recipient or verification data.

## Local preview

Run from the repository root:

```sh
pnpm --filter @kanban/backend preview:verification-email
```

This builds the backend and imports only the compiled, side-effect-free email
template. It does not start Nest, load `.env`, initialize a mailer, request any
recipient/token input or send email. It writes ignored local QA files under
`.codex/previews/verification-email/`:

- `verification-email.html`: normal email using the public logo URL.
- `verification-email-long-url.html`: synthetic long-URL stress case.
- `verification-email-images-blocked.html`: deliberately invalid image source
  for checking the text fallback; this substitution is preview-only.
- `verification-email.txt`: the unchanged plain-text format with sample data.

Open the HTML files locally in a browser. Every verification link targets
`example.invalid` and contains explicitly synthetic, unusable preview data.
Do not substitute or publish real verification links. Dark appearance can be
tested using browser media emulation. No preview file or screenshot proves
Resend delivery or Gmail rendering.

## Browser preview evidence

The browser automation connector could not initialize its kernel assets.
As permitted by the task, QA instead used installed Chrome headless through its
DevTools protocol with a fresh temporary profile, no signed-in browser state and
no new dependency. The profile/browser were closed and cleaned up afterward.
Screenshots were opened and visually inspected as well as checked for geometry.

| Preview                                                                                                | Viewport | Measured card  | Result                                                    |
| ------------------------------------------------------------------------------------------------------ | -------- | -------------- | --------------------------------------------------------- |
| [Desktop](../design/screens/implementation/verification-email-layout/desktop.png)                      | 1366×900 | 580×511, x=393 | Centered; public image loaded.                            |
| [Mobile](../design/screens/implementation/verification-email-layout/mobile.png)                        | 390×844  | 366×635, x=12  | Readable padding, wrapped URL, CTA fully visible.         |
| [Mobile dark](../design/screens/implementation/verification-email-layout/mobile-dark.png)              | 390×844  | 366×635, x=12  | Dark media query applied; readable text/button.           |
| [Images blocked](../design/screens/implementation/verification-email-layout/mobile-images-blocked.png) | 390×844  | 366×635, x=12  | Image failed as intended; text Kanvexa and layout remain. |
| [Long URL](../design/screens/implementation/verification-email-layout/long-url-mobile.png)             | 320×844  | 296×1357, x=12 | Vertical content scroll; URL stays inside card.           |

All five cases had document scroll width equal to viewport width, a 58 px CTA
height, both links inside the card, and no JavaScript exceptions. Measured
heading/card and CTA color contrast met 4.5:1 in light/dark Chrome previews.
Screenshots contain only synthetic preview data. Missing-image Chrome UI can
differ from Gmail's image-blocking UI.

## Automated verification

Targeted template/mailer, transport and auth-service tests passed: 69 tests.
Coverage includes centered/fluid table structure, padded cells, legacy-client
fallbacks, one public HTTPS logo, visible wordmark, unchanged business wording,
subject/text/plain, identical CTA/fallback URLs, exact escaping for `&`, quotes,
`<`/`>`, injection payloads and encoded token preservation. Existing SDK timeout,
idempotency and fake-mail tests remain in place. No automated test calls Resend.

Final verification:

| Check                                                | Result                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                          | Passed after adding explicit Node `URL`/`console` imports to the new preview script.                          |
| `pnpm test`                                          | Passed on rerun: backend 45 suites / 413 tests, frontend 57 files / 461 tests, shared 6 tests; 880 total.     |
| `pnpm build`                                         | Passed. Existing Vite local `NODE_ENV` and chunk-over-500-kB warnings remain; no environment/frontend change. |
| Prettier on all five changed text files              | Passed with the default configuration; no broad CRLF reformat.                                                |
| `git diff --check`                                   | Passed.                                                                                                       |
| Local preview command and standalone generator rerun | Passed; ignored synthetic HTML/text produced without email delivery.                                          |
| Chrome preview geometry, contrast and screenshots    | Five cases passed, as detailed above.                                                                         |

The first full run timed out at the existing 5-second limit in unchanged
`ColumnActions.test.tsx` and `CardActions.test.tsx`. Both suites then passed in
isolation (23 tests), and a complete `pnpm test` rerun passed without changing
timeouts, fixtures or frontend code. These failures are recorded rather than
reported as an initial pass. The preview-script lint error was a new issue and
was fixed; the final full lint run passed. No business failure was accepted as
a baseline. Gmail acceptance remains pending separately from these results.

## Gmail QA still pending

No real email was sent and no Gmail account was opened. Gmail desktop, Gmail
Android/iOS and Gmail dark mode are **unverified**. Browser dark emulation does
not reproduce Gmail's automatic color transformations; Outlook's conditional
wrapper/padding fallback was not run in Outlook. Clients ignoring max-width
may use a wider fluid card; clients ignoring border-radius use square corners.

After an authorized release, or through the existing owner-controlled local
Resend setup described in [K2](email-verification.md):

1. Use an owner-approved test inbox and the existing registration/resend flow.
   Do not change provider credentials or bypass cooldowns for this layout test.
2. In Gmail desktop and mobile, verify the centered card, consistent cell
   padding, readable paragraphs and expiry/one-time wording, CTA tap area and
   absence of horizontal overflow.
3. Check both light/dark appearance and blocked/allowed external images. The
   Kanvexa text must remain visible; distinguish a blocked image from an HTTP
   error at the public logo URL.
4. Check CTA and copied fallback link target the same verification URL, and
   that the plain-text part remains usable. Do not post real token-bearing
   links or screenshots containing them in GitHub/documentation.
5. Record actual client/device/version and any automatic dark-mode recoloring.
   Resolve client-specific defects before claiming Gmail acceptance.

## Files and git scope

- `apps/backend/src/mail/verification-email.ts`: HTML only.
- `apps/backend/test/auth/verification-mailer.spec.ts`: layout/security regression
  assertions plus existing delivery coverage.
- `apps/backend/scripts/preview-verification-email.mjs` and
  `apps/backend/package.json`: local synthetic preview command.
- This task record and five PNGs under
  `docs/design/screens/implementation/verification-email-layout/`.

No push, new PR, merge or deploy was performed. The current template is not yet
claimed to be released to inboxes. Real-client Gmail acceptance remains open.
