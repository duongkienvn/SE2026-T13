# Frontend Architecture

## 1. Tổng quan

Frontend Kanvexa là React + TypeScript trong trình duyệt, với Workspaces, Kanban/Calendar/Table, Cards, collaboration, Home/My Tasks, Search, Notifications và Account Settings. REST phục vụ command/query, Socket.IO cung cấp realtime hints và presence; backend/PostgreSQL quyết định persistent state và quyền truy cập. Xem [project overview](../project-overview.md) cho inventory sản phẩm hiện có.

## 2. Cấu trúc hiện có

```text
apps/frontend/src/
├── app/          # routes, guards, providers and session-aware layout
├── components/   # shared primitives and official branding
├── features/
│   ├── activities/
│   ├── auth/
│   ├── board-members/
│   ├── boards/   # discovery, settings, Kanban/Calendar/Table
│   ├── cards/    # detail, checklists, attachments, dates and filtering
│   ├── columns/
│   ├── comments/
│   ├── labels/
│   ├── landing/
│   ├── notifications/
│   ├── presence/
│   ├── productivity/  # Home and My Tasks
│   ├── realtime/
│   ├── search/
│   ├── settings/      # appearance, preferences, security, export/privacy
│   ├── shortcuts/
│   └── workspaces/    # discovery, overview, boards, members and settings
├── hooks/
├── lib/          # envelope/binary REST clients, query client and utilities
├── pages/        # shared route error and not-found pages
├── test/         # synthetic fixtures and setup
└── style.css     # shared tokens, themes and styles
```

- Routing ở `app/routes.tsx`, guards/providers/layout ở `app/`. API adapters, query keys/hooks và presentation types nằm trong feature; shared wire contracts đến từ `packages/shared`.
- TanStack Query quản lý server state. Optimistic rollback, cache và late responses tuân thủ session generation và Board access version; logout/access loss không giữ dữ liệu riêng tư của session cũ.
- Board discovery và Workspace Boards dùng API search/filter/sort/pagination. Board views dùng chung dữ liệu được authorize, URL-backed filters và Card permalinks. Preview summaries được chia theo nhóm Card và invalidate theo Card bị ảnh hưởng.
- `features/realtime/` giữ Socket.IO client theo auth session, theo dõi Board được phép đọc và nhận notification/access hints. Reconnect yêu cầu REST resync; mutation holds chỉ áp dụng cho query xung đột, không phải toàn bộ ứng dụng. Xem [realtime synchronization](../tasks/frontend/realtime-frontend.md).
- Workspace UI tích hợp REST cho Overview, Boards, Members/Guests/Invitations và Settings. Workspace ADMIN không tự có quyền private Board; Workspace-visible readers dùng read-only capability thay vì role giả.
- `settings/sections.ts` khai báo profile, appearance, notifications, preferences, security, connected accounts, data/privacy và keyboard shortcuts. Export dùng authenticated binary requests; email change/deletion chỉ hoàn tất sau server-confirmed success với đúng session boundary.
- `ThemeSync`, boot script và semantic tokens hỗ trợ light/dark/system. Layout giữ vùng Kanban làm việc trong viewport và dùng pagination hoặc vùng scroll phù hợp; mobile/settings không chịu một quy tắc cấm scroll toàn trang máy móc.
- QA entrypoints trong `apps/frontend/qa/` và test fixtures dùng synthetic data; chúng không phải production gateways hoặc bằng chứng provider đã được enable trên server.

---

## 3. State management model

