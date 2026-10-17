# Task Documentation

Tài liệu task được chia theo phần chịu trách nhiệm để dễ tìm và review:

- [`backend/`](backend/) chứa API, persistence, authorization và realtime phía
  server.
- [`frontend/`](frontend/) chứa UI, client integration, responsive behavior và
  realtime phía trình duyệt.

## Backend tasks

- [Backend foundation](backend/backend-foundation-pr-description.md)
- [Authentication](backend/backend-authentication.md)
- [Board management API](backend/board-management-api.md)
- [Board members management](backend/board-members-management.md)
- [Column management API](backend/column-management-api.md)
- [Card management API](backend/card-management-api.md)
- [Realtime foundation](backend/realtime-foundation.md)
- [Realtime board events](backend/realtime-board-events.md)
- [Comments API](backend/comments-api.md)
- [Activity core and read API](backend/activity-core.md)

## Frontend tasks

- [Frontend application foundation](frontend/frontend-foundation.md)
- [Frontend authentication](frontend/frontend-auth.md)
- [Authentication integration with the real backend](frontend/frontend-auth-integration.md)
- [Frontend compact layout](frontend/frontend-compact-layout.md)
- [Boards and board members frontend](frontend/boards-frontend.md)
- [Kanban board UI](frontend/kanban-board-ui.md)
- [Realtime frontend synchronization](frontend/realtime-frontend.md)

## Quy ước

- Task mới dùng tên file kebab-case và được đặt đúng trong `backend/` hoặc
  `frontend/`.
- Không đặt screenshot trong `docs/tasks/`. Ảnh thiết kế mẫu nằm trong
  [`../design/screens/reference/`](../design/screens/reference/); ảnh chụp giao
  diện thực tế nằm trong
  [`../design/screens/implementation/<task-slug>/`](../design/screens/implementation/).
- Tài liệu task frontend liên kết tới ảnh implementation bằng relative path để
  link hoạt động trên GitHub và trong editor.
- Khi di chuyển hoặc đổi tên task, phải cập nhật mọi liên kết trong repository
  và chạy format/link checks trước khi commit.
