# VT-053 executable evidence

Collected 12 November 2026 (Asia/Bangkok). Logs contain actual output and child exit codes; expected RED/mutant failures are retained. Starting HEAD: `654cbb2d9e2c48b2e057b7793075d9a810f77788`. Tested working-tree code is identified by SHA-256 in [verification-context.json](verification-context.json), then committed without behavior changes.

## Commands and results

Commands run from repository root. PowerShell capture: `command *> evidence-file; $taskExit=$LASTEXITCODE; Add-Content evidence-file "EXIT_CODE=$taskExit"`. The native runner also writes exact child commands, historical SHAs and content hashes.

| Command                                                                                    | Output                                                                                                                               | Result                                                                                   |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                           | [install.txt](install.txt)                                                                                                           | PASS, exit 0; package/lockfile unchanged                                                 |
| `pnpm lint`                                                                                | [lint.txt](lint.txt)                                                                                                                 | PASS, exit 0                                                                             |
| `$env:VITEST_MAX_WORKERS='2'; pnpm test`                                                   | [workspace-test.txt](workspace-test.txt)                                                                                             | PASS, exit 0; backend 1,296, frontend 1,677, shared 20, mobile 47 native + 22 Jest tests |
| `pnpm build`                                                                               | [workspace-build.txt](workspace-build.txt)                                                                                           | PASS, exit 0                                                                             |
| `pnpm test:infra`                                                                          | [infra.txt](infra.txt)                                                                                                               | PASS, 25 tests, exit 0                                                                   |
| `pnpm format:check`                                                                        | [format.txt](format.txt)                                                                                                             | FAIL, exit 1; 1,347 existing CRLF files in Windows checkout                              |
| `pnpm format:check --end-of-line auto`                                                     | [format-windows.txt](format-windows.txt)                                                                                             | PASS, exit 0; Windows line-ending detection                                              |
| `git diff --check`; `node docs/assignments/VT-053/evidence/audit.cjs`                      | [diff-links.txt](diff-links.txt)                                                                                                     | PASS, both exit 0; links/source hashes/service unchanged                                 |
| Focused Jest command below                                                                 | [focused-jest.txt](focused-jest.txt)                                                                                                 | PASS, 77 tests/4 suites, exit 0; source lines 83.83%, branches 87.75%                    |
| `node --experimental-strip-types --test apps/backend/test/search/board-scope.contract.mjs` | [native-scope.txt](native-scope.txt)                                                                                                 | PASS, 3 tests, exit 0                                                                    |
| `node apps/backend/test/search/verify-evidence.mjs history`                                | [RED](history-red.txt), [GREEN](history-green.txt)                                                                                   | Runner exit 0; children RED 1 (2 fail), GREEN 0 (3 pass)                                 |
| `node apps/backend/test/search/verify-evidence.mjs mutation`                               | [original](mutation-original.txt), [mutant](mutation-mutant.txt), [restored](mutation-restored.txt), [summary](mutation-summary.txt) | Runner exit 0; children 0 -> 1 -> 0, both tests kill mutant                              |
| `pnpm --filter @kanban/backend test:search:database` with environment below                | [database-load.txt](database-load.txt)                                                                                               | PASS, 11 groups, exit 0, two real 40-worker workloads                                    |
| Instrumented DB command below                                                              | [database-coverage.txt](database-coverage.txt)                                                                                       | PASS, 10 groups in one Node test, exit 0; compiled lines 99.24%, branches 86.43%         |

```powershell
pnpm --filter @kanban/backend exec jest --runInBand --testPathPattern=search --coverage '--collectCoverageFrom=src/api/search/**/*.ts' --coverageReporters=text --coverageReporters=json-summary
```

Root tests include shared/backend/frontend/mobile. PostgreSQL/native replay/mutation are separate. Source Jest and compiled V8 coverage have different denominators.

## Isolated PostgreSQL reproduction

Use a fresh data directory and free port; adapt the binary path. The disposable trust-authenticated cluster binds loopback. Never substitute production.

