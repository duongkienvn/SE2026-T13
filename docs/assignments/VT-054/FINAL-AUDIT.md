# Kiểm tra trước khi nộp

- Baseline 5c20856ba4686bac472c2cdb26cbf6dc51e83c76, nhánh mới assignment/23001908-vt054-async-progress. Bản đối chiếu commit gồm spec, RED, patch, integration, UI, quality và worker tuning.
- pnpm lint và pnpm build exit 0. pnpm test exit 1. Log mặc định cho thấy một test auth backend vượt 5 giây, frontend 1.682 pass / 5 timeout. Lượt riêng backend dùng Jest --runInBand --testTimeout=20000 pass 119 suites / 1.297 tests. Kết quả chạy riêng ghi trong serial-gates.json, không ghi đè kết quả root.
- Root pnpm format:check exit 1. Trong lần chạy có 1.451 warning paths ngoài tracked feature diff. Định dạng phần bài được sửa và kiểm tra riêng, không format file ngoài phạm vi. Các log .txt chỉ được bỏ khoảng trắng cuối dòng/EOF để git diff --check và có thể đối chiếu với log trước đó trong lịch sử. Các JSON evidence chỉ được format lại.
- PostgreSQL feature schema, job service (7 nhóm) và HTTP/JWT (5 nhóm) pass với build cuối. Suite export cũ pass 8 nhóm rồi gặp 503 EXPORT_TIMEOUT ở Board giới hạn kích thước, kỳ vọng 200. Baseline từng gặp 503 ở case kỳ vọng 413. Hai kết quả đều được giữ, không sửa generator hoặc deadline của luồng đồng bộ để làm test xanh.
- Mutation 44f8c6f bị KILLED, commit cố ý chỉ ở nhánh mutation tạm. Mapper bản nộp dùng row.format. Không có migration chạy trên database phát triển/production.
- Bản PDF A4 cuối có 7 trang nội dung chính và 2 trang phụ lục. Chromium và Poppler dùng để kiểm tra từng trang. README gồm lệnh, phạm vi đo, traceability và nguồn evidence. Reflection có 307 từ theo đếm whitespace (không tính tiêu đề).
- PR tham khảo VT-053 #252 được khớp pull ref chính xác. Public API trả rate-limit 403 khi đọc metadata. GitHub CLI portable đã xác minh checksum nhưng phiên CLI chưa đăng nhập. Draft PR description được chuẩn bị sẵn.

Chạy riêng theo workspace hoàn tất: backend 119 suite / 1.297 test, frontend 160 file / 1.687 test, mobile 60 test Node và shared 20 test. Tất cả exit 0. Mobile script có bước Vitest bổ sung không tìm thấy test và exit 0, số 60 chỉ đến từ Node test. Log root timeout được giữ nguyên. Coverage Jest sau tối ưu: 13/13 pass, mapper 100% line/branch, worker 91,3% line và 66,66% branch trong test worker tập trung. Kết quả V8 trước tối ưu được ghi với phạm vi và thời điểm riêng.

Theo yêu cầu cuối của người nộp, phần tự chấm chỉ xuất hiện trong bàn giao, được bỏ khỏi PDF.
