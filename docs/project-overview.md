# Kanvexa — Project Overview

Tài liệu này là nguồn tham chiếu của nhóm về mục tiêu, phạm vi sản phẩm và hướng triển khai ở mức tổng quan của **Kanvexa**. Ứng dụng được cung cấp tại [kanvexa.tech](https://kanvexa.tech); hướng dẫn chạy local nằm trong [README](../README.md), còn quyết định kỹ thuật chi tiết nằm trong [`docs/architecture/`](architecture/).

Phạm vi hiện tại dưới đây được đối chiếu với source trên branch `docs/post-mvp-planning` ngày 2026-10-25. Đây là trạng thái triển khai trong repository, không phải xác nhận mọi chức năng đã được kiểm thử trên production. Một số ghi chú hiện trạng trong tài liệu kiến trúc vẫn mô tả các milestone trước; các nguyên tắc kiến trúc còn hiệu lực được giữ nguyên.

## Mục tiêu

Kanvexa giúp nhiều thành viên cùng làm việc trên một `Board`, quản lý `Column` và `Card`, trao đổi qua comment và nhìn thấy thay đổi mà không cần tải lại trang. MVP tập trung vào quản lý board/card, kéo thả, realtime collaboration, presence, comment, lịch sử hoạt động và quyền truy cập. Post-MVP mở rộng sản phẩm theo phạm vi đã duyệt; Kanvexa không hướng tới sao chép toàn bộ Trello hay Miro.

## Current MVP Scope

Các chức năng sau đã có API và giao diện tương ứng trong source hiện tại.

### Authentication và User

- Đăng ký bằng email/password, xác minh email, gửi lại email xác minh, đăng nhập và đăng xuất.
- Google Sign-In thuộc MVP (#79), dùng chung Kanvexa JWT; liên kết tài khoản
  password hiện có phải qua password reauthentication tường minh. Không tự gộp
  theo email; xem [Google authentication](tasks/backend/google-auth-account-linking.md).
- Xem và cập nhật thông tin profile cơ bản; xem các phương thức đăng nhập đã liên kết.

### Board và thành viên

- Tạo board; liệt kê các board mà user có quyền truy cập; xem chi tiết board. Danh sách Active/Archived có search riêng và phân trang theo không gian hiển thị.
- Đổi tên và cập nhật thông tin cơ bản; archive và restore board theo quyền `OWNER`. Board archived chỉ cho đọc, ngoại trừ thao tác restore được cấp quyền.
- Thêm user đã đăng ký trong hệ thống vào board. MVP chưa bao gồm email invitation hoặc invitation token/link workflow.
- Hai role trong MVP là `OWNER` và `MEMBER`. Người tạo board trở thành `OWNER`; `OWNER` quản lý board và thành viên; `MEMBER` tham gia công việc cộng tác. User không thuộc board không được truy cập board. Xem [Board Members](tasks/backend/board-members-management.md) và [Archive/Restore](tasks/backend/board-archive-management.md) cho các rule chi tiết.

### Column và Card

- Tạo, đổi tên, xóa `Column` rỗng theo business rule; sắp xếp lại column bằng kéo thả.
- Tạo, sửa và archive `Card` khi không còn sử dụng. Card có title, description, deadline và có thể được assign cho nhiều thành viên.
- Di chuyển card giữa các column và sắp xếp lại trong cùng column bằng kéo thả.

Trong normal user flow, `Board` và `Card` ưu tiên archive. Hard delete không phải thao tác mặc định của MVP; chỉ bổ sung sau này nếu có business rule rõ ràng. Restore Card chưa có trong source hiện tại và thuộc phạm vi Post-MVP, khác với Restore Board đã triển khai.

### Realtime, presence và comment

- Đồng bộ thay đổi quan trọng đến các client đang xem cùng board mà không cần tải lại: column được tạo/sửa/xóa hoặc đổi thứ tự; card được tạo/sửa/archive, di chuyển hoặc đổi thứ tự; comment thay đổi.
- Hiển thị user đang online và đang xem cùng board. Presence là trạng thái realtime tạm thời, không phải dữ liệu nghiệp vụ lưu lâu dài.
- Tạo comment trên card; sửa/xóa comment theo rule phù hợp; cập nhật comment theo thời gian thực.
- Client chỉ được join hoặc listen room của board sau khi backend xác nhận quyền truy cập. Realtime không bỏ qua authorization.

### Activity / audit history

Backend tạo `Activity` có cấu trúc cho các business action quan trọng, thay vì chỉ lưu một chuỗi văn bản đã render. Ví dụ: board được cập nhật, archive hoặc restore; thành viên được thêm/xóa hoặc đổi role; column được tạo/sửa/di chuyển/xóa; card được tạo/sửa/di chuyển/archive; comment được tạo/sửa/xóa. Giao diện Activity History cho phép thành viên xem lịch sử board theo trang.

### Navigation và responsive UI

Authenticated app có sidebar mở/thu gọn, các trang Boards, Board Detail, Members và Profile. Danh sách dài dùng phân trang và layout đo theo viewport; UI hỗ trợ desktop/mobile. Các route hiện có gồm `/boards`, `/boards/:boardId`, `/boards/:boardId/members` và `/profile`, cùng các trang authentication/email verification.

## Approved Post-MVP Scope

[Post-MVP Roadmap V1](roadmap/post-mvp.md) đã duyệt **25 nhóm tính năng/workstream** trong **6 phase (0–5)**. Đây là phạm vi và thứ tự triển khai đã duyệt; không phải danh sách tính năng đã release, và chưa có lịch triển khai cho từng issue được phê duyệt.

| Nhóm                           | Số workstream | Phạm vi đã duyệt                                                                                             |
| ------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------ |
| Workspace                      | 4             | Quản lý workspace, membership/invitations, settings và overview.                                             |
| Board                          | 4             | Customization, visibility/permissions, settings và discovery.                                                |
| Card                           | 7             | Checklists, labels, attachments, advanced dates, archive/restore, quick actions/deep links và search/filter. |
| Collaboration & Productivity   | 4             | Notifications/mentions, My Tasks, Home Dashboard và global search.                                           |
| Account & Application Settings | 3             | Security/account management, appearance và preferences.                                                      |
| Data, Views & Experience       | 3             | Export, Calendar/Table views và productivity/UX polish.                                                      |

Các phase gồm MVP Stabilization & Design Handoff → Application & Account Foundation → Workspace & Access Control → Board & Card Enhancements → Productivity & Collaboration → Views, Data & Polish. Các ràng buộc phụ thuộc, migration và acceptance criteria nằm trong roadmap, không được suy rộng từ tên phase hoặc mockup.

Thiết kế sử dụng [Product & UX Blueprint](design/product-ux-blueprint.md), [Post-MVP guidelines](design/design-guidelines.post-mvp.md) và [visual reference register](design/post-mvp/visual-reference-register.md). Giữ branding/design system Kanvexa, hỗ trợ desktop/mobile và Light/Dark/System themes, bảo toàn dữ liệu và chức năng MVP. Mockup đã duyệt là visual reference, không phải bằng chứng chức năng đã triển khai. Free Plan, Upgrade to Pro, pricing và subscription không thuộc phạm vi được duyệt.

## Ngoài phạm vi MVP

Ranh giới MVP ban đầu vẫn có giá trị. Những phần mở rộng đã được duyệt chỉ được triển khai theo Post-MVP roadmap; các ý tưởng ngoài roadmap tiếp tục cần quyết định phạm vi riêng.

### Product features ngoài MVP

- Video call, voice call, AI assistant.
- Calendar/Table views, attachments, invitations, notifications và Workspace roles thuộc Post-MVP theo phạm vi cụ thể trong roadmap; không phải chức năng MVP hiện tại.
- Gantt chart, time tracking, complex analytics, Google Drive integration và push notification không tự động được phê duyệt cùng các workstream trên.
- Mobile application, Trello-style automation, offline-first support.
- Không mở rộng Board roles ngoài `OWNER`/`MEMBER` chỉ vì Post-MVP bổ sung Workspace roles.

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

Nhóm dùng thống nhất các tên trên, không tự đổi thành `Project`, `Task`, `Issue`, `Lane` hoặc `List`. `Workspace` trong Post-MVP là một domain concept bổ sung đã được duyệt, không phải tên thay thế của `Board`. Workspace `ADMIN`/`MEMBER` không thay thế Board `OWNER`/`MEMBER` và không ngầm cấp quyền vào private board; xem roadmap và blueprint.

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
├── architecture/   Tài liệu kiến trúc và developer guides
├── deployment/     Deployment, CI/CD và verification runbooks
├── design/         MVP references/evidence và Post-MVP design
├── roadmap/        Phạm vi và phase Post-MVP đã duyệt
└── tasks/
    ├── backend/    Tài liệu task backend
    └── frontend/   Tài liệu task frontend
.github/
└── workflows/      Cấu hình GitHub Actions CI/CD
```

`packages/shared` dành cho contract, type, enum và realtime event names dùng chung; TypeORM entity thuộc backend, không đặt trong shared package. Backend hiện có các business module `auth`, `users`, `boards`, `board-members`, `columns`, `cards`, `comments` và `activities`. `realtime` là cross-cutting realtime layer/module, không phải business domain module và không chứa core business logic.

## Nguyên tắc kiến trúc

- **Server authoritative:** Backend và database là source of truth. Frontend không tự quyết định permanent business state.
- **REST + WebSocket:** REST phục vụ initial fetch, command và query; Socket.IO phục vụ realtime broadcast, presence và collaboration events. Không xây ứng dụng socket-only.
- **Persistence before broadcast:** Backend xử lý và persist business operation thành công trước khi broadcast event. Event không thay thế database transaction.
- **Socket rooms:** Room của board dùng convention `board:{boardId}` và luôn kiểm tra quyền trước khi join/listen.
- **Modular monolith:** MVP được tổ chức thành các module trong một backend. Chỉ bổ sung hạ tầng như Redis, Kafka, CQRS hoặc CRDT khi có requirement rõ ràng.
- **Persistence:** TypeORM Data Mapper với `Repository<Entity>`, schema thay đổi qua migration; giữ `synchronize: false` và không tự chạy migration khi app khởi động.

## Luồng sử dụng chính

1. **Tạo và mở board:** Login → tạo board → người tạo trở thành `OWNER` → mở board → tải columns/cards/members → join realtime board room sau khi được xác thực và cấp quyền.
2. **Di chuyển card:** User kéo card → frontend gửi command → backend kiểm tra membership và business rule → cập nhật database → broadcast event di chuyển card → các client khác cập nhật UI.
3. **Thêm comment:** User gửi comment → backend kiểm tra quyền truy cập → lưu comment → tạo `Activity` nếu áp dụng → broadcast realtime comment event.
4. **Presence:** User mở board → authenticated socket join board room sau khi kiểm tra quyền → cập nhật presence state → các thành viên đang xem board nhận cập nhật.

## Quy trình phát triển

Issue → tạo branch từ `main` → implement hoặc viết tài liệu → commit → push branch → Pull Request → GitHub Actions CI → CodeRabbit review → human review → merge → xóa branch.

`main` được bảo vệ bằng ruleset; không push trực tiếp vào `main`. Dùng tên branch theo loại thay đổi, ví dụ `feat/...`, `fix/...`, `docs/...`, `refactor/...`, `chore/...`. Commit theo Conventional Commit đơn giản, ví dụ `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `ci:`, `test:`.

## Trạng thái hiện tại

Đối chiếu source ngày 2026-10-25 cho thấy MVP đã có các luồng auth/profile, Board/Board Members, Column/Card, realtime business events, presence, comments và Activity History. Archive/Restore Board và sidebar/Board UX cũng đã được tích hợp. Các hồ sơ triển khai và kiểm thử theo milestone nằm trong [task index](tasks/README.md); không sửa lại lịch sử task để biến chúng thành mô tả release hiện tại.

- **Đã có trong repository:** schema/migrations, shared contracts, UI/API cho các chức năng MVP nêu trên, GitHub Actions CI và production deployment/verification tooling. Xem [production runbook](deployment/production.md) và [CI/CD](deployment/cicd.md).
- **Chưa có trong route/source hiện tại:** Workspace, Home Dashboard, My Tasks, notification center, settings/themes và các khả năng Post-MVP mới liệt kê trong roadmap. Profile và connected accounts cơ bản đã có, khác với bộ Account Settings được lên kế hoạch.
- **Landing Page:** `/` vẫn dùng `RootRedirect` tới Login hoặc Boards. Không xem thiết kế landing page là tính năng đã release; theo dõi riêng [Issue #84](https://github.com/duongkienvn/SE2026-T13/issues/84).
- **Bước tiếp theo:** Phase 0 xác minh release/CI/deployment, regression và design handoff trước khi triển khai Post-MVP. Một tính năng có trong source không tự xác nhận deployment hoặc production QA đã hoàn tất.
