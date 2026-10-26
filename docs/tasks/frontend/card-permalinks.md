# Card permalinks (P1-03)

## Scope and integration

Cards have the authenticated canonical route `/boards/:boardId/cards/:cardId`.
The existing Board detail route remains the parent, so opening or closing a card
keeps the Kanban DOM, horizontal scroll, selection, presence subscription, and
board dialog state mounted. The drag-and-drop implementation is unchanged.
`RequireAuth` and `AuthenticatedLayout` continue to own authentication and layout;
no new API, migration, dependency, or shared contract is needed. The existing
member:removed event now also delivers a minimal revocation notice directly to
the removed user after server receive grants are revoked.

The checkout was clean before work. The local branch `codex/card-permalinks` was
created from freshly fetched `origin/main` (`1dfd5ed`), including P1-02. No merge
conflicts were encountered. The work is recorded in seven local commits; no push,
PR, merge, or deployment was performed.
Local skill directories that became untracked under the newer main's ignore rules
are unrelated existing files and were preserved.

## Navigation and drafts

- A card click pushes its canonical path. Browser Back closes the overlay and
  restores the exact board URL, including query/hash; Forward reopens the card.
- Close/Escape use Back only for a card entry pushed by the current mounted board.
  Fresh tabs, pasted links, restored sessions, and reloads replace the card URL
  with its board route on Close. A validated board return path preserves filters
  after reload when router state is available. No dummy history entry is created.
- A changed title, description, or due date blocks in-app route changes with
  Keep editing / Discard changes. The prompt receives focus. Hard reload/window
  close use the browser's native before-unload protection.
- Card form and comment state survive background refetches. Changing the card ID
  creates a new detail instance after the navigation guard permits leaving.
- Existing save, archive, assignments, due dates, comments, and archive-list restore
  use their original implementations. CardForm and ArchiveCardSection were moved
  out of the oversized detail file without duplicating their state or forms.

## Authorization, failures, and sharing

The board and shell share useVerifiedBoard. A cached Board must pass a successful
REST check in the current mounted auth generation before its title or Card is
shown. A failed initial revalidation, including 503 with cached data, keeps Retry
and never starts the Card request. Network failures after a successful check of
the mounted page preserve its existing form/drafts.

Board failures 400/403/404 produce the same generic unavailable page. Card failures
400/403/404 hide cached detail and Copy link. Non-denial initial Card failures retain
the authorized board placeholder and the same CardForm instance, including edits
entered while the first request was pending; Retry never overwrites that draft.

Membership removal still commits first and revokes every affected socket receive
grant before adapter operations. BoardRoomCoordinator sends member:removed only to
the removed user's own sockets as a minimal direct revocation notice, then leaves
the room. Remaining members receive the existing room publication afterward.
The notice is the sole exception to excluding the removed user from subsequent
board business events; it includes only boardId and their own userId. Failure is
isolated through the existing disconnect fallback and cannot fail a committed REST
removal. Other-board grants and queue ordering are preserved.

RealtimeProvider handles that notice for the current user/session immediately,
without requiring another REST response: cancel requests, clear descendant/list
caches, and retain a generic denial tombstone. Uppercase route IDs are covered.
Queued invalidations cannot clear that denial or revive old data. Other-user
removals retain the normal invalidation behavior. Session-generation checks reject
queued notifications from an older session. AuthProvider's cache clearing and
late-response protection remain unchanged. A 401/session end unmounts private
content even with a dirty card form.

Other failures show retry controls. Failed background card refreshes keep edits
and explicitly show that refresh failed. Archived Board/Card details are read-only;
backend authorization remains authoritative for every request.

Copy link builds an absolute same-origin URL from the actual board/card IDs.
It contains no title, email, token, or query string. Success appears only after
`navigator.clipboard.writeText` resolves in a secure context. Unsupported or denied
clipboard access exposes a labelled, read-only URL that selects on focus. Sharing
the link does not grant access.

## Visual scope

