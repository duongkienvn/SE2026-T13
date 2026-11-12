# BT3 · VT-053 | Dương Công Kiên — 23001895 | APP-02 / SE2026-T13

Baseline: `b7c1b97986e75d7d07bbed74b29f5ad3a53fcf30` (main, 12/11/2026). This is an **individual, review-pending** change. Do not merge without another team member's review.

## 0. Contract and invariants reviewed before coding

Existing `GET /api/search` uses JWT, `q/type/page/limit`; strict response `{query,type,groups:{workspaces,boards,cards}}`. Without `boardId`, the exact legacy behavior, empty query, URL/deep links, ranking, total, `hasMore`, stable `updatedAt DESC,id ASC` tie-break, archived exclusion, ACL and Guest directory privacy must remain. New optional `boardId` (UUIDv4) **only when `type=cards`** restricts the card list; it must add a WHERE predicate, never replace ACL. Backend errors must not turn into fake empty success responses. No DB schema, shared result type, UI or mobile API changes.

## 1. AI-assisted plan and human-review checkpoints

**Prompt P1 sent to ChatGPT / GitHub-powered coding assistant:** “Inspect the actual Search Controller/DTO, Card query builder, query pagination/ranking helper, frontend consumer and integration fixtures. Explain the request/response contract and invariants first, then propose a minimal implementation plan with exact files, fail-first tests, mutation and 40-concurrent load harness. Do not merge.”

Two proposed shortcuts were rejected on repository evidence: (i) rebuilding `/search`/pagination/rank was unnecessary because `search-query.ts` and `test/search/search.integration.mjs` already implement and test it; (ii) requiring a filter or adding response fields would break `apps/frontend/src/features/search/api.ts` and `dto/search-response.dto.ts`. Instead add an optional Card-only filter; leave clients/output unchanged. An exception-catching fallback was also rejected because `search.service.ts` correctly propagates DB transaction failures.

**Assumptions for student review:** Board UUIDv4; filtered totals refer to filtered Cards; only `type=cards` accepts `boardId`; new filter is strictly additive; no migrations. Planned production changes: `dto/search-query.dto.ts`, `card-search.ts`, small pure `card-board-scope.ts`, Swagger description in `search.controller.ts`. Test files: `search-contract.spec.ts`, `test/search/board-scope.contract.mjs`, extension of `test/search/search.integration.mjs`. Risk: backward API compatibility, authorization and silent failures. Target 40 concurrent requests, p95 <= 1500ms and zero errors.

## 2. Reproduce tests

```sh
# Fast independent contract tests, Node 22+; no DB.
node --experimental-strip-types --test apps/backend/test/search/board-scope.contract.mjs

# Jest contract + exception propagation; workspace dependencies installed.
cd apps/backend && pnpm exec jest --runInBand --runTestsByPath src/api/search/search-contract.spec.ts

# HTTP/Postgres real contract; ONLY a local isolated PostgreSQL instance:
# SEARCH_DATABASE_TESTS=local-only DATABASE_HOST=127.0.0.1, other local DB env.
pnpm --filter @kanban/backend test:search:database

# 40 concurrent workers, 400 HTTP tasks (requires deployed local TEST server).
VT053_SEARCH_URL='http://127.0.0.1:3000/api/search?q=needle&type=cards&limit=20' VT053_SEARCH_TOKEN='<test JWT>' node apps/backend/test/search/search-load.mjs
```

Never point database or load test at production without permission. `test:search:database` creates a randomized temporary database and drops it. CI's ordinary Jest tests **do not** run this separate DB integration automatically. Synthetic HTTP responses establish the load harness works but cannot certify real application p95 or security.

## 3. TDD, mutation and traceability

Baseline `b7c1b97...` → RED seam stub `107b092`, fail-first native contract `b5b3814` (local 1/3 pass, 2 fail, exit 1) → patch `b591929` plus DTO/query changes (local 3/3 pass, exit 0). Contract assertions: C01 legacy no-scope, C02 parameterized SQL, C03 Board separation; Jest tests cover optional/invalid query contracts and backend failures; PostgreSQL integration covers wire shape, filtered totals, authorization and invalid input. Mutation experiment: temporary `try/catch` in `SearchService.search` that returns empty groups must be killed by the failure-path test; the submitted branch must preserve exception propagation. Review source diff and full workflow results before approval.

For load, the script reports request count, `maxActive`, p95, error count and threshold; record test environment/fixture separately. Fixed UUID fixtures and no shared clock/random data reduce flaky behavior; isolated PostgreSQL DB and immutable seeded ranking rows reduce order/state flakiness.
