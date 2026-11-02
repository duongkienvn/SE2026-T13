# Board-local Card filtering and preview summaries (P3-07 / CD-07)

`GET /api/boards/{boardId}/cards` retains its paginated envelope and Card DTO.
Optional query fields are `q` (trimmed, at most 200 characters, literal
case-insensitive title/description substring), `labelIds` and `assigneeIds`
(comma-separated 1–50 unique UUIDs), `dueStatus` (`NO_DUE_DATE`, `OVERDUE`,
`DUE_TODAY`, `UPCOMING`), and `dueFrom` / `dueTo` (explicit-offset ISO instants).
Each label or assignee facet matches any supplied ID; facets combine with AND.
Unknown or foreign label/member IDs return a generic 404. Omitted fields and an
empty trimmed keyword apply no filter; empty ID lists, duplicates, invalid dates,
and a range with `dueFrom >= dueTo` return 400. Bounds are inclusive from and
exclusive to. Null due dates do not match a range. Existing `columnId`, `status`,
`page`, and `limit` rules remain in force.

The server uses one current clock and the account's IANA timezone (default UTC):
overdue is strictly before now, today is not overdue and on the same local civil
date, upcoming is not overdue and on a different local date. These are the P3-03
rules; no completion is inferred from columns. Active results retain existing
column-ID then exact numeric position and UUID order; within a column they use
position then UUID. Archived order remains archive time descending then UUID.
Pages are not a snapshot across concurrent edits; refetch after changes.

`GET /api/boards/{boardId}/card-preview-summaries?cardIds=<uuid>,<uuid>` takes
1–100 distinct Card UUIDs. Its normal success envelope contains
`data: { summaries: [{ cardId, labelIds, checklist: { checkedItems, totalItems },
attachmentCount, commentCount }] }`. Missing, foreign, and archived Cards are
omitted without distinguishing them. Counts include checklist items, active
attachments and non-deleted comments; no contents or private file identifiers are
returned. Both routes require a current Board read grant and send `no-store`.

Example (replace the UUIDs with IDs from the authorized Board):

```http
GET /api/boards/{boardId}/cards?q=review&labelIds={labelId}&assigneeIds={userId}&dueStatus=UPCOMING&page=1&limit=20
GET /api/boards/{boardId}/card-preview-summaries?cardIds={cardId}
```

The summary success envelope has the following `data` shape (the usual envelope
also includes the standard response fields):

```json
{
  "summaries": [
    {
      "cardId": "00000000-0000-4000-8000-000000000001",
      "labelIds": [],
      "checklist": { "checkedItems": 1, "totalItems": 2 },
      "attachmentCount": 1,
      "commentCount": 3
    }
  ]
}
```

The existing list is a single globally paginated sequence, not per-column pages.
P3-13 should load the ordered Column list separately and render matches under
those Columns. Page and total describe the whole filtered Board, or the selected
Column when `columnId` is supplied. A page past the end returns an empty `data`
array and the actual total. Invalid grammar returns 400 `VALIDATION_FAILED`;
foreign/nonexistent facet IDs return 404 `NOT_FOUND` (column uses the existing
`COLUMN_NOT_FOUND`); missing or expired sessions return 401, and inaccessible
Boards return 404. No response distinguishes a foreign preview Card from a
missing or archived Card. Shared `BoardCardFilters`, `CardPreviewSummary`, and
`CardPreviewSummaries` types are exported by `@kanban/shared`.

For P3-13, key cached list and summaries by authenticated session, Board and all
query parameters. Suggested keys are `[...boardKeys.cards(boardId), 'filtered', filters, page, limit]` and
`[...boardKeys.cards(boardId), 'preview-summaries', sortedCardIds]`.
These are proposed P3-13 keys, not hooks already implemented here. Invalidate
both prefixes for `card:created`, `card:updated`, `card:moved`, `card:archived`,
`card:restored`, `card:assignees-changed` and `labels:changed`; invalidate preview summaries for
`comment:created`, `comment:updated`, and `comment:deleted` as well. Checklist,
attachment, and Card-label assignment changes use `card:updated`, not separate
payloads. Existing
`boardKeys.card`, `checklistKeys`, `attachmentKeys`, `labelKeys` and `commentKeys`
remain independent detail caches. Invalidate relevant pages and summaries for existing Card,
assignee, label, checklist, attachment and comment hints; resync on reconnect,
logout, account switch, or access loss. Do not put query text or results in
socket messages. Disable drag and drop while a filter or incomplete page prevents
safe full-list ordering. Card detail/deep links remain independent of filters.

No migration was added. See the P3-03 date record and existing event contracts
for timestamp and realtime details. PostgreSQL integration tests require an
explicitly designated test server capable of creating disposable databases.

## Verification record

A disposable PostgreSQL 16 container bound to loopback was used for the Card
integration suite and then removed with its anonymous volume. The suite applies
all migrations to a temporary database and deletes it afterward. The P3-07
checks cover literal metacharacters, multi-label and multi-assignee OR/AND,
filtered totals, page boundaries, a 1,000-card pagination traversal, a 100-card
preview request, mixed checklist states, active/pending/removed attachments,
visible/deleted comments, invalid and foreign IDs, explicit-offset DST fold
ranges, due states, archive/restore, concurrent checklist updates, guest,
Workspace viewer, private Board denial and revoked Board membership. A PostgreSQL
`EXPLAIN (ANALYZE, BUFFERS)` query was exercised with the populated Board; no
additional index or migration was introduced. This small fixture is not a
large-scale performance benchmark.

The original global list orders Columns by UUID rather than Column position; the
Column list remains authoritative for layout, and the legacy Card sequence is
unchanged. Clients must group the returned Cards under their ordered Columns,
not infer Column layout from Card response order. As with any paginated list,
concurrent changes may shift page boundaries; refetch after hints.

Verification in this checkout: `pnpm lint`, `pnpm build`, changed-file Prettier,
`git diff --check`, and the PostgreSQL Card integration suite passed. The
focused DTO/service Jest run passed 39 tests. A full backend Jest run passed 90
of 91 suites (888 tests); `boards-module.spec.ts` timed out waiting 45 seconds
for its child process, including on an isolated retry. The first `pnpm test`
run was interrupted after multiple frontend test timeouts during concurrent
execution. A one-worker frontend retry reported an `AcceptInvitation.test.tsx`
failure and was interrupted before completing the entire frontend suite. Full `pnpm format:check` reported 830 files; changed-file formatting
passed separately. The local runtime reported Node 22.12.0, below the
repository's declared minimum 22.13.0.

Follow-up: the BoardsModule bootstrap test was rerun after increasing the child
process timeout to 180 seconds and passed (1 suite, 1 test). The earlier full
backend run is still recorded above; it was not rerun in its entirety.
The 11 previously affected frontend test files were rerun with one worker,
`--testTimeout=30000` and `--hookTimeout=30000`: all 183 tests passed, including
the invitation test. This targeted retry does not constitute a full frontend
suite run.
