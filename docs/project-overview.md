# Realtime Collaborative Kanban — Project Overview

Tài liệu này là nguồn tham chiếu của nhóm về mục tiêu, phạm vi sản phẩm và hướng triển khai ở mức tổng quan. Các quyết định kỹ thuật chi tiết sẽ được ghi trong [`docs/architecture/`](architecture/) khi cần.

## Mục tiêu

Xây dựng ứng dụng Kanban cộng tác theo thời gian thực: nhiều thành viên cùng làm việc trên một `Board`, quản lý `Column` và `Card`, trao đổi qua comment và nhìn thấy thay đổi mà không cần tải lại trang. Project tập trung vào quản lý board/card, kéo thả, realtime collaboration, presence, comment, lịch sử hoạt động và quyền truy cập; đây không phải bản sao đầy đủ của Trello hay Miro.

## Phạm vi MVP

### Authentication và User

- Đăng ký, đăng nhập, đăng xuất.
- Xem và cập nhật thông tin profile cơ bản.

### Board và thành viên

- Tạo board; liệt kê các board mà user có quyền truy cập; xem chi tiết board.
- Đổi tên và cập nhật thông tin cơ bản; archive board khi không còn sử dụng.
- Thêm user đã đăng ký trong hệ thống vào board. MVP chưa bao gồm email invitation hoặc invitation token/link workflow.
- Hai role trong MVP là `OWNER` và `MEMBER`. Người tạo board trở thành `OWNER`; `OWNER` quản lý board và thành viên theo quyền được định nghĩa; `MEMBER` tham gia công việc cộng tác. User không thuộc board không được truy cập board. Ma trận quyền chi tiết sẽ được xác định ở tài liệu kiến trúc/nghiệp vụ sau.

### Column và Card

- Tạo, đổi tên, xóa `Column` theo business rule; sắp xếp lại column bằng kéo thả.
- Tạo, sửa và archive `Card` khi không còn sử dụng. Card có title, description, deadline và có thể được assign cho nhiều thành viên.
- Di chuyển card giữa các column và sắp xếp lại trong cùng column bằng kéo thả.

Trong normal user flow, `Board` và `Card` ưu tiên archive. Hard delete không phải thao tác mặc định của MVP; chỉ bổ sung sau này nếu có business rule rõ ràng.

### Realtime, presence và comment

- Đồng bộ thay đổi quan trọng đến các client đang xem cùng board mà không cần tải lại: column được tạo/sửa/xóa hoặc đổi thứ tự; card được tạo/sửa/archive, di chuyển hoặc đổi thứ tự; comment thay đổi.
- Hiển thị user đang online và đang xem cùng board. Presence là trạng thái realtime tạm thời, không phải dữ liệu nghiệp vụ lưu lâu dài.
- Tạo comment trên card; sửa/xóa comment theo rule phù hợp; cập nhật comment theo thời gian thực.
- Client chỉ được join hoặc listen room của board sau khi backend xác nhận quyền truy cập. Realtime không bỏ qua authorization.

### Activity / audit history

Backend tạo `Activity` có cấu trúc cho các business action quan trọng, thay vì chỉ lưu một chuỗi văn bản đã render. Ví dụ: board được cập nhật; thành viên được thêm/xóa hoặc đổi role; column được tạo/sửa/di chuyển/xóa; card được tạo/sửa/di chuyển/archive; comment được tạo/sửa/xóa.

## Ngoài phạm vi MVP

Các mục sau không thuộc MVP hiện tại; chỉ xem xét sau này khi có requirement rõ ràng.

### Product features ngoài MVP

- Video call, voice call, AI assistant.
- Calendar view, Gantt chart, time tracking, analytics dashboard.
- Complex file storage, Google Drive integration, email notification, push notification.
- Mobile application, Trello-style automation, offline-first support.
- Advanced roles.

### Technical approaches không dùng trong MVP hiện tại

- CRDT, Redis, Kafka, microservices, CQRS.

## Thuật ngữ domain

| Thuật ngữ      | Trách nhiệm                                                                         |
| -------------- | ----------------------------------------------------------------------------------- |
| `User`         | Người sử dụng hệ thống.                                                             |
| `Board`        | Không gian Kanban để nhiều thành viên cộng tác.                                     |
| `BoardMember`  | Quan hệ membership và role giữa `User` và `Board`.                                  |
| `Column`       | Nhóm trạng thái và vị trí của card trên board.                                      |
| `Card`         | Đơn vị công việc trên board.                                                        |
| `CardAssignee` | Quan hệ giữa card và các thành viên được assign; một card có thể có nhiều assignee. |
| `Comment`      | Nội dung thảo luận trên card.                                                       |
| `Activity`     | Bản ghi có cấu trúc về hoạt động/audit history của board.                           |

