# STAB-01 — Backend stabilization

Implements [issue #209](https://github.com/duongkienvn/SE2026-T13/issues/209) and
the serialization, scanner and lease findings from PRs #200 and #201. Local
implementation/verification only; no production flag, secret or deployment changed.

## Mention response compatibility

`CommentMentionResponseDto` exposes only `userId`, `start` and `end`, with
`@Type` on `CommentResponseDto.mentions`. The shared response transformer keeps
its allowlist policy; request validation and public JSON contracts are unchanged.
Tests cover empty, single and multiple mentions, UTF-16 spans after an emoji,
unknown-field exclusion and compiled create/edit/list HTTP responses.

## Lease and reminder decisions

- Batch claims still use `FOR UPDATE SKIP LOCKED`. After Board, Workspace and
  recipient locks, dispatch renews a row only if this worker still owns it and
  its lease is live or no attempt has ever been recorded. Competing ownership
  is never overwritten. Expired attempted rows become `UNKNOWN` automatically.
- Eligibility is evaluated separately from lease age. `CANCELLED` still means
  genuine ineligibility (consent, verification, ACL, archived content, stale age
  or due occurrence), rather than a lease expiring while waiting in a batch.
- A final conditional attempt write fences lease expiry during the decision.
  Without a valid lease there is no provider call; recovery selects `PENDING`
  before any attempt, otherwise `UNKNOWN`. The provider call stays outside
  database transactions/domain locks. Existing definitive retry backoff, rate
  limits, terminal ambiguity, provider idempotency key and shutdown recovery stay
  intact. This does not promise exactly-once delivery by an external provider.
- Scanner candidates include a database-clock preview. A not-yet-eligible
  schedule advances the keyset cursor without taking domain locks. This avoids
  application clock skew. Current Card, timezone, permissions, assignment and
  database time are still rechecked under the original transaction locks; the
  final due-instant check, occurrence digest and unique constraints are retained.

No schema migration, notification kind/provider, UI redesign or new service.

## Production configuration

The frontend Dockerfile, production Compose build args and existing CD workflow
now forward public `VITE_TASK_EMAIL_ENABLED`, default `false`. Both backend
flags remain default-off. Runtime variables do not rebuild Vite. The
[production runbook](../../deployment/production.md) records QA, controlled
backend enablement, readiness checks, subsequent frontend release and safe
disablement. STAB-03 integrated QA and explicit rollout approval remain required.

## Verification

Local checks (not deployment evidence):

- `pnpm lint`: pass. Backend compilation and frontend TypeScript/production
  bundling via `pnpm build`: pass, with existing Vite NODE_ENV and chunk warnings.
- Focused DTO/scanner Jest tests: 17 passed. Frontend flag tests: 6 passed.
- `pnpm test` with `VITEST_MAX_WORKERS=2`: backend 105 suites / 1,095 tests and
  shared 20 tests passed. Frontend 139/140 files and 1,461/1,462 tests passed;
  unchanged `RegisterPage > maps backend validation details to fields` found
  two alerts when the Google SDK load error also appeared. Rerunning that file
  alongside the flag tests passed all 29 tests. No auth UI/test changes were made.
- Real PostgreSQL comments persistence script: pass. Notification foundation
  PostgreSQL/HTTP/Socket.IO script: all 16 groups passed, including compiled
  create/edit/list mention serialization and request validation.
- Task notification PostgreSQL script: pass, including new slow-batch expiry,
  ownership takeover, domain-lock waits, PENDING/UNKNOWN attempt fencing and
  lock-free future reminder / concurrent eligible reminder cases. Existing rate,
  ACL, retry, crash/shutdown, timezone/DST and authoritative rechecks also passed.
- `pnpm test:infra`: all 21 tests passed (Compose rendering needs the Docker CLI,
  not a running daemon). Isolated Vite production builds with explicit `false`
  and `true` each embedded the expected email UI flag.
- Changed-file Prettier and `git diff --check`: pass. Repository-wide
  `pnpm format:check` still reports pre-existing formatting in untouched files;
  no repository-wide write was performed.

The PostgreSQL scripts were run with `NODE_ENV=test`, a loopback host, the
`NOTIFICATION_DATABASE_TESTS=local-only` guard where required and protected local
test credentials. They created/dropped random temporary databases. All mail was
fake. The race helper forces lease expiry in SQL instead of sleeping for two
minutes while a provider/domain lock is stalled; it counts raw provider calls
without fake-mailer deduplication. No network I/O occurs under domain locks.

Docker image build/runtime checks were not run because the local Docker daemon
was unavailable. No real Resend call or inbox delivery was tested. These remain
part of integrated QA before any production enablement; the defaults remain off.
