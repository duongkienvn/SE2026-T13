# Policy PATCH review và GREEN

Prompt thực tế: “Triển khai tối thiểu mapper allowlist và retry predicate theo 12 tests RED, không đổi expected results. Không serialize raw row; failed errors dùng mã cố định.”

Patch: `toExportJobResponse` liệt kê 7 trường công khai, state mapping giữ nguyên; PENDING progress 0, COMPLETED 100, các trạng thái khác null. `canRetryExportJob` chỉ cho FAILED với attempts < 3 và expiry > clock hiện tại.

Review self-directed: Scope chỉ policy; design không có I/O/side effect, dễ đưa vào service; correctness giữ equality tại expiry là expired và không restart completed; evidence cùng 12 tests chạy lại không thay assertions. Kết quả: 12 passed/12, exit 0, 25.741s; log `evidence/green-policy.txt`. Chưa tích hợp API/job persistence; TC01 HTTP vẫn RED. Không gọi phần này là feature hoàn chỉnh hoặc chứng minh database uniqueness.

Nguy cơ còn lại: raw entity có private fields cần select hợp lý ở service; thời gian job phải kiểm tra tại database claim/commit; retry predicate unit không bảo vệ race nếu UPDATE thiếu điều kiện. Test PostgreSQL phải xác minh các điều kiện đó.

## Schema RED → PATCH → GREEN (PostgreSQL thật)

Prompt thực tế: “Thêm executable schema contract trước migration: migrate baseline vào database ngẫu nhiên, assert có durable job table và unique user/key, giữ synchronize/migrationsRun false, kiểm tra schema drift và cleanup finally.”

- RED `async-export-schema.integration.mjs`: exit 1 tại `hasTable` false/expected true, log `evidence/red-schema.txt`; không phải SQL connection failure.
- PATCH: `BoardExportJob` và `1794787200000-AsyncBoardExports`. Guard user-reference dùng hàm account deletion có sẵn. Ràng buộc attempt/state/lease, bytes <=20MiB, expiry hữu hạn; populated down từ chối mất tombstone idempotency. Review sửa UUID default từ uuid_generate_v4 sang gen_random_uuid theo `database-options.ts` uuidExtension pgcrypto và initial migration. Không đổi expected tests.
- Build entity/schema exit 0 (`evidence/schema-backend-build.txt`). GREEN cùng harness exit 0: durable table, UNIQUE, explicit migration và no schema drift; log `evidence/green-schema.txt`. pg cảnh báo concurrent-query deprecation khi schema inspection; không phải failure.
- Giới hạn: hiện harness chỉ xác minh schema metadata, chưa chứng minh race, rollback, lease, account deletion hoặc legacy-data upgrade. Cần mở rộng integration tests trước final audit.

## Service/API PATCH review

- Actual timeline: initial HTTP RED and policy RED preceded production implementation. The service draft was generated before the detailed service integration harness; this harness therefore strengthens verification, not a claim that every service case was RED first. The account cleanup assertion was RED before its cleanup patch.
- Keep: database UNIQUE and row claim/lease; generator and public mapper reuse; explicit failed retry; sanitized errors; current owner/session gates before final download.
- Modify: add `.take(1)` to avoid locking more queue rows than an individual claim requires; use allSettled in worker batches so one rejection cannot clear the concurrency guard while siblings still run; remove optional production dependency introduced only for test convenience and update the old controller fixture instead.
- Fix detected by test: `eraseAccountPrivateState` retained 3 export jobs; add job table to its explicit inventory. Same harness then passed all 7 groups, including count zero.
- HTTP test boot now supplies a job-service stub because the controller has a new dependency; assertions remain 202/PENDING/ID and no private fields. This proves routing/validation wiring, not database behavior. Database harness exercises the real service separately.
- GREEN focused Jest: 3 suites, 46 tests, 45.231s, exit 0 (`evidence/green-http-policy-regression.txt`). Database: 7 groups pass (`evidence/green-jobs-database.txt`). Backend build exit 0 (`evidence/jobs-api-build.txt`). Scheduler/full JWT HTTP and browser integration are still pending.

## Frontend PATCH review

- Actual implementation now calls async start/status/retry/download. `requestRawJson` reuses the API client's network/error boundary for raw job JSON; shared `BoardExportJobResponse` replaces a duplicated backend response type. Client validates job identity, format/state, attempts and expiry shape before using the response.
- BoardExportCard keeps operation key per board/format/session generation through errors, clears it after success/expiry/exhaustion or selection changes. Failed job gets one explicit retry when the user invokes the action again; a failure during polling stops and reports an error rather than looping retries. Blob publication still uses the existing session/current-owner and filename checks. Session generation cleanup aborts polling.
- Progress tests keep visible queued/running/downloading status; account export retains its existing progress text. Existing page fixtures were adapted at the new job/download boundary and endpoint assertions now check POST body format; content, filename, permission and no-stale-download assertions remain.
- A second AI-test issue was found: `expect.any(Blob)` compared jsdom's Blob constructor with Fetch/Node's Blob realm and failed despite correct bytes (`evidence/green-ui-workflow.txt`: 48 pass, 1 fail). Replace the constructor oracle with exact downloaded text while retaining phase/request ordering. Reviewed run: 66/66 pass; additional retry/abort/unknown-state tests: 69/69 pass (`evidence/ui-retry-abort-regression.txt`). Stronger active-timer abort test confirms one timer exists before abort and zero afterwards; API suite 6/6 pass (`evidence/ui-poll-timer-abort.txt`).
- Shared build and frontend build pass; existing Vite chunk-size warning is retained. Detector run once over the changed UI returned [] (`evidence/ui-detector.json`). This is not visual/browser proof. Browser QA and final full-repository checks remain pending.

## Browser integration review

- Verified production bundle against actual JWT REST + Socket.IO on port 3009 and disposable PostgreSQL. Eight independent viewport/theme journeys completed; all RUNNING and completion images inspected. Evidence directory `docs/design/screens/implementation/vt054-async-export/direct/`.
- AI harness mistake: proxying REST while leaving realtime pointed at unavailable localhost:3000 caused protected discovery cache clearing; browser could not download though server job completed. Diagnostic logs and one failure screenshot retained. Fixed test environment, not application authorization.
- Metadata self-review: initial browser JSON accidentally overwrote the requested theme with HTML className (which is empty) and retained a stale “origin forwarded” label. Keep original as `evidence/browser-results-initial-metadata.json`; final harness asserts `data-theme` equals requested theme, labels direct REST/socket correctly and reruns. No timing/test result was edited to create a pass.
