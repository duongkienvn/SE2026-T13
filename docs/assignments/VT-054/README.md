# VT-054 · Async Board export

Vũ Quang Nam · 23001908 · SE2026-T13 · APP-02. Baseline: `5c20856ba4686bac472c2cdb26cbf6dc51e83c76`. Submission branch: `assignment/23001908-vt054-async-progress`.

In Settings → Data & Privacy, Board owners can start an export, see its phase and download the result when ready. Repeating a request with the same operation key does not create another job. The API keeps the original synchronous Board and account exports available.

- [Specification and plan review](SPEC-PLAN.md)
- [Equivalence partitions and 16 test cases](TEST-DESIGN.md)
- [RED record](RED.md) and [patch review](PATCH-REVIEW.md)
- [Mutation, coverage, flaky runs and load results](QUALITY-EXPERIMENTS.md)
- [API and migration notes](../../tasks/backend/async-board-export-jobs.md)
- [Browser screenshots](../../design/screens/implementation/vt054-async-export/README.md)

## Reproduce on a disposable local database

Use Node 22.23.4, pnpm 10.18.3 and PostgreSQL 16. From repository root:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @kanban/shared build
pnpm --filter @kanban/backend build
pnpm --filter @kanban/backend exec jest --runInBand --watchman=false --testPathPattern=exports
pnpm --filter @kanban/frontend exec vitest run src/features/settings/data-privacy src/lib/api-client.test.ts
```

The integration harnesses require explicit local opt-in and create/drop a random database on the separate test container. Use the following command only for the disposable environment.

```powershell
docker run --detach --name vt054-23001908-postgres --publish 127.0.0.1:55454:5432 --env POSTGRES_DB=vt054_test --env POSTGRES_HOST_AUTH_METHOD=trust postgres:16.15-alpine3.24
docker exec vt054-23001908-postgres pg_isready -U postgres -d vt054_test
$env:EXPORT_DATABASE_TESTS='local-only'
$env:DATABASE_HOST='127.0.0.1'
$env:DATABASE_PORT='55454'
$env:DATABASE_NAME='vt054_test'
$env:DATABASE_USER='postgres'
$env:DATABASE_PASSWORD='local-test'
$env:NODE_ENV='test'
node apps/backend/test/exports/async-export-schema.integration.mjs
node apps/backend/test/exports/async-export-jobs.integration.mjs
node apps/backend/test/exports/async-export-http.integration.mjs
$env:VT054_LOAD='1'
$env:VT054_LOAD_LABEL='reproduction'
node apps/backend/test/exports/async-export-http.integration.mjs
Remove-Item Env:VT054_LOAD
```

The load command writes JSON observations before enforcing thresholds. Expect a nonzero exit if latency or correctness misses the criteria. Use a new label to retain previous raw results.

## Quality experiments

To reproduce the mutation, create an isolated local branch from `e30de97`, apply [the one-line mutation](evidence/mutation-response-format.patch), and run the mapper test. It should fail the CSV assertion. Run the same command again on the submission branch to confirm restoration.

```powershell
pnpm --filter @kanban/backend exec jest --runInBand --runTestsByPath src/api/exports/export-job-policy.spec.ts --watchman=false
pnpm --filter @kanban/backend exec jest --runInBand --runTestsByPath src/api/exports/export-job-policy.spec.ts --watchman=false --coverage --collectCoverageFrom=src/api/exports/export-job-policy.ts
$env:NODE_V8_COVERAGE='apps/backend/coverage/vt054-reproduction'
node apps/backend/test/exports/async-export-http.integration.mjs
node apps/backend/test/exports/async-export-jobs.integration.mjs
Remove-Item Env:NODE_V8_COVERAGE
node apps/backend/test/exports/summarize-export-coverage.mjs apps/backend/coverage/vt054-reproduction
```

The report documents the host, workload, validation boundaries and remaining risks. The database checks cover local execution and do not measure a production deployment.

## Traceability

| AC / risk                    | Test cases                   | Evidence path                                                                                                                                                                             | Commit                    | Outcome                                                          |
| ---------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------- |
| AC1, duplicate identity      | TC01–TC05                    | apps/backend/test/exports/async-export-http.integration.mjs và async-export-jobs.integration.mjs                                                                                          | 5230eb1, 0497e65, 5c84617 | 404 RED, 202 GREEN, UNIQUE bảo vệ 120 retry, conflict/validation |
| AC2, status mapping          | TC08–TC10                    | apps/backend/src/api/exports/export-job-policy.spec.ts                                                                                                                                    | a7bb5fa, a8b0ecc, fb7d6b8 | 12 RED → 12 GREEN, CSV mutant bị KILLED                          |
| AC3, access và compatibility | TC06, TC07, TC09, TC12, TC13 | apps/backend/test/exports/async-export-http.integration.mjs và async-export-jobs.integration.mjs                                                                                          | 0497e65, 5c84617          | JWT, isolation, revoke, TTL, JSON thật, cleanup                  |
| AC4, retry/lease             | TC10–TC11                    | apps/backend/test/exports/async-export-jobs.integration.mjs                                                                                                                               | 0497e65, fb7d6b8          | 120 retry cùng job, failure sanitized, stale worker bị chặn      |
| AC5, UI / session            | TC14–TC15                    | apps/frontend/src/features/settings/data-privacy/async-export-api.test.ts, async-export-progress.test.tsx, DataPrivacyPage.test.tsx và apps/backend/test/exports/async-export.browser.mjs | 5c84617, e30de97          | 7 RED, UI GREEN, 8 browser journeys, hủy timer                   |
| NFR1, 120 logical tasks      | TC16                         | apps/backend/test/exports/async-export-load.mjs, evidence/load-keepalive-drain.json                                                                                                       | fb7d6b8, 66c4fb1          | 120/120, 0 duplicate, ack đạt, completion chưa đạt               |

Các file evidence được lưu dưới thư mục evidence của bài. Mỗi phép đo latency trên Board rỗng, một session, máy Windows local và PostgreSQL 16 disposable.

## Report and final check records

- [PDF submission](../../../output/pdf/BT3_23001908_VT-054.pdf)
- [AI usage](AI-USAGE.md), [reflection](REFLECTION.md), [final audit](FINAL-AUDIT.md), [draft PR description](PR-DESCRIPTION.md)
- [Root gate exit codes](evidence/final-gates.json), [backend isolated test](evidence/backend-serial.txt)
- VT-053 reference tip `66941279222844ae712fcef33deab67e3344b1cc` matches GitHub [PR #252](https://github.com/duongkienvn/SE2026-T13/pull/252) via `git ls-remote origin 'refs/pull/*/head'`. PR body/review timeline could not be inspected through the public API rate limit. No implementation or fixture from that branch was reused.
- Re-render the A4 report with Node and a local Playwright core/Chromium installation. Set `VT054_PLAYWRIGHT_ROOT` to the installed module directory, then run `node docs/assignments/VT-054/render-report.mjs` from the repository root. Set `VT054_PR_NUMBER` only after a draft PR is verified.
