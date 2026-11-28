# MOB-44 Private assignee avatars and filter draft preservation

[Issue #329](https://github.com/duongkienvn/SE2026-T13/issues/329)

Phase P7A functional stabilization. Fixes audit findings F03 and F04 on the
mobile client only. Backend authorization, Board room fencing, Web and shared
description-update semantics (R01) are unchanged.

## F03 Managed assignee avatars

`toUserResponseDto` returns `/users/<id>/avatar/<asset>` for uploaded photos.
The Board roster decoder used to accept HTTPS URLs only, so uploaded photos
became `null` on Kanban, Table, Card metadata and the assignee picker.

- `boards/members/avatar-source.ts` (pure): `managedAvatarPath` accepts only
  the exact `/users/<same user id>/avatar/<uuid>` shape, so another user's
  path, a query string, `%`, `\`, whitespace or control characters are rejected.
  `externalAvatarUrl` accepts plain HTTPS without credentials (at most 2048
  characters). `avatarRevision` keeps a non-negative safe integer and uses 0
  otherwise.
- `decodeAssigneeAvatar` (in `kanban-api.ts`) keeps the managed path first,
  then a legacy HTTPS URL, otherwise `null`. Each `KanbanAssignee` now carries
  `avatarRevision`.
- `boards/members/assignee-avatars.tsx`: `memberAvatarOptions` is the single
  roster-fenced read that `BoardMemberAvatar` already used, now shared.
  - Key: `[...members(identity, boardId), 'avatar', userId, revision, path]`.
  - The read uses `resourceKey` on the same key, `retries: 0`, `staleTime:
Infinity` and `gcTime: 0`. Bytes are capped at 512 kB and kept in memory as
    a WebP data URI. No files are written, and no bearer token goes into an
    Image URL or to an external host.
  - Roster denial, Board teardown, logout and account switch evict the photo
    with the roster.
  - A new revision is a new key, so the photo is fetched again.
- `AssigneeAvatarScope` (the Board subtree, enabled while focused and online)
  and `useAvatarScope` (Card metadata, enabled while active and the roster is
  allowed) supply the fence. With no scope, the hooks observe nothing and
  managed photos show initials, which is the fail-closed default.
- Wired surfaces: Kanban preview avatar stack (first three), Table and picker
  `AssigneeAvatar`, and the Card metadata stack. Legacy HTTPS photos still
  render as before. A failed, denied or oversized read keeps initials.

## F04 Filter draft ownership

A background Board detail refetch (for example, after an unrelated member is
added) sets `isFetching`, so `verified` becomes false and `BoardContent`
unmounts. The open sheet and its draft lived in that subtree and were lost.

- `BoardEntry` now owns `filterSheet: { labels, draft } | null`. `BoardEntry`
  is keyed by user, session generation and Board, so a Board change or identity
  switch still starts clean.
- `BoardFiltersSheet` gained an optional `onDraftChange` and reports each draft
  edit. Calendar does not pass it, so its behavior is unchanged.
- While access is uncertain, nothing protected is rendered. The skeleton shows
  and no sheet or catalog appears. After a successful re-verification, the sheet
  reopens with the unapplied draft and catalogs are read again. Apply, Cancel
  and Reset keep their old semantics.
- Confirmed loss of access (403/404 or a `null` read revokes the room) clears
  the draft in the existing `revoked` effect. It is never restored.
- The verification predicate (`!detail.isFetching` and the rest) is unchanged.

## Verification

- Node: `test/boards/avatar-source.test.ts` (F03 decode, exact path shape,
  rejected variants, legacy HTTPS rules, revision, data URI).
- Jest `board-kanban.component.test.js`:
  - F03 managed photo, legacy HTTPS and another user's path (initials), with
    one fenced read, the exact `resourceKey`, and logout clearing photos.
  - Roster 403 never reads a photo; a revision change refetches (two reads).
  - F04 background revalidation hides the sheet while unverified, then restores
    the draft with no filtered read before Apply.
  - F04 a 404 clears the draft, and it is not restored after access returns.
- Mutation checks: 8 killed. One redundant denial effect was removed instead,
  because revocation already covers it.

## Not verified

- Two-client native scenario on a device (MOB-42 runtime).
- Live backend avatar bytes (the read path is the same one MOB-25 already
  uses for the member roster).
