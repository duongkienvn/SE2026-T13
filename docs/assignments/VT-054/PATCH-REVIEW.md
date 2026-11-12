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
