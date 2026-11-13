# Test-first RED — execution record

Production baseline: `5c20856ba4686bac472c2cdb26cbf6dc51e83c76`; plan commit `b6efdfa`.

Command: `pnpm --filter @kanban/backend exec jest --runInBand --runTestsByPath test/exports/async-export.e2e-spec.ts --watchman=false`.

Result: exit 1; 1 suite failed, 1 test failed. Expected HTTP 202, received 404, assertion at test line 62. Nest boot and HTTP request succeeded; this is missing async endpoint behavior, not missing import/compilation. Full captured output: `evidence/red-http.txt`. pnpm additionally printed a misleading `Command "jest" not found` footer after Jest's failure output; the actual assertion above is the RED oracle. Baseline export suite independently passes 33 tests.

## Review test output (Codex self-review)

Keep: real Nest HTTP response and public response shape assertions. Modify in subsequent test-first cycle: add generator completion barrier, exact projection keys, stronger UUID pattern, retry/concurrency and fresh ACL/session cases. Reject: interpreting this one route test as evidence of idempotency or security. Guard override deliberately limits scope to authenticated contract routing. No production code has been edited at this checkpoint.

Prompt for next cycle: “Before implementing the job service, write retry/state/failure cases using controlled deferred work and exact response projection; preserve this 202 oracle. For persistence uniqueness/lease, add disposable PostgreSQL tests and do not treat mocks as proof.”

## Vòng test-first policy

Prompt self-directed thực tế: “Viết test trước cho exact response allowlist, state/progress mapping, CSV preservation và failed retry dưới 3 attempts/trước expiry. Dùng clock cố định; test không được coi là chứng minh database uniqueness.”
Output giữ: `export-job-policy.spec.ts`, 12 tests; seam `export-job-policy.ts` chỉ khai báo contract và throw unsupported. Chạy RED trước triển khai: `pnpm --filter @kanban/backend exec jest --runInBand --runTestsByPath src/api/exports/export-job-policy.spec.ts --watchman=false`; 12 failed/12, 26.976s, exit 1, log `evidence/red-policy.txt`. Thất bại ở mapper/retry chưa implement, không phải import/compile. Giới hạn: fixture thêm private columns kiểm tra allowlist nhưng không chứng minh query không tải bytes; sẽ cần kiểm tra repository/API thực tế.

Quyết định policy trước implementation: 3 attempts tối đa, job/result hết hạn sau 15 phút kể từ khi tạo; worker concurrency dự kiến 4. Running progress null, completed 100. Policy không tự reset attempt count và không tự động retry FAILED. Các giới hạn này chưa được benchmark.

## Real HTTP và UI test-first

- HTTP/JWT/worker integration mới dùng AppModule thật và PostgreSQL disposable: 5 groups pass (`evidence/jobs-real-http.txt`). Latch giữ generator cho tới sau response 202; route/private headers, validation/auth/member/isolation, fault/retry và authVersion/owner revocation được kiểm tra. Không coi đây là browser E2E.
- UI prompt thực tế: “Viết test trước cho visible queued/running/downloading announcement, disable khi đang xử lý; viết client workflow tests kiểm tra same-key retry, polling → download và abort/session error.”
- UI progress RED: 3 failed/3 vì thông báo vẫn generic/sr-only, không phải compile/import; log `evidence/red-ui-progress.txt`. Client workflow có seam throw unsupported, tests đang chờ kết quả session 45411. Chưa có implementation client workflow.
- Đã đọc kanvexa-ui và impeccable từ skill gốc (worktree không có impeccable vì skill không tracked). Context launcher chạy một lần, cho phép scoped existing refinement. DESIGN.md trong frontend là record Board cũ và không áp dụng cho settings; source components/tokens và settings spec là incumbent authority cho chỉnh sửa nhỏ. Không thay đổi global visual design.

- Client workflow RED lần đầu có 4 failed tests và 1 unhandled rejection do test trì hoãn quan sát assertion promise. Self-review sửa test để gắn fulfillment/rejection observer ngay, không đổi expected workflow. Lượt reviewed RED: 4 failed/4, không unhandled error (`evidence/red-ui-api-reviewed.txt`). Đây là lỗi test do AI sinh có evidence thật; log đầu giữ tại `evidence/red-ui-api.txt`.
