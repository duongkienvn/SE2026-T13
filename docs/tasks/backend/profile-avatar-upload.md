# Private profile avatars — Issue #103

## Design and invariants

- Production uses AWS SDK v3 constrained presigned POSTs: 60-second grants,
  exactly one backend-generated pending key, exact MIME and exact requested bytes
  between 1 byte and 5 MiB.
  Intents expire after five minutes and belong to the JWT user, not request IDs.
- Backend reads bounded bytes, checks framing/MIME/decoded raster, disallows
  animation, limits pixels and normalizes orientation to a metadata-free 512px
  WebP. Untrusted pending objects are never served.
- PostgreSQL stores a stable object key plus monotonic avatar revision. Intent
  ownership/state and revision checks serialize replacement/removal under User
  row locks. S3 IO/image decoding happen outside transactions. Duplicate complete
  cannot resurrect a superseded avatar. Display-name patches touch that field only.
- Reads use authenticated backend binary delivery, not signed GET URLs. A user
  can read their own avatar or an avatar of a current member sharing a Board.
  Every read rechecks current membership and the requested asset version. HTTP
  responses are private/no-store; the frontend deduplicates blobs per session and
  asset version, revokes preview/object URLs and falls back to initials on failure.
- Legacy HTTPS avatar URLs remain unchanged until upload/remove. Manual URL writes
  are retired; neither arbitrary S3 keys nor URLs can bypass verification.
- Committed pointers are detached before old objects become eligible for cleanup.
  Expired/failed intents track both pending and potential active keys for recovery
  after ambiguous S3/DB failures. Cleanup rechecks references, rejects expired work,
  retries failed deletes and never removes a referenced object. A bucket lifecycle
  also bounds abandoned pending objects. No external avatar is downloaded.
- `memory` storage provides local multipart upload without AWS or filesystem
  assets; it is forbidden in production. Default `disabled` returns an honest 503.
  Tests inject fake storage; no test accesses the production bucket.

## API and persistence

All routes below use `/api` and the existing JWT/session invalidation guard.

| Method/path                                        | Request / result                                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `POST /users/me/avatar/uploads`                    | `{ contentType, fileSize, expectedRevision }` → 201 `{ uploadId, expiresAt, upload: { kind, url, fields } }`                        |
| `POST /users/me/avatar/uploads/:uploadId/complete` | No client key/userId → 200 public `UserResponseDto` after actual byte verification and commit                                       |
| `DELETE /users/me/avatar`                          | `{ expectedRevision }` → 200 public user with null avatar                                                                           |
| `GET /users/:userId/avatar/:assetId`               | Authorized current normalized bytes, `image/webp`, private/no-store, nosniff; 404 otherwise                                         |
| `POST /users/me/avatar/uploads/:uploadId/file`     | Local `memory` mode only, one multipart `file`, 204; JWT/owner/size/MIME checks. Disabled/S3 mode rejects before parsing multipart. |

JSON follows existing envelopes/DTO allowlists. `PATCH /users/me` now accepts
only `displayName`; unknown avatar URL/key fields return `VALIDATION_FAILED`.
This deliberately retires the URL-writing client contract, requiring coordinated
frontend/backend rollout. Existing external HTTPS URLs still render directly
with no-referrer and initials fallback. New response `avatarUrl` values are
API-relative stable asset paths, not direct `<img>` URLs: consumers use the shared
JWT/blob renderer. `avatarRevision` is public; S3 object keys/intents/credentials
are not exposed in User DTOs. Upload targets necessarily contain their constrained
pending key and signing fields; never log these.

Keys are `avatars/v1/pending/{userId}/{uploadId}` and
`avatars/v1/active/{userId}/{uploadId}.webp`. Immutable active PUT uses
`If-None-Match: *`. Unknown fields, oversize requests and unsupported MIME fail
before creating an intent. Expiry/replay/conflict is 409; byte/MIME/decoder errors
use `AVATAR_*` codes with 413/415/422; busy/unconfigured/storage failure is 503.
There is no arbitrary key completion or public avatar directory. The existing
Board authorization service remains the membership boundary, including archived
Boards that can still be read. Read authorization is checked again after S3 IO.

