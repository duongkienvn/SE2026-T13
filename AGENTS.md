# Kanvexa Agent Instructions

Kanvexa is a realtime collaborative Kanban application in Post-MVP development.
This file is the primary repository-wide guidance for coding agents.

## Context and scope

- Inspect the working directory, branch, `git status --short`, and relevant code before editing. Preserve existing uncommitted work.
- Use [README.md](README.md) and [project overview](docs/project-overview.md) for orientation when needed; read additional documents by task scope below, not the entire documentation tree.
- [Post-MVP roadmap](docs/roadmap/post-mvp.md) defines approved scope and dependencies; the [Product & UX Blueprint](docs/design/product-ux-blueprint.md) defines product, access, and interaction decisions. Implement only the requested subset and acceptance criteria. Workstream names and mockups do not expand scope.
- Distinguish approved/planned work, code implemented in this checkout, and verified deployment. Historical architecture sections still describe skeletons or earlier milestones; the overview also lags implemented card restore, user preferences, and password security flows. Inspect source/tests and relevant task records, report discrepancies, and do not silently redesign or expand the assignment.
- Do not hardcode current issue/PR status, commit SHAs, or the active phase into reusable instructions.

| Task                 | Read as needed                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend/API/database | [Backend developer guide](docs/architecture/backend-developer-guide.md), [backend architecture](docs/architecture/backend-architecture.md), [database design](docs/architecture/database-design.md), affected services/entities/migrations/tests                                                                                                         |
| Frontend/UI          | [Frontend architecture](docs/architecture/frontend-architecture.md), [base design guidelines](docs/design/design-guidelines.md), [Post-MVP addendum](docs/design/design-guidelines.post-mvp.md), relevant blueprint sections and screen specs/images selected through the [visual reference register](docs/design/post-mvp/visual-reference-register.md) |
| Post-MVP feature     | Relevant roadmap requirement IDs/dependencies, blueprint sections, issue/acceptance criteria, and existing implementation/task records                                                                                                                                                                                                                   |
| Deployment/CI        | [Production runbook](docs/deployment/production.md), [CI/CD guide](docs/deployment/cicd.md), relevant workflows/scripts; [verification record](docs/deployment/verification.md) is historical evidence, not a current pass                                                                                                                               |
| Documentation only   | Affected documents and their referenced sources; inspect code/scripts when checking implementation claims                                                                                                                                                                                                                                                |

## Architecture and placement

Keep the pnpm workspace and NestJS modular monolith:

- `apps/frontend`: React + TypeScript + Vite; TanStack Query for server state, React state for local UI, feature code under `src/features/`, routing/providers/layout under `src/app/`, shared UI under `src/components/`, tokens in `src/style.css`.
- `apps/backend`: NestJS + TypeORM + PostgreSQL; business modules, DTOs, services, and entities under `src/api/<feature>/`; database configuration/migrations under `src/database/`; Socket.IO under `src/realtime/` as a cross-cutting layer.
- `packages/shared`: cross-application contracts, types, enums, and event names. Keep backend entities/services and backend-only logic out of this package. Check existing exports before duplicating a contract.
- Preserve existing auth/profile/account linking, password recovery and session invalidation, preferences, board/card archive and restore, comments/activity, and realtime behavior when extending them. An API preference does not imply its full settings/theme UI exists.
- Use domain names `User`, `Board`, `BoardMember`, `Column`, `Card`, `CardAssignee`, `Comment`, and `Activity`. `Workspace` is an approved additional concept, not a replacement name for `Board`.
- Follow [task placement rules](docs/tasks/README.md): records go in `docs/tasks/backend/` or `docs/tasks/frontend/` by primary responsibility. Keep records out of the tasks root; update the index and affected links when adding/moving them. Store implementation screenshots separately from approved design references in `docs/design/`.

## Engineering invariants

