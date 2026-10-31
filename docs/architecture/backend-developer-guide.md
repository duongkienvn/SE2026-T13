# Backend Developer Guide

Business code belongs in `apps/backend/src/api/<feature>/`. Each feature owns its request and response DTOs, controller, service, module, entities, and any repository/query code it needs. Authentication is a separate feature and uses the `User` entity owned by `users`. Database options and migrations remain in `src/database/`; the schema contract remains [database-design.md](database-design.md).

## Request DTOs and validation

Use the field decorators in `src/decorators/field.decorators.ts` for common validation, transformation and Swagger metadata. Optional means the field may be absent. It does **not** permit `null` unless `nullable: true` is set. Date fields keep an ISO timestamp with timezone as a string. Numeric and boolean transforms reject ambiguous strings.

```ts
class CreateExampleRequestDto {
  @StringField({ trim: true, minLength: 1, maxLength: 120 })
  title!: string;

  @UUIDField()
  boardId!: string;

  @BooleanFieldOptional()
  archived?: boolean;
}
```

The global validation pipe transforms DTOs, rejects unknown fields, and returns `VALIDATION_FAILED` with field paths. `ClassField(() => ChildDto, { each: true })` validates nested arrays. `Trim`, `ToLowerCase`, `ToUpperCase`, `StrictBoolean`, `SafeNumberQuery`, and `IsNullable` are available for fields outside the standard decorators. Add feature-specific cross-field rules only when a real contract requires them.

## Responses and errors

Return a response DTO or data from a controller. The global interceptor returns `{ success: true, statusCode, message, data }` and preserves the HTTP status. `paginateQueryBuilder()` and `paginateCursor()` return marked results that add `meta`. `@SkipResponseWrap()` opts out for special responses. `204`, redirects, streams, Swagger, `/`, and health endpoints are handled without wrapping. Use `@ResponseMessage('...')` to customize a success message and `apiSuccess()` only when explicitly constructing an already wrapped response.

Never return raw TypeORM entities as public API contracts. Define a response DTO with `@Expose()` on allowed fields and `@Type()` on nested DTOs, then use `@SerializeResponse(ExampleResponseDto)` on the controller method or `toResponseDto(ExampleResponseDto, value)` in an explicit mapper. This drops internal fields such as `passwordHash` even inside nested objects. Request DTOs and response DTOs serve different purposes.

```ts
class ExampleResponseDto {
  @Expose()
  @ApiProperty()
  id!: string;

  @Expose()
  @ApiProperty()
  title!: string;
}

@Get(':id')
@SerializeResponse(ExampleResponseDto)
@ApiSuccess({ type: ExampleResponseDto, summary: 'Get example' })
@ApiCommonErrors([400, 404, 500])
getOne(@Param('id', ParseUUIDPipe) id: string) {
  return this.exampleService.findOne(id);
}
```

The example is documentation only; it does not create a business endpoint. Swagger helpers document the real JSON envelope. `ApiPaginated(ItemDto)` documents offset pages, `ApiPaginated(ItemDto, { cursor: true })` documents cursor pages, and `ApiBearerToken()` adds OpenAPI security metadata. It does not enforce authentication. Auth must add a real guard in its own issue.

Throw `new ApplicationException(HttpStatus.NOT_FOUND, 'EXAMPLE_NOT_FOUND', 'Example not found')` for expected public errors. Codes use uppercase snake case; optional details are string arrays. Unexpected errors and unmapped SQL failures are sanitized by the global filter. SQLSTATE `23505` and `23503` map to conflict responses.

## Persistence and pagination

Import entities through `TypeOrmModule.forFeature([Entity])`, inject `Repository<Entity>` with `@InjectRepository(Entity)`, and keep business rules in the feature service. Persist successfully before publishing a realtime event. Do not use `BaseEntity` or synchronize schema changes; create and review a migration.

```ts
const page = await paginateQueryBuilder(
  this.repository
    .createQueryBuilder('item')
    .where('item.boardId = :boardId', { boardId }),
  query,
  'createdAt',
  'DESC',
);
```

`PageQueryDto` defaults to page 1, limit 20, and caps limit at 100. The helper validates the offset, adds primary-key ordering, executes `skip/take`, and returns a count. For Activity or Comment feeds, use `CursorQueryDto` and `paginateCursor(builder, query, 'createdAt')`. The cursor helper requires an unjoined PostgreSQL query with a `timestamptz` field and UUID primary key; it uses timestamp plus UUID order and a bounded opaque cursor. Order fields are selected by server code and verified against TypeORM metadata, never accepted as client SQL text. Map the returned entities to response DTOs at the HTTP boundary.

## Tests and local checks

