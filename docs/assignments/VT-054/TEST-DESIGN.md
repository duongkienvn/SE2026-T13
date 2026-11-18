# Risk-based test design — trước production patch

Prompt thực tế của Codex: “Thiết kế equivalence partitions từ AC1–AC5, chọn dữ liệu xác định, ≥10 cases, negative/failure paths và concurrency oracle. Không dùng test count hoặc mock calls làm bằng chứng database uniqueness.”

## Risks và levels

R1 (cao): retry/concurrent retry sinh nhiều job; unit kiểm tra canonical payload, PostgreSQL kiểm tra UNIQUE và claim, HTTP kiểm tra contract. R2 (cao): bytes riêng tư lộ sau revoke/session change; database/API và UI session test. R3 (cao): worker crash/failure để trạng thái sai; lease/recovery test và fault injection. R4 (vừa): response mapping sai; exact projection assertions và mutation. R5 (vừa): regression export cũ; 33 test baseline và database export suite. R6 (vừa): tải làm ack hoặc completion chậm; 120-worker HTTP experiment.

Browser E2E có giá trị cho journey start → running → download và failure → retry; không cần browser E2E cho mọi malformed UUID vì API validation có oracle rõ hơn. Unit với repository fake không chứng minh database concurrency. Load với generator giả lập không chứng minh export PostgreSQL production.

## Equivalence partitions và dữ liệu đại diện

UUID cố định cho fixtures mới: actor `1bc98bc9-13de-4da7-9027-78eaee006611`, board `291da68b-c50b-42cc-ad8d-3151ea006622`, key `39725ab4-df2b-4ffd-b048-1c2db7006633`. Đây là dữ liệu tổng hợp, không phải ID từ production.

| Partition                             | Valid?                    | Representative / lý do                              | Case       | Risk  |
| ------------------------------------- | ------------------------- | --------------------------------------------------- | ---------- | ----- |
| Request mới, OWNER, JSON/CSV          | Có                        | Hai format hợp lệ có representation khác            | TC01, TC12 | R4,R5 |
| Retry cùng payload/key                | Có                        | Cùng actor/board/format; mất ack                    | TC02       | R1    |
| Concurrent same key                   | Có                        | 120 request cùng tuple, đếm row và attempt          | TC03       | R1    |
| Key reused khác payload               | Không                     | Đổi json → csv, giữ actor/key                       | TC04       | R1    |
| Malformed identifier/key              | Không                     | `not-a-uuid`, thiếu key                             | TC05       | R4    |
| Không có session hợp lệ               | Không                     | Không token, expired, invalidated                   | TC06       | R2    |
| Không phải OWNER                      | Không                     | MEMBER, outsider, Workspace ADMIN                   | TC07       | R2    |
| PENDING/RUNNING                       | Có để poll, chưa download | Worker được giữ bằng deferred promise               | TC08       | R3,R4 |
| COMPLETED                             | Có                        | Buffer fixture biết trước và exact response keys    | TC09       | R1,R4 |
| FAILED                                | Có để xem/retry           | Generator throw lỗi chứa SQL giả, không lộ chi tiết | TC10       | R3    |
| Lease hết hạn                         | Có để recover             | Clock điều khiển, worker cũ completion tới muộn     | TC11       | R1,R3 |
| Kết quả expired / quyền revoked       | Không download            | TTL hết; OWNER bị demote trong lúc chạy             | TC13       | R2    |
| UI đang chạy/kết thúc/lỗi             | Có                        | Response trình tự xác định                          | TC14       | R3    |
| UI đổi session hoặc unmount           | Phải cleanup              | Response cũ tới muộn                                | TC15       | R2    |
| Independent valid operations dưới tải | Có                        | 120 key khác nhau, thêm retry                       | TC16       | R1,R6 |

## Test cases (planned, chưa coi là executed)

| ID   | Requirement/Risk | Level             | Precondition/Input                           | Expected                                                        | Priority |
| ---- | ---------------- | ----------------- | -------------------------------------------- | --------------------------------------------------------------- | -------- |
| TC01 | AC1/R4           | HTTP + service    | Valid OWNER request, generator blocked       | 202 + ID/status PENDING; không chờ file                         | P0       |
| TC02 | AC1,AC3/R1       | service + DB      | Retry khi pending và completed               | Cùng ID, một row; completed không chạy lại                      | P0       |
| TC03 | AC1/R1           | DB + HTTP         | 120 same-key calls                           | Một logical job, một active attempt, payload thống nhất         | P0       |
| TC04 | AC1/R1           | API + DB          | Cùng key khác format/board                   | 409, không sửa job trước                                        | P0       |
| TC05 | AC1/R4           | API negative      | Key/board malformed, unknown body field      | 400, không enqueue                                              | P1       |
| TC06 | AC1–3/R2         | API negative      | Missing/expired/invalidated token            | 401, không có dữ liệu job/bytes                                 | P0       |
| TC07 | AC1–3/R2         | DB/API negative   | MEMBER/outsider/admin không Board OWNER      | Quyền hiện hành được áp dụng; không tạo/trả job                 | P0       |
| TC08 | AC2/R3,R4        | service/API       | Pending → running, deferred generator        | Exact status projection, running indeterminate; download 409    | P1       |
| TC09 | AC2,AC3/R1,R4    | service/API       | Complete known JSON fixture                  | COMPLETED/100; bytes đúng; không lộ key/body qua status         | P0       |
| TC10 | AC2,AC4/R3       | fault integration | Generator throws; explicit retry             | FAILED sanitized; cùng ID, attempt count tăng đúng một lần      | P0       |
| TC11 | AC4/R1,R3        | DB/fault          | Lease expired, worker cũ trả muộn            | Reclaim được; stale attempt không overwrite result              | P0       |
| TC12 | AC3,AC5/R5       | regression        | JSON/CSV sync routes, account export         | Contract cũ giữ nguyên; đúng format tải async                   | P1       |
| TC13 | AC3/R2           | DB/API            | Revoke OWNER hoặc TTL trước download         | Không protected bytes; privacy headers                          | P0       |
| TC14 | AC5/R3           | UI + browser      | Start/poll/complete hoặc failure/retry       | Status đọc được, action phù hợp, retry dùng key cũ              | P1       |
| TC15 | AC5/R2           | UI                | Logout/session change/unmount trước response | Abort polling, bỏ kết quả cũ, không download                    | P0       |
| TC16 | NFR1/R1,R6       | load HTTP         | Warm-up rồi 120 unique tasks + retries       | Report p50/p95/max, errors, rows/attempts, ack/completion riêng | P1       |

## Review tests trước khi viết

Giữ exact payload/status assertions; sửa weak oracle “HTTP 202 là đủ” thành cả ID, trạng thái, timing barrier và số job. Bác bỏ sleep tùy ý để đợi background: dùng deferred promise/latch trong unit và poll có deadline trong integration. Không bắt service mock trả job rồi dùng đó làm bằng chứng idempotency thật. Các quyết định này do Codex self-review; chưa có human reviewer approval.
