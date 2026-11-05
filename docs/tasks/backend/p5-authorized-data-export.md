# P5-01 — Authorized data export backend

Implements [Issue #216](https://github.com/duongkienvn/SE2026-T13/issues/216),
roadmap DX-01 and the AC-01 account export slice. This record describes local
implementation and verification, not deployment. No frontend, migration, new
dependency, export persistence, background job, storage provider or realtime
event is introduced. Existing Card/Board data remains authoritative.

## HTTP and P5-07 integration

| Request                                       | Successful download                     |
| --------------------------------------------- | --------------------------------------- |
| `GET /api/boards/:boardId/export?format=json` | JSON Board snapshot                     |
| `GET /api/boards/:boardId/export?format=csv`  | One CSV row per Card                    |
| `GET /api/users/me/export`                    | JSON metadata for the verified JWT user |

Both query DTOs default to `format=json`. Account accepts an explicit
`format=json`; CSV and all other Account formats are rejected. Unknown keys,
duplicate/structured format parameters and unsupported values produce
`400 VALIDATION_FAILED`. There is no account selector or administrator override.
Malformed Board UUIDs use the existing `ParseUUIDPipe` error convention.

Success is HTTP 200 with UTF-8 bytes **outside the REST success envelope**:

- JSON: `Content-Type: application/json; charset=utf-8`.
- CSV: `Content-Type: text/csv; charset=utf-8`.
- `Content-Disposition: attachment; filename="kanvexa-board-<verified UUID>-<UTC YYYY-MM-DD>.<json|csv>"`.
- Account filename: `kanvexa-account-<UTC YYYY-MM-DD>.json`.
- `Cache-Control: private, no-store`, `Pragma: no-cache`, and
  `X-Content-Type-Options: nosniff` on successful **and failed** export requests.

Middleware sets privacy headers before guards and validation. Attachment headers
are set only after generation and fresh authorization succeed. There is no
redirect, external download URL or partial file on error. Swagger documents the
binary media types, query DTOs, headers and errors.

P5-07 should issue an authenticated GET and read a Blob on 200. On non-200,
decode the ordinary JSON error envelope; never save the error body as a file.
Filename prefixes/date/UUID are server-controlled. The current CORS origin policy
is unchanged; do not depend on cross-origin JavaScript being able to inspect
`Content-Disposition`. P5-07 may use the documented deterministic filename when
the response header is not exposed. Board Settings must show downloads only for
explicit OWNER; archived Boards remain exportable. Data & Privacy downloads use
the current account route. The server remains authoritative regardless of UI.

## Authorization and errors

| Actor                                                    | Board export                     |
| -------------------------------------------------------- | -------------------------------- |
| Explicit Board OWNER, including a guest OWNER            | Allowed on active/archived Board |
| Explicit Board MEMBER, including a guest MEMBER          | `403 FORBIDDEN`                  |
| Workspace-only reader or ADMIN without Board membership  | Access-safe `404 NOT_FOUND`      |
| Outsider or missing Board                                | Access-safe `404 NOT_FOUND`      |
| Missing, expired, invalidated or unverified JWT identity | `401 UNAUTHORIZED`               |

Workspace ADMIN never grants PRIVATE Board access or Board export permission.
`BoardAuthorizationService.requireOwner()` is reused without its mutation/row-lock
path, before any Board content queries. Account comments use the canonical
`readableBoardPredicate`: explicit Board membership or WORKSPACE_VISIBLE plus
current Workspace membership. Account Board memberships contain explicit
memberships only, not every readable Board.

Other errors are `413 EXPORT_TOO_LARGE`, sanitized `500 INTERNAL_ERROR` for
unexpected database/serialization failure, and `503 EXPORT_TIMEOUT` for the
bounded snapshot deadline. Existing rate limiting remains in effect (429).
Database statement timeout failures follow the existing sanitized 5xx filter.
Account permission/role/Workspace changes detected before publication return
`403 FORBIDDEN` with a retry message. Board demotion returns 403; removed Board
membership returns 404. No protected file bytes accompany these responses.

## JSON v1 schema

The exact TypeScript contracts are exported by
[`packages/shared/src/data-export.ts`](../../../packages/shared/src/data-export.ts).
The following definitions enumerate all exported properties. `ID` is a UUID
string; `Instant` is a UTC ISO timestamp ending in `Z`. Every named field is
present; nullable fields use JSON null. Positions and attachment byte sizes are
strings, preserving PostgreSQL numeric/bigint precision. Objects never include
additional entity properties.

| Definition      | Fields                                                                                                                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Timestamps`    | `createdAt: Instant`, `updatedAt: Instant`                                                                                                                                                                                                                                                                                            |
| `Archive`       | `isArchived: boolean`, `archivedAt: Instant \| null`                                                                                                                                                                                                                                                                                  |
| `Board`         | Timestamps + Archive + `id: ID`, `name: string`, `description: string \| null`, `workspaceId: ID`, `visibility: PRIVATE \| WORKSPACE_VISIBLE`, `backgroundPreset: string`                                                                                                                                                             |
| `Column`        | Timestamps + `id: ID`, `boardId: ID`, `name: string`, `position: string`                                                                                                                                                                                                                                                              |
| `Label`         | `id: ID`, `name: string`, `color: string`                                                                                                                                                                                                                                                                                             |
| `BoardMember`   | `id: ID`, `userId: ID`, `role: OWNER \| MEMBER`, `displayName: string`                                                                                                                                                                                                                                                                |
| `Card`          | Timestamps + Archive + `id: ID`, `boardId: ID`, `columnId: ID`, `title: string`, `description: string \| null`, `position: string`, `startDate: Instant \| null`, `dueDate: Instant \| null`, `createdById: ID`, `assigneeIds: ID[]`, `labelIds: ID[]`, `checklists: Checklist[]`, `attachments: Attachment[]`, `comments: Comment[]` |
| `Checklist`     | Timestamps + `id: ID`, `title: string`, `position: string`, `items: ChecklistItem[]`                                                                                                                                                                                                                                                  |
| `ChecklistItem` | Timestamps + `id: ID`, `text: string`, `position: string`, `isChecked: boolean`                                                                                                                                                                                                                                                       |
| `Attachment`    | `id: ID`, `kind: URL \| FILE`, `state: ACTIVE`, `displayName: string`, `originalFilename: string \| null`, `mimeType: string \| null`, `byteSize: string \| null`, `url: string \| null`                                                                                                                                              |
| `Comment`       | Timestamps + `id: ID`, `authorId: ID`, `content: string`, `mentions: Mention[]`                                                                                                                                                                                                                                                       |
| `Mention`       | `userId: ID`, `start: integer`, `end: integer`                                                                                                                                                                                                                                                                                        |

Board JSON top level, in serialized property order:

```typescript
type BoardExport = {
  schemaVersion: 1;
  generatedAt: Instant;
  board: Board;
  columns: Column[];
  cards: Card[];
  labels: Label[];
  boardMembers: BoardMember[];
};
```

Columns order by exact stored numeric position, then ID. Cards order by Column
position/ID, then Card position/ID, including active and archived Cards. Labels
and Board members order by ID. Assignees and assigned labels order by their IDs.
Checklists/items order by position/ID; attachments by ID; comments by creation
time/ID; mention spans by start/ID. Repeated downloads with unchanged source data
have identical ordering and contents except `generatedAt`.

Only ACTIVE URL/FILE metadata is exported. URL is the existing validated HTTPS
URL; FILE URL is null. FILE name, MIME and byte size are metadata only. Pending,
failed, expired and removed attachment rows are excluded. Deleted comments are
excluded. Mention spans use existing UTF-16 offsets and are included only when
within the comment text. No new completion field is inferred from Column names.
An empty Board has empty content arrays, while existing Columns and members are
still represented.

Account JSON top level, in serialized property order:

```typescript
type AccountExport = {
  schemaVersion: 1;
  generatedAt: Instant;
  profile: Timestamps & {
    userId: ID;
    email: string;
    displayName: string;
    emailVerifiedAt: Instant | null;
    avatarUrl: string | null;
  };
  preferences: {
    theme: 'light' | 'dark' | 'system';
    timeZone: string;
    dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
    weekStartsOn: 'monday' | 'sunday';
    notifications: {
      inApp: {
        cardAssigned: boolean;
        commentMentioned: boolean;
        workspaceInvited: boolean;
        boardInvited: boolean;
        membershipChanged: boolean;
        dueReminder: boolean;
      };
      email: {
        cardAssigned: boolean;
        commentMentioned: boolean;
        dueReminder: boolean;
      };
    };
  };
  linkedProviders: { password: boolean; google: boolean };
  workspaceMemberships: {
    workspaceId: ID;
    name: string;
    type: 'PERSONAL' | 'TEAM';
    role: 'ADMIN' | 'MEMBER';
  }[];
  boardMemberships: {
    boardId: ID;
    name: string;
    role: 'OWNER' | 'MEMBER';
    workspaceId: ID;
  }[];
  notifications: {
    id: ID;
    kind:
      | 'CARD_ASSIGNED'
      | 'COMMENT_MENTIONED'
      | 'WORKSPACE_INVITED'
      | 'BOARD_INVITED'
      | 'MEMBERSHIP_CHANGED'
      | 'DUE_REMINDER';
    createdAt: Instant;
    readAt: Instant | null;
    workspaceId: ID | null;
    boardId: ID | null;
    cardId: ID | null;
  }[];
  comments: (Timestamps & {
    id: ID;
    cardId: ID;
    boardId: ID;
    content: string;
  })[];
};
```

Account memberships order by Workspace/Board ID. Notifications and authored
comments order by creation time/ID. Comments on archived readable Boards/Cards
are included; deleted or inaccessible comments are excluded. There are no
third-party author profiles or mention targets in Account comments.

Missing preference rows use existing effective defaults: system theme, UTC,
YYYY-MM-DD, Monday, all six in-app categories enabled and all three email
categories disabled. Export does not create missing preference rows.
Linked provider flags are booleans obtained from password presence and Google
identity existence, never the credential or provider subject itself.

Notification history contains only the current recipient's notification ID,
kind and timestamps/read status. V1 deliberately emits null for all three context
IDs, including accessible contexts: this keeps retained notification metadata
portable without disclosing historical relationships, titles, actors or delivery
internals after access loss. Public avatar output accepts an external HTTPS URL
without credentials, query or fragment. Private uploaded avatar keys and signed
URLs are omitted. Board content and private file bytes require separate
authorized Board export/download; Account export is not a bulk Board export.

## CSV contract and spreadsheet protection

UTF-8 **without BOM**, RFC 4180 double-quote escaping, CRLF record separators,
stable unquoted header, and exactly one row per active/archived Card:

```csv
boardId,boardName,columnId,columnName,cardId,title,description,position,startDate,dueDate,isArchived,assignees,labels,checklistDone,checklistTotal,attachmentCount,commentCount,createdAt,updatedAt
```

Every data cell is quoted. Null dates/descriptions become empty strings;
booleans are lowercase `true`/`false`. Assignees are UUIDs sorted ascending and
joined with `;`. Labels are names sorted by PostgreSQL C collation then ID, joined
with `;`; delimiter-containing names remain human-readable, not a lossless nested
format. Checklist counts derive from `isChecked`; attachment counts use ACTIVE
rows and comment counts exclude soft deletion. CSV is a convenience projection,
not a complete replacement for JSON.

Before quoting, every cell (including joined cells) is checked after removing
leading Unicode whitespace, control, format and combining characters and NFKC
normalization. A significant leading `=`, `+`, `-` or `@` adds a leading apostrophe
to the original cell text. Embedded quotes/newlines remain escaped inside the
cell. JSON retains the original text. Header-only CSV is valid for an empty Board.

## Consistency, bounds and privacy

- Each generation uses a fresh READ ONLY, REPEATABLE READ PostgreSQL transaction.
  Related queries share one 15-second deadline; each statement has a five-second
  timeout and idle transactions have a 20-second timeout. There are no row locks,
  storage requests or network delivery while generating the snapshot.
- Queries page at 100 rows with stable ordering. Nested data is fetched for a
  100-Card batch through scoped collection queries, avoiding one query per Card
  and joined collection cross-products. CSV uses indexed scoped aggregates.
- More than 10,000 total Cards, including archived Cards, rejects either Board
  format before content generation. Completed representations over 20 MiB
  (20,971,520 UTF-8 bytes) reject with 413; exactly the limit is permitted. Account
  uses the same byte limit. Buffering and temporary nested-row accounting reject
  overflow without publishing a truncated or partial file.
- After buffering, a separate fresh snapshot rechecks Board OWNER or every
  exported Account grant, plus the current verified user/session version and JWT
  expiry. Account rechecks Board readability, explicit role, Board Workspace ID,
  and Workspace membership/role in bounded batches. Revoked grants discard the
  complete buffered file. Checks use PostgreSQL, not cached permissions.
- The final authorization check is the publication boundary. Revocation committed
  before that check is enforced; bytes already delivered cannot be recalled by a
  subsequent revocation. No locks are held across HTTP delivery.
- All projections are allowlists. Member emails, password hashes, Google subjects,
  auth/recovery/verification tokens, storage/pending keys, presigned URLs, file
  contents, outbox attempts and notification delivery internals are absent.
  Unexpected failures use the existing sanitized exception filter; raw export
  content is never logged. Existing business writes and realtime are untouched.

## Local verification

The integration command requires explicit opt-in and a local PostgreSQL server:

```powershell
$env:EXPORT_DATABASE_TESTS = 'local-only'
# Set DATABASE_HOST to 127.0.0.1/localhost/::1 and the explicitly local test port,
# user, password and administration database. Never supply production settings.
pnpm --filter @kanban/backend test:exports:database
```

The script creates/drops a randomized disposable database, runs the existing
migration chain there, starts real Nest HTTP/JWT and uses synthetic fixtures.
Mail is fake, private storage is disabled, and task workers/emails are disabled.
It checks both formats on active/archived Boards; the owner/member/guest/viewer/
admin/outsider matrix; nested ordering and privacy; RFC 4180 and formulas;
self-only Account defaults/preferences/notifications/comments; invalid queries,
expired/unverified JWTs, failure headers and Swagger; demotion, membership loss,
Workspace access loss and session invalidation races; concurrent Card/comment
edits, archive and delete; 10,000 versus 10,001 Cards; Board/Account byte overflow;
sanitized failures and zero schema drift. Cleanup drops the temporary database.

Recorded results for this implementation:

- **Pass:** focused export Jest suite, 33 tests.
- **Pass:** disposable PostgreSQL 17 + real Nest HTTP suite, 10 assertion groups.
- **Pass:** `pnpm lint`.
- **Pass:** `pnpm test`: backend 107 suites / 1,165 tests, frontend 140 suites /
  1,472 tests, shared 20 tests. The additional deadline unit test subsequently
  passed in the focused run, bringing the backend test total to 1,166.
- **Pass:** `pnpm build` (shared, backend, frontend, including TypeScript).
- **Pass:** explicit `pnpm --filter @kanban/backend exec tsc --noEmit -p tsconfig.json`
  and `pnpm --filter @kanban/shared exec tsc --noEmit -p tsconfig.json`.
- **Pass:** changed-file Prettier, documentation path checks and `git diff --check`.
- **Baseline failure:** the final `pnpm format:check` reports formatting/CRLF
  differences in 1,206 unchanged files and zero changed files. The failing paths
  were compared with `git diff --name-only origin/main`. Unrelated files are
  preserved; all task files pass the separate changed-file Prettier check.
- Non-fatal existing Vite warnings concern `.env` NODE_ENV and bundle size. The
  PostgreSQL run reports a pg concurrent-query deprecation warning during ORM
  schema inspection. Neither warning is a failed check.

Production, deployment and frontend browser verification are **not run** and are
outside this backend-only scope. Larger exports intentionally require a narrower
Board/dataset; queued exports, ZIP, storage links, imports, scheduled/email
exports, account deletion and UI remain excluded. No rollout migration is needed.
