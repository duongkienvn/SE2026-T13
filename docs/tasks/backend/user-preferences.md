# P1-01 — User Preferences API & Persistence

Phase 1; AC-02 Appearance foundation and AC-03 Preferences foundation.
Backend contract for P1-05 Account Settings & Appearance. The approved
[roadmap](../../roadmap/post-mvp.md), [product blueprint](../../design/product-ux-blueprint.md)
and [settings specification](../../design/post-mvp/settings-notifications/ux-spec.md)
are consistent with these four fields; they did not define conflicting wire values.

## API contract for P1-05

Both endpoints require the existing Kanvexa bearer JWT. Identity comes exclusively
from `@CurrentUser().userId`; there is no account selector. A `userId` in PATCH is
an unknown field and fails validation. Query parameters cannot select another user.

| Field          | Accepted values                                  | Default      |
| -------------- | ------------------------------------------------ | ------------ |
| `theme`        | `light`, `dark`, `system`                        | `system`     |
| `timeZone`     | Node/ICU-recognized IANA name, maximum 100 chars | `UTC`        |
| `dateFormat`   | `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY-MM-DD`         | `YYYY-MM-DD` |
| `weekStartsOn` | `monday`, `sunday`                               | `monday`     |

Enum values are case sensitive; accepted values are preserved verbatim. Timezone validation combines
the installed class-validator `IsTimeZone` (Node `Intl.DateTimeFormat`) with a
named-zone syntax check, so numeric offsets such as `+07:00` are rejected even on
Node versions that support offsets in Intl. `UTC`, `Asia/Ho_Chi_Minh`,
`America/New_York` and recognized IANA aliases are valid. Whitespace is not trimmed.
The frontend interprets `system` using OS/browser settings. These preferences do
not change UTC persistence or the existing Card `dueDate` API.

### Read

```http
GET /api/users/me/preferences
Authorization: Bearer <kanvexa-jwt>
```

```json
{
  "success": true,
  "statusCode": 200,
  "message": "OK",
  "data": {
    "theme": "system",
    "timeZone": "UTC",
    "dateFormat": "YYYY-MM-DD",
    "weekStartsOn": "monday"
  }
}
```

GET returns saved values or all four defaults without inserting a row.

### Partial update

