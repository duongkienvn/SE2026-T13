# Backend Architecture

## 1. Tổng quan

Backend của project là một NestJS modular monolith theo hướng MVP. Mục tiêu của layer này là làm nơi duy nhất xử lý business logic, xác thực quyền, giao tiếp với database và phát sự kiện realtime sau khi thay đổi đã được persist thành công.

Project hiện tại đang ở giai đoạn cấu trúc nền tảng: các module business chưa triển khai đầy đủ, nhưng folder và cấu trúc cơ bản đã có sẵn trong `apps/backend/src` và đã thể hiện hướng kiến trúc dự định.

Backend không phải là nơi lưu trữ UI state; backend là source of truth cho dữ liệu nghiệp vụ và các thay đổi trạng thái board.

---

## 2. Current vs Planned structure

### Current state

Repository hiện có các folder và file nền tảng sau:

```text
apps/backend/src/
├── api/
│   └── health/
├── common/
│   ├── dto/
│   ├── interfaces/
│   └── types/
├── config/
├── constants/
├── database/
│   ├── entities/
│   ├── migrations/
│   ├── repositories/
│   ├── data-source.ts
│   └── database-options.ts
├── decorators/
├── exceptions/
├── filters/
├── guards/
├── realtime/
├── utils/
├── app.module.ts
├── main.ts
└── ...
```

Trong đó:

- `api/health/` là module hiện có, dùng để kiểm tra health endpoint.
- `database/` đã có cấu hình TypeORM, data source và kế hoạch cho entities/migrations/repositories.
- `realtime/` hiện là layer cross-cutting, chưa có business gateway logic thực tế.
- `guards/`, `decorators/`, `filters/`, `exceptions/` là các cross-cutting concerns sẽ được bổ sung khi cần.

### Planned state for MVP

Theo hướng architecture đã thống nhất, backend dự kiến tổ chức theo các business module:

```text
apps/backend/src/
├── api/
│   ├── auth/
│   ├── users/
│   ├── boards/
│   ├── board-members/
│   ├── columns/
│   ├── cards/
│   ├── comments/
│   ├── activities/
│   └── health/
├── database/
│   ├── entities/
│   ├── migrations/
│   ├── repositories/
│   ├── data-source.ts
│   └── database-options.ts
├── realtime/
│   ├── gateways/
│   ├── services/
│   ├── guards/
│   └── room-management/
├── common/
│   ├── dto/
│   ├── interfaces/
│   ├── types/
│   └── utils/
├── config/
├── decorators/
├── guards/
├── filters/
├── exceptions/
├── constants/
├── utils/
├── app.module.ts
├── main.ts
└── ...
```

Lưu ý:

- `realtime` không phải business domain module; nó là cross-cutting layer cho socket connection, room, presence và broadcast.
- `auth`, `boards`, `columns`, `cards`, ... là các module nghiệp vụ cần được tạo theo từng domain.

---

## 3. Responsibility của từng layer

### Controller

Controller xử lý HTTP concern:

- nhận request và DTO/input;
- chuyển tham số từ HTTP sang contract của service;
- gọi service phù hợp;
- trả response về client.

Controller chỉ nên tập trung vào request/response; không đặt business logic phức tạp trong controller.

Ví dụ trong MVP, controller chịu trách nhiệm cho API endpoint như board create, card update, comment create, v.v. Nhưng không quyết định logic nghiệp vụ; logic phải nằm trong service.

### Service

Service là nơi thực hiện business rules và orchestration:

- validate business rule;
- kiểm tra quyền truy cập theo `BoardMember` và role;
- thực hiện transaction khi cần;
- gọi repository hoặc database layer để đọc/ghi dữ liệu;
- tạo `Activity` sau khi action thành công;
- trigger realtime event sau khi persist xong.

Service là trung tâm của backend: nó là nơi quyết định điều gì hợp lệ, điều gì được phép, và điều gì cần được lưu.

### Database layer

Database layer dùng TypeORM theo dạng Data Mapper style với `Repository<Entity>` và `@InjectRepository(...)`.

Các concern chính:

- entities;
- repositories;
- data source;
- migrations;
- schema mapping và query logic.

Khuyến nghị architecture:

```ts
@InjectRepository(Board)
private readonly boardRepository: Repository<Board>
```

Không dùng Active Record nếu chưa có architecture decision mới. TypeORM migration sẽ lưu mọi thay đổi schema; `synchronize: false` phải giữ nguyên.

### Realtime layer

Realtime layer chịu trách nhiệm:

- Socket.IO connection lifecycle;
- authenticate socket connection;
- join/leave room theo board;
- presence tracking;
- broadcast events sau khi business operation được persist;
- room cleanup khi disconnect.

Gateway không chứa core business logic. Gateway chỉ tập trung vào transport / event dispatch; logic nghiệp vụ vẫn ở service và business module.

---

## 4. Business module direction

MVP dự kiến có các business module sau:

- `auth`
- `users`
- `boards`
- `board-members`
- `columns`
- `cards`
- `comments`
- `activities`

`realtime` không nằm trong nhóm trên vì đây là cross-cutting layer, không đại diện cho một domain Business riêng.