```powershell
$pgBin = 'F:\Program Files\PostgreSql\17\bin'
$taskPgData = "$PWD\.codex\vt053\pgdata-icu"
& "$pgBin\initdb.exe" -D $taskPgData -U vt053 --auth=trust --encoding=UTF8 --locale-provider=icu --icu-locale=und --locale=C
$taskPg = Start-Process -FilePath "$pgBin\pg_ctl.exe" -ArgumentList @('-D', $taskPgData, '-l', "$PWD\.codex\vt053\postgres-icu.txt", '-o', '"-h 127.0.0.1 -p 55453"', '-w', 'start') -WindowStyle Hidden -Wait -PassThru
if ($taskPg.ExitCode -ne 0) { throw 'Local PostgreSQL did not start' }
$env:SEARCH_DATABASE_TESTS='local-only'
$env:DATABASE_HOST='127.0.0.1'
$env:DATABASE_PORT='55453'
$env:DATABASE_NAME='postgres'
$env:DATABASE_USER='vt053'
$env:DATABASE_PASSWORD='vt053-local-test' # dummy for disposable loopback cluster
$env:DATABASE_SSL='false'
$env:DATABASE_POOL_SIZE='10'
$env:NODE_ENV='test'
$env:TASK_NOTIFICATION_JOBS_ENABLED='false'
$env:TASK_NOTIFICATION_EMAIL_ENABLED='false'
$env:VT053_RUN_LOAD='1'
pnpm --filter @kanban/backend test:search:database
# Instrumentation is excluded from reported load.
$env:VT053_RUN_LOAD='0'
pnpm --filter @kanban/backend exec node --experimental-test-coverage '--test-coverage-include=**/dist/api/search/**/*.js' --test test/search/search.integration.mjs
& "$pgBin\pg_ctl.exe" -D $taskPgData -m fast -w stop
```

Each invocation migrates/drops a random `kanban_search_*` database. It never migrates `postgres` or existing development data. Compiled AppModule receives the source override; HTTP uses an ephemeral port/generated JWT. Tokens are not logged/persisted. Background email jobs are off. Workloads use 40 tasks, one owner/JWT, 400 requests each, asserted Card totals 4,000/100. Latency includes JSON parsing, all requests and nearest-rank percentiles. No separate heavy checks ran alongside reported load.

## Preserved failures and limitations

- Missing mobile dependencies: [test](workspace-test-missing-deps.txt), [build](workspace-build-missing-deps.txt). Frozen-lockfile install restored existing Jest/`expo-secure-store`.
- [Initial lint failure](lint-initial-failure.txt): literal regex spaces replaced by equivalent `{4}`/`{2}` quantifiers.
- [Resource-related test failure](workspace-test-resource-failure.txt): default frontend workers under concurrent suites caused many frontend/mobile timeouts and a mobile callback-count failure. Rerun limits Vitest workers through its supported environment option. No tests/assertions/timeouts changed. This identifies a resource/flakiness risk without proving every initial failure has one cause.
- [C-locale DB failure](database-locale-c-failure.txt): unchanged baseline Unicode assertion failed; ICU `und` passes. Production collation unverified.
- Docker engine unavailable: image/lifecycle smoke checks not run; this test/backend-input slice does not change containers. Other unrelated domain DB suites not run. Actual local search SQL/HTTP checks ran with installed PostgreSQL.
- Existing pg deprecation and frontend chunk/router warnings remain unsuppressed.

CI/final HEAD are linked in the final report/PR. Incoming CI [43172581311](https://github.com/duongkienvn/SE2026-T13/actions/runs/43172581311) failed only assignment DTO formatting. Human teammate review remains required before merge.
`core.autocrlf=true` writes existing tracked files as CRLF. Plain Prettier expects LF and flags 1,347 files. No unrelated files were rewritten; the Windows content check uses `--end-of-line auto`. Linux CI runs unchanged `pnpm format:check` on LF. Report the raw local failure separately from content validation and CI.
