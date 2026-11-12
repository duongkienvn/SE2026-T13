# VT-054: Khảo sát và checkpoint

- Sinh viên: Vũ Quang Nam, 23001908; APP-02, SE2026-T13.
- Baseline sau `git fetch origin`: `5c20856ba4686bac472c2cdb26cbf6dc51e83c76`.
- Worktree riêng: `.worktrees/23001908-vt054-fresh`; nhánh `assignment/23001908-vt054-async-progress`. Checkout gốc có `docs/mobile/testing.md` chưa theo dõi, được giữ nguyên.
- Tài liệu giảng viên (Yêu cầu.txt, hai slide và HTML VT-052) chưa tìm thấy trong repository hay thư mục đính kèm; chưa đọc, không suy đoán nội dung. Rubric ở prompt chỉ là cơ sở tạm thời.
- Nhánh VT-053 có merge-base `b7c1b97986e75d7d07bbed74b29f5ad3a53fcf30`, 26 commit so với origin/main tại lúc kiểm tra. Lịch sử chia seam/test, feature, HTTP/database test, mutation và evidence; cũng có nhiều commit chỉnh portability/format. Chỉ khảo sát lịch sử và nhóm file, không sao chép code, dữ liệu hoặc kết quả.
- Node v22.23.4, pnpm 10.18.3; cài đặt offline đang thực hiện.

## Khảo sát ban đầu

`ExportsController.board` thực hiện export đồng bộ trong request, sau đó kiểm tra lại quyền OWNER và session trước khi trả dữ liệu. `BoardExportService.create` đọc snapshot, giới hạn kích thước; `ExportSnapshot` dùng transaction read-only và timeout. Roadmap DX-01 yêu cầu export được cấp quyền. Export là read-only: không có cơ sở coi retry hiện tại gây trùng notification hoặc transaction nghiệp vụ; nếu chọn slice này, idempotency phải phát biểu theo số job/kết quả, không bịa side effect.

## Review giả định ban đầu của Codex

1. Đề xuất ban đầu: sử dụng export Board làm tác vụ dài. Bằng chứng: controller chờ `boards.create` trước khi trả HTTP và giới hạn tới 10.000 card/20 MiB. Quyết định: tiếp tục khảo sát export, nhưng không giả định job store hoặc progress đã tồn tại.
2. Đề xuất ban đầu: lưu kết quả trong RAM để dễ chạy. Bằng chứng: export có thể chứa dữ liệu riêng tư, cần recheck OWNER/session trước trả; có giới hạn 20 MiB mỗi kết quả. Quyết định: không coi cache RAM đơn giản là production-safe hoặc có tính bền vững; phải thiết kế giới hạn, vòng đời và kiểm tra quyền hoặc chỉ tuyên bố harness.
3. Đề xuất ban đầu: kiểm thử trùng notification cho mọi retry. Bằng chứng: luồng export chỉ đọc dữ liệu, không tạo notification. Quyết định: không khẳng định risk không áp dụng; kiểm thử trùng job theo contract được chọn.

## Việc tiếp theo

Khảo sát cách lưu trạng thái bền vững, truy cập và thu hồi quyền; xác định test seam có thể RED đúng hành vi; chạy baseline sau khi cài dependency. Chưa có test-first, implementation, mutation, benchmark, PDF hay PR; không có điểm số được xác nhận.

## Tiến độ môi trường

- `pnpm install --frozen-lockfile --offline`: thất bại vì thiếu tarball trong store; thử có mạng trong sandbox gặp ENOTFOUND; chạy lại có quyền mạng thành công. pnpm cảnh báo bỏ qua build scripts của @parcel/watcher, @scarf/scarf và argon2.
- `pnpm --filter @kanban/shared build`: exit 0, log `evidence/baseline-shared-build.txt`.
- Test baseline export đang chạy; chưa ghi kết quả khi chưa kết thúc.
- `docker version --format '{{.Server.Version}}'`: thất bại do Docker Desktop Linux engine không chạy. Chưa có PostgreSQL được chỉ định là môi trường test; không chạy migration.
- `docs/tasks/backend/p5-authorized-data-export.md` xác nhận export hiện tại không có background job, không có persistence và phải kiểm tra lại quyền trước trả file. Frontend có `BoardExportCard` và test liên quan, vì vậy giải pháp user-facing cần xét cả client, không thể coi API unit test là UI hoàn chỉnh.
- Ngoài export, attachment file có PENDING, idempotency key, lease và cleanup, nhưng cần khảo sát thêm trước khi lựa chọn vì chuyển luồng xác minh file sang background có rủi ro security và race.
- Hai lần chạy `pnpm --filter @kanban/backend exec jest --runInBand --runTestsByPath src/api/exports/exports.spec.ts` không xuất kết quả sau nhiều phút và đã được ngắt; **không có kết quả baseline test**. `pnpm --filter @kanban/backend exec jest --version` trả `29.7.0`. Điều tra nguyên nhân trước khi ghi test RED.
- `Test-NetConnection 127.0.0.1 -Port 5432` trả False. Không có database thử nghiệm được chỉ định.
- Chưa chốt slice, chưa có commit trên nhánh mới; kiểm tra lại trạng thái trước khi tiếp tục. Không dùng lại nhánh cũ.