This implements the permalink slice of CD-06, using the incumbent Dialog, Button,
Alert, inputs, spacing, Inter, and semantic tokens. Card dialogs fill the 375px
mobile viewport and use the existing wide two-column composition at tablet/desktop
widths. Other dialogs retain their previous layout. Copy link and Close card are
Available. The full Card Detail V2 redesign, checklists, attachments, labels,
Duplicate, cross-board moves, App Shell V2, and new navigation are excluded here.
The approved collage is a composition guide for later V2 work, not a requirement
to add those excluded controls to this slice. The current app is light themed;
theme implementation is outside this task.

## Verification

New Vitest/RTL coverage exercises click, Back/Forward, direct Close, dirty-draft
protection, clipboard success/failure, login return, board-before-card authorization,
400/403/404 fallbacks, archived read-only state, cached detail revocation, membership
removal, session rejection, realtime draft preservation, and network retry.
Existing Card action and Board detail tests were also run during implementation.
Recovery tests explicitly lock initial Card503 → draft retention → retry and
cached Board503 → no Card fetch/title → successful Retry. Desktop/375px tests cover
shell preference, A→B dirty navigation, safe Close, and retained DOM scroll state.
A delayed prior-session revocation cannot clear a newly authenticated user's Board.

Real Chromium QA uses the production route tree and components with deterministic
REST fixtures plus an actual Socket.IO client/test-server transport at 375, 768,
and 1280px. It checks navigation, focus restoration, nonzero horizontal Board
scroll through browser Back,
Escape, draft confirmation, manual-copy fallback, reload/direct Close, archived
read-only state, unavailable state, network retry, and document/dialog overflow.
The actual AppModule Socket.IO suites additionally verify post-commit notifications
to every removed tab, later business-event exclusion, and adapter/disconnect failure
isolation. Fixtures do not prove live PostgreSQL or deployment behavior.

| State         | 375px                                                                               | 768px                                                                               | 1280px                                                                                |
| ------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Card detail   | [Mobile](../../design/screens/implementation/card-permalinks/detail-375.png)        | [Tablet](../../design/screens/implementation/card-permalinks/detail-768.png)        | [Desktop](../../design/screens/implementation/card-permalinks/detail-1280.png)        |
| Copy fallback | [Mobile](../../design/screens/implementation/card-permalinks/copy-fallback-375.png) | [Tablet](../../design/screens/implementation/card-permalinks/copy-fallback-768.png) | [Desktop](../../design/screens/implementation/card-permalinks/copy-fallback-1280.png) |
| Archived      | [Mobile](../../design/screens/implementation/card-permalinks/archived-375.png)      | [Tablet](../../design/screens/implementation/card-permalinks/archived-768.png)      | [Desktop](../../design/screens/implementation/card-permalinks/archived-1280.png)      |
| Unavailable   | [Mobile](../../design/screens/implementation/card-permalinks/unavailable-375.png)   | [Tablet](../../design/screens/implementation/card-permalinks/unavailable-768.png)   | [Desktop](../../design/screens/implementation/card-permalinks/unavailable-1280.png)   |
| Retry         | [Mobile](../../design/screens/implementation/card-permalinks/retry-375.png)         | [Tablet](../../design/screens/implementation/card-permalinks/retry-768.png)         | [Desktop](../../design/screens/implementation/card-permalinks/retry-1280.png)         |

Additional recovery captures:

| State                          | 375px                                                                                     | 768px                                                                                     | 1280px                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Initial GET failure with draft | [Mobile](../../design/screens/implementation/card-permalinks/initial-error-draft-375.png) | [Tablet](../../design/screens/implementation/card-permalinks/initial-error-draft-768.png) | [Desktop](../../design/screens/implementation/card-permalinks/initial-error-draft-1280.png) |
| Revoked while REST fails       | [Mobile](../../design/screens/implementation/card-permalinks/revoked-375.png)             | [Tablet](../../design/screens/implementation/card-permalinks/revoked-768.png)             | [Desktop](../../design/screens/implementation/card-permalinks/revoked-1280.png)             |

Geometry and browser assertions: [browser-qa.json](../../design/screens/implementation/card-permalinks/browser-qa.json).
The [browser restart check](../../design/screens/implementation/card-permalinks/restart-qa.json)
closed and relaunched Chromium with the same profile, restored the Card tab
and session, rechecked auth → Board → Card using token-gated fixture responses,
verified safe Close, and verified login return after the session was removed.
This check ran at 1280px; responsive behavior is covered above.

