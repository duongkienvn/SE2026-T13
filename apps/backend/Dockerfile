# syntax=docker/dockerfile:1
FROM node:22.23.4-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace
RUN npm install --global pnpm@10.18.3
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/backend/package.json apps/backend/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=kanvexa-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @kanban/backend... --store-dir /pnpm/store

COPY packages/shared packages/shared
COPY apps/backend apps/backend
RUN pnpm --filter @kanban/backend... build \
    && pnpm --filter @kanban/backend deploy --prod --legacy /out/backend

FROM node:22.23.4-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=384
ENV DOTENV_CONFIG_QUIET=true
WORKDIR /app
COPY --from=build --chown=node:node /out/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/backend/dist ./dist
COPY --from=build --chown=node:node /workspace/apps/backend/package.json ./package.json
USER node
# Verify the actual native addon and workspace CommonJS export in the final stage.
RUN node -e "require('argon2'); require('pg'); require('@kanban/shared'); require('typeorm'); require.resolve('typeorm/cli.js')"
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:3000/health/ready',{signal:AbortSignal.timeout(2500)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