## Checkpoint cập nhật — 12/11/2026

- Đã tìm và đọc đề chính thức `../lab/lab3/Yêu cầu.txt` từ thư mục học phần, cùng text toàn bộ 27 slide Lecture 06 và 28 slide Lecture 07 ở `../slide/`. Chưa xem hình/notes; chưa tìm thấy HTML VT-052. Ghi chú thiếu tài liệu phía trên là lịch sử khảo sát ban đầu, đã được thay thế bởi kết quả này.
- Chốt slice: Board export bất đồng bộ đầy đủ backend job + progress UI; xem `SPEC-PLAN.md` và `TEST-DESIGN.md`. Chưa có production patch.
- Baseline Jest chạy ngoài sandbox hoàn tất: 33/33 pass. Lượt đầu 126.38s; lượt lưu log 37.801s. Không thể kết luận hai lần ngắt trước đó là bug ứng dụng; quá trình transform/import tốn thời gian và quyền sandbox có thể ảnh hưởng. Log thật tại `evidence/baseline-export-tests.txt`.
- Test HTTP RED đã được viết trước implementation: `apps/backend/test/exports/async-export.e2e-spec.ts`; TC01 kỳ vọng 202/PENDING/ID. Guard được override bằng fixture, nên test này không chứng minh JWT/ACL. Session thực thi RED: 13302 (phải poll authoritative handle trước khi chạy lại).
- Chưa có migration, service, UI, mutation, performance, PDF hoặc PR. Không có điểm rubric được xác nhận.

- RED session 13302 terminal: exit 1, expected 202 versus actual 404, 1/1 test failed in 50.216s. `RED.md` reviews scope and weak oracles; `evidence/red-http.txt` preserves full output. Test-first commit is next; no production edits yet.
- Specification/test-design commit: `b6efdfa`.

## Vòng policy và môi trường test riêng

- Trước production policy: commit `a7bb5fa`, 12/12 RED (`evidence/red-policy.txt`). Sau patch: 12/12 GREEN (`evidence/green-policy.txt`), không sửa assertions. Xem `PATCH-REVIEW.md`.
- Docker Desktop đã khởi động qua `docker desktop start`; daemon 27.5.1. Container test riêng `vt054-23001908-postgres` ID prefix `7712b9e42f3a`, image `postgres:16.15-alpine3.24`, bind `127.0.0.1:55454`. Database administration test `vt054_test`, user postgres; host-auth trust chỉ dùng cho container local này. `pg_isready` trả accepting connections. Không dùng container phát triển `se2026-t13-postgres-1` hoặc Supabase.
- Baseline backend build đang chạy qua session 62459, log `evidence/baseline-backend-build.txt`; cần poll handle trước khi chạy lại. Sau build chạy existing exports.integration.mjs bằng local-only opt-in và DATABASE_* trỏ container 55454; script tạo/drop random database, không dùng vt054_test cho dữ liệu test.
- Bước tiếp: schema job + worker/service theo SPEC, persistence/HTTP retry tests và UI. HTTP TC01 vẫn thiếu endpoint; chưa có mutation/load/PDF/PR.

## Checkpoint schema/service

- Baseline backend build session 62459 terminal exit 0; log `evidence/baseline-backend-build.txt`.
- Baseline existing exports DB suite session 44374 terminal exit 1: expected 413, actual 503 EXPORT_TIMEOUT ở oversized fixture (line 652). Giữ failure log `evidence/baseline-export-database.txt`; chưa điều tra timeout xong, không sửa assertion hoặc coi pass.
- Schema contract RED: table chưa tồn tại, exit 1, `evidence/red-schema.txt`. Sau entity+migration build session 97114 exit 0 và cùng contract GREEN exit 0, unique/no drift xác minh. Database tạm đã drop bởi finally.
- `export-jobs.service.ts` mới là draft chưa kiểm chứng và chưa đăng ký module/controller; cần integration tests concurrency/retry/recovery, account cleanup inventory, worker và API. Không đánh dấu feature GREEN vì HTTP TC01 vẫn thiếu route.
- Không có tiến trình test/build đang chạy ở checkpoint này. Container PostgreSQL test 55454 vẫn sẵn sàng. Các file chưa commit phải kiểm tra qua git status trước tiếp tục.

## Backend service/API integration checkpoint

