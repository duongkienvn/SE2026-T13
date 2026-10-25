---
name: kanvexa-feature
description: Implement a scoped Kanvexa feature, issue, or behavior fix involving API, database, shared contracts, or client integration. Use for end-to-end implementation; use kanvexa-ui for frontend-only visual work and kanvexa-review for review-only requests.
---

# Kanvexa Feature

Follow [AGENTS.md](../../../AGENTS.md). Paths in code spans below are relative to the repository root; run commands there.

## Establish the change

1. Inspect the working tree and related code/tests before editing. Extract the issue's actor, acceptance criteria, non-goals, and affected layers. If issue context is unavailable, use the supplied requirements and identify missing decisions; do not invent acceptance criteria.
2. For Post-MVP work, map the requested subset to requirement IDs and prerequisites in the [roadmap](../../../docs/roadmap/post-mvp.md) and relevant [blueprint](../../../docs/design/product-ux-blueprint.md) sections. A feature group is not a single issue or proof of implementation. Resolve scope/access/migration decisions before dependent code changes.
3. Trace existing controller → service → entity/repository → response/event → client/cache behavior. Consult the relevant [backend guide](../../../docs/architecture/backend-developer-guide.md), [database design](../../../docs/architecture/database-design.md), or [frontend architecture](../../../docs/architecture/frontend-architecture.md) and feature task records. Report stale documentation separately from verified source behavior.

## Implement the smallest complete slice

1. Identify API request/response compatibility, schema/backfill needs, shared exports/events, client updates, and regression risks before editing. For UI changes, also use [kanvexa-ui](../kanvexa-ui/SKILL.md).
2. Define server authorization for each operation and query, including resource-to-board ownership, non-members, archived/read-only access, and creator/last-owner rules. Keep Board roles separate from planned Workspace permissions; Workspace ADMIN never implies private Board access.
3. Place business logic under `apps/backend/src/api/`, entities within their owning feature, and migrations under `apps/backend/src/database/migrations/`. Reuse validation/serialization/error conventions and `BoardAuthorizationService`. Keep only genuinely shared contracts in `packages/shared/src/`.
4. For multi-row changes, use the existing transaction and Board row-lock pattern. Check constraints, exact ordering/position calculations, assignment-versus-removal, stale updates, and retry/idempotency behavior where relevant. Review migration defaults, legacy data, locks, backfill completeness, and recovery; do not assume a destructive down migration is safe.
5. Publish business events only after commit through the existing publisher/broadcast services, outside the board coordinator queue. Preserve membership eviction and authorized recipients. Keep payloads minimal; never emit raw entities or sensitive fields. Cover REST success with unavailable realtime delivery and reconnect recovery.
6. Integrate clients through existing REST/query hooks and session-scoped realtime lifecycle. Handle loading/error/permission loss, cache invalidation, and optimistic rollback; preserve existing routes and contracts unless explicitly changed by the task.
7. Add focused regression tests for changed behavior and meaningful edge cases. Migrations, database constraints/locking, and authorization/realtime races need real PostgreSQL integration coverage, not only repository mocks.

## Verify and hand off

- Use [kanvexa-verification](../kanvexa-verification/SKILL.md) to choose and run checks. Inspect the full diff for scope, unintended contract changes, and sensitive data.
- Add/update task documentation when durable decisions, contracts, migration notes, or verification evidence warrant it. Follow the [task index](../../../docs/tasks/README.md); do not rewrite historical records as current release status.
- Report behavior changed, requirement coverage, files/layers affected, exact verification outcomes, unresolved discrepancies, and remaining risks. Include migration/rollout considerations when relevant; follow AGENTS.md authorization boundaries for Git and deployment actions. No fixed number of commits is required.
