# BT3 · VT-053 — Dương Công Kiên · 23001895

APP-02 / Kanvexa · [Draft PR #252](https://github.com/duongkienvn/SE2026-T13/pull/252) · branch `assignment/23001895-vt053-search-board-scope`.

Baseline: `b7c1b97986e75d7d07bbed74b29f5ad3a53fcf30`. This continuation began at `654cbb2d9e2c48b2e057b7793075d9a810f77788`, with a clean checkout. This record covers code and executable evidence. No final PDF, merge or production deployment. Another team member must review before merge.

## Specification

Add optional UUIDv4 `boardId` to authenticated `GET /api/search` for `type=cards`. This is VT-053's incremental slice. The baseline already implements global Workspace/Board/Card search, text/type filtering, pagination, ranking, ACLs, snippets and frontend consumption. See [service](../../../apps/backend/src/api/search/search.service.ts), [query helpers](../../../apps/backend/src/api/search/search-query.ts) and the baseline [integration suite](../../../apps/backend/test/search/search.integration.mjs). Do not attribute those existing features to this assignment.

| ID  | Testable acceptance criterion                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 | Omitted `boardId` preserves legacy defaults, response fields/groups and existing clients.                                                                                              |
| AC2 | Card-only UUIDv4 scope filters before count/page; totals and `hasMore` describe matching authorized active Cards. Wrong types and invalid/empty/repeated/structured scopes return 400. |
| AC3 | Scoped pages preserve rank, then `updatedAt DESC, id ASC`; immutable fixtures have no missing/duplicate hits; beyond-last pages retain correct totals.                                 |
| AC4 | Scope preserves ACLs, archive exclusion, Workspace-name privacy and revocation. Empty text makes no business queries. Database failures propagate to sanitized errors.                 |
| AC5 | Real local HTTP/PostgreSQL workload: 40 concurrent workers, 400 requests per workload, zero errors and p95 <= 1500 ms, with environment/limitations reported.                          |

Non-functional constraints: **NFC1**, no schema migrations, new dependencies, mandatory parameters or response-breaking changes. **NFC2**, server authorization and bound SQL remain authoritative. **NFC3**, failures never become fake empty success. **NFC4**, evidence is reproducible on Windows/Node without production access or weakened assertions.

## Contracts and invariants explained before editing

- JWT identity comes from the guard. Success is `{success:true,statusCode:200,message:"OK",data:{query,type,groups:{workspaces,boards,cards}}}`; groups contain `{items,total,hasMore}`. Result DTO allowlists and relative deep links remain unchanged. `Cache-Control: no-store` remains.
- `q` defaults to empty, trims, permits up to 120 Unicode code points, rejects null bytes/malformed Unicode. Matching is literal case-insensitive substring with escaped LIKE metacharacters. Empty text returns empty groups without business queries.
- `type` defaults to `all`: independent first-page groups, default limit 5/max 10, no `page`. Specific types default to page 1/limit 20/max 50, with positive safe pagination arithmetic. Unknown parameters fail validation.
- `boardId` is optional UUIDv4, only for Cards. It adds `card.boardId = :boardScopeId`; omission adds nothing. Inaccessible, nonexistent or archived Boards return no matches without disclosing existence.
- The [shared read predicate](../../../apps/backend/src/api/board-members/board-permissions.ts) allows explicit Board members or Workspace members of WORKSPACE_VISIBLE Boards. Workspace ADMIN does not override PRIVATE. The [directory join](../../../apps/backend/src/api/search/board-search.ts) separately hides Workspace names from Guests.
- Filter/count/page use one REPEATABLE READ transaction. Rank is exact title, prefix, title substring, description-only; ties use newest update then UUID ascending. This stabilizes one response, not pages across independent concurrent changes.
- Query/transaction failures propagate to the global exception filter; SQL/private contents are sanitized. Search has no persistent mutations or realtime broadcasts.
- [Shared contracts](../../../packages/shared/src/search.ts) and [frontend requests](../../../apps/frontend/src/features/search/api.ts) remain unchanged. Existing consumers still work. Shared `GlobalSearchQuery` does not yet advertise `boardId`; no new typed consumer/UI is included in this backend slice.

The change follows the roadmap's cross-board search/access dependency and blueprint aggregate-access rule. It does not introduce other CD-07 filters or permissions.

## AI plan and evidence-backed corrections

Before edits, the assistant read PR metadata, the entire baseline-to-HEAD diff, search source/tests, shared/frontend consumers, Jest and CI, then explained the contract in the conversation. Plan: preserve production scope in `card-board-scope.ts`, `card-search.ts`, `dto/search-query.dto.ts`, `search.controller.ts`; improve DTO/HTTP/service/integration tests and load/error harnesses; add `test/search/verify-evidence.mjs`; replay history, mutate, measure coverage/local load, run gates and independent review; document and push the existing Draft PR.

| Assumption/approach                                                          | Correction and precise evidence                                                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rebuild global search, pagination and ranking.                               | Rejected: baseline `search-query.ts:6–56`, `search.service.ts:23–59` and integration tests already provide them. Add only Board scope.                                                                                 |
| Require scope, use a new route or change response fields.                    | Rejected: `apps/frontend/src/features/search/api.ts:5–28` sends legacy requests without scope; `dto/search-response.dto.ts` and shared result contracts define existing output. Keep optional input on the same route. |
| Synthetic responses prove backend performance; one scoped hit proves paging. | Corrected: compiled AppModule + PostgreSQL with 4,000 Cards/40 Boards, asserted totals, multi-page ties and an excluded matching Card.                                                                                 |
| A transaction-start rejection covers query failures.                         | Corrected after independent review: callback rejection in native and standard Jest tests, plus a real PostgreSQL error through HTTP and recovery.                                                                      |

UUIDv4 follows existing UUID field conventions/generated IDs. Filtered totals are scoped totals. No schema/index/response changes were necessary. This continuation changes tests/harnesses and formatting; the existing production filter was sound.

## Risk portfolio and traceability

R1 compatibility; R2 privacy/authorization; R3 pagination/rank; R4 hidden failures; R5 latency/harness validity; R6 validation/SQL. Test paths below are under `apps/backend/`.

| ID  | AC/Risk | Executable case                                                          | File                                                                          | Commit/result                              |
| --- | ------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------ |
| T01 | AC1/R1  | Omitted filter/defaults/groups                                           | `src/api/search/search-contract.spec.ts`, `test/search/search.dto.spec.ts`    | `a0f7130` + `a9af8b0`; PASS                |
| T02 | AC2/R6  | Bound Board SQL, omission preserves scope                                | `test/search/board-scope.contract.mjs`                                        | `b5b3814` RED -> `b591929` GREEN           |
| T03 | AC2/R1  | HTTP forwards scope/page/limit; Swagger optional                         | `test/search/search.e2e-spec.ts`                                              | `a9af8b0`; PASS                            |
| T04 | AC2/R6  | Wrong type, invalid/repeated/structured scope, null/array/object         | `test/search/search.e2e-spec.ts`, `src/api/search/search-contract.spec.ts`    | `a9af8b0`; PASS                            |
| T05 | AC2/R1  | Owner narrowing, filtered totals, inactive groups/exact item keys        | `test/search/search.integration.mjs`                                          | `b4a9738` + `a9af8b0`; PASS                |
| T06 | AC4/R2  | Outsider, Guest/private, admin/private, unknown/archived Board denied    | `test/search/search.integration.mjs`                                          | `a9af8b0`; PASS                            |
| T07 | AC4/R2  | Visible reader allowed, scoped Guest name hidden                         | `test/search/search.integration.mjs`                                          | `a9af8b0`; PASS                            |
| T08 | AC4/R2  | Scoped results disappear after cross-Workspace grant revocation          | `test/search/search.integration.mjs`                                          | `a9af8b0`; PASS                            |
| T09 | AC3/R3  | Scoped first/middle/last/beyond-last, rank/timestamp/UUID ties           | `test/search/search.integration.mjs`                                          | `a9af8b0`; PASS                            |
| T10 | AC4/R2  | Empty query, consistent revocation/archive snapshot, 4,000-row traversal | `test/search/search.service.spec.ts`, `test/search/search-scale.mjs`          | baseline + final checks; PASS              |
| T11 | AC1/R1  | JWT, exact wire allowlists, no-store, deep links, sanitized errors       | `test/search/search.e2e-spec.ts`, `test/search/search.integration.mjs`        | baseline + final checks; PASS              |
| T12 | AC4/R4  | Transaction-start and callback query errors preserve rejection identity  | `test/search/search.service.spec.ts`, `test/search/search-error.contract.mjs` | `a9af8b0`; PASS                            |
| T13 | AC4/R4  | Genuine PostgreSQL error -> sanitized HTTP 500, recovery                 | `test/search/search.integration.mjs`                                          | `a9af8b0`; PASS                            |
| T14 | AC4/R4  | SAME error tests kill empty-success catch                                | `test/search/verify-evidence.mjs mutation`                                    | temporary mutant; 2 FAIL expected          |
| T15 | AC5/R5  | 40 workers, 400 legacy + 400 scoped HTTP requests                        | `test/search/search-load.mjs`, integration fixture                            | `a9af8b0`; PASS                            |
| T16 | AC4/R6  | Literal wildcards/backslash/injection/Unicode                            | `test/search/search.dto.spec.ts`, `test/search/search.integration.mjs`        | baseline; ICU PASS, C-locale FAIL retained |

The final test/harness commit is `a9af8b0c549cfffd2528937a5f7d9f18d2f7486c`, identifiable with `git log --oneline -- apps/backend/test/search/verify-evidence.mjs`. The [context manifest](evidence/verification-context.json) records tested file hashes and starting HEAD, avoiding a self-referential commit hash.

## RED -> GREEN and mutation

From repository root:

```powershell
pnpm install --frozen-lockfile
node apps/backend/test/search/verify-evidence.mjs history
node apps/backend/test/search/verify-evidence.mjs mutation
node --experimental-strip-types --test apps/backend/test/search/board-scope.contract.mjs
pnpm --filter @kanban/backend exec jest --runInBand --testPathPattern=search --coverage '--collectCoverageFrom=src/api/search/**/*.ts' --coverageReporters=text --coverageReporters=json-summary
```

Replay uses tracked test text from `b5b3814ff82b9330e2b2a8f9bb918da72075d10e` and source from that commit, then `b5919297d6b251ed4c7dc6fb2b4d833297869026`, in a temporary directory. The test precedes its implementation. RED: 1 pass/2 fail, exit 1: stub returns null instead of a bound predicate; the third test dereferences null. GREEN: 3 pass/0 fail, exit 0. [RED](evidence/history-red.txt), [GREEN](evidence/history-green.txt) contain commands, full SHAs and content hashes. This proves **helper-level TDD**, not historical HTTP-level RED. DTO integration followed in `1911645`, query wiring in `b3dde4d`, HTTP/PostgreSQL tests in `b4a9738`. No artificial history was created.

Mutation first runs the original failure oracle, copies service source to a temporary file, appends `.catch(() => toResponseDto(SearchResponseDto, result))` to the transaction promise, and reruns the SAME tests with only `VT053_SERVICE_SOURCE` changed. Both fail with **`AssertionError: Missing expected rejection.`** Original 2 pass/exit 0; mutant 2 fail/exit 1; restored/original 2 pass/exit 0. Logs: [original](evidence/mutation-original.txt), [mutant](evidence/mutation-mutant.txt), [restored](evidence/mutation-restored.txt), [hash summary](evidence/mutation-summary.txt). Production source is never overwritten, hashes match, temporary files are removed. Ordinary Jest now protects both failure paths in CI too.

## Coverage and flaky risks

Focused Jest: **77 tests/4 suites PASS**, exit 0. Search-source lines **83.83% (140/167)**, branches **87.75% (43/49)**; service/request/response DTOs each 100% line/branch. Query builders are mocked there: these percentages alone do not prove SQL behavior. [Focused output](evidence/focused-jest.txt).

Real PostgreSQL Node V8 report: compiled search JavaScript **99.24% lines, 86.43% branches**, 100% functions; scope/Card query builders 100% line/branch. [Database coverage](evidence/database-coverage.txt). Its denominator includes emitted decorator/helper code and differs from Jest source coverage; do not combine the reports arithmetically.

Code coverage counts execution. Risk coverage maps compatibility/privacy/failure/ordering/latency concerns to observable assertions above. High coverage is not proof of correctness; mutation and actual SQL/HTTP checks add evidence.

1. **Shared state:** random migrated/dropped database per run, serialized setup, immutable fixtures. Query-runner interception always restores in `finally`; do not run interception concurrently inside the same app instance.
2. **Time/order:** fixed timestamps and UUID-sorted ties avoid insertion-clock dependence. Offset pages may shift during independent concurrent edits; one response uses REPEATABLE READ.
3. **Network/resources:** loopback ephemeral port, deadlines, 40 awaited workers, real JWT/response validation. One warmed run cannot prove sustained production p95. Reported load excludes coverage instrumentation.
4. **Locale:** the initial `C` locale failed an unchanged baseline Vietnamese case-match assertion; [failure retained](evidence/database-locale-c-failure.txt). ICU `und`/UTF-8 passes. Production collation is unverified. A pre-existing pg concurrent-query deprecation warning remains unsuppressed.

## Real local database and load

Windows x64; i7-12700H/20 logical CPUs; 40 GiB RAM; Node 22.17.0, pnpm 10.18.3, Jest 29.7.0, Prettier 3.9.9, PostgreSQL 17.5. CI uses Node 22.13.0. Docker engine was unavailable. Installed PostgreSQL binaries supported a separate disposable loopback cluster at port 55453, ICU `und`, UTF-8, pool size 10. Existing development/production databases were untouched.

[Reproduction commands and environment](evidence/README.md) include isolated-cluster setup and exact scripts. `SEARCH_DATABASE_TESTS=local-only` and loopback host are mandatory. The integration suite creates/drops a random database, starts compiled full AppModule, issues JWTs and seeds 4,000 bulk Cards/40 Boards plus ACL/rank fixtures. Set `VT053_RUN_LOAD=1` to run both workloads before cleanup. Authentication, validation, SQL, serialization and HTTP JSON reading are included. Test-only rate limit 10000 avoids single-IP throttling; ordinary tests separately verify 429. This is 40 concurrent tasks with one owner/JWT, not 40 distinct human sessions.

| Workload                                                            | Requests/success/failure | Max concurrent | p50       | p95           | p99       | Errors | Target         |
| ------------------------------------------------------------------- | ------------------------ | -------------- | --------- | ------------- | --------- | ------ | -------------- |
| Legacy `q=Bulk188&type=cards&limit=20&page=40`, total 4,000         | 400/400/0                | 40             | 473.13 ms | **579.12 ms** | 740.20 ms | 0%     | PASS <=1500 ms |
| Scoped same term, `limit=20&page=2&boardId=<bulk board>`, total 100 | 400/400/0                | 40             | 387.00 ms | **435.83 ms** | 472.30 ms | 0%     | PASS <=1500 ms |

[Raw load/database log](evidence/database-load.txt): **11 groups PASS**, exit 0, including actual SQL failure/HTTP 500 and recovery. Nearest-rank percentiles include all completed requests, including failures if any, measured through JSON parsing. Runs are sequential, closed-loop and warmed by integration setup. No synthetic server or production target was used. Internet latency, cold caches, capacity and confidence intervals remain unverified.

## Verification, review and AI usage

Root gates: `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:infra`, `pnpm format:check`, `git diff --check`; [results/commands](evidence/README.md). PostgreSQL/native mutation/replay are separate manual checks. CI and broad Jest configuration were unchanged.

Incoming CI [43172581311](https://github.com/duongkienvn/SE2026-T13/actions/runs/43172581311) passed lint/test/build/infra and failed only Prettier on `search-contract.spec.ts`. Historical no-undef/ESM failures were already patched. This continuation uses repository Prettier without disabling assertions/transforms. Initial local tests/build lacked installed mobile Jest/`expo-secure-store`; frozen-lockfile install repaired dependencies without package/lock changes. Initial evidence-runner lint failure was fixed with an equivalent counted-space regex. Initial failure logs are retained.

An independent review agent read the full original 11-file diff and continuation, ran tests, identified the paging/failure gaps, reviewed corrections and found no actionable defects. [Review record](evidence/independent-review.md). This is AI peer review; it is not human teammate approval.

AI Usage Log:

- Complete user request (trailing whitespace normalized): [user-request.txt](evidence/user-request.txt). The earlier README's reconstructed “Prompt P1” is not treated as a verified historical transcript.
- Primary assistant inspected source/contracts before proposing edits, preserved production scope, added tests/harnesses and executed commands. Independent agent reviewed without editing and reran tests.
- Decisions/corrections are recorded above. Original helper TDD, temporary mutation, local PostgreSQL and observed failures are reported with their limits.
- No final PDF generated. Commit/push is authorized only for this assignment branch; keep PR Draft, wait for CI, do not merge/deploy.
  Final local root test run passed with `VITEST_MAX_WORKERS=2`: backend 117 suites/1,296 tests; frontend 158 files/1,677 tests; shared 20 tests; mobile 47 native and 22 Jest tests. The default-worker failure is retained as a resource/flakiness limitation. Plain Windows `pnpm format:check` fails on 1,347 pre-existing CRLF files (`core.autocrlf=true`); the explicit Windows content check uses `--end-of-line auto`, while unchanged Linux CI checks LF. No unrelated files were reformatted.
