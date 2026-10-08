# Frontend Architecture

## 1. Tổng quan

Frontend của project là ứng dụng React + TypeScript chạy trong trình duyệt, mục tiêu render board, column, card và interaction workflow cho team làm việc cùng lúc trên cùng một board. Frontend không phải nơi lưu trữ dữ liệu nghiệp vụ lâu dài; nó là client layer của hệ thống, phục vụ initial data loading, business command và realtime synchronization.

Project hiện tại chỉ là skeleton React/Vite cơ bản; chưa có feature module nào được triển khai theo cấu trúc feature-based. Vì vậy, tài liệu này sẽ chỉ mô tả architecture direction đã thống nhất và phân biệt rõ phần hiện có và phần dự kiến cho MVP.

---

## 2. Current vs Planned structure

### Current state

Frontend hiện tại mới chỉ có các file nền tảng trong `apps/frontend/src`:

```text
apps/frontend/src/
├── App.test.tsx
├── App.tsx
├── main.tsx
├── style.css
└── ...
```

Hiện chưa có:

- feature folder như `auth`, `boards`, `columns`, `cards`;
- hook layer chuyên biệt;
- shared API client layer;
- query cache layer hoàn chỉnh;
- realtime socket module thực tế;
- dnd-kit integration.

### Planned state for MVP

Frontend dự kiến theo hướng feature-based structure, với các area rõ ràng:

```text
apps/frontend/src/
├── app/
├── features/
│   ├── auth/
│   ├── boards/
│   ├── board-members/
│   ├── columns/
│   ├── cards/
│   ├── comments/
│   └── presence/
├── pages/
├── components/
├── hooks/
├── lib/
├── types/
├── routes/
├── api/
└── styles/
```

Tuy nhiên, đây là hướng planning cho các feature tương lai, không phải là mô tả “đã tồn tại” trong source code hiện tại. Khi viết docs, cần phân biệt rõ `Current` và `Planned` để tránh nhầm lẫn.

---

## 3. State management model

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

### Không dùng Redux/Zustand trong MVP

Project không sử dụng Redux hay bất kỳ global state library nào ở MVP. Điều này là yêu cầu rõ ràng trong `AGENTS.md` và là nguyên tắc cần được giữ trong tài liệu. Nếu sau này có requirement rõ ràng mới, có thể xem xét lại, nhưng hiện tại không ưu tiên thêm một state management library mới.

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

MVP frontend nên tổ chức theo feature thay vì một khối app lớn không có ranh giới rõ. Dự kiến:

- `auth`: login/register/profile flow
- `boards`: board listing, create, detail, archive
- `board-members`: membership, role, access management
- `columns`: column list, rename/delete/reorder
- `cards`: card create/edit/archive/move/assign
- `comments`: comment list/create/update/delete
- `presence`: online user presence and board room state

Từng feature nên có boundary rõ ràng về component, hooks, query, mutation và UI logic.

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

Frontend architecture của project đang ở giai đoạn skeleton, nhưng hướng đi đã rõ: React + TypeScript + Vite + Tailwind + TanStack Query + dnd-kit + Socket.IO Client; server state ở query cache, local UI state ở component/hook, realtime cập nhật chỉ đồng bộ event sau khi backend đã xử lý và persist thành công.

Điểm then chốt là separation of concerns:

- REST = initial load, commands and queries
- TanStack Query = server state + cache
- local state = transient UI behavior
- Socket.IO = live collaboration and presence
- `packages/shared` = real shared contracts between frontend and backend

Đây là architecture basis để mỗi feature mới được xây dựng theo cùng convention, đồng thời giữ cho frontend không tự “vượt quá” quyền quyết định dữ liệu nghiệp vụ.
