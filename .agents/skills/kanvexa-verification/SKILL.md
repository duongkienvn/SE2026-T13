---
name: kanvexa-verification
description: Select and run proportionate Kanvexa quality checks for a working-tree change, branch, or pre-PR/pre-merge readiness review. Use to verify formatting, lint, builds, unit tests, PostgreSQL behavior, or deployment contracts; documentation-only changes do not require the full application suite.
---

# Kanvexa Verification

Follow [AGENTS.md](../../../AGENTS.md). All code-span paths and commands below are relative to the repository root. Verification does not authorize commits, remote actions, deployment, or migrations on an undesignated database.

## Choose checks from the actual diff

1. Inspect branch/status, the complete diff, changed contracts, and callers. Separate pre-existing changes/failures from this task. Inspect root/workspace `package.json` and relevant CI definitions before choosing commands; scripts can evolve.
2. Check the required Node/pnpm versions in `package.json` and service prerequisites. Use installed tooling; do not add dependencies just to validate. Report blockers without silently changing environment/configuration outside scope.
3. Select the applicable rows below. Start with focused tests for fast feedback, then run relevant repository gates for application changes. Do not describe local success as proof of CI, deployment, or production behavior.

| Change                          | Checks                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation/instructions only | Review claims, internal links/repository paths, instruction consistency, and any SKILL.md frontmatter; `git diff --check`; `pnpm format:check`. Use the environment's official skill validator if available; do not install it. No application suite unless executable behavior changed.                               |
| Application code                | `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm format:check`; focused tests below as needed.                                                                                                                                                                                                                            |
| Frontend                        | Vitest/Testing Library tests via `pnpm --filter @kanban/frontend test`; build via `pnpm --filter @kanban/frontend build` (TypeScript + Vite). Add real browser interaction/visual QA for UI changes using [kanvexa-ui](../kanvexa-ui/SKILL.md).                                                                        |
| Backend                         | `pnpm --filter @kanban/backend test:unit`, HTTP E2E via `pnpm --filter @kanban/backend test:e2e`, build via `pnpm --filter @kanban/backend build`. Choose PostgreSQL suites for persistence/access/concurrency behavior.                                                                                               |
| Shared contracts                | `pnpm --filter @kanban/shared build`, `pnpm --filter @kanban/shared test`, then affected consumers' tests/builds; shared output serves both ESM and CommonJS.                                                                                                                                                          |
| Deployment/CI/infra             | `pnpm test:infra`; inspect changed workflows, Compose, Dockerfiles, Caddy routes, and relevant scripts against the [production runbook](../../../docs/deployment/production.md) and [CI/CD guide](../../../docs/deployment/cicd.md). Image/lifecycle checks below depend on the change and available Docker resources. |

There is no root `typecheck` script. `pnpm build` builds the workspace; frontend build runs `tsc -b` and backend build uses Nest/TypeScript. Build shared first with `pnpm --filter @kanban/shared build` before standalone consumer tests/builds. Root `pnpm test` already does this; it runs backend Jest (unit + HTTP E2E), frontend Vitest, and shared Node tests. It does **not** run the separate PostgreSQL integration scripts or infrastructure tests.

## PostgreSQL and migration verification

- Real PostgreSQL checks are required for schema/migration changes, database-dependent constraints/queries, locking/ordering races, and database-backed authorization/realtime behavior. Unit/HTTP tests with mocks cannot prove these properties.
- Inspect the selected integration script's setup and cleanup before running. Existing scripts use root environment connection settings to create/drop random temporary databases; confirm the configured server is explicitly intended for testing and permits temporary database creation. Do not expose credentials, run against production, or substitute the development database for a temporary test database.
- Build shared first. Choose existing commands from `apps/backend/package.json` according to the affected domain:
  - `pnpm --filter @kanban/backend test:database` for schema foundation, migration up/down/up, metadata, and constraints.
  - `pnpm --filter @kanban/backend test:cards:database` for Card/restore/ordering; `test:columns:database`, `test:boards:database`, `test:board-members:database`, `test:comments:database`, and `test:activities:database` under the same `pnpm --filter @kanban/backend` prefix for those domains.
  - `pnpm --filter @kanban/backend test:preferences:database`, `test:email-verification:database`, `test:google-auth:database`, or `test:password-security:database` under that prefix for preferences/identity/security changes.
  - `pnpm --filter @kanban/backend test:realtime` for mocked realtime E2E; `pnpm --filter @kanban/backend test:realtime:database` and `pnpm --filter @kanban/backend test:board-events:database` for actual PostgreSQL/socket integration and access/event ordering.
- Inspect existing tests and extend coverage for the changed behavior: absent/non-member/owner cases, cross-board/cross-user isolation, archived/read-only, rollback, concurrent mutation/removal/restore, post-commit event delivery and revocation, and legacy data as applicable.
- For a migration, review additive/backfill/constrain sequencing, defaults/nullability, indexes/constraints, lock duration, old/new code compatibility, preserved IDs/associations/archive state, and recovery. Exercise clean migration and realistic legacy-data/backfill paths in disposable databases; up/down/up alone does not prove upgrade safety. Document irreversible rollback/data loss and a backup/roll-forward plan.
- Do not run `migration:run` or `migration:revert` against a database that was not explicitly designated for that operation. Preserve `synchronize: false` and `migrationsRun: false`; never make test success depend on automatic schema synchronization.

## Infrastructure checks when applicable

- CI runs lint/test/build/infra/format; inspect [.github/workflows/ci.yml](../../../.github/workflows/ci.yml) and [cd.yml](../../../.github/workflows/cd.yml) for their actual triggers/gates. Preserve PR quality checks, separated publishing/deployment permissions, protected production approval, serialized explicit migrations, and secret/public-build-config boundaries.
- For image/runtime changes, use `pnpm verify:images` with the locally built image tags/configuration required by the scripts/runbook. For local deployment lifecycle changes, use `pnpm test:infra:smoke` only after inspecting its isolated Compose setup, prerequisites, and cleanup.
- These commands need Docker/images and exercise more than static checks; report them as not run when unavailable or irrelevant. A historical [verification record](../../../docs/deployment/verification.md) is not evidence for the current diff. Do not run production smoke, trigger CD, or deploy as an implied part of local verification.

## Final audit and results

- Review the entire diff, including untracked files, then run `git diff --check` and inspect final `git status --short`. Confirm only intended files changed and no generated artifacts/secrets were added. For documentation-only work, explicitly confirm application code/configuration is untouched.
- Run `pnpm format:check`. If it fails, separate formatting caused by this change from pre-existing failures. Format only intended files with the existing Prettier tool; do not run a repository-wide write to clean unrelated files. Recheck changed files, and report any remaining full-repository failures.
- Report exact commands and outcomes as **pass**, **fail**, **skipped** (with reason), or **not run** (with reason). List remaining risks, prerequisites, browser/database/CI coverage gaps, and whether acceptance criteria are demonstrated. Never fabricate a result or treat missing services as a pass.
