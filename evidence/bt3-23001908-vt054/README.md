# BT3 VT-054 — khảo sát ban đầu

Branch nộp bài: https://github.com/duongkienvn/SE2026-T13/tree/feat/bt3-23001908-vt054-async-progress. Model, test-first, mutation, benchmark mô phỏng và PDF đã được tạo.

- Repository: https://github.com/duongkienvn/SE2026-T13
- Branch: `feat/bt3-23001908-vt054-async-progress`
- Baseline: `c062cf1c2e2306be6cda68930f6bd509b2d80c68`, `main`, working tree sạch trước khi tạo branch.
- Node v22.23.4; pnpm 10.18.3. Hai bài giảng đã đọc phần văn bản của mọi slide, đề bài đã đọc đầy đủ.
- CodeGraph được chỉ dẫn vì `.codegraph` tồn tại, nhưng lệnh `codegraph` không có trong PATH và không có MCP tool tương ứng.

## Prompt và kế hoạch ban đầu của AI

Prompt chính là [prompt-original.txt](prompt-original.txt), bản sao nguyên văn của yêu cầu người dùng; mục 3–6 yêu cầu khảo sát export và notification, chọn vertical slice, lập specification và plan trước code, review bằng repository, rồi viết test trước patch.

Đề xuất ban đầu để review: thêm job export mới, trả ID và trạng thái ngay; xử lý export ở background, cung cấp endpoint theo dõi và tải kết quả; tái sử dụng `BoardExportService`; dùng idempotency key để retry không tạo job trùng. Viết test unit/API trước, kiểm tra RED, sau đó bổ sung implementation; kiểm tra quyền khi tạo và lấy kết quả; chạy focused Jest, regression và các gate của repository. Các giả định còn chưa xác nhận: lưu trữ job và lifecycle có thể triển khai đủ nhỏ; môi trường có PostgreSQL test được chỉ định; client có thể quan sát trạng thái.

## Review dựa trên repository

1. Plan ban đầu có nói kiểm tra quyền khi lấy kết quả, nhưng chưa nêu kiểm tra session hiện tại và thời điểm công bố file. `apps/backend/src/api/exports/exports.controller.ts` kiểm tra lại OWNER và session sau khi tạo buffer, ngay trước khi gửi. Sửa plan: job phải giữ kiểm tra mới này khi phát hành dữ liệu, kể cả khi quyền hoặc phiên bị thu hồi trong thời gian chờ.
2. Plan ban đầu đề xuất idempotency key nhưng chưa xác định cách duy trì tính duy nhất hoặc xử lý sự cố qua nhiều process. `apps/backend/src/api/notifications/task-email-outbox.ts` dùng `ON CONFLICT` trong transaction; `task-email-dispatcher.service.ts` dùng lock/lease và phân biệt kết quả UNKNOWN. Sửa plan: key đơn lẻ hoặc map trong bộ nhớ không chứng minh uniqueness và retry an toàn xuyên process; giải pháp production cần persistence, transaction, lifecycle và kiểm tra PostgreSQL thực. Đây là điểm thiếu của plan, không phải khẳng định plan ban đầu đã đề xuất map. Nếu không thể xác minh an toàn trong phạm vi, dùng phương án harness được đề cho phép và mô tả giới hạn.

`docs/tasks/backend/p5-authorized-data-export.md` mô tả export hiện hành không có background job, persistence hoặc storage, và có giới hạn file, authorization và deadline. Hai lựa chọn đã xem xét: (1) API export bất đồng bộ bền vững, cần nhiều thay đổi về lưu trữ/lifecycle và xác minh DB; (2) characterization/harness cách ly trên export gần nhất theo phương án dự phòng của đề, không chứng minh đã có chức năng product. Đã chọn phương án (2).

## Baseline và chẩn đoán Jest

Đã khởi chạy `pnpm --filter @kanban/backend test -- --runTestsByPath src/api/exports/exports.spec.ts` và `pnpm --filter @kanban/backend exec jest --runInBand --runTestsByPath src/api/exports/exports.spec.ts --silent`; các lệnh chưa trả kết quả tại thời điểm ghi. Không xem chúng là pass. PostgreSQL integration đòi hỏi server local được chỉ định rõ; chưa chạy và chưa có bằng chứng môi trường đáp ứng. Không chạy migration hoặc tải lên production.

Các lệnh Jest chạy thử ban đầu bị ngắt thủ công; exit code 1 do ngắt, không phải test failure được chẩn đoán. Lần chạy `--no-cache` sau đó cho thấy EPERM khi Jest rename file cache trong sandbox. Chuyển cache vào workspace và chờ đủ lâu: suite export pass 33/33; `export-regression.txt` ghi lần chạy lại trên source không đổi so với baseline.

## Milestone và cách chạy

