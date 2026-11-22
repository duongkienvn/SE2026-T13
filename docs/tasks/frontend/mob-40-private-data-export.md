# MOB-40 Native account and OWNER-only Board export

[Issue #320](https://github.com/duongkienvn/SE2026-T13/issues/320)

Built on `main` (after MOB-37/38). Independent of MOB-39 (#323). MOB-41 (#321)
will place the export engine inside the final Data & Privacy landing; this task
adds only a minimal `/data-privacy` screen and one Settings entry.

## Backend contracts used (unchanged)

| Route                                     | Who                                                  | 200 response                                                                                |
| ----------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /users/me/export?format=json`        | current verified account                             | `application/json; charset=utf-8`, `attachment; filename="kanvexa-account-YYYY-MM-DD.json"` |
| `GET /boards/:id/export?format=json\|csv` | explicit Board OWNER (guest OWNER, archived allowed) | JSON or `text/csv; charset=utf-8`, `kanvexa-board-<uuid>-YYYY-MM-DD.<ext>`                  |

`@SkipResponseWrap()` raw bytes; errors keep the JSON error envelope. Server
limits: 20 MiB per file, 10,000 Cards (`413 EXPORT_TOO_LARGE`). Verified in
`exports.controller.ts` and `packages/shared/src/data-export.ts`. The backend
does not compress responses.

## What changed

### Transport (`client.ts` `binary()`)

The bounded reader used by attachments and avatars required Content-Length.
Exports must be capped even when the header is missing, so:

- With `maximumBytes` and no declared length, chunks are collected until the
  cap; one byte over throws `invalid-response` with code
  `RESPONSE_TOO_LARGE` (also used for a declared length over the cap).
- `onProgress(received, total?)` reports actual bytes; no fake percentage when
  the total is unknown.
- Existing callers still pass `requireContentLength: true`, so their behavior
  is unchanged. Redirects stay `redirect: 'error'`, `cache: 'no-store'`,
  `credentials: 'omit'`; the Bearer goes only in the Authorization header.

### `features/exports/model.ts`

- `downloadExport()` uses `SessionHttpClient.binary()` (identity-fenced),
  `retries: 0`, 120 s timeout, `maximumBytes: DATA_EXPORT_BYTE_LIMIT`, the
  requested MIME only. Board exports carry the Board resource key with read
  access so access loss or A→B aborts the transfer.
- Rejected as exports: 204, HTML, wrong MIME, JSON envelopes, missing
  `attachment` disposition, empty bodies, oversize bodies, any 4xx/5xx.
- `exportFilename()`: a Content-Disposition name is used only if it is exactly
  the documented shape for this target (same Board UUID, same extension);
  otherwise the documented fallback. Traversal, CRLF, absolute paths, bidi
  controls, other Boards, double extensions and personal text never reach the
  OS filename.
- CSV/JSON bytes are never parsed or rewritten (BOM, CRLF, order kept).

### `features/exports/native.ts`

- Files live only in `Paths.cache/kanvexa-private-exports/<random>/`. A file is
  created only after a complete validated response, with a synchronous write
  and a size check before the URI is returned.
- `clearPrivateExportFiles()` runs on cold start and every session end (root
  layout). A failed delete fences new exports until the app restarts.
- Share uses `expo-sharing` (`isAvailableAsync` first); Open uses
  `File.canPreview/preview`. Neither is reported as "saved".

### `useExport` + UI

- States: idle, downloading (real bytes), canceled, ready, removed, error.
  One export at a time; Cancel aborts; 429 uses Retry-After.
- The private file is kept while the user may share/open it, and deleted on
  **Remove file**, a new export, unmount (leaving the screen), session end and
  cold start.
- `/data-privacy`: “Export my data (JSON)” with what is and isn’t included and
  a privacy note.
- Board Settings: an **Export board** card with JSON/CSV, shown only when
  `currentUserRole === OWNER` (explicit role; archived included; Workspace
  ADMIN without Board ownership never). A server 403/404 hides the button and
  shows a non-disclosing message.

## Checks

See the PR for the command list. Added `test/exports/contracts.test.ts`
(Node, 10) and `test/exports.component.test.js` (Jest, 9). Mutation check: 7/9
killed; the two survivors are redundant second layers (the hook checks the
storage fence before the native save does; the button is disabled during a
download as well as the in-flight lock).

## Not verified

- No Android/iOS device: native share sheet, preview, Save to Files, TalkBack/
  VoiceOver, 320 dp, large font and dark mode are untested.
- No live-backend run; contracts were checked against the backend source and
  fake transport.
- "Save a copy" to a user-chosen folder is not offered separately; the OS share
  sheet is the only handoff (it may offer Save to Files/Drive).