From the repository root, run `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm format:check`. Backend commands include `pnpm --filter @kanban/backend test:unit`, `test:e2e`, `test:cov`, and `test:database`. The database script creates a random temporary database, runs the initial migration, tests entity metadata and pagination, reverts and reruns the migration, then drops the temporary database. It never reverts the development database. Unit tests use `*.spec.ts`; HTTP E2E tests use `*.e2e-spec.ts` and are both discovered by the default Jest command.

TypeORM CLI commands use the same `databaseOptions()` as Nest runtime. Run `migration:show` against a configured database to inspect state; only run `migration:run` or `migration:revert` on a database explicitly intended for that operation. `/health` is process liveness and `/health/ready` probes database connectivity. Rate limiting is per process and defaults to 120 requests per minute per IP; a future Auth feature may use `@Throttle` for stricter limits. Compression belongs at the reverse proxy, and URI versioning will be introduced with an explicit API contract.

## Board membership authorization

`BoardAuthorizationService` is the reusable board-level authorization seam.
`requireRead()` allows explicit Board members or authenticated Workspace members
on WORKSPACE_VISIBLE Boards; Workspace ADMIN never overrides PRIVATE. Explicit
membership is returned as OWNER/MEMBER, and Workspace-only read access as null.
`requireMember()` remains the stricter gate for writes and administrative member
reads, while owner wrappers preserve OWNER and archive rules. Mutations pass
their transaction manager and acquire the Board row lock before checking the
persisted grant. Missing/inaccessible reads and absent explicit write grants
return the same safe 404. Do not trust JWT/client roles or capabilities. See the
[visibility/access contract](../tasks/backend/board-visibility-access-control.md)
for DTOs, SQL filtering, revocation ordering and the single-process deployment
assumption.

`BoardMembersService` performs membership mutations in TypeORM transactions. Removing a member deletes every matching `card_assignees` row through the board's cards before deleting the membership row; archived cards are included. The board creator cannot be demoted or removed, and role changes cannot leave a board without an `OWNER`. The member response DTO nests only the public `UserResponseDto` fields.

Column Management uses `BoardAuthorizationService.requireMember()` with
`{ mutable: true }` for create, rename, reorder and delete. This keeps the MVP
policy that both `OWNER` and `MEMBER` can collaborate on board structure while
still rejecting archived-board mutations with `409 BOARD_ARCHIVED`. Read-only
Column listing uses `requireRead()` without granting writes.

Column create, reorder and delete operations run inside a transaction after
locking the Board row. The lock serializes concurrent structural changes for a
single Board; Column positions are calculated as exact `numeric(20,10)` values
and are returned as strings. Rebalance updates the full ordered set only when
no representable fractional gap remains.

## Card Management (E2)

`CardsModule` exposes eight board-scoped endpoints for Card queries, creation,
partial updates, archive, move and multi-assignee management. Reuse the existing
DTO/serialization/pagination/error conventions. All mutations acquire the Board
row lock via `requireMember(..., { mutable: true }, manager)` before reading
related state, matching E1 and membership removal. This closes assign-vs-remove
races without changing BoardMembersService or F1. Card positions reuse E1's exact
BigInt arithmetic and rebalance active destination Cards atomically. Archived
Cards retain their references and continue blocking Column deletion. See
[E2 requests, responses and PostgreSQL concurrency tests](../tasks/backend/card-management-api.md).

## Realtime foundation (F1)

The Nest-managed Socket.IO gateway uses `/socket.io`, separate from the REST
prefix, with JWT handshake auth and the same origin allow-list as HTTP. Import
`RealtimeModule` and inject `RealtimeBroadcastService` for future post-commit
business broadcasts. All board emissions must go through that service so they
share ordering with authorized joins and membership revocation. Member removal
holds a per-board queue through transaction commit and eviction of all affected
sockets. Do not call broadcast inside a queued operation or a still-open
transaction. Expired sockets are disconnected and must authenticate and join
again. See [F1 contracts, security invariants and testing](../tasks/backend/realtime-foundation.md).

## Card checklists (CD-01)

`CardsModule` also exposes `CardChecklistsService` and authenticated nested
checklist/item REST routes. Commands share the Board row lock with Card and
membership mutations, and publish `card:updated` only after commit. Exact ordered
positions, bounded detail payloads, derived progress and scoped aggregate access
are documented in [the checklist contract](../tasks/backend/card-checklists.md).

## Board-scoped labels (CD-02)

`LabelsModule` owns the Board catalog, Card association routes and exported
`LabelsService.forCards` batch reader. Mutations share the existing Board row
lock; composite FKs enforce same-Board links. Catalog invalidation uses one
post-commit `labels:changed` event; assignments reuse `card:updated`. See the
[label contracts, lifecycle rules and verification](../tasks/backend/board-card-labels.md).