```http
PATCH /api/users/me/preferences
Authorization: Bearer <kanvexa-jwt>
Content-Type: application/json

{"theme":"dark","timeZone":"Asia/Ho_Chi_Minh"}
```

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Preferences updated",
  "data": {
    "theme": "dark",
    "timeZone": "Asia/Ho_Chi_Minh",
    "dateFormat": "YYYY-MM-DD",
    "weekStartsOn": "monday"
  }
}
```

Send 1–4 fields. Omitted fields retain saved values, or defaults on the first save.
An identical PATCH does not create a duplicate or update the timestamp. The
response always contains exactly the four public fields; IDs, relationships,
credentials and timestamps are excluded by response DTO serialization.

- `400 VALIDATION_FAILED`: empty object, JSON null, arrays, wrong types, field
  nulls, unknown keys, invalid enum values or invalid/overlong timezone. Express
  can reject JSON scalars before DTO validation; the exception filter normalizes
  400 responses specifically for this PATCH endpoint to the same validation code.
  After JWT authentication, a guard checks raw body keys before DTO transformation
  can discard `__proto__`, `constructor` or `prototype`. These keys also return
  validation errors without inserting or updating preferences.
- `401 UNAUTHORIZED`: missing, invalid, expired JWT, or a deleted/unverified
  account rejected by the existing JWT guard.
- `404 NOT_FOUND`: preferences service cannot find the authenticated account
  (including deletion between guard verification and service access).
- Existing throttling and sanitized unexpected-error conventions apply.

Frontend should save through PATCH, use the returned complete object, and reload
through GET after a new login. No preference data is added to profile/login
responses, and there are no new realtime events.

## Persistence and concurrent requests

`UsersModule` registers a separate preferences controller/service and
`Repository<UserPreferences>`; existing profile/auth services are unchanged.
`user_preferences.user_id` is both the UUID primary key and a one-to-one FK to
`users.id`. PostgreSQL CHECK constraints enforce the finite theme/date/week values;
timezone validity is checked at the HTTP boundary, with a `varchar(100)` column.
Timestamps use `timestamptz`.

PATCH opens a transaction and locks the existing User row with `FOR UPDATE`
before reading preferences. This also serializes the first two saves when no
preference row exists. It merges only supplied fields, saves with the transaction's
repository, and returns after commit. Requests for different users lock different
rows. Repeated identical saves use TypeORM's unchanged-entity behavior. GET is
read-only and can observe either committed state during an overlapping PATCH.

FK deletion uses `NO ACTION`, matching the current account/Google identity policy.
Future account deletion must explicitly handle saved preferences; it must not
silently cascade data away.

## Migration and rollout/rollback

New migration: `1792886400000-UserPreferences`. Up only creates the new empty
table and constraints; no existing data is changed and no backfill is needed.
Entity and migration discovery use the existing globs. `synchronize: false` and
`migrationsRun: false` remain unchanged.

Down runs inside TypeORM's migration transaction, acquires an `ACCESS EXCLUSIVE`
lock, and refuses to drop a populated table. The lock closes the check/drop race.
An empty table can be reverted and recreated. Keep transactional migration mode;
do not invoke down outside a transaction or disable its safety guard.

No production or shared database migration is part of this task. For a future
production rollout:

1. Review the migration and rollback guard, take a verified backup and rehearse
   restore on an isolated snapshot; confirm a separately approved deployment.
2. Apply the additive migration explicitly before deploying the new backend.
3. Smoke-test defaults and a saved PATCH with an authorized test account.
4. For application rollback, retain the new table so preferences survive. Only
   use schema down if empty. For populated tables prefer roll-forward or an
   explicitly reviewed export/restore plan; never delete rows to bypass the guard.

## Verification

Focused tests:

```sh
pnpm --filter @kanban/backend test --runTestsByPath test/users/user-preferences.dto.spec.ts test/users/user-preferences.e2e-spec.ts
pnpm --filter @kanban/backend test:preferences:database
```

The database script builds the backend, creates a randomly named disposable
PostgreSQL 16 container with a random password and ephemeral localhost port,
does not load `.env`, and removes the container in `finally`. Docker must be
running; the first run may pull the pinned PostgreSQL image. It checks fresh and
populated migrations, preservation of users/hashes/Google identities/boards,
empty rollback/rerun, populated rollback refusal, schema drift, defaults without
insertion, invalid input without insertion, first-save and existing-row concurrent
PATCH, uniqueness/FK/CHECK constraints, response serialization, JWT isolation,
profile regression, a new JWT and a new Nest application instance.

Existing foundation, email-verification and Google-auth database fixtures account
for the extra table/migration and rollback order. Their scripts continue to use
isolated databases/containers. Full workspace checks are `pnpm lint`, `pnpm test`,
`pnpm build`, `pnpm format:check`, and `git diff --check`.

### Executed results — 2026-10-25

| Command/check                                                    | Exit | Result                                                                                                         |
| ---------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| Targeted preference DTO and HTTP Jest suites                     | 0    | 45 tests passed                                                                                                |
| `pnpm lint`                                                      | 0    | Workspace lint passed                                                                                          |
| `pnpm test`                                                      | 0    | Backend: 49 suites/499 tests; frontend: 66 files/608 tests; shared: 6 tests                                    |
| `pnpm build`                                                     | 0    | All workspace packages built                                                                                   |
| `pnpm --filter @kanban/backend test:preferences:database`        | 0    | Disposable PostgreSQL migration/persistence/concurrency/HTTP/restart checks passed                             |
| `pnpm --filter @kanban/backend test:google-auth:database`        | 0    | 14 PostgreSQL/auth checks passed; Google verifier mocked                                                       |
| `pnpm --filter @kanban/backend test:email-verification:database` | 0    | 16 PostgreSQL/HTTP/Socket.IO checks passed; mail transport fake                                                |
| `pnpm --filter @kanban/backend test:database`                    | 0    | Ran against an additional disposable container; schema, pagination and rollback checks passed                  |
| `pnpm format:check`                                              | 1    | 185 unchanged files have existing formatting issues; left outside this task                                    |
| Prettier check over every changed/new file                       | 0    | All task files pass                                                                                            |
| `git diff --check`                                               | 0    | No whitespace errors                                                                                           |
| Skill's supplemental Bun TypeScript audit                        | 1    | Checker requires TypeScript 7 unstable APIs; repository uses TypeScript 5. No dependency/toolchain change made |

Environment: Windows, Node `22.12.0`, pnpm `10.18.3`, Docker `27.5.1`, disposable
`postgres:16.15-alpine3.24`. Node is below the repository's required `>=22.13.0`;
commands emitted an engine warning. Build also reports the existing frontend
bundle-size warning, and TypeORM/pg tests emit runtime/deprecation warnings.
Initial sandbox attempts hit Jest cache permissions and localhost connection
restrictions; reruns with approved local test access passed. HTTP tests first
exposed empty-array/null validation gaps, then passed after the scoped fixes.
Final review also exposed reserved-key filtering before DTO validation. Three
HTTP regressions first failed with 200, then passed after the PATCH-only raw-key
guard was added. PostgreSQL regressions confirm rejected requests neither insert
a new row nor alter saved preferences; a fourth HTTP test confirms JWT runs first.
During final verification one integration attempt failed on an empty Docker port
mapping, and another overlapped a build clearing `dist`. The subsequent sequential
build/integration run passed. These setup failures are recorded separately from
the successful checks; full workspace regression also passed after the fix.
No production/shared database, live Google OAuth or real email delivery was used.

## Scope and decisions

- Facts: contracts reviewed on `origin/main` at `cea6d1c`; dedicated branch
  `feat/user-preferences-api`; existing JWT guard rejects deleted users with 401.
- Accepted scope: four preferences, backend/database/tests/Swagger/integration
  documentation only; no new dependency or shared package contract is needed yet.
- Assumption: recognize IANA identifiers/aliases supported by the deployed Node
  ICU database; no independent timezone catalog is introduced.
- Open product decisions: none for this contract. Production migration/deployment
  approval is separate and has not been requested or performed.
- Excluded: frontend/theme provider/localStorage, locale, notification preferences,
  security/session/token changes, workspace schema, Card date conversion.

Before merge, refresh main and resolve conflicts with P1-06 explicitly. No commit,
push, PR, merge or deploy is included in this handoff.
