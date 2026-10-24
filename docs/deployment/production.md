# Kanvexa production deployment — Issues #64 and #68

This runbook prepares one AWS EC2 Ubuntu Server 24.04 LTS machine with about
2 GiB RAM. Kanvexa is live at https://kanvexa.tech. The existing checkout is
`/opt/kanvexa`, secrets are `/etc/kanvexa/production.env` (root-owned 0600), and
the Compose project is `kanvexa`. Infrastructure/DNS are already provisioned.
See [production CI/CD](cicd.md) for GHCR publishing, review-gated OIDC/SSM delivery,
first-publication steps, failure handling and manual release controls. Server
commands below use an authorized Bash administrator session from the repo root.

PRs targeting `main` run **CI** (`.github/workflows/ci.yml`), retaining the required
`Quality checks` status. A push to `main` or manual **Actions → CD → Run workflow →
main** runs **CD** (`.github/workflows/cd.yml`): reusable CI → publish both SHA-tagged
GHCR images → production approval → OIDC/SSM delivery → production smoke. A failed
quality check blocks publishing and deployment; off-main dispatch skips every job.
Only `deploy` uses the protected `production` environment. CI/CD concurrency groups
are distinct; main CD runs and the existing `kanvexa-production` deploy group do
not cancel active runs. Deployments remain serialized, including migration work;
keep the host lock for manual operations. See the CI/CD runbook for pending-run
replacement semantics and the branch-protection inspection limits. This workflow
refactor performs no production deployment and changes no deployment scripts.

## Architecture and verified repository facts

```text
Internet -> HTTPS/WSS kanvexa.tech -> frontend (Caddy + React static /srv)
                                       | /api/*, /socket.io/*, /health[/ready]
                                       v
                                    backend:3000 -> postgres:5432
```

- Three long-running services: `frontend`, `backend`, `postgres`. `migrate` is an
  explicit one-shot tool under the `tools` profile. No additional frontend server.
- Only Caddy publishes TCP 80/443 and UDP 443 (HTTP/3). Its admin endpoint stays on
  container loopback 2019. NestJS and PostgreSQL have no published ports.
- `application` network: Caddy/backend. Internal `database` network:
  backend/PostgreSQL/migration tool. Caddy cannot directly access PostgreSQL.
- Named volumes: `postgres_data`, `caddy_data` (certificates/keys), `caddy_config`.
  Keep the Compose project name stable. Never use `down -v` on production.
- Memory limits: PostgreSQL 512 MiB, backend 512 MiB, Caddy 128 MiB; 1152 MiB total.
  Migrations have a separate 384 MiB limit. Backend V8 heap is 384 MiB, with native
  memory additional. These are starting bounds; load-test actual capacity.
  JSON container logs rotate at 10 MiB, retaining three files per container.
- Builds use Node 22.23.4, pnpm 10.18.3, frozen lockfiles and isolated build
  contexts. Final images use Caddy 2.11.7-alpine and Node bookworm-slim;
  PostgreSQL is pinned to 16.15-alpine3.24. Review security patches and rebuild
  regularly. Patch tags are controlled version pins, not immutable digests.
- Nest output is `dist/main.js`; compiled migrations are in
  `dist/database/migrations/`. `pnpm deploy --prod --legacy --frozen-lockfile`
  preserves portable workspace dependencies without changing workspace linking.
  Shared exports include ESM for Vite and CommonJS for Nest, including its CJS
  package marker. Native `argon2` and `pg` are checked in the final Linux image.
- Backend runs as `node`, with read-only filesystem, dropped capabilities,
  `init: true` and a 30-second shutdown grace period. Existing Nest bootstrap
  already enables shutdown hooks. Container startup does not run migrations.
- Vite embeds `/api` at build time. Runtime environment changes cannot change the
  built frontend. REST and Socket.IO share the browser origin. Prefixes remain
  intact. Engine.IO uses `/socket.io/`; the exact `/socket.io` path also proxies
  unchanged, preserving NestJS's JSON 404 rather than serving the SPA.
- Some existing overview/architecture documents still describe planned/skeleton
  features. The inspected code and tested artifacts above describe deployment;
  this issue does not change business features or event contracts.

## Infrastructure prerequisites

Keep these prerequisites in place; CI/CD does not recreate infrastructure:

1. Ubuntu 24.04 EC2, a stable public IP/Elastic IP, encrypted EBS (start with at
   least 20 GiB), accurate system time and security updates. Reserve space for
   database growth, image layers, logs and backup staging. Prefer building images
   on a larger workstation/runner rather than the 2 GiB serving instance.
