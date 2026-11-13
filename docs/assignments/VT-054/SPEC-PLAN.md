# VT-054 — Specification và kế hoạch trước implementation

## Nguồn và phạm vi

Sinh viên Vũ Quang Nam (23001908), APP-02, SE2026-T13. Baseline `5c20856ba4686bac472c2cdb26cbf6dc51e83c76`; nhánh `assignment/23001908-vt054-async-progress`.
Đã đọc `D:/TAI LIEU DAI HOC/NAM BON/SEM_1/SE/lab/lab3/Yêu cầu.txt` và toàn bộ text của 27 slide Lecture 06, 28 slide Lecture 07 từ OOXML. Chưa xem hình/notes của slide; HTML VT-052 chưa tìm thấy. Rubric cuối đề chính thức là 15/20/25/20/5/15. Mục 4 trong thân đề gộp 25 điểm, tương ứng test quality 20 + performance 5.

### Problem statement

Export Board hiện tại giữ HTTP request trong lúc tạo JSON/CSV, người dùng chỉ thấy thao tác tải đang chờ. Cần tách việc tạo export sang job bất đồng bộ, hiển thị trạng thái và cho phép retry khi mất phản hồi mà không tạo thêm job cho cùng thao tác. Tái sử dụng `BoardExportService.create`, không đổi nội dung file, quyền OWNER hoặc export account hiện có. Roadmap liên quan: DX-01; yêu cầu bài tập bổ sung vòng đời job cho Board export.

### Acceptance criteria

- AC1: OWNER với session hợp lệ gửi Board, format và UUID v4 idempotency key; nhận HTTP 202 và job ID trước khi export hoàn tất. Retry cùng user/key/payload trả cùng job, kể cả request đồng thời; payload khác trả 409.
- AC2: Người tạo job có quyền OWNER hiện hành đọc được trạng thái PENDING/RUNNING/COMPLETED/FAILED. Trạng thái phản ánh công việc thật; chỉ COMPLETED có progress 100, RUNNING là indeterminate. Lỗi công khai được sanitize.
- AC3: Kết quả COMPLETED tải đúng JSON/CSV qua kiểm tra OWNER và session mới; chưa xong trả conflict. Người khác, mất quyền, session invalid hoặc kết quả hết hạn không nhận bytes. Retry job đã hoàn tất không tạo lại kết quả.
- AC4: Khi xử lý lỗi, job chuyển FAILED; retry rõ ràng dùng cùng job ID, có giới hạn số lần, không tạo thêm job. Việc claim và completion cần bảo vệ bằng database conditional update/lease; tiến trình chết không khóa job mãi.
- AC5: Giao diện Board export hiển thị waiting/running/success/failure; retry giữ logical operation key, ngừng polling và bỏ dữ liệu khi logout, đổi session hoặc unmount. Export account và API tải đồng bộ hiện có vẫn hoạt động.

### Constraints và invariant

- NFR1: chạy 120 thao tác đồng thời, đo acknowledgement và end-to-end riêng; mục tiêu p95 <= 3500 ms, không suy diễn tải giả lập thành production.
- NFR2: UNIQUE(user_id, idempotency_key) và so sánh payload canonical; cùng logical operation chỉ có một job identity, một attempt được claim tại một thời điểm; completed attempt không bị retry phát lại.
- NFR3: PostgreSQL là nguồn trạng thái bền vững, không thêm Redis/queue dependency. Bytes export tối đa 20 MiB như hiện tại; có hạn lưu kết quả và số worker hữu hạn. Metadata key được giữ tới cleanup tài khoản để tránh reuse vô tình; dữ liệu bytes được dọn theo TTL.
- NFR4: truy cập kết quả phải recheck ACL/session; không log nội dung export; job mới phải vào inventory xóa dữ liệu tài khoản. Không tự chạy migration ngoài database test được chỉ định.

## Prompt lập kế hoạch thực tế (Codex self-directed, không phải xác nhận người dùng)

“Dựa trên ExportsController, BoardExportService, ExportSnapshot và P5-01, lập kế hoạch nhỏ cho Board export async. Bảo vệ OWNER/session, retry đồng thời, không dùng RAM làm nguồn trạng thái; test trước patch, đo 120 concurrency và phân biệt ack/completion. Liệt kê assumptions, files, risks và test cho từng bước.”

### Output / assumptions

A1. Tái sử dụng export hiện có; không phát notification vì source không có side effect đó.
A2. Cần bảng job riêng, khóa unique user/key, claim/lease và status projection allowlist; migration tường minh.
A3. REST polling đủ cho slice, không cần Socket.IO event mới.
A4. Giao diện hiện có cho phép thay Board request flow, giữ account flow.
A5. Test PostgreSQL cần môi trường local disposable; Docker hiện chưa chạy. Đây là prerequisite verification, không phải bằng chứng feature đúng.

### Kế hoạch và file dự kiến

1. Baseline focused export tests, lưu command/output/exit. Sau đó HTTP test trước production: POST job hiện trả 404, expected 202; không dùng compilation failure làm RED.
2. Viết tests contract/idempotency/failure/ACL và migration; tiếp tục giữ RED có ý nghĩa. Files: `apps/backend/test/exports/async-export.e2e-spec.ts`, test service trong feature exports; database harness trong `apps/backend/test/exports/`.
3. Entity, migration, job service/worker, controller và DTO trong `apps/backend/src/api/exports/`; đăng ký qua ExportsModule và database config hiện có. Dùng unique constraint và conditional claim, bytes không đi qua status mapper. Tests TC01–TC12.
4. Contract shared và Board export client/hook trong `packages/shared/src/` và `apps/frontend/src/features/settings/data-privacy/`. Test UI state/retry/session, TC13–TC16. Đọc UI skills trước sửa giao diện.
5. Mutation response state mapping trong nhánh tạm; lưu diff và baseline/mutant/restored logs. Đo coverage và repeat/order experiments.
6. HTTP load harness 120 operation + same-key retries, p50/p95/max/duplicates; dùng database local nếu có, ghi rõ mô phỏng nếu không.
7. README, traceability, AI log, reflection, PDF <=8 trang chính, kiểm tra render; full gates; push/Draft PR, không merge.

### Review độc lập theo bằng chứng (self-review)

| Đề xuất ban đầu                            | Repository evidence                                                                                                     | Quyết định                                                                   | Lý do                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Dùng cache RAM để giữ kết quả cho đơn giản | `ExportSnapshot` và P5-01 yêu cầu recheck quyền/session; mỗi export tới 20 MiB; AGENTS yêu cầu PostgreSQL authoritative | Bác bỏ RAM làm persistence; dùng job lưu bền và TTL                          | Restart và tải lớn làm cache mất kết quả hoặc tăng bộ nhớ; quyền có thể bị thu hồi |
| Bảo vệ duplicate notification trong export | `BoardExportService.create` chỉ mở read-only snapshot; không gọi notification publisher                                 | Sửa risk thành duplicate job/attempt/result; notification risk không áp dụng | Không tạo test giả cho side effect không tồn tại                                   |
| Chỉ thêm API, bỏ UI E2E                    | `BoardExportCard.tsx` đã có thao tác người dùng; AC yêu cầu hiển thị tiến trình                                         | Bác bỏ API-only làm đầy đủ; cần UI state và journey test                     | Unit/API không chứng minh người dùng quan sát tiến trình                           |

Chưa có implementation nào được chấp nhận. Các con số workload/TTL/worker trong design là contract cần test, chưa phải kết quả thực nghiệm.
