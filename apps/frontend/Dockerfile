# syntax=docker/dockerfile:1
FROM node:22.23.4-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace
RUN npm install --global pnpm@10.18.3

# Dependency layers survive application-only edits. Never copy host node_modules.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/backend/package.json apps/backend/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=kanvexa-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @kanban/frontend... --store-dir /pnpm/store

COPY packages/shared packages/shared
COPY apps/frontend apps/frontend
# Public build-time configuration only. Runtime secrets never enter this stage.
ARG VITE_API_BASE_URL=/api
ARG VITE_GOOGLE_CLIENT_ID=
RUN test "$VITE_API_BASE_URL" = /api \
    && VITE_API_BASE_URL="$VITE_API_BASE_URL" VITE_GOOGLE_CLIENT_ID="$VITE_GOOGLE_CLIENT_ID" pnpm --filter @kanban/frontend... build

FROM caddy:2.11.7-alpine AS runtime
COPY infra/caddy/ /etc/caddy/
COPY --from=build /workspace/apps/frontend/dist /srv
EXPOSE 80 443 443/udp
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:2019/config/ || exit 1
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