Migration `1793102400103-PrivateAvatars` adds owner-constrained unique object keys,
nonnegative revisions and `avatar_uploads` with FK, unique key, MIME/size/state/
expiry checks and cleanup indexes. It neither rewrites legacy URLs nor touches
auth credentials/preferences/Board data. Down refuses current private pointers;
after an explicit detachment/export decision it removes intent/revision metadata,
not S3 bytes. See the [operator rollback plan](../../deployment/private-avatars.md).

Two completions for one base revision cannot both win. Remove also advances the
revision, invalidating older intents. Same current completion/removal retries are
idempotent; superseded completions cannot resurrect images. A successful DB
commit with a lost acknowledgement preserves the current asset for retry. Old
objects are never deleted during the mutation or on an ambiguous failure.
Durable cleanup rechecks under User→intent locks before deleting unreferenced
keys. No process-local queue is relied upon for database consistency.

## Frontend and approved visual scope

`/settings/profile` keeps the vertical #107 form and legacy `/profile` redirect.
Profile photo selection/preview/upload/cancel/remove are Available under #103;
display name and read-only email retain their positions. Bio, session/device
management, account deletion and other storage features remain excluded. Settings
navigation and disabled/Soon slots are unchanged. The
[Settings reference/spec](../../design/post-mvp/settings-notifications/ux-spec.md)
is applied with #103's explicit upload approval and semantic light/dark tokens.

`AvatarEditor` validates local MIME/5 MiB size for early feedback, then waits for
backend verification. It handles pending/error/retry and revokes preview URLs.
The single Profile unsaved-edits guard covers independent name/photo drafts.
Name and avatar responses merge only their owned fields into current-user cache;
avatar merges also reject older revisions. Session generation/current checks
surround async side effects; unmount/session switch aborts transfers and cannot
populate another account's cache. S3 receives FormData fields/file only, no JWT.

All existing `UserAvatar` placements use the same managed-blob renderer: header,
sidebar/footer, Profile, members, assignees, presence, comments and activity. It
deduplicates reads per session generation/version for five minutes, avoids an
automatic failure retry loop, revokes object URLs and uses initials on denial/image
failure. Current-user fields override stale Board DTO avatar fields. Board
revocation resets avatar caches; member-removal hints revalidate reads. Refresh
fetches the stable API asset again; no expiring signed GET is retained. Other
members' profile DTOs update on normal Board/member refetch; no new profile
realtime event was introduced.

## Local operation and verification

Copy `.env.example` with `AVATAR_STORAGE_DRIVER=memory`, apply migrations explicitly
to the designated development DB, and use normal `pnpm dev`. RAM storage is capped
at 64 MiB and is ephemeral across backend restarts; it is a local exercise mode,
not persistent S3 emulation. Default/production example stays disabled until
[manual AWS preparation](../../deployment/private-avatars.md). No real AWS
credentials are needed by tests; `NODE_ENV=test` forces inherited S3 mode off.

`pnpm --filter @kanban/backend test:avatars:database` creates its own randomly
named disposable PostgreSQL 16 Docker container bound to loopback, runs all
migrations and the existing foundation suite against that server, and removes
the container in `finally`. It ignores the user's DB settings. Real JWT, DTOs,
HTTP, authorization, decoder and PostgreSQL locks are exercised; only object
storage is in-memory. For browser QA after building, run
`node test/users/avatar.integration.mjs --serve` from `apps/backend`: disposable
API at port 3001 and a printed test-only account/container name. Ctrl+C requests
graceful cleanup. If a shell forcibly terminates the process before `finally`,
verify and stop that exact printed disposable container manually. Point a separate
Vite process's `VITE_API_BASE_URL` at `http://127.0.0.1:3001/api`.

### Verification record — 2026-10-27

