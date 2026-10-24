# Backend Authentication và User Profile

Authentication MVP dùng JWT access token stateless. Access token được ký bằng HS256, có TTL 3600 giây, issuer `kanban-api`, audience `kanban-web` và secret bắt buộc từ `JWT_SECRET` (tối thiểu 32 byte). Password được hash bằng Argon2id.

## API

| Method | Endpoint             | Auth       | Kết quả                                           |
| ------ | -------------------- | ---------- | ------------------------------------------------- |
| POST   | `/api/auth/register` | Public     | `201`, public `UserResponseDto`; không phát token |
| POST   | `/api/auth/login`    | Public     | `200`, access token và public user                |
| POST   | `/api/auth/logout`   | Bearer JWT | `204`, không có body                              |
| GET    | `/api/users/me`      | Bearer JWT | `200`, public user                                |
| PATCH  | `/api/users/me`      | Bearer JWT | `200`, public user sau persist                    |

Success responses dùng envelope chung `{ success, statusCode, message, data }`. Error responses dùng global filter; duplicate email là `409 EMAIL_ALREADY_EXISTS`, credentials sai là `401 INVALID_CREDENTIALS`, token không hợp lệ là `401 UNAUTHORIZED`.

Register normalize email bằng trim/lowercase, giữ nguyên password trước khi hash, và whitelist `email`, `password`, `displayName`. Profile chỉ cho phép `displayName` và `avatarUrl`; avatar URL phải là HTTPS hoặc `null` để xóa. Unknown fields bị global validation pipe từ chối.

Từ Issue #76, password đăng ký phải dài 8–128 ký tự, có ít nhất một chữ hoa
ASCII `A–Z`, một chữ số ASCII `0–9` và một punctuation/symbol Unicode. Không
bắt buộc chữ thường; whitespace được phép nhưng không tính là ký tự đặc biệt.
Chỉ registration mới áp dụng policy này. Login của tài khoản cũ giữ nguyên;
không thay đổi password hash hoặc vô hiệu hóa tài khoản có mật khẩu yếu hơn.
Xem [registration password policy](../auth-registration-password-policy.md)
cho chi tiết validation và verification.

Login giới hạn 10 requests/60 giây/IP; register giới hạn 5 requests/300 giây/IP. Rate limit là in-memory theo process và không dùng `X-Forwarded-For` khi server chưa cấu hình trusted proxy.

Logout chỉ xác nhận request có JWT hợp lệ. Server không tạo session, refresh token, blacklist hoặc revoke token; access token đã phát vẫn hợp lệ đến `exp`. Frontend phải xóa token và auth state ngay cả khi logout request thất bại.