Mỗi module nên có trách nhiệm rõ ràng theo domain:

- `auth`: đăng ký, đăng nhập, xác thực token, session hoặc JWT concerns.
- `users`: profile, user metadata, account context.
- `boards`: board create/read/update/archive, membership và quyền liên quan.
- `board-members`: membership, role, board access rules.
- `columns`: column create/update/delete/reorder.
- `cards`: card lifecycle, assignment, move, archive.
- `comments`: comment create/update/delete.
- `activities`: structured audit log từ business action.

---

## 5. Authentication và Authorization

Authentication và authorization là hai concern khác nhau.

### Authentication

Authentication xác định người dùng đang là ai. Trong MVP, hướng chuẩn là JWT-based hoặc cơ chế tương đương. Mục tiêu là xác nhận user identity trước khi cho phép truy cập protected resource.

### Authorization

Authorization dựa trên `BoardMember` và role của user trong board. Đây là nguyên tắc quan trọng của project.

MVP role:

- `OWNER`
- `MEMBER`

Tất cả quyền của board phải được xác minh dựa trên board membership, không dựa trên UI state hoặc client-side giả định.

Các guard hoặc service authorization pattern có thể dùng như:

- `JwtAuthGuard`
- `BoardMemberGuard`
- `BoardOwnerGuard`

hoặc cách tương đương. Cách quan trọng là permission check phải tập trung và tái sử dụng được, không bị rải rác trong controller.

---

## 6. Realtime responsibilities

Realtime layer phải phục vụ các concern sau:

- Socket.IO connection management;
- authentication/authorization socket check;
- join board room;
- leave board room on disconnect;
- presence tracking;
- event broadcast đến đúng board room;
- coordination với frontend cache invalidation / UI update.

Room convention:

```text
board:{boardId}
```

Đây là room duy nhất để broadcast events liên quan đến board. User chỉ được join room nếu backend xác thực tài khoản và quyền truy cập board.

Presence ở MVP có thể dùng in-memory state dạng:

```text
boardId
→ userId
→ socketIds
```

Cách này đủ cho nhiều tab hoặc nhiều socket cùng một user. Không dùng Redis ở MVP.

---

## 7. Activity / Audit strategy

`Activity` không được frontend tự tạo một rendered message để lưu audit. Backend là component duy nhất tạo activity khi business action đã thành công.

`Activity` nên là structured data, ví dụ:

- actor;
- board;
- target domain object;
- action type;
- localized metadata.

Điều này giúp frontend render linh hoạt theo nhiều UI format mà không phải dựa vào text đã render sẵn từ client.

Ví dụ activity type bao gồm:

- board updated;
- member added;
- member role changed;
- column created/moved/renamed/deleted;
- card created/updated/moved/archived;
- comment created/updated/deleted.

---

## 8. Persistence before broadcast

Backend phải tuân thủ nguyên tắc quan trọng:

```text
Business action
→ validate/auth/authorize
→ service logic
→ database write / transaction
→ success response
→ realtime broadcast
```

Realtime event không thể thay thế database transaction. Nếu backend không persist thay đổi thành công, frontend không nên coi dữ liệu đã hợp lệ. Database và backend là source of truth; client chỉ có thể phản ánh state đã được backend xác nhận.

---

## 9. TypeORM and migration strategy

Project đã đặt hướng đi rõ ràng:

- PostgreSQL là database chính;
- TypeORM là ORM;
- schema thay đổi qua migration;
- `synchronize: false` được giữ nguyên;
- repository pattern được ưu tiên.

### Design principles

- entity là data model;
- repository là access layer;
- service là business orchestrator;
- migration là công cụ để thay đổi schema.

Database changes không được tự động sửa schema bằng sync; thay vào đó, cần generate migration rõ ràng để review và áp dụng ở môi trường dev/test/production theo quy trình chuẩn.

---

## 10. Convention khi tạo module mới

Khi tạo một business module mới, nên tuân thủ các nguyên tắc sau:

1. Tách rõ controller/service/repository/entity.
2. Chỉ đặt logic nghiệp vụ trong service, không đặt trong controller.
3. Dùng `@InjectRepository` và `Repository<Entity>`.
4. Validate authz tại service hoặc guard thích hợp.
5. Không tạo business logic phụ thuộc vào Socket.IO gateway.
6. Tạo activity khi có action quan trọng cần audit.
7. Sau khi persist thành công, tiến hành realtime broadcast nếu có liên quan.
8. Cập nhật docs/architecture nếu có thay đổi về module responsibility hoặc ownership.

---

## 11. Kết luận

Backend architecture của project đang trong giai đoạn khởi tạo nhưng hướng đi đã rõ: một modular monolith NestJS với PostgreSQL và TypeORM, REST dùng cho command/query, Socket.IO cho realtime, và logic nghiệp vụ được giữ ở service layer thay vì controller/gateway.

Điểm then chốt là sự tách biệt rõ ràng giữa:

- `Controller` = transport layer
- `Service` = business logic
- `Repository / TypeORM` = persistence layer
- `Realtime` = broadcast/presence layer
- `Activity` = audit history layer

Đây là basis để các feature sau này được implement theo cùng convention và không làm lệch kiến trúc đã thống nhất.