| Check                                                                                    | Result                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                                              | PASS                                                                                                                                                                 |
| `pnpm test`                                                                              | PASS: backend 559 / 56 suites; frontend 800 / 91 files; shared 6                                                                                                     |
| `pnpm build`                                                                             | PASS. Existing Vite local `.env` NODE_ENV warning and >500 kB chunk advisory remain.                                                                                 |
| `pnpm --filter @kanban/backend test:avatars:database`                                    | PASS: dedicated avatar cases plus existing database-foundation suite, fresh/legacy up/down/up, no entity drift, DB constraints, pagination and guarded enum rollback |
| `pnpm test:infra`                                                                        | PASS: 17 checks, including private prefix policy and backend-only env contracts                                                                                      |
| `pnpm format:check`                                                                      | FAIL: 590 untouched files report existing style/CRLF issues. All changed/new supported files pass targeted `prettier --check`; no unrelated formatter cleanup.       |
| `git diff --check` and changed Markdown local links                                      | PASS                                                                                                                                                                 |
| `docker build -f apps/backend/Dockerfile -t kanvexa-backend:avatar-local-verification .` | PASS, final Linux native Sharp/libvips check                                                                                                                         |
| Read-only Linux runtime exercise                                                         | PASS: network disabled, non-root, 512 MiB / 0.75 CPU, two 4096×4096 PNGs normalize to 512px WebP; third concurrent job rejects 503                                   |
| Production S3/IAM/CORS/IMDSv2, live rollout/smoke                                        | NOT RUN: manual operator gates, no AWS changes authorized                                                                                                            |

The PostgreSQL schema introspection emits a pg deprecation warning from TypeORM's
internal parallel metadata queries; the complete suite passes. This is not a
claim about production load, migrations or AWS permissions. No cloud provisioning,
production migration or production upload was performed.

Browser QA used the real local memory adapter and disposable PostgreSQL API,
not production S3. Chrome covered native file selection, local preview, upload,
verified save, loaded 512px authenticated images in Profile/header/footer,
reload persistence within the running backend, replacement and removal/initials.
Screenshots were inspected at 375×812 light, 768×1024 dark, 1280×800 light/reduced
motion and approximately 1440×826 dark. No page overflow or clipped actions was
found; photo actions measure at least 44px. Keyboard Tab showed visible focus and
Enter activated Remove. Final Profile console had no errors/warnings; reads
succeeded (React development StrictMode/HMR also cancels superseded requests).
After live code edits one development HMR session emitted Router blocker warnings;
a clean production-bundle preview rechecked the unsaved-photo dialog/Keep editing,
upload and loaded images at 375px with no console errors/warnings.
Board/presence/comment placements are covered by their existing regression tests
and the common renderer, not a claim of a separate populated-browser fixture for
every screen. No manual screen-reader audit was run.

| Reference element                        | State and scoped implementation                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| Profile photo and identity               | Available; existing top identity row retained, real picker/preview below it     |
| Change/Remove                            | Available by explicit #103 approval; cancel and verification status added       |
| Name/email/save                          | Available; existing vertical form, independent name mutation, email read-only   |
| Seven Settings sections                  | Existing order and routes retained; Notifications/Data & Privacy remain Soon    |
| Bio/devices/destructive controls/billing | Excluded; absent                                                                |
| Mobile shell and themes                  | Existing drawer/Back to Settings and semantic Light/Dark/System tokens retained |

### Changed areas

- Backend: [avatar module](../../../apps/backend/src/api/users/avatars/avatar.module.ts),
  storage/normalizer/service/controller/DTO/config, User/AvatarUpload entities,
  [migration](../../../apps/backend/src/database/migrations/1793102400103-PrivateAvatars.ts),
  profile DTO/service/module, environment validation, AWS/Sharp dependencies and
  lockfile, image/storage/integration tests and schema foundation expectations.
- Frontend: [AvatarEditor](../../../apps/frontend/src/features/auth/components/AvatarEditor.tsx),
  avatar API/managed `UserAvatar`, Profile form/types, Board revocation/member
  invalidation and associated interaction/session/cache regression tests.
- Deployment/docs: backend Docker native check, Compose/env examples,
  [manual runbook and policy JSON](../../deployment/private-avatars.md), infra
  contracts, database design, Settings scope override, production/task indexes.
