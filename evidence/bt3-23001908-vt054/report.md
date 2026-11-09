# BT3 — APP-02 — VT-054

Vũ Quang Nam — MSSV 23001908 — Team SE2026-T13  
Repository: https://github.com/duongkienvn/SE2026-T13  
Baseline: `c062cf1c2e2306be6cda68930f6bd509b2d80c68`  
Branch local: `feat/bt3-23001908-vt054-async-progress`. Chưa push, chưa có link branch/PR nộp được.

“Tôi chịu trách nhiệm về toàn bộ code, test và nội dung bài làm; tôi đã khai báo việc sử dụng AI.”

## 1. Specification và plan

Export hiện đồng bộ nên không có trạng thái job cho người dùng theo dõi. Theo điều khoản dự phòng trong đề, bài thực hiện một model chạy được, cách ly, với exporter giả thay vì sửa API đang dùng. Các AC cho model: (1) submit trả QUEUED trước khi xong, sau đó có RUNNING/COMPLETED; (2) cùng user/key/input trả cùng job và chỉ gọi exporter một lần, khác input báo conflict; (3) lỗi trả FAILED không lộ exception, retry cùng key không chạy lại; (4) chỉ owner đọc được job, input sai hoặc job không tồn tại bị từ chối. Không suy diễn phần trăm tiến độ.

Invariant chỉ trong một tiến trình: một cặp user/key tương ứng tối đa một input và một lần gọi. Không chứng minh tính bền vững hoặc phân quyền production. Hai constraints: không thêm dependency, không đụng database/service thật; phép đo 120 job có p95 mục tiêu ≤3,5 giây nhưng mô phỏng không chứng minh hiệu năng production. Phạm vi, assumptions và hai điểm review plan được lưu trong README và specification. Evidence: controller export xác thực lại trước khi gửi; outbox dùng transaction và unique conflict, nên model bộ nhớ không được trình bày như giải pháp bền vững.

## 2. Test strategy và equivalence partitioning

Specification chứa bảng 12 case T01–T12, priority và mức unit. Phân lớp theo user/key/board hợp lệ hoặc rỗng/sai kiểu, quan hệ request trùng hoặc khác input, owner/khác owner, và operation thành công/thất bại. Mỗi lớp có đại diện. Chuỗi rỗng đồng thời là biên của quy tắc nonempty; EP phân nhóm hành vi, còn BVA tập trung giá trị tại và sát biên. T06, T09–T11 là negative; T08 là failure-path retry. Integration PostgreSQL cần kiểm tra unique constraint khi nhiều transaction và revoke quyền khi phát hành. API và E2E không thể kiểm chứng trên model không có API/UI; không khẳng định đã chạy.

| ID / level | Risk        | Input / điều kiện      | Expected / priority      |
| ---------- | ----------- | ---------------------- | ------------------------ |
| T01 unit   | async       | operation đang chờ     | QUEUED; cao              |
| T02 unit   | status      | operation đã bắt đầu   | RUNNING; cao             |
| T03 unit   | contract    | operation hoàn thành   | COMPLETED; cao           |
| T04 unit   | retry       | trùng trước hoàn thành | cùng ID; cao             |
| T05 unit   | retry       | trùng sau hoàn thành   | một lần gọi; cao         |
| T06 unit   | conflict    | cùng key, board khác   | từ chối; cao             |
| T07 unit   | isolation   | user khác, cùng key    | ID khác; cao             |
| T08 unit   | failure     | lỗi rồi gửi lại        | FAILED, một lần gọi; cao |
| T09 unit   | isolation   | user khác đọc          | not found; cao           |
| T10 unit   | input       | ID không tồn tại       | not found; cao           |
| T11 unit   | input       | rỗng hoặc null         | từ chối; vừa             |
| T12 unit   | concurrency | 120 request cùng key   | một ID/call; cao         |

## 3. Test-first và mutation

