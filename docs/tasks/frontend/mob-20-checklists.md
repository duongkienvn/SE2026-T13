# MOB-20 — Native Card Checklists

Issue [#280](https://github.com/duongkienvn/SE2026-T13/issues/280).
Branch: `feat/mobile-card-checklists`; base: `48f2bcd` (GitHub `main` verified
before implementation). Its first-parent history contains MOB-15 PR #275,
MOB-16 PR #276, MOB-17 PR #277 and MOB-18 PR #282 (`0f7eeb7`).

## Scope and integration

`features/cards/checklists/CardChecklists.tsx` implements the default
`CardChecklistsSection` in the existing MOB-18 slot, below Description.
It consumes `CardDetailSectionProps`: the verified
`boardId`, `cardId`, `identity`, Board/Card state, route activity, and
`canEdit` gate. The optional section override still works. The Card route,
Back guard, text editor, metadata, attachments, and comments are unaffected.

`useChecklists(context)` binds an authoritative list to the existing
`queryKeys.checklists(identity, boardId, cardId)`; `useChecklistMutation(context)`
owns the section's pending state and latest checkbox intent. The app's
session HTTP client supplies authorization, resource epochs and aborts.
No backend, Web, shared package, endpoint or dependency changed.

## REST contract

All routes are under `/api/boards/:boardId/cards/:cardId/checklists`.
Inputs are allowlisted; there are no query parameters.

| Method and suffix                    | Body                      | Response                         |
| ------------------------------------ | ------------------------- | -------------------------------- |
| GET base                             | —                         | 200 full Card checklist snapshot |
| GET `/summary`                       | —                         | 200 Card ID and aggregate counts |
| POST base                            | `{title}`                 | 201 full new Checklist           |
| PATCH `/:checklistId`                | `{title}`                 | 200 full Checklist               |
| PATCH `/:checklistId/move`           | `{beforeChecklistId}`     | 200 full Checklist               |
| DELETE `/:checklistId`               | —                         | 204 (no JSON read)               |
| POST `/:checklistId/items`           | `{text}`                  | 201 full Checklist               |
| PATCH `/:checklistId/items/:id`      | `{text}` or `{isChecked}` | 200 full Checklist               |
| PATCH `/:checklistId/items/:id/move` | `{beforeItemId}`          | 200 full Checklist               |
| DELETE `/:checklistId/items/:id`     | —                         | 204 (no JSON read)               |

Full snapshots have `cardId`, `checklists` and `checkedItems`, `totalItems`,
`completionPercentage`. Each Checklist includes its Card ID, title, items,
counts, identifier, position and timestamps; an Item has its Checklist ID,
text, checked state, identifier, position and timestamps. The adapter
validates identifiers, parent relationships, shape, limits and count
consistency, and drops unrecognized fields. Text is trimmed against
1–120 Unicode code points for titles and 1–255 for items. The Card limit is
50 Checklists; each Checklist supports 200 Items. The section uses the full
snapshot rather than requesting `/summary` redundantly. The summary read is
available through the same adapter. Percentages use the server's two decimal
rounding, with 0/0 shown as 0%. With one list, its progress is also the Card
aggregate; multiple lists get a separate Card aggregate.

## Ordering, writes and cache

- Positions are opaque decimal strings. The client uses the server's ordered
  arrays. Up/down/top/bottom fetches the latest list and compares the displayed
  sibling IDs before sending an explicit UUID anchor or `null` to append.
  The anchor is from the same sibling array; invalid, self, unchanged or
  stale moves are not sent. The server still resolves concurrent operations
  between that read and PATCH; no client-generated ranks or conditional
  update endpoint are assumed.
- One write batch per Card blocks overlapping forms, deletes and moves.
  The active checkbox responds to each tap and coalesces the latest desired
  value while its PATCH is outstanding. Intermediate write responses never
  replace the cached list. After settlement, the affected list/preview
  requests already in flight are canceled and refreshed from REST.
  The section keeps its last displayed rows and progress during the write,
  even if a commit hint arrives before the HTTP response. Only the active
  checkbox reflects pending intent. An offline or failed refresh labels
  any still authorized previous snapshot as the last loaded view.
- Both successful and failed writes reconcile via the existing
  `card:updated` / `changeScope: 'checklists'` cache targets: the Checklist
  key, exact per-Card preview and preview batches that contain the Card.
  Room hints use the same targets. Checklist mutations do not touch the
  Card DTO or invalidate the Board query on success. Card/Board archival
  errors recheck the corresponding capability; 403/404 child responses
  take the existing MOB-06 access-probe path without assuming Board loss.
- There is no automatic write retry. An ambiguous create keeps its text,
  rejects resubmission from that draft, and requires an explicit successful
  reload before offering another create in the mounted section.
  The endpoint has no idempotency key, so the user must review the result
  before starting a separate creation. Definitive failures retain the draft
  while access remains valid. Delete asks for confirmation and never removes
  content optimistically; the server snapshot after HTTP 204 updates counts.
- Writes require the current verified Board capability, active Board/Card,
  route focus, connection and matching session/resource epoch. Authorized
  archived and read-only users see checked state and progress but no write
  actions. Logout, 401, account changes and confirmed revocation fence or
  evict protected requests and caches. Checklist failure has its own Retry
  and does not replace the Card description or dirty title/description draft.

## Visual comparison

Directly inspected [Group 04](../../mobile/assets/04-card-detail.png) against
MOB-18 and [MOB-02](../../mobile/MOB-02-COMPONENTS.md). The integration follows
the existing single scroll: Checklist heading and outlined check mark,
left-aligned list titles and right-side Add item, rounded bordered surfaces,
indigo-to-teal progress, checked/total on the right, divided rows with checked
text struck through. It uses the existing semantic palette, type ramp, spacing,
48 dp controls, progress and sheet. Long text wraps. Short forms use
Save/Cancel, a discard prompt for dirty dismissal, and keyboard avoidance.

The mockup shows a compact preview and a separate collaboration view. MOB-20
uses the existing typed Card section and shows the complete list inline, with
no duplicate Card screen or unrelated actions. Overflow entries are required
for reorder, rename and delete; targets take more room than the illustrative
rows. A Card with multiple Checklists has an aggregate above its lists. Loading,
empty, mutation/retry and read-only states are added as specified. No screenshot
is presented as proof of native rendering.

Applied appllama-app-design-skill and appllama-usage to the native controls,
keyboard/sheet behavior, touch and theme conventions using the approved
mockup as visual authority; Appllama MCP was not connected. Applied kanvexa-ui
to keep approved, supported content scoped to the existing section.
Impeccable context and Operate/craft guidance were used to preserve the
existing visual system and state/error hierarchy. Ponytail kept changes in the
section and reused the existing ordering, query and app controls.
Kanvexa-verification scoped the checks to Mobile per the owner.

## Verification

- `pnpm --filter @kanban/mobile test`: **PASS**, 275 Node tests and 300 Jest
  tests across 25 suites. The Router fixtures still emit development-only
  `ROUTE_NAMES_CHANGED` warnings. Focused Node contract checks: **PASS**, 7/7.
- After the final early-hint and offline changes, reran
  `pnpm exec jest --runInBand test/card-detail.component.test.js -t MOB-20`
  from `apps/mobile`: **PASS**, 11/11, including an early hint before HTTP
  204 and blocked offline writes.
- The Mobile harness covers multiple lists, 0/0, partial/100% progress,
  exact status and 204 parsing behavior, limits, payload scope, rebalance,
  concurrent reorder, duplicate taps, checkbox intents, stale reads, preview
  reconciliation, interrupted POST, 401/403/404, revoke/account changes,
  archive/read-only and the independent MOB-18 draft. The 320 dp / 160%
  dark and System cases verify wrapping props, checkbox state, theme
  tokens, autofocus and draft dismissal within the harness.
- `pnpm --filter @kanban/mobile lint` and `pnpm --filter @kanban/mobile typecheck`:
  **PASS** on final source. Prettier on changed files (`--end-of-line auto`),
  changed documentation links and `git diff --check`: **PASS**.
- `pnpm --filter @kanban/mobile bundle:android`: **PASS** on final source.
  Metro processed 1,453 modules and the verifier checked 1,406 native
  sources in the Hermes source map. The first attempt hit a Windows sandbox
  temporary-volume error while Hermes was writing bytecode. The successful
  export used a standard Windows temp directory, `EXPO_OFFLINE=1` and a
  loopback API base.

Native rendering, actual keyboard geometry, hardware Back, TalkBack,
physical layout/contrast, motion, iOS and live Web–Mobile concurrency are
not verified by the Mobile JS harness. There is no APK, ADB, EAS or production
verification. At the theoretical 50 × 200 maximum the snapshot is validated,
but native scrolling performance for 10,000 simultaneous rows was not measured.
