# Column Management REST API (E1)

## Mục tiêu

Triển khai backend REST API quản lý Column trong một Board, làm nền tảng cho
Card Management API và Kanban Board UI.

## Phạm vi đã thực hiện

- `GET /api/boards/:boardId/columns`
- `POST /api/boards/:boardId/columns`
- `PATCH /api/boards/:boardId/columns/:columnId`
- `PATCH /api/boards/:boardId/columns/:columnId/move`
- `DELETE /api/boards/:boardId/columns/:columnId`

Column response gồm `id`, `boardId`, `name`, `position`, `createdAt` và
`updatedAt`. `position` được trả dạng string; list response dùng pagination
envelope hiện tại với mặc định `page=1`, `limit=20`, tối đa `100`.

## Quyết định nghiệp vụ

- OWNER và MEMBER đều được create, rename, reorder và delete Column rỗng.
- Board archived vẫn cho phép list Column nhưng từ chối mutation bằng
  `409 BOARD_ARCHIVED`.
- Column chỉ được thao tác khi `column.boardId` khớp `boardId` trên URL.
- `beforeColumnId: null` chuyển Column xuống cuối; không cho di chuyển trước
  chính nó hoặc sang Board khác.
- Column còn bất kỳ Card nào, kể cả archived Card, trả `409 COLUMN_NOT_EMPTY`.
- Không tự move, archive hoặc xóa Card khi xóa Column.

## Ordering và tính nhất quán

- Position khởi tạo theo bước `100.0000000000`.
- Arithmetic được thực hiện bằng fixed-scale `BigInt`, không dùng JavaScript
  floating-point.
- Reorder chỉ cập nhật Column được di chuyển khi còn fractional gap.
- Khi gap không còn biểu diễn được trong `NUMERIC(20,10)`, toàn bộ thứ tự được
  rebalance trong cùng transaction.
- Create, reorder và delete khóa dòng Board trong transaction để serialize các
  thay đổi đồng thời trên cùng Board.
- Delete vẫn bắt và chuyển lỗi FK `23503` thành lỗi nghiệp vụ nhất quán để
  bảo vệ race condition giữa kiểm tra Card và delete.

## Files chính

- `apps/backend/src/api/columns/columns.module.ts`
- `apps/backend/src/api/columns/columns.controller.ts`
- `apps/backend/src/api/columns/columns.service.ts`
- `apps/backend/src/api/columns/columns-ordering.ts`
- `apps/backend/src/api/columns/dto/`
- `apps/backend/test/columns-ordering.spec.ts`
- `apps/backend/test/columns.e2e-spec.ts`
- `apps/backend/test/columns.integration.mjs`

## Kiểm thử

- Unit test fixed-scale ordering và rebalance.
- HTTP E2E test cho authentication, envelope, validation và cả năm endpoint.
- PostgreSQL integration test cho persistence, MEMBER permissions, archived
  board, concurrent create, rebalance và delete rule.

## Validation

Đã chạy:

- Shared build: pass.
- Backend Nest build: pass.
- Frontend TypeScript/Vite build: pass; chỉ có cảnh báo bundle chunk lớn hơn
  `500 kB`.
- Backend Jest: `24` suites, `164` tests pass.
- Column targeted Jest: `2` suites, `7` tests pass.
- Shared Node tests: `3` tests pass.
- Frontend Vitest: `28` files, `175` tests pass.
- ESLint trên `apps packages`: pass.
- Prettier trên toàn bộ file thuộc task: pass.

Chưa pass/không chạy được:

- PostgreSQL integration: bị chặn bởi `ECONNREFUSED 127.0.0.1:5433`; Docker
  Desktop cũng không chạy trong môi trường này.
- Full `prettier --check .`: fail vì `245` file đã tồn tại trong repository
  lệch format ngoài scope; các file thuộc task đã pass targeted check.
- `pnpm` wrapper tự tái tạo `node_modules` trước mỗi lệnh nên các script pnpm
  không hoàn tất; các lệnh build/test/lint tương đương đã được chạy trực tiếp
  bằng binary đã cài theo lockfile.
- Môi trường hiện dùng Node `22.12.0`, thấp hơn yêu cầu project `>=22.13.0`;
  pnpm phát cảnh báo engine nhưng các build/test không-DB vẫn pass.
