# AGENTS.md

Instructions for AI coding agents working on this repository.

## Read First

Before making changes, read:

- `README.md`
- `docs/project-overview.md`
- relevant files under `docs/architecture/`

These documents are the source of truth for product scope and architecture.

If documentation and implementation conflict, report the discrepancy instead of silently redesigning the system.

## Repository Structure

```text
apps/
├── frontend/
└── backend/

packages/
└── shared/

docs/
├── architecture/
└── tasks/
```

- `apps/frontend`: React frontend.
- `apps/backend`: NestJS backend.
- `packages/shared`: types, contracts, enums, and event names shared between frontend and backend.
- Do not put backend-only code such as TypeORM entities or services in `packages/shared`.

## Core Architecture Rules

- Backend/PostgreSQL is the source of truth for persistent data.
- Use REST for commands, queries, and initial data loading.
- Use Socket.IO for realtime updates and presence.
- Persist business changes successfully before broadcasting realtime events.
- Do not put core business logic inside Socket.IO gateways.
- Use TypeORM migrations.
- Keep `synchronize: false`.
- Use TypeORM Data Mapper style with `Repository<Entity>`.
- Board permissions are based on `BoardMember`.
- MVP roles are `OWNER` and `MEMBER`.

Do not introduce major architecture changes unless explicitly requested, including:

- Redis
- Kafka
- microservices
- CQRS
- CRDT
- Redux or another global state library

## Domain Terminology

Use these terms consistently:

- User
- Board
- BoardMember
- Column
- Card
- CardAssignee
- Comment
- Activity

Do not rename domain concepts without discussion.

## Development Workflow

Normal workflow:

```text
Issue
→ branch from main
→ implement
→ commit
→ push
→ Pull Request
→ CI
→ review
→ merge
```

Do not push directly to `main`.

Do not commit, push, merge, or modify remote branches unless explicitly requested.

## Verification

Run the relevant checks before finishing:

```bash
pnpm lint
pnpm test
pnpm build
pnpm format:check
```

For documentation-only changes, `pnpm format:check` is usually sufficient.

Never claim a command passed unless it was actually executed.

## Change Discipline

- Inspect existing code before editing.
- Keep changes scoped to the requested task.
- Avoid unrelated refactors.
- Do not add dependencies unless necessary.
- Prefer the simplest solution that matches the existing architecture.
- Update relevant documentation when architectural or domain rules change.