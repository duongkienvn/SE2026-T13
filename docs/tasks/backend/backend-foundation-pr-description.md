# chore: implement backend application foundation

## Summary

- Audit the full NestJS boilerplate source, tests, configuration, tooling, CI and deployment setup against Kanban in [the gap matrix](../../architecture/backend-foundation-gap-analysis.md).
- Add shared success/error response contracts, HTTP response wrapping with explicit opt-out, safe response DTO serialization, reusable field/transform/Swagger decorators, and typed application exceptions.
- Add bounded TypeORM offset/cursor pagination, PostgreSQL readiness, configurable in-memory HTTP rate limiting, and consistent runtime/CLI connection options.
- Document feature module conventions in the [Backend Developer Guide](../../architecture/backend-developer-guide.md), without adding business endpoints or changing the database schema.

## Verification

- PASS: `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm install --frozen-lockfile`, and `git diff --check`.
- PASS: backend Jest discovers 4 suites and 19 tests (1 unit suite/6 tests, 3 E2E suites/13 tests). `test:cov` and the separate `test:unit`/`test:e2e` scripts also pass.
- PASS: `pnpm --filter @kanban/backend test:database` creates a temporary database, checks TypeScript and compiled entity discovery, runs/reverts/reruns the migration, checks schema drift, and verifies offset/cursor pagination with duplicate timestamps.
- PASS: changed-file Prettier check. Repository-wide `pnpm format:check` fails on 45 pre-existing, unrelated files; this PR leaves them untouched.
- PASS: compiled `node dist/main.js` smoke test for `/`, `/health`, `/health/ready`, and OpenAPI JSON.
- CI now starts an isolated PostgreSQL service and runs the database integration script after the workspace build. The updated workflow awaits its first GitHub Actions run.

## Architecture and compatibility

The global success envelope changes the REST success body shape for future business endpoints; `/`, `/health`, and `/health/ready` keep explicit unwrapped health responses. API prefix remains `/api`. Schema entities and the initial migration are unchanged. TypeORM keeps `synchronize: false` and `migrationsRun: false`. Rate limiting is per process; a distributed deployment needs shared enforcement or ingress limits. Auth guards, JWT, role policy, password rules, Realtime, Redis, compression and a production Docker image remain separate work.
