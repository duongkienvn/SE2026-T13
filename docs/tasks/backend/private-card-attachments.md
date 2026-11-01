# Private Card File Attachments — P3-06 / CD-03 part 2

Implements [Issue #159](https://github.com/duongkienvn/SE2026-T13/issues/159)
on the merged [P3-05 foundation](card-attachments-foundation.md). This record
describes local implementation and verification, **not a production rollout or
product-owner approval**. Storage remains disabled by default. P3-10 owns the UI.
See the [manual AWS runbook](../../deployment/private-card-attachments.md) before
enabling S3; no AWS resources were accessed or changed during implementation.

## V1 decisions and policy review

The P3-05 proposal is adopted as the following enforced implementation policy;
avatar limits are not reused. Production enablement requires explicit operator
acknowledgement, `ATTACHMENT_POLICY_ACK=v1`, after owner review of this policy.
The acknowledgement is a deployment gate, not evidence that approval occurred.

| Rule                 | Enforced behavior                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File size            | 1–10 MiB (10,485,760 bytes), both source and verified output                                                                                               |
| Card slots           | 20 total ACTIVE/PENDING URL and FILE attachments                                                                                                           |
| Board bytes          | 100 MiB total ACTIVE verified bytes plus PENDING reservations                                                                                              |
| Types/extensions     | PNG `.png`, JPEG `.jpg/.jpeg`, WebP `.webp`, PDF `.pdf`, UTF-8 text `.txt`; exact declared MIME required                                                   |
| Raster reservation   | Reserve the full 10 MiB before transfer because re-encoding can expand the source; ACTIVE consumes actual output bytes                                     |
| PDF/text reservation | Exact declared source bytes; verification preserves bytes                                                                                                  |
| Transfer             | Intent 15 minutes; each S3 POST at most 60 seconds; exact key, MIME, byte length and AES256 encryption                                                     |
| Verification         | Two completions per process; 120-second persisted lease, capped at intent expiry; 30-second provider operations                                            |
| Images               | Static raster only, at most 16 million pixels and 8192 per dimension; full decode and same-format re-encode, metadata removed; five-second decoder timeout |
| Cleanup              | Five-minute sweep; one-hour safety grace after the later of expiry/state change; daily permanent tombstone reconciliation                                  |
| HTTP abuse controls  | Intent, completion and local transfer: 12/minute/IP/process in addition to application controls                                                            |

Expired PENDING reservations count until the worker transitions them. FAILED,
EXPIRED and REMOVED rows consume no logical quota. Physical storage temporarily
includes raw, normalized and cleanup-pending objects and can exceed the logical
100 MiB. No per-owner/global storage quota or total pending-intent quota is
introduced. Multi-process rate limits are independent. These operational and
cost implications, retention, capacity and any future malware scanner require
owner/operator review before production enablement.

## Schema and compatibility

`1794009600000-PrivateCardFiles` adds hidden `declared_bytes`, `content_sha256`,
`intent_auth_version`, `verification_token` and `verification_expires_at` columns
to `card_attachments`; it adds no domain table or public metadata field. The
original composite Card/Board FK, uploader restriction, immutable identity,
scoped idempotency, unique object pointers and lifecycle guards remain.
`declared_bytes` is the exact source length; `reserved_bytes` can be larger;
`byte_size` is the verified output. Native CHECKs constrain these relationships,
digest shape and a paired, PENDING-only finite verification lease. Revisions
advance on internal claims as well as public edits; clients use returned values
rather than assuming an initial revision number.

Legacy FILE rows receive `declared_bytes=reserved_bytes` and a single revision
increment. Original pointers, timestamps, MIME, bytes and lifecycle state remain
unchanged. No digest or session provenance is fabricated: legacy ACTIVE metadata
is readable but download returns `503 ATTACHMENT_NOT_VERIFIED`; legacy unfinished
intents cannot be completed by a new session. Replace through a new upload,
then remove the old association through an authorized workflow. URL rows and
existing Card data are unchanged. Empty migration down/up works; down refuses
any FILE metadata or cleanup obligations, so populated installations roll forward.
Do not bypass the guard to remove evidence of objects that still need cleanup.

Each FILE insert atomically creates two permanent ownership/cleanup jobs, one
for each namespace. The cleanup table has no parent FK and survives Card/Board
hard deletion. Its primary key prevents reusing a deleted FILE identity/key.
The due index includes completed jobs; a pending-expiry partial index supports
bounded sweeps. Updates use explicit mutable columns rather than re-saving
hidden immutable timestamps, preserving legacy PostgreSQL microseconds.

## REST and storage contracts

Routes below are relative to `/api/boards/:boardId/cards/:cardId/attachments`.
All require the existing Bearer JWT. JSON uses existing success/error envelopes;
downloads and 204 responses do not. Unknown JSON/query fields are rejected on
intent/completion routes. Swagger describes allowlisted DTOs, limits and errors.

| Method/path                        | Contract                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `POST /uploads`                    | `{filename, contentType, fileSize, displayName?}`; optional UUID-v4 `Idempotency-Key`; 201 owned intent                        |
| `POST /uploads/:uploadId/complete` | Empty JSON/query; 200 ACTIVE metadata only after content verification and commit                                               |
| `DELETE /uploads/:uploadId`        | 204 owner cancellation for unfinished/terminal intents; repeated cancellation is 204; ACTIVE must use association DELETE       |
| `POST /uploads/:uploadId/file`     | Development/test memory driver only; one multipart `file`; JWT/ACL/ownership checked before parsing; 204                       |
| `GET /` and `GET /:attachmentId`   | Existing ACTIVE-only safe metadata, stable `(created_at,id)` pagination and exact totals; no pending records or storage fields |
| `GET /:attachmentId/file`          | Authenticated backend stream of verified ACTIVE bytes; no public or presigned GET URL                                          |
| `PATCH /:attachmentId`             | Existing optimistic `expectedRevision`; FILE allows `displayName` only, with no binary replacement                             |
| `DELETE /:attachmentId`            | Existing idempotent association removal; immediate REMOVED tombstone, later durable object cleanup                             |

An intent response is `{uploadId,state,expiresAt,upload}`. While PENDING,
`upload={kind,url,fields,expiresAt}` is a short-lived, uploader-only transfer
capability. S3 form fields necessarily contain the pending object key and signing
material: never persist, log, broadcast or put this response in a shared query
cache. ACTIVE replay returns `upload:null`. Active storage keys, credentials,
digests, pending metadata and cleanup details never appear in metadata/events.
The memory target is an authenticated API-relative path; S3 uses only the returned
form target. Disabled storage preserves `503 ATTACHMENT_FILES_NOT_AVAILABLE`.
Legacy `POST / {kind:FILE}` does not create an upload; enabled mode returns 400
with guidance to `/uploads`, while disabled mode retains 503.

The dedicated `AttachmentStorage` boundary has disabled, bounded ephemeral
memory and private S3 implementations. Memory is forbidden in production and
has a 128 MiB process cap. S3 uses the default SDK credential chain for the EC2
instance role, a separate attachment bucket and a validated configurable physical
prefix; database keys remain provider-independent. There is no external URL
fetch, proxy, public ACL, frontend AWS credential or signed-download operation.
S3 reads bound header length, actual streamed bytes and duration. Verified writes
use `If-None-Match:*`, SHA-256 checksum and AES256 server-side encryption.

## Access, validation and concurrency

Every write uses `BoardAuthorizationService` and the established Board row lock,
then checks the current Card, archive state and JWT session version/expiry. Board
OWNER/MEMBER, including explicit Board-member Guests, can edit. Read-only
Workspace viewers can read currently visible Boards, but cannot mutate. Workspace
ADMIN alone does not grant PRIVATE Board access. Scope mismatches are rejected;
foreign or other-uploader intents are not disclosed. Upload completion/cancellation
are uploader-owned even for another Board OWNER. ACTIVE metadata editing/removal
uses normal Board editor permissions. Archived Board/Card reads and downloads
remain authorized; all user mutations are blocked. Archive/restore and Workspace
Board moves preserve associations and object ownership.

Intent reservation, current quota aggregates and idempotency lookup occur under
the Board lock, serialized with URL attachments and Board/Card/membership changes.
Normalized replay with the same key returns the same intent; changed declarations
conflict. Terminal intents cannot resurrect; use a new key for a new upload.

Completion first claims a persisted token/lease in a short transaction. It then
reads pending bytes, verifies content and writes an immutable ACTIVE-namespace
object **outside PostgreSQL transactions**. Finalization rechecks ownership,
session, ACL, archive, expiry, lease token and quota under the Board lock before
committing ACTIVE metadata and its digest. A superseded/cancelled worker cannot
activate an object. Successful retry returns the current ACTIVE result without
another write/event. The two-job per-process bound also covers provider reads.

Verification compares declaration, extension, MIME, exact raw size and actual
content. Raster framing rejects trailing data/truncation/animation, followed by
bounded full decoding and re-encoding. Text must be non-binary UTF-8 without
dangerous controls or obvious executable/HTML/SVG signatures. PDFs support a
deliberately strict **classic-xref** profile: offsets, object/stream boundaries,
catalog/page tree/count and EOF are validated. Encryption, active actions,
embedded files, object streams and incremental updates are rejected. Some valid
PDF variants are therefore unsupported. **This is not malware scanning** and
does not certify a document safe to open in a third-party reader.

Download checks the current session/Board/Card before provider I/O and rechecks
them plus the ACTIVE pointer/digest before returning the stream. Access revoked
during I/O cancels the provider stream. A missing/mismatched verified object fails 503. Already delivered bytes cannot be recalled, and revocation after stream
authorization does not terminate an in-flight response. Headers are
`Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, explicit
verified MIME/length, `Content-Security-Policy: sandbox` and sanitized ASCII plus
RFC5987 UTF-8 Content-Disposition. Only normalized raster is inline; PDF/TXT are
forced downloads. Client range requests are not a resumable-download contract.

## Recovery and cleanup

| Failure/window                                                | Persisted outcome and recovery                                                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Grant fails after reservation                                 | Reservation remains; same idempotency key retries; expiry eventually releases quota                                              |
| Recognized missing raw object                                 | Completion returns 409 `ATTACHMENT_NOT_UPLOADED`, releases its claim; transfer and retry                                         |
| Invalid content                                               | Current token holder marks FAILED; no public metadata/event; cleanup is durable                                                  |
| Provider/transient DB failure                                 | Keep PENDING and its lease; retry after lease expiry, within intent lifetime                                                     |
| Verified PUT succeeded, commit failed or acknowledgement lost | Retry recomputes content; adopts the immutable existing object only if MIME/digest match, then commits or returns already ACTIVE |
| Existing object differs                                       | Fail closed with 422; never overwrite or delete it as synchronous compensation                                                   |
| Cancellation/archive/revocation races                         | Final transaction cannot activate; unreferenced bytes remain private and are reclaimed                                           |
| Process dies or provider delete fails                         | Database jobs survive; startup resumes due work, with persisted leases/backoff                                                   |
| Very late/ambiguous write after a delete                      | Permanent completed jobs are revisited daily; identity/key reuse is prohibited                                                   |

The worker expires up to 50 eligible intents and claims up to 10 cleanup jobs per
sweep using `FOR UPDATE SKIP LOCKED`, five-minute leases and compare-and-set
completion. Provider deletion happens outside the claiming transaction. PENDING
protects both its object pointers; ACTIVE protects its verified pointer. Grace
outlasts issued POSTs and verification/provider operations. Terminal states cannot
reactivate and object identity cannot be reused, so an unreferenced object cannot
become referenced during deletion. Failures retain durable 5-minute to 1-hour
backoff. Completed jobs resweep every 24 hours and are never pruned automatically.
Multiple processes can claim safely; scheduler/throughput/backlog still require
monitoring. Disabled storage pauses the worker; re-enabling resumes due work.

## Realtime and P3-10 integration guide

One existing `card:updated {boardId,cardId,columnId}` is published after effective
activation, display-name edits or removal, through `BoardEventPublisher`. No new
shared event name is added. Pending intents, transfers, invalid input, failed or
denied completion, retries and repeat deletion emit nothing. Transport failure
does not fail a committed REST response. Delivery is best effort; reconnect and
authoritative REST resync recover missed invalidation, including lost-ack windows.

P3-10 should:

1. Use server permissions and current Board/Card state for controls; treat UI
   checks as convenience only. Keep unfinished intent state private to the uploader.
2. Generate one UUID-v4 idempotency key per selected file; send the exact browser
   byte size and matching MIME/extension. Retain the key across intent/transport
   retries. Never assume raster output length equals the original.
3. For `kind:s3`, append **all** returned form fields to `FormData`, then append
   `file` last and POST to `url`. Do not set multipart Content-Type manually and
   do not send the API Bearer token to S3. A 204 transfer is not completion.
   For memory mode, upload the single `file` to the API-relative URL with JWT.
4. POST completion with `{}` and the API JWT. Show success only after its 200.
   On `ATTACHMENT_UPLOAD_BUSY`, retry with bounded backoff; transient 503 may
   require waiting for the 120-second lease. Renew an expired 60-second POST by
   replaying the same intent request within 15 minutes. A terminal/expired intent
   requires a new upload/key. Respect 429 and do not retry 415/422 indefinitely.
5. On cancellation call the unfinished-intent DELETE; on an ACTIVE attachment
   call association DELETE. Treat 401/403/404 or access loss as a reason to stop,
   clear protected cache/state and discard grants. Revoked S3 forms may still
   accept raw pending bytes until expiry, but cannot publish or download them.
6. Refetch scoped metadata after completion and on `card:updated`. Existing Card
   query invalidation includes archived caches; any new attachment query key must
   include the session, Board and Card and subscribe to the same invalidation.
7. Fetch the file route with API authentication and use a short-lived browser
   Blob URL if previewing; revoke it on unmount/access loss/logout. A plain `<img>`
   or anchor does not add the Bearer header. Do not cache content in a service
   worker or persist grants/Blob data. Documents remain downloads.

Common errors include 409 `ATTACHMENT_LIMIT_REACHED`, `ATTACHMENT_UPLOAD_BUSY`,
`ATTACHMENT_UPLOAD_EXPIRED` and `ATTACHMENT_IDEMPOTENCY_CONFLICT`; 413 oversized
content; 415 unsupported/mismatched type; 422 invalid/conflicting content; 503
disabled, unavailable or busy processing. Use the existing error envelope/code,
not provider error text. The API is authoritative; no list of pending objects or
administrative key-based download is exposed.

## Local verification

Completed using synthetic bytes and disposable loopback PostgreSQL only:

- Focused backend Jest: **52 suites / 468 tests passed**, covering attachments,
  Card/Board ACL, archive/order, realtime, labels/checklists and config; final
  mocked S3 regression **4/4 passed** after error-shape hardening.
- New real Nest/JWT/PostgreSQL/injected-memory lifecycle suite:
  **19 groups passed** (`test:private-files:database`). Includes legacy upgrade,
  empty down/up/zero ORM drift, MIME/filename/byte checks, ACL and archive,
  quota/idempotency/lease races, completion pressure, rollback/lost acknowledgements,
  cleanup/restart/late writes, session invalidation and actual Socket.IO COMMIT gates.
- Existing attachment foundation **16 groups**, dates **11**, checklists **16**,
  labels **15**, Card **13**, database foundation and Workspace API passed.
- Avatar PostgreSQL migration/HTTP/decoder/concurrency/cleanup regression and its
  database foundation follow-up passed.
- Existing PostgreSQL/Socket.IO suites: realtime **16 scenarios**, Board events
  **10 groups** passed. Intentional transport/adapter failures log expected errors.
- Shared **16 tests**, frontend invalidation **23 tests**, shared/backend/frontend
  builds and changed-code ESLint passed. Frontend build retains existing environment
  and chunk-size warnings. Changed-file formatting and `git diff --check` passed.
- Repository-wide `pnpm format:check` failed on existing formatting/line-ending
  warnings across untouched files; only changed files were formatted. No unrelated
  baseline formatting was repaired.

The high-volume private-file integration suite overrides throttler storage only;
real JWT guards, validation, services, transactions and Board authorization remain.
S3 SDK and presigner tests are mocked; **no real AWS interoperability, IAM/CORS,
production resource capacity, deployment or malware scanning was tested**. Full
monorepo/UI/production suites are outside this scoped backend change. See the
runbook for manual staging verification and production prerequisites.
