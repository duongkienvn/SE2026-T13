# Realtime Collaborative Kanban

Initial pnpm monorepo for a React frontend, NestJS API, and PostgreSQL development database.

## Requirements

- Node.js 22.13 or newer
- pnpm 10 or newer
- Docker with Docker Compose

## Start locally

```sh
pnpm install
cp .env.example .env
docker compose up -d
pnpm dev
```

On PowerShell, use `Copy-Item .env.example .env` instead of `cp` if preferred.

The frontend is available at `http://localhost:5173` and the API health endpoint at `http://localhost:3000/`. PostgreSQL uses host port 5433 by default to avoid conflicts with a local PostgreSQL installation. Set `DATABASE_PORT` in `.env` to change that host port; Compose maps it to port 5432 inside the container. Set `WEB_PORT` and `API_PORT` to change the app ports. To run one app at a time, use `pnpm dev:web` or `pnpm dev:api` after starting PostgreSQL.

`DATABASE_NAME`, `DATABASE_USER`, and `DATABASE_PASSWORD` configure both the local PostgreSQL container and the API. `DATABASE_HOST=localhost` points the locally running API to the container's published port.

`pnpm build`, `pnpm lint`, `pnpm test`, and `pnpm format:check` run workspace checks. Database migrations will be added with the first schema change; TypeORM schema synchronization is disabled.