- Backend/PostgreSQL is authoritative for persistent business data. Use REST for commands, queries, and initial loading; Socket.IO for realtime updates and transient presence. Keep core business logic in services, outside gateways.
- Commit business changes before broadcasting. Reuse the existing `BoardEventPublisher`/`RealtimeBroadcastService` and board coordination boundary; do not emit inside an open transaction or nest a broadcast in its board queue. Delivery failure must not turn a committed REST mutation into a failed mutation.
- Enforce authorization on the server for every resource and action. Reuse `BoardAuthorizationService`; validate board membership and resource-to-board relationships. Preserve archived/read-only rules and creator/last-owner protections.
- Board permissions use `BoardMember` with `OWNER`/`MEMBER`. Roadmap Workspace `ADMIN`/`MEMBER` roles are distinct and do not imply implemented Workspace permissions or automatic access to private Boards. Introduce them only through scoped requirements and the approved access model.
- Authenticate sockets, validate membership before joining `board:{boardId}`, and preserve room isolation, ordered joins/broadcasts/revocation, and receive-grant eviction on access loss. Preserve token expiry/invalidation and reconnect checks.
- Use TypeORM Data Mapper with `Repository<Entity>`, explicit migrations, `synchronize: false`, and `migrationsRun: false`. Do not run migrations implicitly on app startup.
- Preserve transactions, Board row locking, exact position arithmetic, foreign keys, and uniqueness constraints for related mutations. Check concurrent edits, reorder/restore, member removal, and assignment races; an in-process queue does not replace database integrity.
- Reuse request validation, response DTO allowlists, API envelopes/errors, and shared realtime contracts. Never expose password hashes, tokens, SQL, stack traces, or other private data through API responses, events, or logs.
- Keep frontend caches and socket subscriptions scoped to the authenticated session and authorized Board. Handle optimistic rollback, stale responses, reconnect resync, logout, and access loss without retaining protected data.
- Preserve compatibility and existing data. Keep changes focused; no unrelated refactors. Do not add dependencies without a demonstrated need; major architecture changes require an explicit request, including Redis, Kafka, microservices, CQRS, CRDT, or a new global state library such as Redux.
- Update relevant documentation when architectural or domain rules change, within the authorized task scope.
- For UI, reuse Kanvexa branding/components/tokens and approved text overrides. Mockups never authorize fake controls, demo business data, pricing/subscriptions, or additional permissions/features.

## Workflow and safety

Normal flow: Issue → branch from `main` → implementation → verification → commit/push → PR → CI/review → merge. Use focused branches and meaningful Conventional Commits when those actions are requested.

- Follow the approved working-directory and safety principles in [development workflow](docs/WORKFLOW.md). Work in the user's current checkout by default; use another worktree only when requested or confirmed. Resolve missing decisions affecting scope, permissions, or acceptance criteria before dependent implementation.
- Do not push directly to `main`. Do not commit, push, create a PR, merge, deploy, or modify remotes/remote branches without an explicit request. Do not create artificial commits or split work to meet a commit count.
- Do not reset, clean, discard, or overwrite another person's changes. Do not expose environment secrets. Run migrations only against a database explicitly designated for the operation; never use production as a test target.
- Report the result, changed files, exact checks/results, discrepancies, and remaining risks. Never claim a check passed without actually executing it successfully.

## Verification and skills

For application changes, run the relevant checks from the repository root: `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm format:check`. Database, realtime, and infrastructure changes need the corresponding integration/contract checks; the default test command does not run PostgreSQL integration scripts. Documentation-only work normally needs formatting, link/path checks, and `git diff --check`, not the full application suite. Distinguish pass, fail, skipped, and not run, including environment blockers and pre-existing failures.

Repository workflows live in `.agents/skills/`. Read only the skill(s) matching the task; they supplement these rules and do not authorize Git or deployment actions:

- [kanvexa-feature](.agents/skills/kanvexa-feature/SKILL.md): scoped feature/issue implementation across API, database, shared contracts, and clients.
- [kanvexa-ui](.agents/skills/kanvexa-ui/SKILL.md): frontend implementation and visual/interaction refinement; combine with feature guidance for cross-application work.
- [kanvexa-review](.agents/skills/kanvexa-review/SKILL.md): evidence-based branch/diff/PR review; review alone does not authorize code edits.
- [kanvexa-verification](.agents/skills/kanvexa-verification/SKILL.md): select and run checks appropriate to a change, independently or during implementation.