2. Install Docker Engine and Compose plugin using the
   [official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
   Enable Docker at boot. Local overrides require Compose 2.24.4+.
   Docker-group membership grants effectively root access.
3. Use SSM for delivery and authorized administration. No inbound SSH is required
   by CI/CD; do not open TCP 22 for the runner. Security Group: public TCP
   80/443, optionally UDP 443. Never expose 3000, 5432 or 2019. Docker published
   ports can bypass UFW; use Security Groups and inspect actual bindings.
4. Permit required outbound DNS, time, image registries, ACME HTTPS and backup
   traffic. Point `kanvexa.tech` A to the stable IP when authorized; remove stale
   AAAA records unless IPv6 is configured. Port 80/443 admission and correct DNS
   are necessary for automatic certificate issuance/renewal.
5. A clean checkout at `/opt/kanvexa`, anonymous access to both public GHCR release
   images, Python 3, Git, Bash, `flock`, Docker Engine and Compose on `linux/amd64`.
   Local archives below remain an administrator fallback. No GHCR login/PAT is
   needed or used on EC2; a private package must block deployment.
6. An encrypted off-instance backup destination, retention, failure alerts,
   monitoring and a tested restore procedure. Agree RPO/RTO before serving users.

## Environment and secrets

K2 adds required backend mail configuration: `RESEND_API_KEY` (owner-managed
server secret), `MAIL_FROM="Kanvexa <no-reply@kanvexa.tech>"`, and
`PUBLIC_APP_URL=https://kanvexa.tech`. Add these to the protected external production
env before approving the K2 release; never put them in Vite variables/build args or
GitHub logs. Production validates them at startup and uses Resend HTTPS, without
an SMTP fallback. The migration tool does not consume the mail credentials.
See [K2 rollout and recovery](../tasks/email-verification.md) for backfill, backup,
dry-run and real-inbox verification. No real email is sent by automated tests.

Development `.env` and `docker-compose.yml` remain unchanged. Always explicitly
select production Compose and its environment file; never use bare `compose up`.
Create secrets outside the checkout, using an authorized administrator shell:

```bash
sudo install -d -m 0700 /etc/kanvexa
sudo install -m 0600 .env.production.example /etc/kanvexa/production.env
sudoedit /etc/kanvexa/production.env
```

Fill IMAGE_TAG with the release commit SHA, DATABASE_NAME and DATABASE_USER.
Supply unique random DATABASE_PASSWORD and JWT_SECRET from a password manager;
use at least 32 bytes of entropy for JWT (48 random bytes recommended). This
first-setup-only command writes secrets directly without printing them:

```bash
sudo python3 - <<'PY'
from pathlib import Path
import re
import secrets
p = Path('/etc/kanvexa/production.env')
text = p.read_text()
for key in ('DATABASE_PASSWORD', 'JWT_SECRET'):
    text = re.sub(rf'^{key}=.*$', f'{key}={secrets.token_hex(48)}', text, flags=re.M)
p.write_text(text)
PY
```

Do not rerun this against an existing database: changing POSTGRES_PASSWORD in
the environment does not rotate an existing database password. Coordinate SQL
password rotation separately. JWT rotation invalidates sessions. Never source an
unreviewed env file, place secrets in VITE values, commit them, or print rendered
Compose/inspect environments. Use `config --quiet` with real credentials. Unset
unrelated shell variables that could override the selected env file.

Production Compose fixes NODE_ENV=production, API_PORT=3000, API_PREFIX=api,
CORS_ORIGINS=https://kanvexa.tech, SWAGGER_ENABLED=false, LOG_LEVEL=info,
DATABASE_HOST=postgres, DATABASE_PORT=5432 and DATABASE_SSL=false. The template
documents these values; edit Compose deliberately if the topology must change.
VITE_API_BASE_URL=/api is public build-time configuration, not backend runtime
configuration. Secrets are passed only to the services that need them.

TRUST_PROXY_HOPS=1 enables correct client IP/rate limits behind the single Caddy
ingress; default direct/development trust remains disabled. Caddy ignores
untrusted incoming forwarded headers. This is safe only while no alternative
path reaches Nest directly. Never publish the backend port with this setting.
Docker administrators can inspect container secrets. The PostgreSQL bootstrap
role is administrative; separate limited application/migration roles are an
additional operational hardening option when required by policy.

## Manual image archive fallback

Normal releases use [the CI/CD runbook](cicd.md). The commands here are for an
explicitly authorized manual fallback or isolated verification.

On a suitably sized Docker host with the same CPU architecture as EC2:

```bash
export IMAGE_TAG="$(git rev-parse HEAD)"
docker build -f apps/backend/Dockerfile -t "kanvexa-backend:$IMAGE_TAG" .
docker build -f apps/frontend/Dockerfile -t "kanvexa-frontend:$IMAGE_TAG" .
pnpm verify:images
docker image save "kanvexa-backend:$IMAGE_TAG" "kanvexa-frontend:$IMAGE_TAG" \
  -o "kanvexa-$IMAGE_TAG.tar"
sha256sum "kanvexa-$IMAGE_TAG.tar" > "kanvexa-$IMAGE_TAG.tar.sha256"
```

Transfer through an approved secure channel, verify the checksum on the server
and `docker image load -i <archive>`. A manual
server build is also possible, after checking memory/disk and scheduling downtime.
Keep previous images for rollback.

On the server, from an authorized shell that can read the protected env file:

```bash
dc() {
  docker compose --project-name kanvexa \
    --env-file /etc/kanvexa/production.env -f compose.prod.yml "$@"
}
dc config --quiet
dc pull postgres
dc up -d --wait --wait-timeout 120 postgres
dc run --rm migrate
dc run --rm migrate migration:run -d dist/database/data-source.js
dc run --rm migrate
dc up --no-build -d --wait --wait-timeout 120 backend frontend
dc ps
```

Explicitly targeting `migrate` activates its profile. Default command is
`migration:show`: `[ ]` means pending, `[X]` means applied. Use the compiled
DataSource and Node TypeORM CLI; no ts-node or pnpm is needed in the container.
Database startup is gated on pg_isready. Confirm no pending migrations before
serving the new application. Run one migration operator at a time. Both
`synchronize: false` and `migrationsRun: false` remain unchanged.

After authorized DNS/SG setup, Caddy issues/renews TLS and redirects HTTP to HTTPS.
Keep its certificate/config volumes. Validate the running deployment:

```bash
dc exec -T frontend caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
curl -I http://kanvexa.tech
curl -I https://kanvexa.tech
curl --fail https://kanvexa.tech/health
curl --fail https://kanvexa.tech/health/ready
```

From an operator workstation with Node 22.13+ and installed repo dependencies,
run `pnpm smoke:production https://kanvexa.tech`. It creates no persistent data.
It checks real polling and WebSocket upgrade with unauthenticated rejection.
For authenticated verification, supply a short-lived test-account JWT through
SMOKE_ACCESS_TOKEN in a protected process environment and unset afterward; the
script does not print it. Verify login, Board access and realtime updates using
two browser sessions, and confirm WSS transport in Network tools. Do not share
screenshots/logs containing credentials.

## Local verification

After building images and exporting IMAGE_TAG:

```bash
pnpm test:infra
pnpm verify:images
pnpm test:infra:smoke
```

Configuration tests require Docker CLI/Compose and Python 3, but not a daemon.
The explicit local Compose override now uses `NODE_ENV=test` and fake mail delivery;
the smoke script verifies only its synthetic account directly in its disposable
database. This checks application/image wiring without contacting Resend. It is
not evidence of production mail configuration or inbox delivery.
CI/CD tests inject command failures without AWS or production access. Image/smoke
verification requires a running Linux Docker daemon. The smoke script owns a
random Compose project with random in-memory secrets and temporary named volumes;
it does not load development or production secrets. It tests migrations,
registration/login, persisted Board creation, SPA/API/polling/authenticated
WebSocket, database failure/readiness, restart and persistence. It waits for
ingress recovery and removes only its own project/volumes even on failure.

Port 8080 must be free. `compose.local.yml` replaces every production binding
with 127.0.0.1:8080:80, mounts Caddyfile.local read-only and sets the exact local
origin. TLS is disabled only in this explicitly selected override. Never use
that override on production. No real DNS or ACME certificate is needed locally.

## Updates, rollback and migration failure

For automated releases, follow [approval and failure handling](cicd.md); the
pipeline implements these steps without building on EC2 or modifying PostgreSQL.
For manual maintenance:

1. Review release/migration SQL and backward compatibility. Verify images
   off-server, record the current SHA and ensure a recent verified off-host
   backup. Schedule downtime for this single-instance MVP.
2. Pull and verify **both** release images anonymously (or load verified archives)
   while retaining old ones, before stopping anything or changing env.
   `dc stop frontend backend` stops
   application traffic. Keep PostgreSQL and volumes intact; take/export a backup.
3. Atomically update only IMAGE_TAG, BACKEND_IMAGE and FRONTEND_IMAGE in the
   protected env file with a 0600 backup (see CI/CD runbook). Run config validation,
   migration status, explicit migration execution, then status again.
4. On failure, keep traffic stopped. Inspect the migration/transaction state and
   backup; do not enable synchronization, fake migration history or start an
   incompatible version. Use a reviewed fix or deliberate database restore.
5. Start with `dc up --no-build -d --wait backend frontend`; verify HTTPS, REST,
   WSS and resources before reopening. Docker health failure alone does not
   restart a still-running container; monitor unhealthy states explicitly.

Application rollback: stop frontend/backend, restore the previous release's three image keys and
run the same `up --no-build` command. Never automatically revert migrations.
The old application must tolerate the current schema. Prefer expand/contract
schema changes. Otherwise choose a forward fix or approved restore, explicitly
accepting loss of writes after the backup. `dc restart backend` restarts the
same configuration; use `up` to apply changed environment/image settings.

## Backup and recovery

Use a secure staging directory and Bash's binary-safe redirection:

```bash
set -euo pipefail
umask 077
mkdir -p /var/backups/kanvexa
backup_file="/var/backups/kanvexa/$(date -u +%Y%m%dT%H%M%SZ).dump"
dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$backup_file"
dc exec -T postgres pg_restore --list < "$backup_file" > /dev/null
sha256sum "$backup_file" > "$backup_file.sha256"
```

Stop on dump failure; never treat a partial dump as a good backup. Copy dump and
checksum off EC2/EBS before considering the backup complete. A suitable future
destination is private S3 with block-public-access, versioning, SSE-KMS and
lifecycle retention, using a least-privilege EC2 instance profile. Recovery
read/decrypt access should be controlled separately. After it is provisioned:

```bash
aws s3 cp "$backup_file" "s3://<private-backup-bucket>/kanvexa/" \
  --sse aws:kms --sse-kms-key-id '<backup-kms-key-id>'
aws s3 cp "$backup_file.sha256" "s3://<private-backup-bucket>/kanvexa/" \
  --sse aws:kms --sse-kms-key-id '<backup-kms-key-id>'
```

An approved encrypted off-host backup service is also suitable. Establish daily
backups with weekly/monthly retention, missing-upload alerts, and periodic
isolated restore drills. Back up before every migration. Same-instance Docker
volumes or EBS alone are not sufficient. This issue installs no AWS credentials,
backup scheduler or remote services.

For recovery, stop the app, download a selected dump/checksum to a secured host,
verify integrity and restore into a new empty database. Example:

```bash
dc stop frontend backend
dc exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" kanvexa_recovery'
dc exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d kanvexa_recovery --no-owner --exit-on-error --single-transaction' \
  < "$backup_file"
```

Review ownership/permissions. Set DATABASE_NAME to the recovery DB in the protected
env file, select a schema-compatible application SHA and recreate PostgreSQL's
container (`dc up -d --wait postgres`, retaining its volume). Check migration
status, then start backend/frontend. Verify row counts, login, Boards and WSS
before reopening. Do not blindly run new migrations on an old restored release.
Preserve the original database until recovery is confirmed.

## Health and incident response

- Use `dc ps`, `dc logs --tail 100 backend`, `dc logs --tail 100 frontend` and
  `dc logs --tail 100 postgres`. Never dump secret environments. Caddy keeps
  operational logs without enabling access logs containing headers/query data;
  backend uses its existing redacted production JSON logger.
- Liveness `/health` proves process responsiveness only. Readiness `/health/ready`
  queries the DB and returns 503 on failure. Docker backend health uses readiness;
  PostgreSQL uses pg_isready; Caddy health probes the running loopback admin API.
  These checks do not prove migrations or end-to-end application behavior.
- DB unavailable: inspect container, disk, volume and credentials. Liveness can
  remain 200 during a DB outage. Do not expose 5432 to troubleshoot.
- Crash/OOM/unhealthy: inspect logs, exit code, migration status and memory.
  Use `docker stats --no-stream`; tune limits or resize based on measured load.
- TLS: inspect DNS A/AAAA, public IP, clock, port admission and Caddy logs.
  Do not disable production TLS or delete the certificate volume as a workaround.
- WSS: verify `/socket.io/`, exact CORS origin, JWT and backend health. Caddy
  supports WebSocket upgrade automatically; do not strip paths/change events.
- Storage: inspect `df -h`, `docker system df`, retention and log rotation. Remove
  only identified unused images while retaining rollback releases. Never perform
  blanket volume pruning. Keep builds off the 2 GiB serving instance.
- Before approving a release: verify the existing AWS/DNS setup, off-host backups,
  migration compatibility, capacity and TLS/WSS. Provisioning, backup/monitoring
  implementation and live rollouts are outside this repository change.

## References

- [pnpm Docker and deployment patterns](https://pnpm.io/10.x/docker)
- [pnpm deploy legacy workspace support](https://pnpm.io/10.x/cli/deploy)
- [Caddy reverse proxy/WebSocket behavior](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [Caddy SPA routing patterns](https://caddyserver.com/docs/caddyfile/patterns)
- [Compose networking](https://docs.docker.com/compose/how-tos/networking/)
