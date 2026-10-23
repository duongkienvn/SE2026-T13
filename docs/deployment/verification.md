# Issue #64 verification record

Verified on 2026-10-23 from the existing repository checkout, branch
`chore/production-infrastructure`. Initial worktree was clean. Initial HEAD,
local main and the read-only remote main check all identified
`25c75eae034894e97efa256accd821a894e43a44` (Comments tests PR #65 already merged).
Issue #64 and its empty comment thread were read through the GitHub connector.

## Environment and results

Windows host, Linux Docker Desktop engine 28.5.1, Compose 2.40.0, host Node
22.17.0 and pnpm 10.18.3. Docker Desktop was initially stopped and was started for
the local verification. No AWS service, production database, DNS record, external
deployment or remote Git write was used. No dependency was added.

| Command/check                                                                   | Result                                                                                         |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                                     | PASS                                                                                           |
| `pnpm exec eslint scripts/deployment`                                           | PASS                                                                                           |
| `pnpm test`                                                                     | PASS across workspace; backend 42 suites / 304 tests                                           |
| `pnpm build`                                                                    | PASS; existing Vite warning for bundles over 500 kB                                            |
| `pnpm --filter @kanban/backend exec tsc --noEmit --incremental false`           | PASS                                                                                           |
| Proxy + existing rate-limit targeted Jest suites                                | PASS: 2 suites / 11 tests                                                                      |
| `pnpm test:infra`                                                               | PASS: 4 tests, including rendered production/local Compose and fail-closed missing secrets/tag |
| `docker build -f apps/frontend/Dockerfile -t kanvexa-frontend:issue64-verify .` | PASS                                                                                           |
| `docker build -f apps/backend/Dockerfile -t kanvexa-backend:issue64-verify .`   | PASS, including frozen production deployment                                                   |
| `IMAGE_TAG=issue64-verify pnpm verify:images`                                   | PASS                                                                                           |
| Caddy `validate` for production and local config inside frontend image          | PASS, no network/certificate request needed                                                    |
| `IMAGE_TAG=issue64-verify pnpm test:infra:smoke`                                | PASS; temporary project cleaned                                                                |
| Changed supported files: Prettier check                                         | PASS                                                                                           |
| `git diff --check`                                                              | PASS                                                                                           |
| `pnpm format:check`                                                             | FAIL: 396 unchanged files outside this task; see CRLF evidence below                           |
| Real production DNS, ACME certificate issuance/renewal and AWS resource sizing  | NOT RUN: reserved for authorized provisioning/deployment                                       |

Shell syntax in this table uses Bash. In PowerShell set `$env:IMAGE_TAG` before
the same pnpm commands. All production images were built locally; no registry
push was performed.

## Image and integration evidence

Local verification images (image IDs, not registry manifest digests):

- Frontend: `sha256:260802d9f1fb456e4a622aee120d5e51cc83312431eb2939503a2ca551a4ff9f`,
  66,945,808 bytes. Runtime contains Caddy/static assets, without Node build tools.
- Backend: `sha256:f59de6afde623732cb577efe77ccb7254de71ff562326b3d77eb3b5320081c3a`,
  331,844,646 bytes; configured user `node` and command `node dist/main.js`.

Image checks ran without network and with a read-only backend root filesystem.
They loaded argon2, performed hash/verify through its native addon, loaded pg,
TypeORM and the shared CommonJS export, resolved the TypeORM CLI, and found
compiled migration artifacts. Application source, Jest, ts-node, shared source
and `.env` were absent. The frontend bundle contained the relative `/api` base
and no development `http://localhost:3000` origin.

The successful local smoke project `kanvexa-smoke-d2a16fcc2a5e` used independent
temporary volumes and process-local random credentials. It verified:

1. PostgreSQL readiness; pending migration status; explicit compiled migration
   execution; status with no pending migrations.
2. Production image startup and container health under the actual limits,
   network isolation and filesystem/capability settings.
3. Real registration/login (native password hashing) and persisted Board creation
   through the unchanged `/api` reverse proxy.
4. React deep-link fallback, no-cache HTML, immutable hashed assets, missing asset
   404, disabled Swagger, liveness, DB readiness and exact-origin admission.
5. Engine.IO polling and authenticated Socket.IO over a native WebSocket upgrade.
   Exact no-slash `/socket.io` preserved backend JSON 404 instead of SPA HTML.
6. PostgreSQL stopped: liveness remained 200, readiness became 503.
7. Database/backend/Caddy restart and ingress recovery; the same Board and JWT
   remained valid, followed by another successful authenticated smoke check.
8. Cleanup of only the random project's containers, networks and volumes. A final
   Docker listing found no `kanvexa-smoke-*` containers/networks/volumes.

The local HTTP override did not bind 80/443 or require production DNS/ACME.
The production Caddyfile was validated independently and remains HTTPS-only.
Actual certificate issuance, renewal and Internet WSS were not claimed as tested.
Backup/restore operations are documented, but no real backup destination or
production restore was exercised. EC2 load testing and monitoring remain to do.

## Existing CRLF formatting evidence

Compared unchanged `.prettierrc.json` and `apps/backend/src/main.ts` with initial
HEAD using `git show 25c75ea:<path>`, then Prettier's `check()` API:

```text
Both files:
  working copy contains CRLF: true
  working copy after CRLF -> LF equals initial HEAD: true
  initial HEAD Prettier check: true
  working-copy Prettier check: false
  LF-normalized working-copy Prettier check: true
```

The full check reports 396 files outside the final task diff. All task-supported
files pass the targeted check. The rest of the repository was not reformatted,
and neither Git's line-ending configuration nor the global formatter was changed.

## File inventory and scope

| Files                                                                                                | Responsibility                                                                                                       |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `.dockerignore`, `.gitignore`                                                                        | Exclude host modules, env/secrets, backups and build outputs; permit the credential-free production template         |
| `packages/shared/package.json`                                                                       | Package compiled ESM/CJS outputs for production workspace deployment                                                 |
| `apps/frontend/Dockerfile`                                                                           | Frozen multi-stage Vite build, public `/api` arg, Caddy/static runtime and health check                              |
| `apps/backend/Dockerfile`                                                                            | Frozen multi-stage Nest build, portable production dependencies, native runtime check, non-root startup/readiness    |
| `infra/caddy/Caddyfile`, `infra/caddy/Caddyfile.local`, `infra/caddy/routes.caddy`                   | Production HTTPS, separate local HTTP, shared proxy/static/cache/security routing                                    |
| `compose.prod.yml`, `compose.local.yml`                                                              | Production services, explicit migration tool, private networking, volumes, limits, logs; loopback-only test override |
| `.env.production.example`                                                                            | Blank deployment credentials/tag and documentation of fixed/public configuration                                     |
| `apps/backend/src/config/environment.ts`, `apps/backend/src/http-application.ts`                     | Validated opt-in single-hop proxy trust; preserve default direct-access behavior                                     |
| `apps/backend/test/foundation/proxy.e2e-spec.ts`                                                     | Validation, forwarded-chain boundary and client rate-limit isolation tests                                           |
| `scripts/deployment/config.test.mjs`                                                                 | Rendered Compose security/resource/migration contract checks                                                         |
| `scripts/deployment/verify-images.mjs`                                                               | Actual Caddy/runtime/bundle image verification                                                                       |
| `scripts/deployment/smoke.mjs`                                                                       | Read-only HTTP/Socket.IO smoke, with optional existing JWT                                                           |
| `scripts/deployment/local-smoke.mjs`                                                                 | Isolated migration/persistence/outage/restart lifecycle smoke                                                        |
| `package.json`                                                                                       | Explicit infrastructure verification scripts; existing scripts unchanged                                             |
| `README.md`, `docs/architecture/backend-architecture.md`, `docs/architecture/system-architecture.md` | Deployment entry point and production/proxy architecture references                                                  |
| `docs/deployment/production.md`, `docs/deployment/verification.md`                                   | Deployment/operations/recovery runbook and this evidence record                                                      |

Development Compose, existing CI, lockfile/workspace linking, frontend source,
shared contracts, backend business modules, realtime code and schema/migrations
were compared with initial HEAD and remain unchanged. The only application source
change is infrastructure proxy configuration, justified and tested above.

The final local commit series belongs solely to Issue #64. No push, PR, merge,
AWS provisioning, DNS change or production migration was performed. Docker test
images remain locally available for review.
