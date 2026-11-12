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
