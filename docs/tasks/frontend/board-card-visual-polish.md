# Board and Card visual polish

## Scope and decisions

Implements the supplied Phase 3 polish brief and its two mockups, within existing
Board discovery (roadmap BD-04), P3-12 customization, and P3-13 filtering/preview
capabilities. The images guide composition; server permissions and real contracts
remain authoritative. No new List/Timeline, background upload, schema migration,
or Card completion state is introduced. Existing Board Settings/navigation and
Card Detail V2 behavior remain in place.

- Global discovery keeps server pagination, URL search/sort and a compact status
  selector. Starred uses `/boards?view=starred` and selects only its sidebar item.
  Workspace discovery keeps the shell navigation and a single scrollable row of
  secondary directory filters. Unsupported directory Filter/List controls are gone.
- Both directories use `BoardTile`: bundled photo or restrained color cover,
  concise authorized metadata, independent star and permitted action targets.
  Covers reserve their space while the preset catalog loads. Menus escape the
  cover clipping boundary and render above neighboring controls. Withheld member
  counts are never inferred from Workspace membership.
- Create forms share Color/Photo selection using the authenticated preset catalog.
  An optional `backgroundPreset` is validated against canonical server IDs and
  saved with Board and OWNER membership in the existing transaction. Omission
  retains the database default. Workspace gateway forwards the field in the same
  request. Failed drafts remain; Cancel/reopening resets them. Catalog failure
  leaves the default creation path available without claiming a chosen preset.
- Kanban canvas shows the selected local image or softened color, with readable
  surfaces over it. Existing versioned background editing and access checks stay
  intact. Cards have a compact title/status row, clipped description, abbreviated
  zoned date/range, colored labels, checklist progress and icon counts beside
  assignees. Exact saved date format, time and zone remain in accessible labels
  and tooltips. Complete checklist progress does not mark the Card complete.
- Card Filter uses expandable selected facets and a single dialog scroll area,
  with sticky actions. Keyword, due semantics, exact UTC range bounds, URL state,
  Apply/Reset/Cancel and restrictive-filter drag safety remain unchanged.

## Review findings verified against source

All three findings were valid in the starting checkout; no GitHub replies or
thread resolutions were posted.

| Finding                                                                                                     | Resolution                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR 182: recent rows](https://github.com/duongkienvn/SE2026-T13/pull/182#discussion_r4443010954)            | Limit Overview presentation to five rows, retaining the authorized query, totals and View all destination.                                                                                                                                                                                                          |
| [PR 182: per-card star requests](https://github.com/duongkienvn/SE2026-T13/pull/182#discussion_r4443010931) | Preserve list `isStarred` through both UI models and seed the session-scoped query with five-minute freshness. List timestamps reconcile fresh responses even when the boolean is unchanged; old remounts cannot overwrite newer toggles. Existing cancellation, refusal eviction and access/session guards remain. |
| [PR 183: prolonged Saving](https://github.com/duongkienvn/SE2026-T13/pull/183#discussion_r4444297609)       | Start filtered/preview invalidation without awaiting those batches in Card, Comment, Attachment and Label callbacks. Continue awaiting required detail/catalog/card-list refreshes. Mutation errors and authorization invalidation remain intact.                                                                   |

## Additional revocation regression

A real integration test with list-provided star state exposed an existing global
list problem: `removeQueries` evicted the cache but did not notify its mounted
observer, leaving a protected Board name rendered after a star mutation returned
403/404. Revocation now cancels list requests and explicitly clears observed data
before retaining the existing eviction. Tests cover both HTTP statuses and a late
list response that ignores cancellation. Workspace eviction/session boundaries
are preserved.

## Browser evidence

[Implementation captures and measurements](../../design/screens/implementation/board-card-visual-polish/README.md)
use the existing isolated DEV fixtures and production components. Browser QA does
not claim production deployment or a live multi-account socket session. Persistence,
HTTP authorization and rollback are separately exercised by the disposable
PostgreSQL integration script, on the server explicitly designated for testing.

## Verification

- PASS: `pnpm --filter @kanban/backend exec jest --runInBand --runTestsByPath test/boards/boards.dto.spec.ts test/boards/boards.service.spec.ts` — 65 tests.
- PASS: Board HTTP E2E — 37 tests, including selected background in creation response.
- PASS: `pnpm --filter @kanban/backend test:boards:database` — disposable database migrations/defaults, selected creation persistence, OWNER/rollback, discovery/ACL, archive/restore, concurrency, real compiled HTTP/JWT bootstrap. The configured server was explicitly confirmed as a test/development target before execution.
- PASS: `pnpm test` with `VITEST_MAX_WORKERS=1` — 1,288 frontend, 912 backend and 17 shared tests. This preceded the additional global-list refusal/cancellation regressions; a complete frontend rerun verifies the final additions separately.
- PASS: focused global/Workspace star, observer revocation and realtime access checks after the observer fix — 54 tests.
- PASS: `pnpm build` — shared, backend and frontend. Existing Vite `.env` NODE_ENV and bundle-size warnings remain.
- PASS: `pnpm lint`; task-file Prettier checks; `git diff --check`.
- PASS: 30 browser layout measurements and desktop/mobile light/dark screenshots; dialog focus/Escape/action visibility and star click without navigation.
- Full repository `pnpm format:check` fails on existing CRLF formatting in unrelated files. Task files are formatted separately; no repository-wide rewrite or Git line-ending setting change was made. Sampled original HEAD versions of unrelated warned files already pass Prettier while their working copies use CRLF.

- Final complete frontend command: **failed because one Vitest fork worker timed out before starting untouched `cards/ordering.test.ts`**; 121 files / 1,289 tests passed, no assertion failed. The two ordering tests passed in an isolated rerun with `VITEST_MAX_WORKERS=1`, completing coverage of all 1,291 frontend tests across the runs. No worker/test timeout or project test configuration was changed.
- Final full formatting command: **failed on 998 unchanged files**; none of its warnings names a task file. Changed files pass targeted Prettier. Original `auth.service.ts` and `routes.tsx` were sampled to confirm correctly formatted HEAD content versus CRLF working copies.
- Browser action menu checks also verify unobscured Edit/Archive hit targets across their widths, correct Edit identity and focus restoration.

- PASS: final `pnpm --filter @kanban/frontend test -- src/features/cards/ordering.test.ts` — 2 tests; late-response observer test — 2 tests; compact metadata/accessibility test file — 3 tests.
- PASS: final `pnpm --filter @kanban/frontend build` after the menu stacking correction. Root build also passed earlier on the functional implementation. Existing bundle-size warning remains.
- No application/configuration changes were made to address the worker-start failure; it is reported as a runner limitation, not a successful full frontend command.