- `export-jobs.service.ts` và worker đã triển khai, đăng ký ExportsModule; bốn route mới thêm vào ExportsController với privacy middleware. Controller job service là dependency bắt buộc; fixture constructor test cũ được cập nhật, không đổi regression assertions.
- HTTP RED ban đầu đã GREEN trong focused run 3 suites/46 tests. Log `evidence/green-http-policy-regression.txt`. Full JWT HTTP/scheduler chưa chạy.
- Service PostgreSQL first run: các cases retry/claim/recovery/TTL pass, cuối cùng FAIL account cleanup giữ 3 jobs (`evidence/jobs-database-first.txt`). Thêm bảng vào eraseAccountPrivateState inventory; rerun `evidence/green-jobs-database.txt`: 7 groups pass.
- Build session 33499 exit 0 (`evidence/jobs-api-build.txt`). Lint focused lần đầu FAIL 2 no-undef Buffer trong integration harness (`evidence/jobs-focused-lint.txt`); đã thêm explicit node:buffer import; rerun session 51072 đang chạy, poll trước khi restart.
- Bước tiếp: xác nhận focused lint, thêm real JWT HTTP+worker journey; UI test-first theo skills; mutation, coverage/flaky và 120 distinct-task HTTP load; xử lý baseline oversized export timeout; báo cáo PDF và PR cuối cùng.
- Lint rerun session 51072 terminal exit 0, output rỗng (không lỗi): `evidence/jobs-focused-lint-fixed.txt`. Không còn tiến trình kiểm tra đang chạy tại thời điểm commit backend.

## HTTP/JWT và frontend test-first checkpoint

- Real AppModule JWT+worker+PostgreSQL integration: `async-export-http.integration.mjs`, 5 groups pass, log `evidence/jobs-real-http.txt`. Generator latch chứng minh 202 trước completion; kiểm tra raw response allowlist, privacy headers cả errors, JWT/member/isolation, failure/retry, OWNER revoke/session invalidation. Không browser E2E.
- UI progress test-first RED: 3 failed/3, log `evidence/red-ui-progress.txt`. Client workflow tests + seam chưa implement: reviewed RED 4 failed/4, log `evidence/red-ui-api-reviewed.txt`. Test oracle unhandled rejection đã sửa (xem RED.md); không hạ expected result.
- `useExportDownload.ts` và `ExportCard.tsx` hiện có draft hỗ trợ phase callback/visible message, chưa kiểm chứng và chưa commit. `async-export-api.ts` vẫn contract seam throw unsupported. BoardExportCard vẫn dùng sync API; chưa tích hợp async workflow.
- Skill kanvexa-ui và impeccable đã đọc. Impeccable context đã chạy một lần; craft-floor/harden đã đọc. Không cần init/redesign cho refinement nhỏ này. Sau UI hoàn thiện phải chạy detector một lần và visual QA desktop/mobile; chưa làm.
- Không có process build/test đang chạy tại checkpoint. Tiếp theo triển khai raw-JSON client helper/shared contract và async client workflow; giữ key qua retry và session isolation, nối BoardExportCard; chạy test GREEN và regression trước mutation/load/report.

## Async frontend implemented, pending browser QA/commit

- Current edits uncommitted: shared export job contract, backend mapper type import, raw JSON client helper, async API workflow, BoardExportCard integration, session cleanup and progress/status UI. Preserve these edits.
- Tests: reviewed initial focused 66/66, extra retry/abort regression 69/69 pass; active-timer cancellation API suite 6/6 pass. Build shared + frontend pass (frontend build preceded two small retry error-message/key-reset edits; final gates must rerun). Relevant evidence filenames in PATCH-REVIEW.md.
- Lint focused session 55390 running: poll handle before restart. Frontend dev server session 1361 live at http://127.0.0.1:4175/; do not start another on the same port. Detector already ran once and returned []; do not rerun mechanically without a new reason.
- Headless Chromium can launch via existing Playwright core at `D:/Project/market-manager/node_modules/.pnpm/playwright-core@1.62.0/node_modules/playwright-core`; browser version 151.0.7922.34. No dependency was added. node_repl import playwright failed, use a reproducible Node harness with createRequire and configurable module path. Browser itself has not yet visited the app.
- Next: add browser journey helper called by real HTTP integration before its owner/session revoke tests. It can use the test's token/Board fixture in memory and route browser API requests to that ephemeral real Nest server, forwarding responses rather than faking business data. Seed localStorage `kanban.session` with `{accessToken,expiresAt}`; proxy browser requests matching `http://localhost:3000/api/**` to the app's actual URL using route.fetch/fulfill (CORS headers for test origin). Hold the generator with latch to capture RUNNING; assert download; desktop/mobile light/dark screenshots. Read all screenshot artifacts before claiming QA. Then commit UI, move to mutation/coverage/flaky/load/report/full gates/push/PR.
- Lint session 55390 terminal exit 0, log rỗng (`evidence/ui-focused-lint.txt`). Chỉ dev server 1361 còn chạy; chưa có browser journey/screenshot. UI chưa commit để hoàn tất review browser trước commit.