- Chốt phương án dự phòng: model job export cách ly, không kết nối ứng dụng, database hay UI. Chi tiết và 12 test case: [specification.md](specification.md).
- Bổ sung [export-characterization.test.mjs](export-characterization.test.mjs): model gọi trực tiếp `csvRow` từ source export hiện có với dữ liệu tổng hợp, retry cùng key chỉ gọi một lần và output CSV đúng; [export-characterization.txt](export-characterization.txt) ghi 1 test pass. Test này chỉ kết nối serializer, không chạy `BoardExportService`, API, database hoặc xác thực thật.
- [export-service-characterization.test.mjs](export-service-characterization.test.mjs) gọi `BoardExportService.create` thật với repository/snapshot giả: CSV rỗng cho OWNER, một lần gọi sau retry và FAILED với MEMBER. [export-service-characterization.txt](export-service-characterization.txt) ghi 2 test pass; không phải PostgreSQL, HTTP hoặc kiểm tra session trước khi phát hành file.
- [order-isolation.test.mjs](order-isolation.test.mjs) chạy hai kịch bản thành công/thất bại theo cả hai thứ tự trong một process, dùng lại cùng user/key trên các instance model riêng. [order-isolation.txt](order-isolation.txt) ghi kết quả pass; phép thử không hoán đổi thứ tự toàn suite.
- Test-first: [red.txt](red.txt) ghi T01 fail đúng assertion trước patch; [green.txt](green.txt) ghi 9 test pass sau patch. [coverage.txt](coverage.txt) chỉ đo file model. [repeat.txt](repeat.txt) ghi ba lần lặp pass.
- Mutation ban đầu được ghi trong [mutation.txt](mutation.txt). Sau review, thí nghiệm được lặp và lưu tại [commit mutation riêng](https://github.com/duongkienvn/SE2026-T13/commit/9eb2be3cbe0f51e3b4a03327e44e6c8664d8cb3a): chỉ đổi `status: job.status` thành `status: job.board`; T01 fail. [mutation-commit-diff.txt](mutation-commit-diff.txt) và [mutation-commit-run.txt](mutation-commit-run.txt) ghi diff và kết quả. Nhánh nộp giữ mapping đúng.
- Performance: [performance.txt](performance.txt) đo 120 job giả; không có bằng chứng production. Báo cáo và các giới hạn: [report.md](report.md) và [BT3_23001908_VT-054.pdf](BT3_23001908_VT-054.pdf).
- Chuẩn bị từ repository root (Node >= 22.13, pnpm 10.18.3): cài dependencies theo lockfile nếu checkout chưa có, sau đó build shared package. Test service cần `@kanban/shared/dist`, không được Git theo dõi.

```powershell
pnpm install --frozen-lockfile
pnpm --filter @kanban/shared build
```

- Các lệnh kiểm thử từ repository root:

```powershell
node --test evidence/bt3-23001908-vt054/job-model.test.mjs
node --test evidence/bt3-23001908-vt054/export-characterization.test.mjs
node --test evidence/bt3-23001908-vt054/export-service-characterization.test.mjs
node --test evidence/bt3-23001908-vt054/order-isolation.test.mjs
node --test --experimental-test-coverage '--test-coverage-include=**/job-model.mjs' evidence/bt3-23001908-vt054/job-model.test.mjs
node evidence/bt3-23001908-vt054/performance.mjs
```

Để tái lập mutation, làm việc trên một nhánh tạm, đổi đúng mapping `status` trong `job-model.mjs` sang `job.board`, chạy `node --test --test-name-pattern=T01 evidence/bt3-23001908-vt054/job-model.test.mjs`, sau đó khôi phục mapping và chạy lại test. Không để mutation trong branch nộp. Giữ bản sao các thay đổi cá nhân trước khi chuyển nhánh.

Môi trường: Windows, Node v22.23.4, pnpm 10.18.3. Docker engine không kết nối; không có PostgreSQL test được chỉ định. Không chạy migration hoặc production benchmark. Không có API, durable queue, download, phân quyền thật, thử nghiệm PostgreSQL, browser, hay production p95 trong model. Không khẳng định chúng đã được triển khai hoặc xác minh.

Git: lần thử trước, `git add` / local commit bị sandbox từ chối và yêu cầu escalated bị auto-review từ chối. Người dùng sau đó đã xác nhận quyền ghi Git và commit cục bộ. Tại lúc lập báo cáo chưa push, tạo PR hoặc merge; người dùng cần xem lại bằng chứng và cho phép riêng trước khi push hoặc tạo PR.

Các log ban đầu bị `.gitignore` loại trừ theo `*.log`. Các bản `.txt` là bản sao đã so hash của log gốc và có thể được Git theo dõi; các liên kết ở đây trỏ đến bản sao đó.

Lần kiểm tra kết hợp sau khi thêm characterization: [verification-update.txt](verification-update.txt), 10 test pass, exit 0.

Lần kiểm tra kết hợp sau khi thêm order/isolation: [verification-order.txt](verification-order.txt), 11 test pass, exit 0.

Lần kiểm tra sau khi thêm service characterization: [verification-service.txt](verification-service.txt), 13 test pass, exit 0.

[completion-audit.md](completion-audit.md) đối chiếu từng mục rubric với evidence và nêu rõ baseline test pass được ghi sau patch model, cùng những phần chưa được chứng minh hoặc chưa thể nộp.

Kiểm tra cuối: `node --test evidence/bt3-23001908-vt054/job-model.test.mjs` pass 9/9 sau khôi phục mutation và format ([final-checks.txt](final-checks.txt)); `pnpm exec prettier --check 'evidence/bt3-23001908-vt054/*.{md,mjs}'` pass. `pnpm format:check` exit 2, báo 1.211 file; kiểm tra riêng các file Markdown/JavaScript của bài pass, các cảnh báo khác thuộc checkout có sẵn. `git diff --check` pass nhưng không kiểm tra file chưa được Git theo dõi. Không chạy `pnpm lint`, `pnpm test`, `pnpm build` toàn workspace vì không sửa code ứng dụng; không khẳng định CI pass.
