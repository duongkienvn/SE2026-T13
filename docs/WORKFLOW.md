# Development Workflow

> Bản nháp để thống nhất cách làm việc trong repository. Chưa phải quy định cuối cùng; các điểm cần duyệt được ghi ở cuối tài liệu.

## 1. Mục đích và nguyên tắc

Workflow này áp dụng cho cả thành viên dự án và coding agent khi làm việc trong repository.

- Làm việc trong đúng thư mục repository mà người dùng chỉ định.
- Kiểm tra trạng thái hiện tại trước khi sửa và bảo toàn các thay đổi có sẵn.
- Thay đổi phải nhỏ, đúng phạm vi và phù hợp với kiến trúc hiện tại.
- Không tự suy đoán các quyết định ảnh hưởng đến scope, quyền truy cập, dữ liệu hoặc acceptance criteria.
- Không commit, push, merge hoặc thay đổi remote nếu chưa được yêu cầu rõ ràng.

## 2. Trước khi bắt đầu

Chỉ thực hiện kiểm tra đọc trước khi có phạm vi đủ rõ:

1. Xác nhận thư mục làm việc bằng `Get-Location` và `git rev-parse --show-toplevel`.
2. Kiểm tra branch, worktree và `git status --short`.
3. Đọc `AGENTS.md`, `README.md`, `docs/project-overview.md` và các tài liệu architecture liên quan.
4. Xem các skill trong `.agents/skills/`; chỉ dùng skill phù hợp với loại công việc.
5. Ghi rõ mục tiêu, phạm vi, file dự kiến thay đổi, phần ngoài phạm vi và các lệnh kiểm tra dự kiến.

Nếu còn quyết định quan trọng chưa rõ, phải hỏi người dùng trước khi triển khai. Với các quyết định có nhiều nhánh ảnh hưởng đến sản phẩm hoặc workflow, dùng `grill-me` để hỏi từng câu một; không tự chốt thay người dùng.

## 3. Thư mục làm việc và branch

- Mặc định làm việc trực tiếp trong thư mục repository người dùng đang mở, không tự chuyển sang hidden worktree.
- Chỉ dùng worktree khác khi người dùng yêu cầu hoặc xác nhận rõ.
- Tạo branch từ `main` hoặc từ base branch được người dùng chỉ định.
- Dùng prefix branch theo loại thay đổi: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`.
- Không checkout, reset, clean hoặc ghi đè lên thay đổi chưa được xác định rõ là của mình.
- Nếu worktree đang dirty, phải phân biệt thay đổi có sẵn với thay đổi do task hiện tại tạo ra trước khi sửa tiếp.

## 4. Thực hiện thay đổi

- Đọc code hiện tại trước khi chỉnh sửa.
- Giữ thay đổi trong đúng phạm vi task; không thêm dependency hoặc refactor không cần thiết.
- Tuân thủ các nguyên tắc trong `AGENTS.md` và tài liệu architecture.
- Shared package chỉ chứa type, contract, enum và event dùng chung; không đưa logic/backend-only vào đó.
- Nếu thay đổi architecture, domain terminology hoặc workflow, cập nhật tài liệu liên quan.
- Không tạo hoặc sửa source code khi một quyết định phạm vi quan trọng vẫn đang chờ người dùng xác nhận.

## 5. Kiểm tra và xác minh

Chạy kiểm tra theo mức độ phù hợp với thay đổi:

```text
pnpm lint
pnpm test
pnpm build
pnpm format:check
```

- Với thay đổi nhỏ, chạy targeted check trước rồi mới chạy các check tổng quát liên quan.
- Với documentation-only change, tối thiểu chạy `pnpm format:check` nếu môi trường cho phép.
- Với thay đổi có giao diện hoặc hành vi người dùng, phải thực hiện manual QA tương ứng.
- Ghi lại chính xác lệnh đã chạy và kết quả.
- Phân biệt lỗi do thay đổi hiện tại, lỗi môi trường và lỗi có sẵn; không gọi là “pass” nếu lệnh chưa thực sự chạy thành công.
- Nếu thiếu dependency, sai version Node/pnpm hoặc service chưa chạy, ghi rõ blocker thay vì tự sửa ngoài phạm vi.

## 6. Bàn giao trước khi commit

Trước khi commit, báo cáo ngắn gọn:

- branch và thư mục repository đang dùng;
- file đã thay đổi và phần ngoài phạm vi;
- trạng thái `git status`;
- các lệnh kiểm tra đã chạy và kết quả;
- lỗi có sẵn hoặc blocker môi trường;
- các giả định và câu hỏi còn mở.

Sau báo cáo, dừng để người dùng quyết định. Mặc định chưa commit, chưa push và chưa tạo pull request.

## 7. Commit, push và pull request

Chỉ thực hiện sau khi người dùng cho phép rõ ràng:

1. Kiểm tra lại diff và chỉ stage đúng file thuộc task.
2. Dùng Conventional Commit, ví dụ `feat: add shared domain contracts` hoặc `docs: define development workflow`.
3. Commit trên branch task, không commit trực tiếp lên `main`.
4. Chỉ push branch khi đã được cho phép.
5. Tạo pull request về `main`, kèm summary, phạm vi, validation và known issues.
6. Chờ CI, review tự động và human review; chỉ merge khi có quyền và được yêu cầu.

## 8. Decision record

Trong mỗi task, tách riêng bốn loại thông tin:

- **Facts:** điều đã kiểm tra được từ repository hoặc kết quả lệnh.
- **Assumptions:** giả định tạm thời để có thể tiếp tục.
- **Accepted decisions:** điều người dùng đã xác nhận.
- **Open questions:** điều cần người dùng quyết định trước khi triển khai.

## Các nguyên tắc đã được duyệt

1. Mặc định làm trực tiếp trong thư mục repository người dùng đang mở; không tự dùng hidden worktree.
2. Không sửa hoặc ghi đè thay đổi dirty trước khi xác định chúng thuộc về ai.
3. Sau khi hoàn tất sẽ dừng ở bước báo cáo; commit, push và PR chỉ làm khi bạn cho phép rõ ràng.
4. Khi thiếu thông tin ảnh hưởng đến scope, quyền hoặc acceptance criteria, hỏi từng câu một thay vì tự quyết.

Bốn nguyên tắc trên đã được người dùng xác nhận và là quy tắc áp dụng cho các task tiếp theo.