Nhóm dùng thống nhất các tên trên. Không đổi thành `Workspace`, `Project`, `Task`, `Issue`, `Lane` hoặc `List` nếu chưa có quyết định kiến trúc mới.

## Technology stack và repository

| Phần     | Stack và công cụ của project                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| Frontend | React, TypeScript, Vite, Tailwind CSS, TanStack Query, dnd-kit, Socket.IO Client                                      |
| Backend  | NestJS, TypeScript, REST API, Socket.IO, TypeORM                                                                      |
| Database | PostgreSQL                                                                                                            |
| Tooling  | pnpm workspace/monorepo, Jest, Supertest, Vitest, ESLint, Prettier, Docker Compose, GitHub Actions, CodeRabbit review |

```text
apps/
├── frontend/       React application
└── backend/        NestJS application
packages/
└── shared/         Contracts, types và enums thực sự dùng chung giữa frontend/backend
docs/
├── architecture/   Tài liệu kiến trúc chi tiết khi được viết
└── tasks/          Tài liệu task
.github/
└── workflows/      Cấu hình GitHub Actions CI
```

`packages/shared` dành cho contract dùng chung; TypeORM entity thuộc backend, không đặt trong shared package. Backend dự kiến có các business module `auth`, `users`, `boards`, `board-members`, `columns`, `cards`, `comments` và `activities`. `realtime` là cross-cutting realtime layer/module, không phải business domain module. Đây là hướng tổ chức, không phải danh sách module đã implement.

## Nguyên tắc kiến trúc

- **Server authoritative:** Backend và database là source of truth. Frontend không tự quyết định permanent business state.
- **REST + WebSocket:** REST phục vụ initial fetch, command và query; Socket.IO phục vụ realtime broadcast, presence và collaboration events. Không xây ứng dụng socket-only.
- **Persistence before broadcast:** Backend xử lý và persist business operation thành công trước khi broadcast event. Event không thay thế database transaction.
- **Socket rooms:** Room của board dùng convention `board:{boardId}` và luôn kiểm tra quyền trước khi join/listen.
- **Modular monolith:** MVP được tổ chức thành các module trong một backend. Chỉ bổ sung hạ tầng như Redis, Kafka, CQRS hoặc CRDT khi có requirement rõ ràng.

## Luồng sử dụng chính

1. **Tạo và mở board:** Login → tạo board → người tạo trở thành `OWNER` → mở board → tải columns/cards/members → join realtime board room sau khi được xác thực và cấp quyền.
2. **Di chuyển card:** User kéo card → frontend gửi command → backend kiểm tra membership và business rule → cập nhật database → broadcast `card-moved` event → các client khác cập nhật UI.
3. **Thêm comment:** User gửi comment → backend kiểm tra quyền truy cập → lưu comment → tạo `Activity` nếu áp dụng → broadcast realtime comment event.
4. **Presence:** User mở board → authenticated socket join board room sau khi kiểm tra quyền → cập nhật presence state → các thành viên đang xem board nhận cập nhật.

## Quy trình phát triển

Issue → tạo branch từ `main` → implement hoặc viết tài liệu → commit → push branch → Pull Request → GitHub Actions CI → CodeRabbit review → human review → merge → xóa branch.

`main` được bảo vệ bằng ruleset; không push trực tiếp vào `main`. Dùng tên branch theo loại thay đổi, ví dụ `feat/...`, `fix/...`, `docs/...`, `refactor/...`, `chore/...`. Commit theo Conventional Commit đơn giản, ví dụ `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `ci:`, `test:`.

## Trạng thái hiện tại

Project đang ở giai đoạn **Foundation / architecture preparation**.

- **Đã có:** pnpm monorepo, frontend và backend skeleton, PostgreSQL development environment bằng Docker Compose, shared package, GitHub Actions CI. Theo quy trình nhóm, CodeRabbit review và bảo vệ `main` được cấu hình ở GitHub.
- **Chưa có:** business feature, database entity/migration, authentication, board/card features và realtime business logic.
- **Hướng tiếp theo:** architecture documentation → database foundation → authentication → board/member → columns/cards → realtime/presence → comments/activity. Đây là roadmap tổng quan, chưa phải task implementation.
