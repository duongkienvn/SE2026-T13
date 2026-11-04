# P4-10 — Comment @Mentions UI and Safe Rendering

Implements the frontend portion of [issue #199](https://github.com/duongkienvn/SE2026-T13/issues/199)
against the merged [P4-04 comment contract](../backend/p4-notification-events-mentions.md).
Local implementation and verification only; nothing was pushed or deployed. The backend
alone validates spans and creates `COMMENT_MENTIONED` notifications; the client never does.

## Request and response

- `CommentRequest` is now `{ content, mentions: CommentMention[] }` and both
  `createComment` and `updateComment` always send `mentions` (`[]` for plain comments and
  for an edit that removes every mention — an omitted field would clear or keep spans by
  accident).
- The API layer calls `finalizeMentions(content, spans)`: it trims the content and moves
  every span left by the number of removed leading characters, in one step, so offsets
  always match the exact string sent. Spans are never trimmed afterwards.
- `Comment.mentions` is optional in the type (older servers/records) and treated as `[]`.

## Offset algorithm (UTF-16)

Spans are `{ userId, start, end }`, zero-based JavaScript string indices (UTF-16 code
units), `start` inclusive, `end` exclusive, covering `@` + display name.

| Vector                               | Content              | Span               |
| ------------------------------------ | -------------------- | ------------------ |
| P4-04 example (emoji = 2 units)      | `😀 @Linh`           | `3`–`8`            |
| Draft `"  😀 @Linh "` after trimming | `😀 @Linh`           | `5`–`10` → `3`–`8` |
| Vietnamese name                      | `cc @Đặng Thị Linh`  | `3`–`17`           |
| 2000-character limit                 | 1994 × `x` + `@Linh` | `1994`–`1999`      |

`rebaseSpans(spans, before, after, caret)` runs on every textarea change (typing, paste,
cut, selection replacement, undo/redo, IME). It finds the changed region from the common
prefix and suffix, limiting the suffix by the caret so repeated letters resolve correctly
(typing "n" inside `@Ann` is an edit inside the mention, typing after it is not). Spans
before the region stay, spans after it shift by the length change, and any span the edit
touched is dropped — its text stays as ordinary text, so no user ID can attach to other
text. Undo that restores the same characters does not restore the link.

## Composer and suggestions

- `MentionComposer` (textarea + separate listbox, no contentEditable) replaces the two
  `TextAreaField`s in `CommentsSection` for create and edit, with identical classes; a
  main-vs-branch pixel diff of the composer is identical at 1280/768/375 px, light and dark.
- A suggestion list opens only for an `@` at the start, after whitespace or punctuation
  (`ada@example.com` never triggers), not inside an existing mention, with no line break or
  leading space in the query; names with spaces are allowed.
- Candidates are only the Card Detail's authorized Board roster (`members`), minus the
  current user; none when `canReadMembers` is false (Workspace-visible readers), in which
  case the textarea is a plain textarea. No other directory is queried. Matching is case-
  and accent-insensitive (`dang` finds `Đặng`), prefix matches first, at most eight.
  Duplicate display names show the member's email from that roster as a second line.
- Keyboard: ArrowUp/ArrowDown move the highlight (`aria-activedescendant`), Enter selects
  unless an IME composition is active, Tab selects only after the user moved the highlight
  (otherwise Tab is normal), Escape closes only the list (`stopPropagation`, so the Card
  dialog stays open). Pointer/touch selection prevents the textarea blur. A polite status
  line announces how many members were found.
- Selecting inserts `@Name` (+ a space unless whitespace follows), replaces only the
  active token and puts the caret right after it.
- Caps: the 21st span or 11th distinct person is refused with a visible message, as is an
  insertion that would exceed the 2000-character limit.

## Validation before submit

A span whose member is no longer in the roster (or was renamed) blocks Post/Save and shows
"`@Name` is no longer a board member you can mention. Remove mention" — the button unlinks
it and keeps the draft text. Server 400/403/404/409 errors show the existing alert and keep
the draft. An edit whose final content and spans equal the saved comment stays disabled.

## Rendering

`MentionText` re-validates server spans (array, safe integers, in range, length ≥ 2,
starts at `@`, no split surrogate pair, sorted, non-overlapping, ≤ 20). Any problem renders
the whole comment as plain text. Valid spans become `<span class="comment-mention">` text
chunks; there are no links or profile actions, and no `dangerouslySetInnerHTML` — HTML-like
content shows literally. Without member access the text is plain. Comments without spans
render exactly as before.

## Files touched

All changes are in `features/comments/`: `types.ts`, `api.ts`, `CommentsSection.tsx`, new
`mentions.ts`, `MentionComposer.tsx`, `MentionText.tsx`, `mentions.css`, and tests. Card
Detail layout, pagination, delete, archived read-only and realtime were not changed.

## Visual reference and differences

The [Board/Card reference](../../design/post-mvp/board-card/approved-visual-reference-v1.png)
has no mention panel, so the new pieces follow its Card Detail V2 style: the list reuses
the popover look of the Share/Invite panel (avatar + name rows, rounded white surface,
soft shadow), and mentions in comments use the primary-soft chip color used for labels.
Inside the textarea mentions stay plain text (no rich editor, as the issue requires).
Evidence: [implementation screenshots](../../design/screens/implementation/p4-comment-mentions-ui/).

## Verification

Local, November 5, 2026:

| Check                                       | Result                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `vitest run src/features/comments`          | PASS: 4 files, 60 tests                                                                      |
| Full frontend `vitest run --maxWorkers=2`   | PASS: 132 files, 1,387 tests                                                                 |
| Mutation: no `stopPropagation` on Escape    | Caught (Card dialog closed)                                                                  |
| Mutation: render server spans unchecked     | Caught (malformed spans styled)                                                              |
| Mutation: no boundary check before `@`      | Caught (2 email tests)                                                                       |
| `pnpm lint`, frontend `vite build`, `tsc`   | PASS                                                                                         |
| Real Chrome typing (Playwright, mocked API) | `Thanks @Linh and @Đặng Thị Linh ` via keyboard selection at 1280/768/375 px, light and dark |

A first QA fixture with a hand-counted, off-by-one span rendered as plain text — the
render-time validation working as intended. Not verified against a running backend.