### Environment and check results

| Check             | Result                                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| pnpm lint         | Pass (Node 24.22.1)                                                                                                                                                                                                                  |
| pnpm test         | Pass: 673 frontend tests / 76 files, 541 backend tests / 54 suites, 6 shared contract tests (1,220 total); the final frontend suite was rerun after separating route-navigation tests                                                |
| pnpm build        | Pass across shared, frontend, and backend; Vite reports its existing >500kB chunk warning                                                                                                                                            |
| pnpm format:check | Fails on existing repository-wide formatting issues, including unrelated skill files and untouched source/docs. All task files pass targeted Prettier check after formatting the evidence JSON. No repository-wide rewrite was made. |
| git diff --check  | Pass                                                                                                                                                                                                                                 |
| Real Chromium     | Pass: ten flow groups at each of 375/768/1280px, 21 screenshots, no page errors or horizontal overflow                                                                                                                               |

The full test run required loopback access outside the sandbox; the sandboxed
backend HTTP tests otherwise failed with EACCES. The final successful test run
used the PowerShell environment below, then the unmodified pnpm test command:

```powershell
$env:PATH = 'C:\Users\quang nam\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
$env:NODE_OPTIONS = '--no-experimental-strip-types'
New-Item -ItemType Directory -Force '.omo/evidence/p103-fix/tmp' | Out-Null
$env:TEMP = (Resolve-Path '.omo/evidence/p103-fix/tmp').Path
$env:TMP = $env:TEMP
$env:VITEST_MAX_WORKERS = '2'
pnpm test
```

The second-pass review identified three missing cases (revocation delivery, cached
Board503 gate, initial Card503 draft loss). Regression tests first failed for each
case and now pass. Final Chromium evidence covers all three sizes and adds draft
retention/retry plus revocation through real Socket.IO while REST fails. Independent
visual review directly inspected all 21 refreshed captures and returned PASS with
high confidence and no blockers. The first code-integrity reviewer could not
finish because of a usage limit; the bounded replacement review returned PASS
with no reachable correctness/security blocker in the three fixes.

Code audit: the route hook owns history, the dialog owns detail loading/status,
CardForm owns edit state, and CopyCardLink owns clipboard feedback. Router state
is narrowed from unknown and return paths are limited to the current board.
There are no new dependencies or unsafe casts, duplicate forms, logging systems,
or backend authorization rules. Revocation delivery is extended as described above. The largest touched page source is BoardDetailPage (230 nonblank,
noncomment lines); further page functionality should extract contextual actions
before growing it. CardForm is also in the warning band at 204 lines; if it grows again, extract the navigation prompt before adding more form behavior.
The sandbox's default temporary directories caused Vitest transform-file ENOENT
errors; a workspace-local TEMP/TMP directory resolved them. Default test concurrency
caused two 5-second timeouts (including an existing CardActions test); reruns use
`VITEST_MAX_WORKERS=2` without changing repository test configuration or timeouts.
The default installed Node 22.12 is below the declared minimum 22.13. Final checks
use the available bundled Node 24.22.1, with
`NODE_OPTIONS=--no-experimental-strip-types` for tests: otherwise Node 24 discovers
`packages/shared/test/realtime-contracts.ts` as a runtime test and tries to resolve
its intentional typecheck-only `src/index.js` import. No unrelated tooling change
was made to hide either environment issue.

## Limits and discrepancies

- This task does not add filters; it preserves existing board query/hash and DOM
  context when a real board entry exists. A fresh browser cannot recover a prior
  board's scroll or unsaved draft.
- Native reload prompts depend on browser policy and prior user interaction.
- The navigation warning covers the Card fields. Existing comment draft behavior
  is preserved; this task does not introduce a global draft store.
- README/project overview and older architecture snapshots lag the implemented
  P1-02 card restore feature. Source, P1-02, and the requested permalink boundary
  were used; no product or architecture redesign was inferred from stale prose.
- No live PostgreSQL-backed integration, production deployment, Safari, or
  Firefox verification is claimed by these fixture captures.
