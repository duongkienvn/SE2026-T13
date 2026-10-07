# Realtime Collaborative Kanban

Ứng dụng Kanban cộng tác nhiều người theo thời gian thực. Thành viên có thể cùng quản lý board, column và card, trao đổi qua comment và thấy thay đổi mà không cần tải lại trang. Project hiện ở giai đoạn chuẩn bị nền tảng và kiến trúc; các business feature chưa được implement.

## Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, TanStack Query, dnd-kit, Socket.IO Client.
- **Backend:** NestJS, TypeScript, REST API, Socket.IO, TypeORM.
- **Database:** PostgreSQL; **tooling:** pnpm workspace, Jest, Supertest, Vitest, ESLint, Prettier, Docker Compose, GitHub Actions và CodeRabbit review.

## Repository Structure

```text
apps/frontend/   React application
apps/backend/    NestJS application
packages/shared/ Contracts, types và enums dùng chung
docs/            Project, architecture và task documentation
.github/         CI/workflow configuration
```

## Getting Started

Cần Node.js 22.13 trở lên, pnpm 10 trở lên và Docker với Docker Compose. Từ root của repository:

```sh
pnpm install
cp .env.example .env
docker compose up -d
pnpm dev
```

Trên PowerShell, có thể dùng `Copy-Item .env.example .env` thay cho `cp`. Kiểm tra và chỉnh các giá trị trong `.env` trước khi khởi động. Frontend chạy tại `http://localhost:5173`; API health endpoint tại `http://localhost:3000/`. PostgreSQL dùng host port `5433` mặc định để tránh xung đột với PostgreSQL cài trên máy; `DATABASE_PORT` đổi host port này, còn container dùng port `5432`. `WEB_PORT` và `API_PORT` đổi port của hai app. Các biến `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD` cấu hình cả container và API; `DATABASE_HOST=localhost` cho API chạy trên máy kết nối qua published port.

Có thể chạy riêng từng app bằng `pnpm dev:frontend` hoặc `pnpm dev:backend` sau khi khởi động PostgreSQL. Kiểm tra workspace bằng:

```sh
pnpm lint
pnpm test
pnpm build
pnpm format:check
```

Database migration sẽ được thêm cùng thay đổi schema đầu tiên; TypeORM schema synchronization đang tắt.

## Documentation

- [Project overview](docs/project-overview.md): mục tiêu, phạm vi MVP, thuật ngữ, kiến trúc tổng quan và trạng thái hiện tại.
- [Architecture](docs/architecture/): tài liệu kiến trúc chi tiết khi được bổ sung.
- [Tasks](docs/tasks/): tài liệu task.

## Development Workflow

Issue → branch từ `main` → Pull Request → CI và review → merge. `main` được bảo vệ; không push trực tiếp. Xem [project overview](docs/project-overview.md) để biết tên branch và commit convention.