T01 được viết trước patch, với scaffold trả `NOT_IMPLEMENTED`: RED exit 1 vì assertion kỳ vọng `QUEUED`, không phải lỗi import/setup. Sau patch, `node --test .../job-model.test.mjs` GREEN 9 test, gồm 12 case. File `red.txt`, `green.txt` lưu thời gian/lệnh/kết quả. Export thật không thay đổi: Jest suite `exports.spec.ts` pass 33 test khi chuyển cache vào workspace; lần dùng cache mặc định thất bại EPERM khi rename. Lượt pass được ghi sau patch model trên source ứng dụng không đổi, nên là regression chứ không phải baseline pass được ghi trước patch.

Characterization bổ sung chạy model với `csvRow` thật từ `apps/backend/src/api/exports/export-csv.ts`: một job và retry cùng key tạo đúng một dòng CSV, bao gồm xử lý chuỗi bắt đầu bằng dấu bằng; 1 test pass (`export-characterization.txt`). Chỉ serializer được gọi trực tiếp, không đi qua service, HTTP hay database.

Mutation trên nhánh tạm `feat/bt3-23001908-vt054-mutation`: tại `job-model.mjs`, đổi `status: job.status` thành `status: job.board`. T01 fail với actual `board-1`, expected `QUEUED`; mapping đã khôi phục và nhánh bài tập đã được checkout lại. Vì test và code lúc này chưa được commit, nhánh tạm không lưu mutation thành commit; `mutation.txt` ghi kết quả thực thi. Lưu ý này giới hạn khả năng truy vết lại từ Git.

## 4. Coverage, flaky và performance

Node coverage cho riêng `job-model.mjs`: line 100%, branch 100%, function 100%; đây không phải coverage toàn repository. Các AC model được T01–T12 bao phủ, nhưng chưa có bằng chứng database, multi-process, restart, crash, network hoặc quyền thật. Các test tạo model mới mỗi case, dùng promise điều khiển và `setImmediate` thay sleep cố định cho state transition; ba lần chạy lại đều 9/9 pass. Test `order-isolation.test.mjs` chạy thành công rồi thất bại và ngược lại, cùng user/key trên các instance model riêng trong một process; test pass. Điều đó kiểm tra một nguy cơ timing và state/order, chưa hoán đổi toàn suite hay chứng minh không flaky. T12 dùng Promise.all trong một event loop, không phải race giữa process/database.

Performance: Windows x64, Node v22.23.4; host i5-1340P, 16 logical CPU, 15,7 GiB RAM theo metadata thu sau benchmark. Một user tổng hợp gửi 120 job khác key và board; exporter giả chờ timer 10 ms, không có HTTP, database, payload hoặc mạng. Đo từ submit đến khi thấy terminal status; nearest-rank p50 11,724 ms, p95 11,856 ms, lỗi 0/120. Kết quả mô phỏng nhỏ hơn 3.500 ms; production p95 chưa được xác nhận. Xem `performance.mjs`, `performance.txt`, `environment.txt`.

## 5. Traceability và AI trust review

| AC / risk           | Cases        | Evidence file                                | Kết quả                                |
| ------------------- | ------------ | -------------------------------------------- | -------------------------------------- |
| AC1 trạng thái      | T01–T03      | `job-model.test.mjs`, `red.txt`, `green.txt` | RED rồi GREEN model                    |
| AC2 trùng/conflict  | T04–T07, T12 | `job-model.test.mjs`, `green.txt`            | pass model, không chứng minh DB        |
| AC3 failure/retry   | T08          | `job-model.test.mjs`, `green.txt`            | pass model                             |
| AC4 isolation/input | T09–T11      | `job-model.test.mjs`, `green.txt`            | pass model, không chứng minh auth thật |
| response mapping    | T01          | `mutation.txt`                               | phát hiện mutation                     |

Tại lúc lập báo cáo chưa có commit hoặc PR; lần thử trước, bộ kiểm duyệt từ chối ghi commit cục bộ. Người dùng sau đó xác nhận quyền commit; xem lịch sử Git để xác định commit thực tế. Hai điều cần challenge: (1) Map và Promise.all có vẻ chứng minh idempotency nhưng tất cả thao tác cùng process, không kiểm chứng database, restart hay worker khác. (2) Kiểm tra trạng thái và giả lập timer có vẻ cho thấy tiến độ và hiệu năng, nhưng không đi qua HTTP/JWT hoặc export thật; coverage cao không bù các khoảng trống này.

