# Task Documentation

Tài liệu task được chia theo phần chịu trách nhiệm để dễ tìm và review:

- [`backend/`](backend/) chứa API, persistence, authorization và realtime phía
  server.
- [`frontend/`](frontend/) chứa UI, client integration, responsive behavior và
  realtime phía trình duyệt.

Các task records ghi lại phạm vi, quyết định và kết quả tại thời điểm thực hiện;
không phải danh sách trạng thái release hiện tại. Xem [project overview](../project-overview.md)
cho MVP đã triển khai và [Post-MVP roadmap](../roadmap/post-mvp.md) cho phạm vi
đã duyệt tiếp theo. Mục lục dưới đây liệt kê toàn bộ task documents hiện có.

## Quy tắc đặt tài liệu

- Thư mục `docs/tasks/` chỉ chứa file `README.md` này. Không tạo task document
  trực tiếp ở thư mục gốc.
- Đặt tài liệu trong `backend/` khi phần chịu trách nhiệm chính là API, domain
  rules, authorization, persistence, migration, mail hoặc server-side realtime.
- Đặt tài liệu trong `frontend/` khi phần chịu trách nhiệm chính là UI, browser
  behavior, responsive/accessibility, client state hoặc frontend realtime.
- Với task liên quan cả hai phía, đặt một task record tại nơi có phần triển khai
  chính và liên kết tài liệu phía còn lại nếu cần; không nhân bản cùng một record.
- Dùng tên file kebab-case và cập nhật mục lục này cùng mọi liên kết khi tạo,
  di chuyển hoặc đổi tên tài liệu.

## Backend tasks

- [Backend foundation](backend/backend-foundation-pr-description.md)
- [Authentication](backend/backend-authentication.md)
- [Registration password policy](backend/auth-registration-password-policy.md)
- [Email verification](backend/email-verification.md)
- [Google Sign-In and account linking](backend/google-auth-account-linking.md)
- [User preferences API and persistence](backend/user-preferences.md)
- [Password recovery and account security](backend/password-recovery-security.md)
- [Verification email layout](backend/verification-email-layout.md)
- [Board management API](backend/board-management-api.md)
- [Board archive management](backend/board-archive-management.md)
- [Board members management](backend/board-members-management.md)
- [Column management API](backend/column-management-api.md)
- [Card management API](backend/card-management-api.md)
- [Archived cards management and restore](backend/card-archive-restore.md)
- [Realtime foundation](backend/realtime-foundation.md)
- [Realtime board events](backend/realtime-board-events.md)
- [Board presence backend](backend/board-presence.md)
- [Comments API](backend/comments-api.md)
- [Comment realtime synchronization](backend/comment-realtime.md)
- [Activity core and read API](backend/activity-core.md)
- [Activity integration with business mutations](backend/activity-integration.md)

## Frontend tasks

- [Frontend application foundation](frontend/frontend-foundation.md)
- [Kanvexa branding](frontend/kanvexa-branding.md)
- [Frontend authentication](frontend/frontend-auth.md)
- [Authentication integration with the real backend](frontend/frontend-auth-integration.md)
- [Google Sign-In UI polish](frontend/google-sign-in-ui-polish.md)
- [Frontend compact layout](frontend/frontend-compact-layout.md)
- [Boards and board members frontend](frontend/boards-frontend.md)
- [Kanban board UI](frontend/kanban-board-ui.md)
- [Card permalinks and route-linked detail](frontend/card-permalinks.md)
- [Realtime frontend synchronization](frontend/realtime-frontend.md)
- [Board presence frontend](frontend/board-presence.md)
- [Card comments UI](frontend/comments-ui.md)
- [Activity History frontend](frontend/activity-history.md)
- [Sidebar navigation and board creation UX](frontend/app-navigation-board-ux.md)
- [Public landing page](frontend/public-landing-page.md)
- [App Shell V2 and responsive navigation](frontend/app-shell-v2.md)
- [Account Settings, Appearance and Preferences](frontend/account-settings-appearance.md)

## Quy ước

- Không đặt screenshot trong `docs/tasks/`. Ảnh thiết kế mẫu nằm trong
  [`../design/screens/reference/`](../design/screens/reference/); ảnh chụp giao
  diện thực tế nằm trong
  [`../design/screens/implementation/<task-slug>/`](../design/screens/implementation/).
- Tài liệu task frontend liên kết tới ảnh implementation bằng relative path để
  link hoạt động trên GitHub và trong editor.
- Khi di chuyển hoặc đổi tên task, phải cập nhật mọi liên kết trong repository
  và chạy format/link checks trước khi commit.
