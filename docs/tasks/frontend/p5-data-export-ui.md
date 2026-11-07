# P5-07 Data & Privacy export UI

Implements [issue #224](https://github.com/duongkienvn/SE2026-T13/issues/224)
(roadmap DX-01 and the AC-01 account export slice) on top of the merged
[authorized data export backend](../backend/p5-authorized-data-export.md)
(#216). Frontend only: no backend, shared contract, migration or dependency
change.

## Route and page

`Settings → Data & Privacy` is now an available section
(`/settings/data-privacy`) in the same position of the approved Settings order.
Desktop keeps the Settings rail; phones use the existing section list and
`Back to Settings`. The page heading has no decorative icon, matching the
approved mockup. It contains, in order:

1. **Export account data** — JSON only, no format selector and no
   confirmation dialog for this read-only download. Copy describes the real
   V1 contents: profile, settings, sign-in methods, memberships, the user's
   notifications and comments. Board contents and uploaded files are stated
   as not included.
2. **Export board data** — Board selector, mutually exclusive **JSON**
   (default, full structure) and **CSV** (one row per Card) tiles, and the
   export button.
3. A quiet privacy notice: exports contain only data the user can access and
   may include personal data.

Mockup copy that the backend does not support (for example "activity
history") is intentionally not shown.

### Board selector

The selector reuses the shared `boardKeys.list('active' | 'archived')` queries
and keeps only Boards whose `currentUserRole` is `OWNER`. That field is the
caller's own explicit Board membership, so Workspace ADMIN or
WORKSPACE_VISIBLE read access never makes a Board eligible. Archived owned
Boards stay eligible and are labelled `Archived`. Option text includes the
Workspace name (`Roadmap · Engineering · Archived`) so equal Board names can be
told apart. Active Boards are listed before archived ones, then by name.

There is no preselected Board: the button stays disabled until the user picks
one (a deliberate choice to avoid an accidental export; the mockup shows an
example selection). Loading, load error with retry and "no owned boards"
guidance states keep the same layout. Because the queries are the shared Board
list queries, `revokeBoardAccess` clears them on access loss; the selection is
derived from the current list, so a revoked Board disappears instead of
lingering.

## Download flow

| Request                                       | Success                |
| --------------------------------------------- | ---------------------- |
| `GET /api/users/me/export`                    | 200 JSON bytes         |
| `GET /api/boards/:boardId/export?format=json` | 200 JSON bytes (OWNER) |
| `GET /api/boards/:boardId/export?format=csv`  | 200 CSV bytes (OWNER)  |

- `requestBinary` (`lib/api-client.ts`) sends the authenticated GET with
  `cache: 'no-store'`. Only HTTP **200** yields a Blob. Any non-2xx body is
  decoded with the same error-envelope parser as `apiRequest`, so an error
  response is never saved as a file; a non-envelope error body becomes
  `INVALID_RESPONSE`. Success bytes are never passed through the envelope
  parser.
- `useExportDownload` (shared by both buttons) runs through `runAuthorized`,
  allows one request at a time, aborts on unmount and checks, right before the
  file is handed to the browser, that the component is mounted, the auth
  session is still the same (`useAuthSession().isCurrent()`) and, for Boards,
  that the Board is still in the current owner list. A sign-out, account
  switch, revocation or navigation while the export runs therefore publishes
  no file. The Blob is never stored in React state, TanStack Query, storage or
  logs.
- `saveBlob` creates an object URL, clicks a temporary hidden `download` link,
  removes it, and revokes the URL after one second or immediately when the page
  unmounts.
- File names: CORS does not expose `Content-Disposition`, so the documented
  deterministic names are used: `kanvexa-account-YYYY-MM-DD.json` and
  `kanvexa-board-<board UUID>-YYYY-MM-DD.<json|csv>` (UTC date, as the server).
  A header name is accepted only if it matches that exact shape for the same
  target; Board names, response text and personal data never reach the file
  name. A Board ID that is not a UUID produces no file.

### Errors

| Response                     | Message (summary)                                                  |
| ---------------------------- | ------------------------------------------------------------------ |
| 401                          | Session ended; `runAuthorized` signs out and the guard opens Login |
| 403 Board                    | Only a current owner can export; list refreshed, selection cleared |
| 404 Board                    | Board no longer available; list refreshed, selection cleared       |
| 403/404 account              | Access changed / sign in again                                     |
| 400                          | Request not accepted; refresh and retry                            |
| 413 `EXPORT_TOO_LARGE`       | Board: 10,000 cards / 20 MB limit. Account: over 20 MB             |
| 429                          | Too many export requests                                           |
| 503 `EXPORT_TIMEOUT`         | Took too long; try again                                           |
| Network / offline            | Could not reach the server                                         |
| Other 5xx / invalid response | Could not be prepared; try later                                   |

Server text is never echoed. Retry after a failure uses the same button. The
success status says only "Download started." after a 200 response.

## P5-08 extension boundary

`DataPrivacyPage` composes self-contained export sections followed by
`PrivacyNotice`. P5-08 appends its Danger Zone as a separate section after the
notice and can reuse `privacyCardClass` from `ExportCard.tsx`; it does not
need to change the export cards or the route.

## Files

- `apps/frontend/src/lib/api-client.ts` — shared error decoding,
  `requestBinary`.
- `apps/frontend/src/features/settings/data-privacy/` — `export-api.ts`,
  `export-file.ts`, `useExportDownload.ts`, `owned-boards.ts`,
  `ExportCard.tsx`, `AccountExportCard.tsx`, `BoardExportCard.tsx`,
  `DataPrivacyPage.tsx` and tests.
- `settings/sections.ts`, `app/routes.tsx`, `components/icons.tsx`
  (`InfoIcon`), `test/mock-api.ts` (raw response bodies for file tests).

## Verification

See the [implementation evidence](../../design/screens/implementation/p5-data-export-ui/)
for screenshots and the final check results below.

- Focused tests: `api-client` binary tests (12 new), export file/API tests
  (14), Data & Privacy page tests (17), updated Settings layout tests.
- Mutation checks: 9/9 deliberate breaks were caught (session re-check,
  access-lost refresh, OWNER filter, file-name validation, 200-only rule,
  unmount URL revoke, timed revoke, disabled-without-Board, JSON default).
- Visual QA on a production build with synthetic API responses (Chrome via
  Playwright): 1586×992 dark (approved mockup size), 1440×900 selected/CSV,
  exporting, 413 error and no-owned-Boards states, 1280×800 light,
  1366×657 dark, 768×1024 and 390×844 light/dark. No horizontal overflow.
  The page fits without scrolling at 1280×800 and larger; at 1366×657 the
  content area scrolls 77 px (Security scrolls 126 px there today), and phones
  scroll the stacked cards.
- Final checks (run with P5-08 in the same working tree): frontend suite
  152 files / 1,622 tests, `pnpm lint`, `pnpm build`, changed-file Prettier
  and `git diff --check` passed.
- Real backend: against a throwaway PostgreSQL database and the real Nest API,
  the UI downloaded the owner's account JSON, an archived Board as CSV and an
  active Board as JSON with the expected file names; a Board MEMBER saw none of
  the owner's Boards and got 403 on a direct request, an outsider 404. See the
  [P5-08 record](p5-account-security-privacy-ui.md#verification).
- Deviation from the mockup: on wide screens the account export button sits on
  the same row as its JSON note so the page fits common laptop heights; the
  layout stacks on smaller screens.