## 6. Reflection

Confidence tăng trước hết vì test được chạy trước patch và thất bại tại assertion trạng thái mong đợi, sau đó cùng test chạy thành công. Thí nghiệm đổi mapping cho thấy assertion thực sự phát hiện được ít nhất một sai lệch response cụ thể. Test failure path cũng xác nhận trong model rằng một lần gọi exporter bị lỗi không tự tạo lần gọi thứ hai khi gửi lại cùng key. Ba lần chạy lại và dữ liệu kiểm soát giúp giảm một phần nghi ngờ về timing và trạng thái dùng chung. Suite export hiện có chạy qua 33 test trên source không thay đổi, giúp kiểm tra rằng công việc cách ly không sửa API đó.

Tuy nhiên, tất cả bằng chứng chức năng mới đều thuộc model trong bộ nhớ. Promise.all trên một event loop không tái hiện hai transaction cạnh tranh. Không có bằng chứng rằng khóa idempotency tồn tại sau restart, rằng nhiều instance không tạo trùng, hoặc rằng quyền Board và phiên được kiểm tra lại trước khi phát hành dữ liệu. Timer giả không đo truy vấn PostgreSQL, mạng, serialization hay thời gian xuất Board thực. Tỷ lệ coverage 100% chỉ mô tả file model và không xác nhận các rủi ro bên ngoài phạm vi này.

Test có giá trị tiếp theo là một integration test trên PostgreSQL test được chỉ định, cho hai request cùng key chạy đồng thời qua API thực, rồi kiểm tra constraint, số job và quyền sau khi bị thu hồi. Điều đó cần implementation bền vững và thiết kế lifecycle được review trước. AI hỗ trợ phân tích plan, sinh test và model, nhưng người thực hiện vẫn phải đọc diff, đối chiếu log và tự giải thích mọi assertion. Đặc biệt, AI không thể biến mock thành bằng chứng về giao dịch thật hoặc tự nhận kết quả production.

## Phụ lục: AI Usage Log

- Công cụ: OpenAI Codex. Prompt chính là yêu cầu BT3 VT-054 của người dùng, nhấn mạnh khảo sát repo, test trước code, mutation response và bằng chứng thực.
- Output dùng: plan ban đầu, test Node, model cách ly, bảng EP và tài liệu. Evidence: `README.md`, `specification.md`, test và các log trong thư mục này.
- Output điều chỉnh sau review: kế hoạch lưu job/response export phải bảo vệ kiểm tra quyền lúc phát hành; ý tưởng map không đủ để tuyên bố chống trùng qua process. Hai quyết định có đường dẫn source trong README.
- Giới hạn: người dùng phải tự review và chịu trách nhiệm về nội dung; không có bằng chứng đã có human review, PR hoặc CI.

## Phụ lục: trích evidence thực thi

- RED `node --test --test-name-pattern=T01 .../job-model.test.mjs`: exit 1, `actual: NOT_IMPLEMENTED`, `expected: QUEUED` ([red.txt](red.txt)).
- GREEN `node --test .../job-model.test.mjs`: exit 0, 9 pass, 0 fail ([green.txt](green.txt)). Sau khi hoàn nguyên mutation và format, chạy lại 9 pass, 0 fail ([final-checks.txt](final-checks.txt)).
- Mutation `status: job.board`: T01 exit 1, `actual: board-1`, `expected: QUEUED` ([mutation.txt](mutation.txt)).
- Regression export: 33 pass, 0 fail, exit 0 ([export-regression.txt](export-regression.txt)); coverage model và ba lần lặp ở [coverage.txt](coverage.txt), [repeat.txt](repeat.txt).
- Thứ tự/isolation: chạy hai kịch bản theo cả hai thứ tự, 1 test pass ([order-isolation.txt](order-isolation.txt)); không kiểm tra mọi hoán vị của toàn bộ suite.
- Mô phỏng 120 job: p50 11,7235 ms, p95 11,8558 ms, 0 lỗi, Node v22.23.4, Windows ([performance.txt](performance.txt)).
