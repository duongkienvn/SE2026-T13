# P4-08 Global Search UI

**Status: implemented and locally verified.**
The scope follows [issue #196](https://github.com/duongkienvn/SE2026-T13/issues/196),
the [App Shell specification](../../design/post-mvp/app-shell/ux-spec.md), and the
[P4-02 search handoff](../backend/p4-global-search.md). The approved image shows
the Search affordance but does not show an open palette. The surrounding shell
is preserved, and the palette uses existing surfaces, tokens and dialog behavior.

## API and interaction

The authenticated header opens Search by click or Ctrl/Cmd+K. The field receives
focus; Arrow keys select visible results, Enter opens the selected server path,
Escape or the close button dismisses the dialog, and Tab stays within it. A
keyboard-accessible See all action switches to the selected type, Back to all
returns to grouped results, and Load more requests the next page. Input is trimmed,
debounced by 250 ms and limited to 120 Unicode code points. Empty input does not
issue a search or display history.

The client uses `GET /api/search` through `apiRequest`: `all` sends limit 5 and
no page; a specific type sends limit 20 and a page. Groups retain server totals
and `hasMore`; loaded pages deduplicate by type and ID. Titles and subtitles are
rendered as text, and null Workspace context is retained. The returned relative
path is passed to the router, which performs its normal authorization checks.

## Privacy and integration

Query keys contain user ID, session generation, query, type, page and limit.
Requests are aborted on input/view change and close; session checks prevent late
responses from being used across accounts. Search data is not persisted in browser
storage. Board/Workspace access revocation and reconnect clear protected snapshots
before a new read. Existing Board and Workspace query invalidations refresh search,
as do relevant Board realtime events. Server authorization remains authoritative.

Shared files touched: `AppHeader.tsx` replaces only the Search slot; the shell
regression test updates its expectations. Board/Workspace revocation and realtime
invalidation files connect the search cache to existing access-change signals.
No backend, shared contract, global style or other product surface is changed.

## Verification

- Focused Search, shell and invalidation-queue checks: PASS, 5 files and 27 tests.
  These include search 401, Board access-change, stale response and keyboard checks.
- `pnpm --filter @kanban/frontend test --maxWorkers=1 src/features/search/search-auth.test.tsx`:
  PASS, 7 tests. Additional cases exercise a late response after Board access
  revocation, an account switch, Workspace revocation and reconnect after a
  connection loss. These tests were added after the full frontend run below.
- `pnpm test`: the sandboxed rerun failed because backend HTTP tests could not
  connect to loopback; its frontend portion passed 130 files / 1,342 tests. An
  unsandboxed rerun then failed on two timing-sensitive Card navigation tests in
  parallel frontend execution. `pnpm --filter @kanban/backend test` with local
  loopback access: PASS, 104 suites / 1,088 tests. The single-worker frontend
  command `pnpm --filter @kanban/frontend test --maxWorkers=1` passed 130 files
  and 1,342 tests.
- `pnpm build` and `pnpm lint`: PASS. The build reported its existing Vite
  large-chunk warning.
- Changed-file Prettier: PASS. `pnpm format:check`: FAIL, reporting 995 files;
  the changed `RealtimeProvider.tsx` was among them at the time and has since
  been formatted. The remaining formatting drift was not changed.
- Chrome rendered the existing isolated QA fixture with synthetic Search results
  at 375×812, 768×1024 and 1280×800 in light and dark. The six
  [palette captures](../../design/screens/implementation/p4-global-search-ui/)
  were inspected against the approved shell image and spec: the palette stays
  inside the viewport and the page has no horizontal overflow. The image does not
  depict an open palette, so its composition extends the existing dialog style.
  The browser verified Ctrl+K, focus entry and restoration, Tab/Shift+Tab, Escape,
  the mobile drawer and shortcut suppression while the drawer is open. After
  supplying the fixture's missing Board user-state response, the browser also
  verified ArrowDown and Enter on a result and observed one Search request. It
  also verified Ctrl+K does not interrupt an open Card Detail dialog, and Chrome
  touch emulation opened Search on a 375px viewport. The fixture and Search
  responses are local test data, not production data.
- Main's original header Search slot was rendered into the same Boards fixture,
  without changing the rest of the current page. Pixel differences in all six
  `main-shell-*` / `shell-*` pairs were confined to the Search slot. The same
  comparison was captured for a loaded Board, Profile Settings and Card Detail
  at the same six viewport/theme combinations. The Board breadcrumb and layout
  remain positioned as before; one mobile capture also caught a transient star
  state change. Settings differences were confined to Search. Card Detail matched
  exactly on mobile and differed only in the obscured Search slot on tablet and
  desktop. These captures are not a live-backend check.
- Eight local commits record the implementation, tests, visual evidence and this
  task record. No push, PR, merge or deployment was performed.
