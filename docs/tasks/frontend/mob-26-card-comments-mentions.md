# MOB-26 — Native Card Comments, Author Actions & Secure @Mentions

[Issue #293](https://github.com/duongkienvn/SE2026-T13/issues/293).

## Scope and source checks

Implemented in `apps/mobile/src/features/cards/comments/`, mounted as the default
typed `CardCommentsSection` in MOB-18. Metadata, Checklists, Attachments, Card draft
editing, root navigation and realtime infrastructure retain their implementations.
No backend, Web, shared schema, dependencies, endpoints or notification writers
were added. The existing MOB-25 membership predicate now accepts just the fields it
actually reads, allowing the typed Card context to reuse it without a cast.

The clean initial checkout was `main`. A successful `git fetch origin main`
confirmed local HEAD and `origin/main` at `88a700b1`; history includes MOB-18
PR #282 (`0f7eeb79`), MOB-25 PR #296 (`18a40a8e`) and MOB-06 PR #256
(`c44316ee`). Work uses `feat/mobile-card-comments-mentions` in the existing
checkout. The owner subsequently authorized delivery as 11 focused Conventional
Commits and a push of this feature branch, without a `codex` prefix. PR creation,
merge, deployment and production access remain outside the authorized scope.

Sources read: issue #293 in full; AGENTS/workflow; Mobile Roadmap §7/MOB-26;
Architecture §9.4 and native invariants; Design Spec §2/§4.4; network/realtime
contracts; actual MOB-18 section/context and MOB-25 exports/query keys; backend
comments controller/service/input/output DTOs and Board authorization; current
Web CommentsSection, hooks and mention helpers. Historical testing documentation
still says the Socket.IO client does not exist; source and MOB-06 task record
confirm it does. No unrelated documentation was rewritten.

Applied skills: `appllama-app-design-skill`, `appllama-usage`, `kanvexa-ui`,
`impeccable`, `ponytail`, `kanvexa-verification`. The Impeccable context launcher
ran once against the existing Card section; its scoped existing-system path and
craft floor govern this extension. Native controls, inherited tokens, 48dp shared
buttons, local error states and existing pagination/transport are reused. There is
no new state manager or UI library. Appllama MCP was unavailable, so external
screen research could not run; approved repository references and existing native
components are the fallback. CodeGraph was attempted before code search, but the
CLI was unavailable and no CodeGraph MCP tool was exposed.

## API and DTO contract

Authenticated `SessionHttpClient` owns credentials, envelopes, cancellation,
session generation, resource fencing and 401 teardown. All feature requests set
`retries: 0`; writes are never queued for offline replay.

| Method | Path under `/api/boards/:boardId/cards/:cardId` | Success                                                    |
| ------ | ----------------------------------------------- | ---------------------------------------------------------- |
| GET    | `/comments?page=&limit=`                        | 200 paginated, oldest first by `createdAt,id`, limit 1–100 |
| POST   | `/comments`                                     | 201 Comment DTO                                            |
| PATCH  | `/comments/:commentId`                          | 200 Comment DTO                                            |
| DELETE | `/comments/:commentId`                          | 204 empty, through `api.empty`                             |

POST/PATCH send `{content, mentions:[{userId,start,end}]}`, including `[]` when
there are no selected mentions. Content is trimmed, 1–2000 characters using the
backend validator's surrogate-aware character count. Span offsets remain UTF-16.
The optional operation header is not needed here; no idempotency is claimed.

The decoder allowlists `id,cardId,authorId,author?,content,mentions,createdAt,
updatedAt`, checks IDs, cross-Card relationships, timestamps and span structure.
POST/PATCH acknowledgements must also match the submitted final content and spans;
a malformed or mismatched 201 cannot clear the draft.
`author` is only the backend's deleted-user attribution, never a general profile.
Null/absent attribution falls back to the currently authorized loaded Board roster
or **Unknown author**; no cross-scope lookup or invented identity. Deleted user
attribution suppresses live profile/avatar lookup. Output fields such as tokens or
email on the comment DTO are not copied through. Links, HTML-looking strings,
emoji and line breaks render in selectable native Text without executing HTML or
opening links.

Only the current server page (20 rows) is rendered. Previous/Next retain server
order and real totals; each page is a separate child of the existing comments
key. Duplicate IDs and unsorted rows within a response are rejected. Realtime and
mutation results never append synthetic rows. If deletion shrinks the page count,
the UI returns to the last valid page. Offset pagination is not a transactional
snapshot across pages; refresh is the authoritative recovery for concurrent drift.

## Mention algorithm and roster boundary

The composer reads MOB-25 `boardMembersOptions` with its exact directory keys,
20-member pages, decoder, access checks and denial cleanup. Loading another page
is explicit; 101+ members are reachable. At most eight filtered options are
rendered at a time. Duplicate names use authorized email plus an accessible user
ID differentiator. Search is over the loaded explicit Board roster, with a clear
loaded-members label and Load more control; it is not Workspace/global search.

1. A collapsed cursor after an eligible `@query` opens suggestions. Cursor
   movement, newlines, selections, email addresses and existing chosen spans are
   handled separately. Native accessible buttons support touch/screen readers;
   Arrow Up/Down select an option and Tab chooses it where RN supplies those key
   events. Typing a literal `@name` creates no metadata.
2. Selection inserts exactly `@displayName`, records the chosen `userId`, and uses
   JavaScript string indices for `[start,end)`. A separator is outside the span.
3. On text changes, common prefix/suffix calculations find the union of possible
   single-replacement regions. Spans wholly before remain; spans wholly after
   shift by the UTF-16 length delta. Touched or ambiguous repeated-text spans are
   dropped. Text remains plain text. Exact token preservation and surrogate
   boundaries are checked before retaining a span. This handles paste, cut,
   replacements, autocorrect, emoji and multiline edits without relying on RN
   selection-event ordering or reconstructing identity from text.
4. Submission re-reads the relevant loaded MOB-25 pages using its existing API,
   normalizes the final content by trim, rebases offsets, then validates UUIDv4,
   integer/range/order/non-overlap, surrogate boundaries, exact current display
   name, ≤20 spans and ≤10 distinct users. A removed, renamed or page-shifted
   member requires reselection or explicit Remove mention links. It never
   substitutes a same-name member.
   Only pages containing chosen IDs are refreshed (at most ten member pages),
   rather than every previously loaded page. Loaded roster rows deduplicate by
   user ID; later authorized page values replace overlaps without merging names.
5. Highlighting uses only server-authorized metadata and an explicit roster
   grant. Workspace-visible nonmembers never request the roster or infer hidden
   identities. Roster denial clears cached comments and chosen-span metadata,
   cancels protected requests and hides suggestions. Ordinary draft text can
   remain for review; explicit membership loss clears composer/edit drafts.
   When only roster access is denied, otherwise eligible users can still type
   literal `@` text locally; sending stays fenced until membership is rechecked.
   A fresh nonmember Card context also evicts an older roster, fences the member
   comments projection and reloads only the permitted REST projection. Recheck
   Board membership first obtains a fresh MOB-25 Board grant before roster retry.

## Permissions, drafts and concurrency

Writes require active Card context, explicit OWNER/MEMBER, writable active Board,
active Card, current session/access generation and online state. Workspace roles
are never substituted. A Board guest with explicit MEMBER uses the same Board
permission rule. Edit/Delete additionally require `authorId === identity.userId`;
there is no owner/admin bypass. Archived/read-only users have no action buttons.
DELETE has a destructive confirmation. Errors stay within Comments.

Both a synchronous hook lock and a per-Card data-layer lock prevent rapid taps.
Draft clears only after confirmed 201; edit closes only after confirmed 200;
delete completes only on 204. Recoverable failures retain composer/edit text.
Timeout/network/5xx/malformed post responses can be ambiguous: Send stays locked,
Review latest comments re-reads REST, and allowing a new send requires explicit
acknowledgement that it may duplicate the earlier send. No retry assumes that an
operation ID or socket echo proves a previous POST's identity.

Before PATCH/DELETE, REST reloads the original page and compares the selected
comment ID/content/updatedAt/mentions. A mismatch preserves the draft and offers
review/cancel. Review exposes the latest saved content and keeps the user's draft
for an explicit subsequent save. Backend has no revision/CAS token; a remote edit
between this read and PATCH remains possible. MOB-28-wide concurrency changes are
outside scope. If a row moved to another offset page, cancel and locate it again.

Unsent text/pending writes guard route removal and incoming links through the
existing Expo navigation conventions; Keep editing/Discard is explicit. Session
switches remount the typed section; logout, Board fences and roster epochs prevent
late HTTP results from repopulating private caches. Pending requests abort on
unmount. 403/404/409 and uncertain attempts refresh the affected context; invalid
local input does not trigger broad refetches. 429 respects Retry-After for retry
controls. Errors during fresh roster validation are tagged as pre-write failures,
so they do not incorrectly imply that POST was sent.

The parent MOB-18 route already owns `useBoardRealtime`. Existing MOB-06
`comment:created/updated/deleted` targets the comments prefix; create/delete also
refresh count previews. Fifty-millisecond hint batching handles bursts. Mutation
settlement uses those same targets, REST alone supplies values, no local socket
listener injects comments or notifications, and incoming reads never overwrite
local draft state. Reconnect/revocation use the existing room/access machinery.

## UI comparison and evidence limits

Directly viewed [approved Card Detail image](../../mobile/assets/04-card-detail.png)
and compared it with the Design Spec and current CardDetailContent. The scoped
visual inventory is:

| Reference element                                | State and implementation                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Comments after Attachments                       | Available, original MOB-18 mount order retained                                        |
| Section heading/count                            | Available, real server total and shared typography                                     |
| Conversation surface/avatar/author/time          | Available, semantic Surface and soft text backgrounds; honest unknown/deleted fallback |
| Composer/Send                                    | Available to eligible members; multiline native field and explicit pending state       |
| Edit/Delete                                      | Available to own author only; prefill Save/Cancel and destructive dialog               |
| @mention details absent from mockup              | Implemented from API, Web behavior and existing native fields/buttons                  |
| Root footer/navigation/other sections            | Existing implementations retained; no additional root Add comment button               |
| Reactions/threads/moderation/notification writer | Excluded by scope                                                                      |

Uses existing semantic light/dark/system colors, native system font, 4dp spacing
scale, radii and shared touch targets. Action groups wrap; author text flexes;
comment content preserves line breaks. Composer grows from 80dp to 200dp then
scrolls internally; the existing Card Detail KeyboardAvoidingView, safe area and
outer ScrollView continue to own screen insets/keyboard avoidance. No fabricated
screenshots or sample people are included in runtime UI.

The component harness checks 320dp/160% configuration, theme tokens, wrapping and
scroll/keyboard/accessibility props. It does **not** run native layout, IME,
VoiceOver/TalkBack, hardware keyboard or motion. Those behaviors and pixel-level
visual fidelity are **NOT VERIFIED**. No APK, EAS, Expo Go, ADB or device connection
was used or requested, in accordance with the task's explicit verification limit.

## Verification and handoff

Verification is Mobile-only; root, backend, Web and shared build/test suites are
intentionally not run. Existing shared outputs were available for imports.

| Check                                                     | Result                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Focused comments Node API/mentions/integration            | PASS, including actual 15s timeout, 401 teardown and roster late-response fencing                                               |
| Mobile lint                                               | PASS                                                                                                                            |
| Mobile typecheck                                          | PASS, final delivery run                                                                                                        |
| Full Mobile Node suites                                   | PASS, 423/423; final changed comments tests also PASS 14/14                                                                     |
| Comments component harness                                | PASS, 15/15 on final module, including keyboard selection and nonmember transition                                              |
| Full Mobile Jest/navigation/component suites              | PASS, 33 suites / 459 tests; Mobile test command exited 0                                                                       |
| Android Metro/Hermes JS export + verifier                 | PASS, production Android HBC, 1510 native sources, shared ESM and approved logo; all six current Comments sources match the map |
| Changed-file Prettier and diff/path checks                | PASS, changed files, local task reference/index, git diff --check; final status contains only the 16 intended files             |
| Native/device, actual two-device Web/mobile collaboration | NOT VERIFIED, excluded from this run                                                                                            |

Focused tests cover 0/1/20/21/101 rows, 100-limit requests, 200/201/204 contracts,
malformed DTOs/IDs/relationships/statuses, plain-text safety, role/archive rules,
own/other author, roster page 6/denial/rename/removal, UTF-16/emoji/trim/selection/
paste/ambiguous edits/limits, conflict review, rapid taps, offline/429/5xx,
session/access fencing and coalesced socket hints with no fabricated notifications.
The full Jest run includes the real MOB-26 Card navigation regression. An
additional keyboard-option test was added afterward and passed in the final
15-case Comments component run; the full-run count above does not double-count
that focused run. A dedicated real Expo Router navigation run also passed its
MOB-26 case (the other 46 cases were intentionally filtered out). Initial harness
failures came from missing expo-network cleanup, a mock Headers.get returning
undefined instead of null, unsupported v14 test inspection APIs and stale test
socket getters; these fixtures were corrected and rerun. One new purge assertion
was corrected to the existing eviction contract: active Query objects may remain,
but their protected values must be undefined.

The full Jest run emitted non-failing React act/debug warnings in unchanged
invitation/search fixtures and an open-handle notice while native harness timers
settled; it subsequently exited 0 without forced termination. No application work
outside MOB-26 was added. The initial Hermes sandbox
failure and successful workspace TEMP retry are recorded below. No backend/Web/root
suites, APK, production access or deployment checks were run. Delivery is organized
into 11 focused commits covering membership reuse, mention spans, API contracts,
queries/mutations, hooks, composer, section UI, mount, integration tests, native
interaction/navigation tests and this handoff.

Changed-file inventory (repository-relative):

- `apps/mobile/src/features/cards/comments/`: `api.ts`, `mentions.ts`,
  `queries.ts`, `hooks.ts`, `MentionComposer.tsx`, `CardComments.tsx`.
- `apps/mobile/src/features/cards/detail/sections.tsx`: default section mount.
- `apps/mobile/src/features/boards/members/queries.ts`: narrow predicate input type.
- `apps/mobile/test/comments/`: `fixtures.ts`, `contracts.test.ts`,
  `mentions.test.ts`, `integration.test.ts`.
- `apps/mobile/test/comments.component.test.js` and
  `apps/mobile/test/card-detail.component.test.js`.
- This task record and `docs/tasks/README.md`.

Commands use the existing Mobile scripts directly to avoid root scripts that
also build/test backend or Web:

```powershell
pnpm --filter @kanban/mobile test
pnpm --filter @kanban/mobile lint
pnpm --filter @kanban/mobile typecheck
```

Android export uses the same production Metro/Hermes arguments as
`bundle:android`, with `--max-workers 2`. The first sandbox attempt failed because
Hermes could not write `index.hbc` to the sandbox's virtual temporary directory
(exit 6). A process-local TEMP/TMP inside the ignored workspace cache resolved it:

```powershell
$env:TEMP = Join-Path (Get-Location).Path 'apps/mobile/node_modules/.cache/mob26-temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
pnpm --filter @kanban/mobile exec expo export --platform android --output-dir dist/android --source-maps --max-workers 2
node apps/mobile/scripts/verify-native-bundle.mjs apps/mobile/dist/android
```

These are JS export and source-map verification only. No native Android build or
APK/device testing is implied.
