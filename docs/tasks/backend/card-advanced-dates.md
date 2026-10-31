# Advanced Card dates (P3-03 / CD-04)

Contract for [Issue #157](https://github.com/duongkienvn/SE2026-T13/issues/157).

## Date representation decision

Current `cards/validation.ts` presents `<input type="date">` but sends an explicit
UTC instant at the end of the browser-local selected day. The backend has never
persisted a civil date, all-day precision or its source zone. Such legacy instants
retain exactly their existing meaning; no migration or preference change
reinterprets them.

This backend version supports **timestamp instants only**, including nullable
`startDate`. It rejects bare `YYYY-MM-DD` and offset-free local date-times. It
adds no all-day representation or inferred UTC midnight. A future genuine
all-day contract would need explicit civil date/precision and IANA zone storage;
it must not infer all-day intent from existing midnight/end-of-day timestamps.
The existing date-picker adapter remains a timestamp-only legacy client; its
browser zone is not silently replaced by the user's saved timezone preference.

Examples:

```json
{
  "startDate": "2026-03-08T01:30:00-05:00",
  "dueDate": "2026-03-08T03:30:00-04:00"
}
```

Serializes as `startDate: "2026-03-08T06:30:00.000Z"` and
`dueDate: "2026-03-08T07:30:00.000Z"`: one elapsed hour across the New York DST
transition. `{ "startDate": null }` clears start only; omission preserves it.
`{"dueDate":"2026-03-08"}` and `{"dueDate":"2026-03-08T02:30:00"}` return 400.
No timestamp is constructed from a civil date or an IANA wall clock by this API.

## Persistence and compatibility

Migration `1793836800000-CardAdvancedDates.ts` adds only nullable
`cards.start_date timestamptz`, with no default or backfill. Existing due dates,
including PostgreSQL microsecond precision, keep their exact stored value.
Legacy timestamp reads retain the pre-existing JavaScript/JSON millisecond
serialization. Unrelated PATCHes do not rewrite a legacy deadline. No previously
applied migration was edited; synchronization and startup migrations stay off.

Database CHECKs enforce finite non-null start dates and `start_date <= due_date`
when both exist. Existing `due_date` definition and legacy data are not rewritten
or retroactively converted into another precision. API input validation rejects
non-finite instants for both fields. Partial B-tree indexes on
`(board_id,start_date)` and `(board_id,due_date)`, excluding null dates, support
future authorized Board range queries without adding P3-07 endpoints.

The additive column/index/constraint DDL locks Cards and builds two indexes;
schedule an explicitly authorized rollout appropriately for the data size.
Empty down/up is supported. Down requires a transaction, locks Cards and refuses
while any start date exists, avoiding silent data loss. Back up and prefer a
forward fix after users create start dates. Rolling back to older application
code does not remove date constraints: an older writer that ignores a non-null
start may encounter a constraint conflict when changing due date. No production
migration or application rollback was performed here.

## API and validation

Existing authenticated Card create, partial update, detail, active/archived list,
archive and restore routes remain unchanged. `startDate` is an optional nullable
request field and an additional allowlisted response field, always present as a
UTC ISO string or null. `dueDate` retains its existing name and null/omission
semantics. The response DTO implements shared `CardDateFields`; create/update
implement shared `CardDateInput`. No dynamic status or user preference is added
to Card JSON or realtime payloads.

| Input                                                                    | Behavior                                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Neither date                                                             | Both null on create; existing values retained on PATCH              |
| Start only / due only                                                    | Allowed, including past instants                                    |
| Both dates                                                               | Compare normalized instants; equality is allowed                    |
| Omitted field                                                            | Preserve persisted counterpart                                      |
| Explicit null                                                            | Clear only that field; clearing both atomically is allowed          |
| Equivalent timestamp with another offset                                 | Successful no-op, no write/history/event                            |
| Valid replacement of both dates                                          | Validate the complete replacement once, not each intermediate field |
| Start after due, including against an omitted persisted counterpart      | 400 `CARD_DATE_RANGE_INVALID`, no side effects                      |
| Invalid timestamp, empty PATCH, unknown precision/timezone/status fields | 400 `VALIDATION_FAILED`                                             |

The shared `parseCardDateInstant` / `isCardDateInstant` grammar is extended
calendar `YYYY-MM-DDTHH:mm[:ss[.fraction]]` followed by uppercase `Z` or
`+/-HH:mm`. UTC years are bounded to 0001-9999. Components are validated before
constructing a Date: valid month/day and Gregorian leap year, hours 00-23,
minutes/seconds 00-59, numeric offset hours 00-23 and minutes 00-59. Leap seconds,
24:00 overflow, impossible dates, numeric/Date/object inputs and non-finite
values fail. Offset presence makes an instant explicit; an offset alone does not
claim the wall clock belongs to a particular geographic IANA zone.

Fractions accept 1-9 digits and normalize to JavaScript milliseconds, truncating
additional fractional digits as the existing due-date writer did. The date-pair
invariant compares those normalized millisecond instants. Response timestamps
always use `.toISOString()`. Stored legacy due-date precision is preserved when
not explicitly replaced. The global DateField decorator remains unchanged;
stricter Card-specific validation reuses it and adds the shared validator.
Swagger includes offset/UTC examples and omission/null/range semantics.

## Authorization, transactions and events

The existing JWT guard and Board authorization remain authoritative:

- Board OWNER/MEMBER, including a Board-only Guest, can mutate active Cards on
  an active Board. Foreign/missing/inaccessible resources remain indistinguishable
  404s; Workspace ADMIN never inherits PRIVATE Board access.
- Valid Workspace-visible readers can read dates, including archived Cards, but
  cannot mutate (the existing nonmember 404 convention).
- Authorized archived Card/Board reads remain available. Mutations fail with
  409 `CARD_ARCHIVED` / `BOARD_ARCHIVED`. Archive/restore retains both date values,
  labels, checklists, assignments and comments.

Every mutation retains the existing Board `FOR UPDATE` boundary. PATCH reads the
Card and validates proposed dates against the current persisted counterpart
inside that transaction, before changing any fields. Disjoint patches preserve
untouched state; competing individually valid patches cannot commit an invalid
combined range. Database checks independently protect maintenance/concurrent SQL.

Effective changes record the existing CARD_UPDATED Activity in the transaction
and publish existing `card:updated` after commit through `BoardEventPublisher`.
Create retains CARD_CREATED / `card:created`. There is no event for a normalized
no-op, invalid range, denied request or rolled-back write. A failed Activity write
also rolls back the Card date change. Payloads remain only Board/Card/Column IDs;
no date, timezone or preference contents are exposed. Delivery false/throw cannot
turn a committed REST success into failure. Socket grant eviction, session/token
checks, reconnect authentication and REST resync continue unchanged.

## Deterministic projection and frontend/filter handoff

Shared helpers are exported in both ESM and CommonJS:

```ts
const referenceNow = '2026-03-08T06:30:00.000Z';
const status = deriveCardDueStatus(
  card.dueDate,
  referenceNow,
  preferences.timeZone,
);
const civilDisplay = card.dueDate
  ? cardDateInZone(card.dueDate, preferences.timeZone)
  : null;
```

`now` is required and must be an explicit valid instant. There is no internal
`Date.now()`. The status helper defaults its named zone to UTC; the display
helper requires one explicitly. Named IANA zones and aliases are validated using
`Intl.DateTimeFormat`, matching the existing Preferences named-zone policy;
numeric fixed-offset zone strings are rejected. Preferences affect projection,
never stored instants. Era/extended-year projection is preserved at the supported
UTC-year boundaries, without turning the displayed civil day into writable input.

| Status        | Exact rule, in order                                              |
| ------------- | ----------------------------------------------------------------- |
| `NO_DUE_DATE` | Due date is null; reference clock/zone still validated            |
| `OVERDUE`     | Due instant is strictly before reference now                      |
| `DUE_TODAY`   | Not overdue, and due/now share a calendar date in the chosen zone |
| `UPCOMING`    | All other future due dates                                        |

Due exactly at now is DUE_TODAY; one millisecond later it is OVERDUE. Overdue has
priority even on the same civil day. No DUE_SOON threshold is introduced.
Calendar-day comparison uses Intl's IANA rules, never `+24h` or manual hour offsets;
spring/fall days may be 23/25 elapsed hours. Start date, archive state, column name,
label and checklist completion never determine completion or change due status.

P3-10 should keep timestamp and genuine civil/all-day input distinct, explicitly
resolve any future wall-clock UI with its chosen IANA zone and DST policy, and
send the supported instant contract. It must preserve unsaved drafts across
remote invalidation and reconcile failed optimistic writes. Existing browser-local
end-of-day clients remain compatible and are not reinterpreted by this backend.

P3-07 should capture one reference clock and validated user zone per operation,
then apply these same mutually exclusive rules after Board authorization. For
example, overdue is `due_date < :now::timestamptz`; today additionally requires
`due_date >= :now` and equality of `(due_date AT TIME ZONE :zone)::date` with
`(:now::timestamptz AT TIME ZONE :zone)::date`. Upcoming is non-overdue and a
different local day. Null due dates form their own group. Do not add 24 hours to
find a DST day boundary, infer completion, or interpolate unvalidated SQL.

P3-13 can project status from cached authoritative timestamps with an explicit
client clock and preference zone. Status is not included in cached Card REST
responses: consumers must recompute as time passes, refresh on reconnect and
invalidate on existing Card events. No automatic event is promised at a clock
boundary. No reminder scheduling, notifications, calendar views or new completion
model is implemented.

## Verification

Executed locally on 2026-10-31 with Node 22.17.0, pnpm 10.18.3 and a dedicated
PostgreSQL 16.15 container on loopback port 55457. Only random disposable databases
were migrated. Test mail was fake and avatar storage disabled. The new suite
requires `CARD_DATES_DATABASE_TESTS=local-only`, rejects non-loopback/production
settings, and never loads `.env` credentials. It creates/drops its own database.
`test:card-dates:database` is the package script wrapping a backend build and this
same runner. Existing legacy regression runners received the same explicitly
designated local connection and their required local-only opt-ins. All temporary
databases were dropped; the dedicated container and its volume were removed
after verification.

| Check from repository root                                                  | Result                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm --filter @kanban/shared build`                                        | PASS                                                                                                                           |
| `pnpm --filter @kanban/backend build`                                       | PASS                                                                                                                           |
| `pnpm exec eslint apps/backend packages/shared`                             | PASS                                                                                                                           |
| `pnpm --filter @kanban/shared test`                                         | PASS: 13 tests; calendar/offset/strict rejection, explicit clock, timezone/DST, year-boundary projection and ESM/CJS contracts |
| Focused date DTO/service/HTTP command below                                 | PASS: 40 tests                                                                                                                 |
| Targeted backend regression command below                                   | PASS: 43 suites / 409 tests                                                                                                    |
| `pnpm --filter @kanban/frontend test src/features/cards/validation.test.ts` | PASS: 5 legacy date-picker compatibility tests                                                                                 |
| `node apps/backend/test/cards/dates/dates.integration.mjs`                  | PASS: 11 PostgreSQL/HTTP/Socket.IO groups                                                                                      |
| `node apps/backend/test/database/database-foundation.integration.mjs`       | PASS: fresh/historical migrations, source/compiled discovery, constraints, down/up and final zero ORM drift                    |
| `node apps/backend/test/cards/cards.integration.mjs`                        | PASS: 13 Card/ordering/archive/assignment/concurrency groups                                                                   |
| `node apps/backend/test/card-checklists/checklists.integration.mjs`         | PASS: 16 groups                                                                                                                |
| `node apps/backend/test/labels/labels.integration.mjs`                      | PASS: 15 groups                                                                                                                |
| `node apps/backend/test/workspaces/workspace-api.integration.mjs`           | PASS: lifecycle, ACL, rollback and concurrency                                                                                 |
| `node apps/backend/test/activities/activities.integration.mjs`              | PASS: 15 mutation actions, persistence, rollback, Board isolation, events and feed                                             |
| `pnpm --filter @kanban/backend test:realtime:database`                      | PASS: 16 scenarios                                                                                                             |
| `pnpm --filter @kanban/backend test:board-events:database`                  | PASS: 10 groups                                                                                                                |
| Changed-file Prettier, Markdown links/UTF-8 and `git diff --check`          | PASS                                                                                                                           |

```sh
pnpm --filter @kanban/backend test --runTestsByPath test/cards/cards-dates.dto.spec.ts test/cards/cards-dates.service.spec.ts test/cards/cards.e2e-spec.ts
pnpm --filter @kanban/backend test '--testPathPattern=(cards|realtime|columns|board-members|boards|activities|labels|card-checklists|user-preferences)'
```

The new database suite seeds archived and active legacy Cards, raw fractional
and offset deadlines, comments/assignments/checklists before the migration and
compares persisted snapshots/epoch values afterward. It checks native date
constraints/indices and safe down refusal, authorized read/write/archive/restore,
preferences that change display only, real Board lock waiters in both race orders,
Activity failure rollback/retry, COMMIT-gated state/history/events, silent no-ops,
transport failure, reconnect resync and access/token revocation.

Historical migration rehearsals were updated for the additive nullable column:
older snapshot comparisons omit only `start_date`, while this dedicated migration
suite explicitly asserts it starts null and preserves every legacy deadline.
They retain their historical boundary checks and final complete-schema zero-drift
assertion. Test-fixture expectations corrected during development now pass;
there is no remaining selected-check failure. Expected injected delivery failures
log sanitized errors; existing TypeORM schema inspection emits a pg deprecation
warning. No dependency, unrelated application refactor or formatting cleanup was
introduced.

Full frontend/monorepo suites, repository-wide formatting and infrastructure/
deployment checks were not run, following the requested targeted backend scope.
No CI or production verification is claimed. Frontend date-picker upgrades,
genuine all-day precision, reminders and filtering endpoints remain outside this
backend delivery. Rollout needs an explicitly scheduled Card-table migration;
populated start dates require backup/roll-forward rather than a destructive down.