## Browser QA resolved

- Browser harness initially failed download. Earlier reasoning about viewport remount was incomplete: even a fixed viewport failed. Diagnostic showed actual job COMPLETED and GET download 200, while owner list cache was cleared due Socket.IO network errors. Code evidence: board-realtime-client connect_error → connectionLost; access-revocation clears protected Board/Workspace snapshots. The REST-only forwarded test setup omitted the live realtime server.
- Corrected environment: production frontend rebuilt with VITE_API_BASE_URL=http://127.0.0.1:3009/api, AppModule listens test port 3009, test CORS allows preview origin 4176. REST and Socket.IO both connect to the same actual test application. No application security logic changed for this fix.
- Browser session 35332 terminal exit 0. 8 viewport/theme journeys pass, plus the 5 HTTP groups. Each has visible RUNNING, keyboard start, no page overflow and actual JSON download. Log `evidence/browser-direct.txt`. All 9 successful images manually inspected via view_image; `docs/design/screens/implementation/vt054-async-export/README.md` records scope and limitations. Failed logs retained; redundant mislabeled draft screenshots removed from own generated output, one failure image kept.
- Current frontend build artifact targets test port 3009; do not claim it as deployable configuration. Full repository build/final gates must run normally later. Current application source uses env defaults; no .env modified.
- Browser/HTTP processes terminal; dev server 1361 (4175) and preview 26179 (4176) remain live; PostgreSQL container remains live. UI and browser source/evidence remain uncommitted; next run focused lint over new harness, finalize commit, then mutation/coverage/flaky/load/PDF/PR. No score or completion claim yet.

- Final browser session 97075 terminal exit 0: 8 journeys + 5 HTTP groups pass (`evidence/browser-direct-final.txt`), actual data-theme asserted light/dark; corrected browser-results.json generated by this run. Browser focused lint session 28235 exit 0. No browser/test/build process remains active; dev server 1361 and preview 26179 still live.
- UI ready for commit together with shared contract and browser harness. Next required phases remain mutation on temporary branch, coverage/flaky repeats, 120 distinct-task performance (ack and completion separate), final suite/gates, traceability/AI usage/reflection/README/PDF, push/Draft PR and rubric audit. Do not treat 120 same-key retry checks as the required distinct-task performance experiment.

## Quality experiments checkpoint

- Temporary mutation branch created and deliberate mapping bug committed at `44f8c6f`; KILLED (CSV response assertion, 1 fail/11 pass). Returned to submission branch e30de97; 12/12 restored pass; bug commit not ancestor. See QUALITY-EXPERIMENTS.md and raw mutation logs/diff. Mapper source correct now; do not continue from mutation branch.
- Policy coverage 100/100 lines/branches. Native integration V8 summary converter added (uses existing transitive tool deps) and initial summary generated. Raw coverage lives under ignored apps/backend/coverage/vt054-v8-load.
- Three load attempts all FAIL; see quality report table and raw samples. Current load helper now uses native Node fetch; no implicit retry and no lowered 3500ms threshold. Next investigate error.cause/stage/port for fetch failures, request fan-out/keepalive and server/DB latency. Worker still polls one batch of 4 per 250ms; do not change it until measuring/targeting the bottleneck. No performance success yet.
- Flaky/coverage process session 40175 is running: two seeded Jest orders (23001908,54), then 3 service PostgreSQL repeats, stop on first failure. NODE_V8_COVERAGE for service repeats -> ignored apps/backend/coverage/vt054-v8-jobs. Poll handle before restart. After success summarize both V8 directories with summarize-export-coverage.mjs and record exact results. Quality backend build session 96500 exit 0.
- Mutation/coverage/quality docs, load helper, coverage converter, optional HTTP load integration and logs are uncommitted. Dev server 1361 and preview 26179 remain live; PostgreSQL test container remains live. Goal incomplete: performance unresolved, final gates, AI log/traceability/reflection/README/PDF, push/Draft PR and rubric audit still outstanding.

- Flaky process 40175 terminal exit 0: seeds 23001908 và 54 đều 45/45; 3 PostgreSQL repeats đều 7 groups pass. Coverage combined generated: service lines97.43/branches94, worker97.67/91.66, controller88.14/88.88, mapper100/100. Quality harness lint session80750 đang chạy; poll trước restart. V8 summaries/raw logs giữ đúng phạm vi, không suy diễn coverage toàn app.
- Quality harness lint 80750 terminal exit 0. Mutation/profiling/flaky evidence ready for commit. No quality test process active; only frontend dev/preview services remain. Performance investigation not complete; keep goal active.
