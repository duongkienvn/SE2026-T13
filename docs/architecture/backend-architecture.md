# Backend Architecture

## 1. Tổng quan

Backend của project là một NestJS modular monolith theo hướng MVP. Mục tiêu của layer này là làm nơi duy nhất xử lý business logic, xác thực quyền, giao tiếp với database và phát sự kiện realtime sau khi thay đổi đã được persist thành công.

Project hiện tại đã có Application Foundation, Authentication/User Profile MVP, Board/Board Member API, Column/Card Management APIs và realtime foundation F1. Tám domain entities cùng các auth entities `EmailVerificationToken` và `GoogleIdentity` được đặt theo feature trong `apps/backend/src/api/`; các feature nghiệp vụ còn lại sẽ được bổ sung theo từng issue sau.

Backend không phải là nơi lưu trữ UI state; backend là source of truth cho dữ liệu nghiệp vụ và các thay đổi trạng thái board.

---

## 2. Feature-Based Modular Architecture

### Current state

Business code được tổ chức theo domain. Cấu trúc hiện có của Database Foundation:

```text
apps/backend/src/
├── api/
│   ├── activities/entities/activity.entity.ts
│   ├── board-members/entities/board-member.entity.ts
│   ├── boards/entities/board.entity.ts
│   ├── cards/entities/
│   │   ├── card.entity.ts
│   │   └── card-assignee.entity.ts
│   ├── columns/                 # Column Management REST API (E1)
│   │   └── entities/board-column.entity.ts
│   ├── comments/entities/comment.entity.ts
│   ├── auth/                 # register, login, logout, JWT guard
│   ├── users/                # User entity và profile API
│   └── health/
├── common/
│   └── enums/database-enums.ts
├── database/
│   ├── migrations/
│   ├── data-source.ts
│   └── database-options.ts
├── realtime/
├── app.module.ts
└── main.ts
```

Trong đó:

- Mỗi feature trong `api/` sở hữu entity của domain mình; `CardAssignee` thuộc feature `cards`. `auth` là feature riêng cho xác thực, không sở hữu `User` entity.
- Các enum backend dùng chung giữa nhiều feature hiện nằm trong `common/enums/`. Nếu contract tương ứng được đưa vào `packages/shared`, cần tái sử dụng định nghĩa chung thay vì nhân đôi enum.
- `database/` chỉ giữ database infrastructure, DataSource và migrations; không giữ business entities.
- TypeORM discovery nạp entities từ `api/**/entities/` và migrations từ `database/migrations/` theo đúng đuôi `.ts` khi chạy source hoặc `.js` khi chạy build.
- `api/health/` là module hiện có; `realtime/` vẫn là layer cross-cutting.

### Application foundation hiện có

`AppModule` tích hợp global `ConfigModule`, TypeORM và `nestjs-pino`. `main.ts` khởi tạo HTTP app; `http-application.ts` cấu hình Helmet, CORS, prefix, validation, exception filter, Swagger và shutdown hooks. Các thành phần dùng chung có implementation thực tế nằm trong `config/`, `common/dto/`, `filters/` và `logging/`. Không có business controller/service giả trong foundation.

- `NODE_ENV`: `development`, `test` hoặc `production`; mặc định `development`.
- `API_PORT`: cổng backend, mặc định `3000`; `API_PREFIX`: prefix REST, mặc định `api`.
- `CORS_ORIGINS`: danh sách origin chính xác, ngăn cách bằng dấu phẩy. Development mặc định `http://localhost:5173`; production bắt buộc cấu hình tường minh. Browser request từ origin ngoài danh sách không nhận CORS allow header.
- `LOG_LEVEL`: Pino level; mặc định `debug` ở development/test và `info` ở production. Development dùng `pino-pretty`; các môi trường khác xuất JSON ra stdout/stderr.
- `SWAGGER_ENABLED`: chỉ nhận `true` hoặc `false`; mặc định bật ở development/test, tắt ở production. Khi bật: UI `/api-docs`, JSON `/api-docs-json`.
- `JWT_SECRET` là secret bắt buộc, phải có tối thiểu 32 byte và được validate khi Nest khởi động. Không commit secret thật; `.env.example` chỉ có hướng dẫn sinh secret ngẫu nhiên.
- `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD` giữ conventions hiện tại và được validate khi Nest khởi động. TypeORM CLI vẫn đọc `.env` trực tiếp qua `data-source.ts`, không phụ thuộc Nest ConfigModule.

