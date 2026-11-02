# Board discovery and customization backend

This record describes the API implementation, not deployment verification.

## Contracts

All routes require authentication. `GET /api/boards` and
`GET /api/workspaces/:workspaceId/boards` accept `starred=true|false`,
`recent=true|false`, `q` (trimmed Board name, at most 120 characters), and
`sort=createdAt|updatedAt|name|recent`. Workspace listings retain the existing
`search` parameter; when both are supplied, `q` takes precedence. Search is
case-insensitive and treats `%`, `_`, and backslash literally. Defaults remain
unchanged: active Boards, existing page/limit and ordering. `status=archived`
selects archived Boards instead. `recent=true` includes only stored views;
`recent=false` does not filter. Recent sort puts missing timestamps last;
name sorts ascending and timestamps descending, with Board ID in the same
direction as tie breaker. Empty and out-of-range pages use existing pagination
semantics. Invalid values produce 400. The shared read predicate applies before
filtering, counting and pagination; Workspace routes additionally require an
actual Workspace membership. Page sizes remain capped at 100.

List items include `isStarred`, `lastViewedAt` and `backgroundPreset`.
The shared package exports `BoardDiscoveryFilters`, `BoardDiscoverySort`,
`BoardUserDiscoveryState`, `BoardBackgroundPresetId`, `BoardBackgroundPreset`
and `UpdateBoardBackgroundRequest` for API consumers.
For Board detail and mutation results, fetch `GET /api/boards/:id/user-state`
to obtain `{ "isStarred": false, "lastViewedAt": null }` separately. Use
`PUT /api/boards/:id/star` and `DELETE /api/boards/:id/star` to set or clear;
both return that state. `POST /api/boards/:id/views` records an explicit
authorized page visit and returns the same state. Do not call it for prefetch,
background synchronization or previews. Calls within one minute of the last
recorded visit leave the timestamp unchanged across tabs. At most 100 recent
timestamps are retained per user, ordered by timestamp then Board ID; starred
state is retained independently. Archived Boards retain state. Temporarily
inaccessible entries remain stored but are excluded by ACL until access returns.

`GET /api/boards/background-presets` supplies stable `id`, `kind`, `value`, and
suggested `foreground` values. The color IDs are `blue`, `indigo`, `violet`,
`rose`, `orange`, `amber`, `green`, and `teal`. The photo IDs are `mountains`,
`forest`, `coast`, and `lake`, and their catalog values are Unsplash image URLs.
Photo rendering requires access to images.unsplash.com and should apply a dark
overlay when using light text. The default for existing Boards is `blue`.
The presets use photographs offered under the [Unsplash License](https://unsplash.com/license);
their CDN is an external runtime dependency.
An active OWNER can call `PATCH /api/boards/:id/background` with
`{ "preset": "forest" }`; arbitrary URLs and unlisted IDs are rejected.
Board responses also expose `backgroundVersion`. Clients can send that value as
`expectedVersion` in the PATCH to reject stale writes with 409; this comparison
and increment occur under the Board row lock. The optional field preserves the
legacy unconditional contract, so legacy clients must migrate to gain conflict
protection. The version migration must be applied before deploying this code.
The existing `board:access-changed` ID-only event invalidates Board and
Workspace caches after commit; private state is never broadcast.

For P3-12, include the authenticated session identity in list and user-state
cache keys. Invalidate Board/Workspace lists and that user's state after star
or view, and invalidate Board detail/lists after background updates. Clear
session-scoped caches on logout and discard late responses after access loss.
Use `capabilities.canManageBoard` for the background action.
One compatible key shape is `['board-discovery', userId, generation, 'state', boardId]`
for private state and `['board-discovery', userId, generation, 'list', filters]`
for discovery. Star/view invalidate both prefixes and the existing
`['boards', 'list']` and `workspaceKeys.boards(userId, generation, workspaceId)`
prefixes. Background changes invalidate `['boards', 'detail', boardId]` and
the relevant Board and Workspace list prefixes; user-state keys stay private.

## Persistence and rollout

The additive migration creates a composite `(user_id, board_id)` state table,
foreign keys with cleanup, partial recent/star indexes, and a checked preset
column with a safe default. Board mutations and state writes recheck access
inside transactions. Down is allowed only while there is no discovery state and
every Board uses the default; otherwise it refuses to discard preferences. Back
up and roll forward if recovery is needed. Apply migrations
only through the documented deployment process, never implicitly at startup.
Real PostgreSQL migration, upgrade, concurrency, query-plan and access-race
checks must be run against an explicitly designated disposable test server.

The Board integration suite covers a populated upgrade, concurrent duplicate
writes, per-user isolation, 100-entry retention and an indexed recent query on
1,200 relations. Workspace integration exercises private, Board Guest,
Workspace-visible and revoked access. Socket integration checks the background
invalidation. These checks use temporary databases and do not demonstrate a
deployment.
