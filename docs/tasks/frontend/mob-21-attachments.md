# MOB-21 — Native Card attachments and private file safety

Scope: [issue #281](https://github.com/duongkienvn/SE2026-T13/issues/281).
Implementation and verification date: 2026-11-17. This is a local working-tree
record, not deployment evidence. After implementation the owner explicitly
authorized 17 meaningful commits, pushing the feature branch and creating a PR.
Merge, deployment and production access remain outside the authorized scope.

## Baseline and ownership

- Branch: `feat/mobile-card-attachments`, created in the existing checkout from
  `main`. Local HEAD and the GitHub main branch API both reported
  `f2202231a47bb396578115048e26bef03082dbe6` before implementation.
- This baseline contains MOB-04 (#254), MOB-05 (#251), MOB-17 (#277), MOB-18
  (#282), MOB-20 (#286) and MOB-14 (#285). MOB-14 Board capability/archive
  integration and the actual merged typed section boundary were inspected.
- Feature code lives in
  [`apps/mobile/src/features/cards/attachments/`](../../../apps/mobile/src/features/cards/attachments/).
  MOB-18's `CardAttachmentsSection` now defaults to `CardAttachments`; its
  `section` override and independent error boundary remain available.
- No backend, database, shared contract, Web UI, Card root, auth provider or
  global-state architecture was added or replaced. Checklists remain MOB-20-owned.
- CodeGraph was attempted before code search; its CLI was unavailable and no
  CodeGraph MCP was exposed, so source inspection used `rg` and direct reads.

## Source-verified routes and policy

The base is `/api/boards/:boardId/cards/:cardId/attachments`. The session-bound
transport already owns `/api`; feature paths start with `/boards`.

| Operation      | Contract used                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| List           | GET `?page=N&limit=100`, 200 envelope with page metadata; ACTIVE only, `createdAt DESC,id DESC`                     |
| Metadata       | GET `/:attachmentId`, 200 ACTIVE metadata                                                                           |
| Create link    | POST base, 201; `{kind:'URL',url,displayName?}` and UUIDv4 `Idempotency-Key`                                        |
| Edit           | PATCH `/:attachmentId`, 200; `expectedRevision`, supported `url` and/or `displayName`; FILE URL changes rejected    |
| Remove         | DELETE `/:attachmentId?expectedRevision=N`, exactly 204, no body parsing                                            |
| Reserve upload | POST `/uploads`, 201; exact `filename,contentType,fileSize,displayName?` and stable UUIDv4 key                      |
| Memory bytes   | POST exact returned `/api/.../uploads/:uploadId/file`, authenticated multipart `file`, exactly 204                  |
| S3 bytes       | POST exact returned HTTPS URL, every opaque field and `file` last; no bearer, cookies, redirects or manual boundary |
| Complete       | POST `/uploads/:uploadId/complete`, empty object, 200 ACTIVE FILE after verification                                |
| Cancel         | DELETE `/uploads/:uploadId`, exactly 204; repeated pending cancellation is supported by backend                     |
| Private bytes  | GET `/:attachmentId/file`, authenticated raw binary 200; never decoded as a JSON envelope                           |

Authority inspected:
[`card-attachments.controller.ts`](../../../apps/backend/src/api/cards/card-attachments.controller.ts),
[`card-attachment-uploads.controller.ts`](../../../apps/backend/src/api/cards/card-attachment-uploads.controller.ts),
both attachment services, request/response/upload DTOs,
[`attachment-file-policy.ts`](../../../apps/backend/src/api/cards/attachments/attachment-file-policy.ts),
content verifier and current Web attachment adapters/hooks. Backend read/write
authorization, uploader ownership, verification leases, byte hash and transactions
remain authoritative.

Enforced V1 limits are 10 MiB/file, 20 ACTIVE/PENDING slots/Card, 100 MiB
ACTIVE/PENDING file bytes/Board, PNG/JPEG/WebP/PDF/TXT only, 16 million raster
pixels and 8192 pixels per side. Images reserve a 10 MiB normalization budget.
The UI prevents another Add when its authoritative ACTIVE total is already 20;
pending slots and Board-wide remaining quota are checked by the server.

Intent lifetime is currently 15 minutes; transfer grants are usually at most
60 seconds. Actual returned intent and grant `expiresAt` constrain transfer.
An expired grant can be refreshed through the same idempotent intent; an expired
intent requires cancel and a new explicit selection. Local retry source retention
is bounded to 15 minutes, section lifetime and the initiating session.

## Typed integration and reconciliation

`CardAttachments` receives the unchanged `CardDetailSectionProps`:
`{context: CardDetailContext}` with `identity,boardId,cardId,board,card,readOnly,
canEdit,active,refreshCard`. It does not own or patch the parent editor.

- `createAttachmentApi(http, scope)` is the feature's typed, runtime-decoded
  CRUD/intent/complete/cancel/download boundary. Decoders reject PENDING/REMOVED,
  foreign Board/Card data, invalid revisions, invalid names/MIME/size and
  malformed pagination. Private intent grants never enter Query or mutation caches.
- `attachmentOptions` / `useAttachments` use the existing
  `queryKeys.attachments(identity,boardId,cardId)` and explicit next-page loading.
  Empty, initial loading, refreshing, local error/retry and offline states are
  represented independently. Conflicting totals across pages hide the stale count
  and require an explicit list reload instead of presenting a false total. The section does not download files to render a list.
- `useAttachmentActions` owns one in-flight local operation, upload retry source,
  logical idempotency key, cancellation and safe error/status presentation.
  TanStack and the REST client never automatically replay mutations.
- `attachmentGuard` repeats captured identity/resource epoch, foreground section,
  connectivity and cached verified Board/Card write checks. Archived and read-only
  users retain authorized reads/downloads but no mutation affordances. The backend
  still authorizes every request.
- `refreshAttachments` uses existing `hintTargets` for attachment-scoped
  `card:updated`: attachment lists, single Card preview and matching preview batches.
  It cancels stale reads before invalidation; refresh failure cannot fail a
  committed mutation. Existing MOB-06 socket hints/reconnect only refetch reads.
  Neither parent title/description drafts nor pending Checklist values are patched.

The only shared infrastructure additions are optional bounded binary consumption
(`maximumBytes`, `requireContentLength`, returned `contentLength`) and an unsubscribe
return from `subscribeBoardTeardown`. Existing unbounded download callers retain
their previous behavior.

## URL lifecycle

HTTPS syntax is validated before submission/opening: length <=2048, no credentials,
control characters, encoded ASCII controls or backslashes. Display names trim to
1–120 characters when supplied and reject controls. Opening requires an explicit
press and native `Linking`; identity/resource checks repeat after asynchronous
capability checks. Nothing executes HTML or automatically fetches link previews.

Create retains one UUIDv4 key and frozen payload across uncertain network/timeout
results. Repeated taps cannot enqueue another POST. Explicit definitive 4xx errors
allow correction. Discarding an uncertain draft warns that the link may already
exist and requires checking the refreshed list before starting another operation.
Edit and remove carry the displayed revision. A 409 refetches authoritative state,
preserves edit input and requires explicit Reload/review before another save.
Remove has a named destructive confirmation.

## Upload lifecycle and driver assumptions

`select → validate → intent → transfer → verifying → complete → authoritative refetch`.

The Expo 58 compatible `expo-document-picker`, `expo-crypto` and `expo-sharing`
modules were added using Expo's installed `bundledNativeModules.json` versions;
existing `expo-file-system` and `createNativeMultipartUpload` are reused.
The picker requests only the supported MIME list and single selection. Cancel
does not produce an error. Filename normalization rejects path/control/format
characters, checks extension/MIME agreement and never trusts picker size alone.
The app stats the local copy, independently bounds a file stream, checks the exact
read size and examines real text/signature/raster-dimension bytes before reservation.
Full PDF validation and raster decode/re-encode remain backend responsibilities.

The selected bytes are copied into a uniquely named app-owned cache directory.
The picker-created copy is removed only when its URI belongs to app cache; an
external source is never deleted. Expo multipart reads the owned snapshot through
bytes-backed `File` parts. No RN `{uri,name,type}` FormData parts are submitted.

Memory mode uses the authenticated session client and an exact API-relative target.
S3 mode uses `expo/fetch`, with the API-returned URL/fields, `credentials:'omit'`,
`redirect:'error'` and no authorization header. Errors are normalized without
retaining native exceptions, grants, provider XML or credentials. Neither driver
uses fabricated progress; the section displays an indeterminate indicator and
precise selecting/intent/uploading/verifying/complete/failed/canceled state.

An uncertain transfer/completion retry first calls retry-safe complete. Only
`ATTACHMENT_NOT_UPLOADED` allows obtaining a fresh grant with the original key and
retransferring. An ACTIVE replay reads metadata without sending bytes again.
Success requires an authoritative 200 ACTIVE FILE. Failed/canceled/PENDING intents
never become active local rows. Explicit Cancel aborts work, removes local bytes
and best-effort deletes a known owned intent. If the reservation response itself
was lost, its unknown server ID cannot be canceled locally; backend expiry/cleanup
is authoritative. No recovery POST is automatically sent to discover it.

Backgrounding aborts transfer/download. Native picker/share controllers have their
own handoff lifecycle. Session change, 401, resource denial, Board teardown,
permission loss and unmount fence work and remove owned source files. Known pending
intent cleanup is best effort through the captured session, never another user's
credentials. Server denial/offline failure can leave a reservation until expiry.

## Private download and temporary files

Download uses the existing authenticated session transport with the same resource
epoch and captured identity. It requires 200, the metadata's MIME, strict positive
Content-Length <=10 MiB, bounded streamed bytes and exact agreement between header,
metadata size and received bytes. JSON error responses, malformed/truncated/overrun
bodies and obvious active content/type mismatches are rejected before storage.
The server does not expose its content hash in this DTO; the client does not invent
a digest contract or claim independent end-to-end cryptographic verification.

Verified bytes are saved only below `Paths.cache/kanvexa-private-attachments/` in
random subdirectories, with a validated safe filename. Content-Disposition is
ignored. **Open private file** uses Expo File's `canPreview` and native `preview`;
**Share private file** uses the native share controller with the verified MIME.
Viewer availability depends on the OS and installed apps. Neither action saves
to a public media library.

Expo's preview promise resolves at presentation/handoff rather than dismissal.
The source remains private and available until Android returns to the app or the
user presses **Close private file** after viewing (including iOS). This avoids
deleting a file while a native viewer may still need its bytes. Abort, unmount,
session end and access loss still synchronously dispose it. The retained-file
status/action uses the existing section surface, without another Card route.

Temporary download files are removed when share finishes/cancels/fails and
synchronously on abort/logout/account switch/revoke. App startup clears the owned
directory, including prior interrupted-process snapshots. The existing app root
registers cleanup with the existing SessionManager before navigation starts, so
logout/account switch also cleans storage when no Card section is mounted. A failed deletion marks
storage unavailable so further private writes/shares fail closed until cleanup
succeeds. A retained failed upload source exists only for the bounded, explicit
same-key retry and is cleared on cancel/expiry/session end/unmount. No bytes/grants
go to AsyncStorage, persistent Query state, logs or analytics.

Files explicitly shared into another application are outside Kanvexa's ownership;
local cleanup cannot revoke a recipient's copy. Native chooser lifetime, platform
FileProvider access and filesystem deletion require later device QA.

## Visual parity and skills

Applied `appllama-app-design-skill`, `appllama-usage`, `kanvexa-ui`, `impeccable`,
`kanvexa-verification` and `ponytail`. AppLlama MCP was unavailable. Impeccable
context identified the incumbent Mobile surface; no redesign or new design system
was introduced. The user's Mobile-only/no-APK instructions supersede generic
skill root-suite and simulator requirements.

The approved [Card Detail image](../../mobile/assets/04-card-detail.png) was opened
directly before UI work, with Design Spec §§4.4/5–7/9 and Mobile Roadmap §6.

| Reference element                                | Implementation / evidence                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Attachments after Checklists                     | Existing MOB-18 section order and mount retained                                                                         |
| Heading, count and compact Add                   | MOB-02 typography/semantic colors, true server count, capability-gated Add                                               |
| Rounded white/light or dark surface              | Existing `Surface`, radius/spacing/theme tokens                                                                          |
| File/link icon tile, name and secondary metadata | Authored native geometry, actual MIME/size or HTTPS hostname; no fake thumbnails                                         |
| Open and item options                            | Accessible row action plus 48dp contextual options button                                                                |
| Sheets and confirmations                         | Existing BottomSheet/UnsavedChangesPrompt with safe-area, keyboard, reduced-motion and named actions                     |
| Loading/empty/error/read-only                    | Independent section states; no invented business records or future controls                                              |
| 320dp/160% font/dark                             | Component harness verifies semantic colors, scaling/truncation properties and reachable actions; no rendered pixel claim |

No native screenshot is supplied for this task. New screenshot/device/animation
parity, iOS and actual VoiceOver/TalkBack behavior are **NOT VERIFIED** under the
user's explicit no-device/no-APK test scope. Existing MOB-18 captures are historical,
not evidence for these attachments. No fake screenshot or image-backed UI was made.

## Automated verification and limitations

Commands ran from the repository root. The full-suite run and the final focused
rerun are distinguished; final regressions include quota retry, concurrent page totals, native preview retention and app-lifetime cleanup.

| Check                                            | Result                                                                                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Focused Mobile Node attachment tests             | PASS 23/23; `pnpm --filter @kanban/mobile exec node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/card-attachments.test.mjs`                                   |
| Focused attachment UI/native-adapter/root Jest   | PASS 27/27 on final source via `pnpm --filter @kanban/mobile exec jest --runInBand test/card-attachments.component.test.js test/native-attachments.component.test.js test/data-root.component.test.js` |
| Full Mobile Node + Jest                          | PASS, exit 0: Node 298/298, Jest 325/325 (27 suites), via `pnpm --filter @kanban/mobile test`; final focused rerun additionally verifies the remove-conflict regression                                |
| Mobile lint / typecheck                          | PASS, exit 0: `pnpm --filter @kanban/mobile lint` and `pnpm --filter @kanban/mobile typecheck` on final source                                                                                         |
| Android Metro + Hermes JS export                 | PASS final source via `pnpm --filter @kanban/mobile bundle:android`: Hermes bytecode, 1,443 native sources, shared ESM and approved logo                                                               |
| Changed-file Prettier, links, `git diff --check` | PASS: explicit changed-file `pnpm exec prettier --check --end-of-line auto ...`, relative-link resolution and `git diff --check`                                                                       |
| Real memory backend/S3 provider                  | NOT VERIFIED; driver protocols exercised with controlled responses, no live provider used                                                                                                              |
| APK, EAS Build, Expo Go, ADB, phone/emulator/iOS | NOT RUN, explicitly excluded                                                                                                                                                                           |
| Backend, Web and root lint/test/build suites     | NOT RUN, explicitly excluded                                                                                                                                                                           |

The initial two sandbox exports failed because Hermes could not write `index.hbc`
to the sandbox temporary volume (exit code 6, invalid device/volume error). The
unchanged export command succeeded outside that sandbox; no app config was weakened.
Jest emits development-only `act`/Expo Router warnings and its late-exit warning;
the full command still exits 0 after teardown. These warnings are not counted as
device evidence or silently suppressed with `--forceExit`.

New automated cases cover URL schemes/credentials/controls, revision conflicts,
idempotent uncertain creates and double taps, exact statuses, metadata decoding,
pagination 0/1/20/100/101, MIME/name/size discrepancies, raster dimensions, quotas
and error wording, memory/S3 multipart headers/fields, expired grants, ACTIVE replay,
complete-first retry, cancellation/background/account switch/revoke, bounded binary
errors and cleanup, native storage failure, and preserved unrelated Card/Checklist
state. Existing Card Detail tests are retained with its obsolete “no attachments
mount” expectation updated to the newly implemented section.

The new native modules must be included in a future native binary before device
QA; an older binary is not evidence for this feature. No APK was rebuilt here.

Changed-file inventory: the seven attachment module files (`api.ts`,
`CardAttachments.tsx`, `hooks.ts`, `native.ts`, `policy.ts`, `queries.ts`,
`transfer.ts`); MOB-18 `detail/sections.tsx`; the narrow app-root cleanup registration
in `src/app/_layout.tsx`; shared Mobile `api/client.ts` and
`query/resource-access.ts`; Mobile `package.json` and root `pnpm-lock.yaml`;
[`card-attachments.test.mjs`](../../../apps/mobile/test/card-attachments.test.mjs),
[`card-attachments.component.test.js`](../../../apps/mobile/test/card-attachments.component.test.js),
[`native-attachments.component.test.js`](../../../apps/mobile/test/native-attachments.component.test.js),
the existing `card-detail.component.test.js` assertion and app-lifetime cleanup
assertions in `data-root.component.test.js`, this record and the task index.

Remaining integration risks: real native document-provider behavior, chooser/viewer
lifetime, private filesystem permissions/deletion, low-memory behavior on a 10 MiB
file, actual S3 signed-policy/clock expiry, backend concurrent authorization and
cross-client provider security E2E. Automated mocks and Hermes bytecode do not prove
those device/provider behaviors. No claim of device or security E2E PASS is made.