`GET /health` là liveness check không truy vấn database; `GET /` giữ tương thích với health route cũ. Cả hai ở ngoài `/api`. Liveness trả `{ name, status: "ok" }` với HTTP 200 khi process hoạt động. `GET /health/ready` kiểm tra PostgreSQL bằng `SELECT 1` trong transaction có `SET LOCAL statement_timeout = 1000`; response cũng có timeout 1 giây. Các request readiness đồng thời dùng chung một probe để tránh chiếm nhiều kết nối khi database bị treo. Khi database không sẵn sàng, endpoint trả HTTP 503. Health routes được miễn response wrapping và rate limiting.

#### REST response conventions

- Response thành công REST được interceptor chuẩn hóa thành `{ success: true, statusCode, message, data }`; danh sách phân trang thêm `meta`. `@SkipResponseWrap()` dành cho health, stream hoặc contract ngoại lệ. HTTP status vẫn giữ nguyên; `204` không có body. Dùng `@SerializeResponse(ResponseDto)` hoặc `toResponseDto()` với `@Expose()` để giới hạn trường trả về, kể cả nested DTO.
- Response lỗi có `{ success: false, statusCode, code, message, timestamp, path }`, thêm `details` cho validation và `requestId` khi có correlation ID. Auth bổ sung `EMAIL_ALREADY_EXISTS` và `INVALID_CREDENTIALS`; các mã nền tảng gồm `BAD_REQUEST`, `VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `TOO_MANY_REQUESTS`, `INTERNAL_ERROR`. Validation từ global pipe dùng `forbidNonWhitelisted: true`; nested DTO dùng `@ValidateNested` và `@Type`.
- SQLSTATE `23505` và `23503` được map thành HTTP 409; `EntityNotFoundError` thành 404; lỗi database khác và lỗi bất ngờ thành 500 với thông điệp an toàn. Response không chứa SQL, query parameters hay stack trace. Business errors được định nghĩa tại feature tương ứng khi có yêu cầu.
- List APIs tương lai dùng `PageQueryDto` (`page=1`, `limit=20`, tối đa `100`) và `paginateQueryBuilder()` để lấy `data` và `meta` bằng TypeORM; feed theo thời gian dùng `CursorQueryDto` và `paginateCursor()` với timestamp cùng UUID tie breaker. Client nhận envelope chung. Chưa có business list endpoint trong foundation.

`DATABASE_POOL_SIZE` (mặc định 10), `DATABASE_CONNECT_TIMEOUT_MS` (5000) và `DATABASE_SSL` (`false`) dùng chung cho Nest runtime và TypeORM CLI. SSL khi bật xác minh certificate máy chủ; deployment cần cung cấp trust chain phù hợp. SQL query logging tắt để không ghi parameters nhạy cảm. Global HTTP rate limit mặc định 120 requests/60 giây/IP mỗi process; Auth giới hạn login 10 requests/60 giây và register 5 requests/300 giây bằng `@Throttle`. Mặc định `TRUST_PROXY_HOPS=0` không tin forwarded IP headers. Production đặt `TRUST_PROXY_HOPS=1` chỉ khi Caddy là ingress duy nhất và backend không publish port; xem [production deployment](../deployment/production.md). Nếu triển khai nhiều instance, rate limit cần shared storage hoặc enforcement tại ingress.

Request log có `reqId`, method, path, response status và thời gian. `X-Request-Id` hợp lệ từ client được giữ lại; nếu không hợp lệ server tạo UUID và trả cùng header. Logger không ghi raw headers, query, cookies hay request body; các trường nhạy cảm còn được redact. Exception filter log loại lỗi và request ID cho lỗi 5xx, không log SQL hoặc message nội bộ.

Reference implementation: [vndevteam/nestjs-boilerplate](https://github.com/vndevteam/nestjs-boilerplate). Bootstrap, config, filter, logging, Swagger và pagination được điều chỉnh cho NestJS 11 và Kanban; không đưa auth, Redis, cloud logging, Active Record hoặc các dependency nghiệp vụ từ boilerplate vào foundation.

Card Management E2 implements REST create/list/detail/update/archive/move and
multi-assignee operations in `api/cards/`. It reuses E1's exact ordering helpers
and the same Board row lock for every mutation, preserving Card–Column and
assignee–membership invariants under concurrent requests. No new schema,
transport or realtime business events were introduced. See the
[E2 contract and verification](../tasks/backend/card-management-api.md).

### Planned state for MVP

Theo hướng architecture đã thống nhất, từng feature sẽ bổ sung controller, service, module definition, DTO, repository/query code và các thành phần liên quan khi có feature issue. Column Management E1 đã có các thành phần này; các feature còn lại sẽ được bổ sung theo từng issue. Các feature dự kiến gồm:

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
│   ├── migrations/
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
- `auth`, `users`, `boards`, `board-members`, `columns`, `cards`, `comments` và `activities` quản lý code theo domain. `auth` dùng `User` từ `users` khi cần; không khai báo một `User` entity thứ hai.

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

Database layer dùng TypeORM theo dạng Data Mapper style với `Repository<Entity>` và `@InjectRepository(...)`. Entity nằm trong feature tương ứng; DataSource và migrations nằm trong `src/database/`.

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

Authentication MVP dùng JWT access token stateless với HS256, TTL 3600 giây, issuer `kanban-api`, audience `kanban-web` và secret từ `JWT_SECRET`. `JwtAuthGuard` kiểm tra Bearer header, signature, algorithm, expiration, issuer, audience và user còn tồn tại trong PostgreSQL; identity được đưa vào `CurrentUser` dưới dạng user ID.

Các endpoint đã triển khai:

- `POST /api/auth/register` trả `201`, tạo user với Argon2id và không phát token.
- `POST /api/auth/login` trả `200` cùng `accessToken`, `tokenType`, `expiresIn` và public user DTO.
- `POST /api/auth/google` xác minh Google ID token bằng Google SDK và trả cùng
  Kanvexa JWT contract; `sub` được lưu trong `google_identities`, không auto-link
  theo email. Google-only users có password hash NULL và local login từ chối an toàn.
- `POST /api/auth/google/link` yêu cầu JWT + current password + Google credential
  cùng email, trả 204; `GET /api/auth/linked-providers` chỉ trả trạng thái boolean.
  Xem [security, transactions và rollout #79](../tasks/backend/google-auth-account-linking.md).
- `POST /api/auth/logout` là protected stateless endpoint trả `204`; server không revoke hoặc blacklist token.
- `GET /api/users/me` và `PATCH /api/users/me` là protected profile endpoints; chỉ cập nhật user lấy từ JWT context.

Public user response luôn whitelist `id`, `email`, `displayName`, `avatarUrl`, `createdAt` và `updatedAt`; `passwordHash` không được trả về hoặc đưa vào JWT.

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

F1 is implemented in `src/realtime/`: Nest-managed gateway, JWT handshake and
expiration, authorized join/leave, post-commit membership revocation and an
injectable board broadcast service. Join, removal and broadcast share a per-board
queue in the business-independent `RealtimeAccessModule`, closing the gap between
removal commit and eviction without a circular module dependency. The transport
path is `/socket.io`; CORS and WebSocket admission reuse `CORS_ORIGINS`. See the
[F1 implementation guide](../tasks/backend/realtime-foundation.md) for the exact contracts,
single-instance security boundary and tests. Presence and business events below
remain planned for G1/G2 and F2.

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

1. Đặt entity trong `api/<feature>/entities/`; tổ chức controller, service, DTO, module definition và query/repository code theo cùng feature khi triển khai feature đó.
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