Google Sign-In (#79) dùng GIS script loader và official button chung cho Login,
Register, Profile. GIS chỉ trả credential qua callback; backend đổi thành Kanvexa
JWT rồi `AuthProvider.signIn()` quản lý redirect/cache/session như local login.
Opaque button state, mount lifecycle và auth generation chặn callback cũ. Không
lưu Google credential trong storage/router/query cache. Connected accounts query
được scope theo session generation; link yêu cầu password reauthentication và
không đổi JWT. `VITE_GOOGLE_CLIENT_ID` là public build config; cấu hình thiếu/lỗi
không làm hỏng local form. Xem [contracts và verification](../tasks/backend/google-auth-account-linking.md).

### Server state

TanStack Query quản lý server state cho các dữ liệu đến từ backend:

- fetch board data;
- fetch column/card/comment collection;
- cache loading/error status;
- invalidation sau khi mutation thành công;
- sync lại UI khi dữ liệu backend thay đổi.

TanStack Query dùng để quản lý các dữ liệu nguồn từ API, thay vì giữ mọi ứng dụng state trong một store toàn cục.

### Local UI state

React local state hoặc component state được dùng cho:

- modal state;
- menu / dropdown;
- drag state;
- form interaction;
- temporary UI-only decisions;
- optimistic or transient UX behavior nếu cần.

Local UI state thích hợp cho trạng thái tạm thời, không phải dữ liệu nghiệp vụ bất biến. Các state có tính chất durable và business-backed nên đi qua backend và được query/cache lại từ server.

### Không dùng Redux/Zustand

Project không sử dụng Redux hay global state library thay thế TanStack Query và React state. Điều này là yêu cầu rõ ràng trong `AGENTS.md` và là nguyên tắc cần được giữ trong tài liệu. Nếu sau này có requirement rõ ràng mới, có thể xem xét lại, nhưng hiện tại không ưu tiên thêm một state management library mới.

---

## 4. REST + Realtime interaction model

Frontend dùng hai channel chính:

1. REST API cho initial load, query và command
2. Socket.IO cho realtime update và presence

### Initial data loading

```text
Frontend
→ REST API
→ TanStack Query cache
→ UI render
```

Ví dụ: khi user mở board, frontend gọi API để fetch board detail, columns, cards, members, comments. Kết quả được lưu trong TanStack Query cache để UI render và revalidate khi cần.

### Realtime update

```text
Socket.IO event
→ Socket handler in frontend
→ update or invalidate query cache
→ UI rerender
```

Frontend không phải source of truth cho business state. Khi realtime event tới, frontend cập nhật cache hoặc invalidate lại query tương ứng, sau đó UI render dựa trên dữ liệu mới nhất từ backend.

---

## 5. REST design philosophy

REST layer được dùng cho:

- load initial data;
- create/update/delete board/member/column/card/comment;
- submit business commands;
- query dữ liệu cần thiết trước khi mở/hiển thị UI.

Trong architecture này:

- Client không tự quyết định permanent business state.
- Backend là nguồn dữ liệu authoritative.
- Frontend thực hiện request và phản ánh dữ liệu chính xác từ server.

Nói cách khác, frontend dùng REST như “single source of truth for interaction result”, còn realtime chỉ là “live sync event” cho các thay đổi đang xảy ra.

---

## 6. Realtime responsibilities on frontend

Frontend realtime responsibilities gồm:

- connect tới Socket.IO sau khi user authenticated và có quyền truy cập board;
- join board room theo convention `board:{boardId}`;
- listen board events như add/edit/delete/move member, card, comment, column;
- update UI state hoặc invalidate cache để hiển thị thay đổi mới nhất;
- show presence state như user online/active on board.

Presence và collaboration events không thay cho REST request; chúng chỉ cung cấp live UX. Nếu client mất một event vì mạng hoặc socket disconnect, UI có thể refresh lại qua REST API theo pattern chuẩn.

---

## 7. Drag and drop responsibilities

Project dùng `dnd-kit` cho các hoạt động kéo thả chính:

- reorder column;
- reorder card trong cùng column;
- move card giữa các column.

### Architecture expectation

- UI có thể dùng optimistic interaction để phản hồi nhanh bằng drag animation.
- Tuy nhiên, backend vẫn phải xác nhận và persist final change.
- Khi server response hoặc realtime event quay lại, frontend cần sync lại dữ liệu thật với backend.

Điều này tránh trường hợp frontend tự “sửa” state cục bộ mà không có database transaction tương ứng.

---

## 8. Shared package boundary

Frontend có thể import các shared contract từ `packages/shared`, ví dụ:

- shared types;
- enums;
- event names;
- contracts dùng chung giữa frontend và backend.

Tuy nhiên, frontend không được import code backend-specific như:

- TypeORM entity;
- repository;
- service logic;
- guard;
- database model classes.

`packages/shared` nên chứa những phần thực sự dùng chung giữa client và server, không chứa any business implementation riêng của backend.

---

## 9. Feature-based organization

Feature code được tổ chức theo domain như cây thư mục hiện có ở trên. Mỗi feature giữ API adapters, query keys/hooks, local UI và component riêng; primitives dùng chung ở `components/`, router/providers ở `app/`. Không mô tả thư mục chưa tồn tại như một phần của current implementation.

---

## 10. UI conventions and responsibilities

### Components

Components chia theo một trong ba nhóm:

- presentational UI components;
- feature-scoped composite components;
- page-shell / layout components.

Components không nên mang quá nhiều business logic. Business logic nên tách vào hooks hoặc feature services/query layer.

### Hooks

Custom hooks nên tập trung vào:

- fetching data via TanStack Query;
- mutation logic;
- UI-specific state transitions;
- socket event subscription wiring when relevant.

### API layer

Frontend nên có một API abstraction layer để:

- centralize endpoint paths;
- standardize request/response types;
- keep query/mutation hooks decoupled from UI components.

---

## 11. Realtime + cache synchronization pattern

Khi backend gửi realtime event, frontend nên dùng một trong hai cách sau:

- update cached query data directly when event is local and deterministic;
- invalidate related queries so TanStack Query refetches the latest data from backend.

Phương án chính cần ưu tiên là predictable và dễ sửa. Không nên để socket event tự “đổi state” mà không có source-of-truth check dưới backend.

---

## 12. Convention khi tạo feature mới

Khi thêm feature mới, nên tuân thủ các nguyên tắc sau:

1. Tạo feature folder rõ ràng dưới `src/features/...`.
2. Chia UI, hooks, query, mutation và types theo mối quan hệ rõ ràng.
3. Dùng TanStack Query cho server state.
4. Chỉ dùng local state cho UI-local transitions.
5. Không đưa business logic quan trọng vào component đơn lẻ.
6. Nếu feature có realtime cập nhật, xử lý qua socket handler + cache update/invalidation.
7. Nếu feature liên quan tới board permission, luôn dựa trên backend response và dữ liệu đã được xác thực.
8. Nếu cần dùng shared contract, import từ `packages/shared`, không lẫn backend-only code.

---

## 13. Kết luận

Các feature hiện có dùng chung một nền tảng: React + TypeScript + Vite + Tailwind + TanStack Query + dnd-kit + Socket.IO Client; server state ở query cache, local UI state ở component/hook, realtime cập nhật chỉ đồng bộ event sau khi backend đã xử lý và persist thành công.

Điểm then chốt là separation of concerns:

- REST = initial load, commands and queries
- TanStack Query = server state + cache
- local state = transient UI behavior
- Socket.IO = live collaboration and presence
- `packages/shared` = real shared contracts between frontend and backend

Đây là architecture basis để mỗi feature mới được xây dựng theo cùng convention, đồng thời giữ cho frontend không tự “vượt quá” quyền quyết định dữ liệu nghiệp vụ.
