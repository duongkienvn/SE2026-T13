# MOB-25 Native Board membership

[Issue #292](https://github.com/duongkienvn/SE2026-T13/issues/292)

The native Board members destination lists explicit Board memberships, adds an
existing registered account by email as MEMBER, and lets an eligible Board OWNER
confirm role changes or removal. It extends MOB-14 Board Settings and MOB-15 Board
Detail using the existing REST, session, query and realtime foundations. Workspace
invitations, Workspace membership, global people search and mention UI are outside
this task. No backend, Web, shared contract or dependency changes are required.

Implemented on `feat/mobile-board-membership`, created from fetched `origin/main`
at `f94faca7`. Source and merge history confirmed MOB-14 (#285), MOB-15 (#275),
MOB-23 (#290) and MOB-24 (#291) were present. The follow-up delivery request
organizes the change into 11 focused Conventional Commits and authorizes pushing
this feature branch and opening a pull request against `main`. The branch and
commit messages do not use a `codex` prefix. Merge, deployment and production
access remain outside the authorized delivery scope.

Applied skills: `appllama-app-design-skill`, `appllama-usage`, `kanvexa-ui`,
`impeccable`, `ponytail` and `kanvexa-verification`. The Impeccable context launcher
ran once; the supplied task and established native system resolved the design
direction without a redesign. CodeGraph's indexed directory exists, but its CLI
and MCP were unavailable after discovery/attempt; source was read directly.

## Entry points and native system comparison

Board Settings has a **Sharing → Board members** entry. The Board Detail header
also opens the typed `boardMembers` destination at `/boards/:boardId/members`.
Malformed IDs and unavailable resources use the existing resource boundary.

There is no approved native Board Members mockup. The implementation inherits the
existing system rather than introducing a visual identity. References reviewed:

- [Mobile specification](../../mobile/KANVEXA_MOBILE_DESIGN_SPEC.md), sections 3,
  5 and 6, for navigation, sheets, forms, access-first rendering and realtime.
- [Board Detail reference](../../mobile/assets/03-board-detail-and-filters.png)
  and [Profile & Settings reference](../../mobile/assets/10-profile-and-settings.png).
- [MOB-02 components](../../mobile/MOB-02-COMPONENTS.md) and
  [MOB-14 implementation record](mob-14-board-lifecycle.md).
- [Existing Web Members implementation image](../../design/screens/implementation/board-navigation-settings-polish/members-mobile-light.webp)
  for membership semantics where the native references omit details; it is not
  an approved native screenshot.

Source comparison against `apps/mobile/src/ui/tokens.ts`, `controls.tsx`,
`overlays.tsx` and `BoardSettingsScreen.tsx` confirms the same semantic light/dark
theme, system font, typography, spacing and existing `Surface`, `ScreenHeader`,
`Button`, `TextField`, `StatusChip`, `SegmentedControl`, `BottomSheet` and
`ConfirmDialog`. Interactive primitives retain the 48dp minimum. No tokens,
fonts or UI dependencies were added. Theme changes use the existing provider.

The roster is a paginated `FlatList` with real member counts, identity, email,
avatar/initials, Board role and joined date. Text can grow vertically; row content
uses flexible width. Safe areas, keyboard-aware shared sheets, reduced-motion
sheet behavior and named actions are inherited. Loading, empty, offline, denied,
policy failure, retry and stale-selection states have explicit copy. A dirty
email draft prompts before discard; pending add/confirmation actions block
dismissal and duplicate submission. Promotion, demotion and removal name the
person and consequence. Removal explains that Card assignments are cleared and
Workspace membership remains. No global search is inferred from one roster page.

Appllama MCP was unavailable; the approved repository references and incumbent
native components supplied the documented fallback. No native screenshot was
captured, and this comparison is not native visual approval. Root design-system
documents and the Impeccable sidecar are unchanged by this ordinary extension.

## Verified REST contracts

Paths are under `/api`; authenticated session transport owns credentials and
envelopes. Contracts were checked against the current controllers, pagination
DTO, authorization service and native adapters.

| Method and path                            | Request and successful response                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /boards/:boardId`                     | 200 Board DTO, including validated `createdById`, explicit `currentUserRole`, archive state and capabilities.                |
| `GET /boards/:boardId/members`             | `page` ≥ 1; `limit` 1–100, default 20. 200 paginated full roster with `page`, `limit`, `total`, `totalPages`.                |
| `POST /boards/:boardId/members`            | Trimmed, lowercase registered-account `email` (maximum 320 characters). 201 full member DTO with role MEMBER; no role input. |
| `PATCH /boards/:boardId/members/:userId`   | `{ role: OWNER \| MEMBER }`; 200 full member DTO matching target user and requested role.                                    |
| `DELETE /boards/:boardId/members/:userId`  | 204 empty; use the empty-response adapter without JSON parsing.                                                              |
| `GET /boards/:boardId/policy-capabilities` | 200 effective `canInviteMembers`, `canChangeMembership`, `canChangeVisibility`; reuse MOB-14 decoder and key.                |

`decodeBoardMember` allowlists `id`, `user`, `role`, `joinedAt`; `user` contains
`id`, `email`, `displayName`, `avatarUrl`, `avatarRevision`, `createdAt`,
`updatedAt`, and optional `isDeleted`. UUIDs, exact roles, timestamps, nonnegative
revision and deleted-account email shape are validated. Extra server properties
are discarded. Pages reject duplicate membership/user IDs, contradictory metadata,
oversized results and unexpected statuses. This is the authorized full Board
roster DTO, distinct from the smaller Workspace Guest projection and existing
assignee catalog.

Private avatars use authenticated binary requests scoped beneath the Board member
query prefix, allowlisted owned avatar paths and WebP responses; bearer tokens
never enter image URLs. HTTPS external images exclude embedded credentials.
Invalid/deleted/unavailable images fall back to initials.

## Access and policy matrix

| Fresh server identity on this Board                                                  | Full roster                   | Add                     | Change role/remove         |
| ------------------------------------------------------------------------------------ | ----------------------------- | ----------------------- | -------------------------- |
| Explicit Board OWNER, active and writable                                            | Yes                           | Only `canInviteMembers` | Only `canChangeMembership` |
| Explicit Board MEMBER                                                                | Yes                           | No                      | No                         |
| Guest with explicit Board OWNER                                                      | Yes                           | Same OWNER/policy gate  | Same OWNER/policy gate     |
| Guest with explicit Board MEMBER                                                     | Yes                           | No                      | No                         |
| Workspace ADMIN or MEMBER without explicit Board membership, Workspace-visible Board | No; Board may remain readable | No                      | No                         |
| Outsider or Workspace-only user on a private Board                                   | Denied                        | No                      | No                         |
| Explicit member of archived Board                                                    | Yes, read only                | No                      | No                         |

Workspace roles never imply Board OWNER or roster access. Invite and membership
change policies are independent. The UI waits for a fresh explicit Board grant
before fetching/rendering roster data; failed or pending policy checks disable
management. The server remains authoritative for every operation.

Creator, self and last-owner protections remain authoritative server invariants.
The client explains and blocks creator/self actions. It cannot count every OWNER
from a partial page. A freshly verified actor OWNER and a different selected OWNER
establish at least two owners; this is not a replacement for the server's locked
last-owner check. Concurrent changes can still return conflicts.

## State, races and reconciliation

The cache prefix is
`['mobile', 'private', identity.userId, identity.generation, 'boards', boardId]`.
All requests remain fenced to the active identity and authorized Board.

- `queryKeys.members(identity, boardId)` appends `'members'` to that prefix.
- `boardMembersKey(identity, boardId, page, limit = 20)` appends
  `'directory', { page, limit }` beneath members, keeping the full DTO separate
  from the existing assignee catalog.
- `boardMembershipAccessKey(identity, boardId)` appends `'membership-access'`.
  `boardMembershipAccessOptions(data, identity, boardId)` performs the fresh
  Board REST probe; a Workspace role or cached roster cannot grant access.
- `boardPolicyKey(identity, boardId)` appends `'settings', 'policy'`, reusing
  MOB-14. Workspace policy writes invalidate tracked effective Board policy keys.
- `boardMembersOptions(data, identity, boardId, page, limit = 20)` supplies
  non-retrying, stale-on-mount query options.
  `useBoardMembers(data, identity, boardId, page, explicitGrant)` enables them
  only with the caller's fresh explicit grant.

`changeBoardMembership(data, identity, boardId, command, signal)` serializes
commands for that identity/Board, re-reads Board access and effective policy, then
re-reads the selected roster page for role/removal. It checks expected membership
ID and role before sending the command. Stale confirmations require review.
Neither this preflight nor the in-process lock replaces backend authorization,
Board locking, transactions or database race protection.

There are no optimistic membership or assignment writes and no automatic command
retries. Only a successful 204 completes removal. A committed command stays
successful if a later reconciliation GET fails. A request that may have reached
the server but has an unknown outcome blocks another command until the user
explicitly checks the latest Board access and roster. Failed preflight reads do
not falsely become unknown command outcomes. HTTP errors and cooldowns use the
existing native error/retry handling; session replacement and logout fence late
responses and clear protected content.

Successful writes cancel stale requests, evict roster/assignment/Card preview and
Workspace Guest snapshots, then invalidate affected Board detail/settings,
lists, Home, My Tasks, search, notifications and Workspace data. Membership events
target these resources instead of broadly refreshing unrelated Board children.
Removal also refreshes assignment-bearing Card data. Workspace membership is
unchanged. The client does not claim live assignment persistence was verified.

`member:added`, `member:role-changed` and `member:removed` are REST reconciliation
hints. Own removal immediately suspends protected access and clears Guest/roster
snapshots; a fresh REST probe decides private denial versus retained Workspace
read-only access, regardless of the event's `retainsReadAccess` hint. Reconnect,
archive/restore, access loss and session teardown reuse the existing fences.

## Acceptance and responsibility map

| Acceptance area                          | Implementation/evidence                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Board members entry and native roster    | `BoardSettingsScreen.tsx`, `BoardDetailScreen.tsx`, typed route and new native screen; paginated component harness.         |
| Add existing account as MEMBER           | Validated email sheet, exact POST/201 adapter, independent policy gate; API and component tests.                            |
| OWNER/MEMBER role changes and removal    | Explicit confirmations, creator/self guards, fresh preflight, exact PATCH/200 and DELETE/204; conflict and pending tests.   |
| Roles, archive and policy enforcement    | Explicit-grant helper, effective policy checks and read-only/restricted states; permission matrix tests.                    |
| Session, realtime and concurrent changes | Identity/Board keys, request fences, targeted reconciliation and selected-membership recheck; delayed-response/event tests. |
| Native usability and accessibility       | Existing primitives, semantic roles, labels, long text and theme handling; harness evidence only, native QA remains open.   |
| MOB-26 reuse                             | Typed roster API/query exports and access helper; no mention picker or mention UI implemented here.                         |

Changed-file responsibilities:

- `apps/mobile/src/features/boards/members/`: API/strict decoder, query helpers,
  mutation preflight, native roster, add sheet, scoped avatar and typed exports.
- `apps/mobile/src/app/(private)/boards/[boardId]/members.tsx` and
  `apps/mobile/src/navigation/routes.ts`: validated native route.
- `apps/mobile/src/features/boards/BoardSettingsScreen.tsx`,
  `BoardDetailScreen.tsx`, `api.ts`: entry points and retained validated creator ID.
- `apps/mobile/src/features/workspaces/membership/mutations.ts`: effective Board
  policy invalidation after Workspace policy changes.
- `apps/mobile/src/infrastructure/realtime/client.ts`, `reconciliation.ts`:
  membership-specific refresh, eviction and own-access recheck.
- `apps/mobile/test/board-members/`, `board-members.component.test.js`:
  API/state/realtime tests and native component harness.
- This record and `docs/tasks/README.md`: implementation and verification handoff.

Exact changed-file inventory (repository-relative):

```text
apps/mobile/src/app/(private)/boards/[boardId]/members.tsx
apps/mobile/src/features/boards/BoardDetailScreen.tsx
apps/mobile/src/features/boards/BoardSettingsScreen.tsx
apps/mobile/src/features/boards/api.ts
apps/mobile/src/features/boards/members/AddBoardMemberSheet.tsx
apps/mobile/src/features/boards/members/BoardMemberAvatar.tsx
apps/mobile/src/features/boards/members/BoardMembersScreen.tsx
apps/mobile/src/features/boards/members/api.ts
apps/mobile/src/features/boards/members/index.ts
apps/mobile/src/features/boards/members/mutations.ts
apps/mobile/src/features/boards/members/queries.ts
apps/mobile/src/features/workspaces/membership/mutations.ts
apps/mobile/src/infrastructure/realtime/client.ts
apps/mobile/src/infrastructure/realtime/reconciliation.ts
apps/mobile/src/navigation/routes.ts
apps/mobile/test/board-members.component.test.js
apps/mobile/test/board-members/fixtures.ts
apps/mobile/test/board-members/membership.test.ts
docs/tasks/README.md
docs/tasks/frontend/mob-25-board-membership.md
```

## Verification record and limits

Evidence reported by the implementing agent for this working tree:

| Command/check                                                                             | Result                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @kanban/mobile test`                                                       | PASS, exit 0: 341 Node tests and 378 Jest tests in 28 suites. Includes 31 new membership Node tests and the original 26 Members component cases.                            |
| `pnpm --filter @kanban/mobile exec jest --runInBand test/board-members.component.test.js` | PASS, exit 0: latest 27/27 Members cases, including the additional rapid-submit regression.                                                                                 |
| `pnpm --filter @kanban/mobile typecheck`                                                  | PASS, exit 0, including the final callback guard.                                                                                                                           |
| `pnpm --filter @kanban/mobile lint`                                                       | PASS, exit 0, including the final callback guard and tests.                                                                                                                 |
| `pnpm --filter @kanban/mobile bundle:android` with workspace TEMP/TMP                     | PASS, exit 0: Android Hermes bytecode and verifier; 1,472 native sources, shared ESM and official logo. Final source-map content matches the current Members screen source. |
| `pnpm exec prettier --check <changed paths> --end-of-line auto`                           | PASS; only the changed Mobile files and two task documents.                                                                                                                 |
| `git diff --check`, `git diff --cached --check`                                           | PASS.                                                                                                                                                                       |
| Backend, Web and root application suites                                                  | SKIPPED per task owner scope; no backend/Web edits.                                                                                                                         |
| PostgreSQL/live API/cross-client checks                                                   | NOT RUN.                                                                                                                                                                    |

The final post-fix full Jest rerun with
`pnpm --filter @kanban/mobile exec jest --runInBand --detectOpenHandles`
also passed all 379 tests in 28 suites, including the 27 Members cases.

The initial focused Node run passed 27/28: an overbroad assertion incorrectly
expected comments under a refreshed Card prefix to remain untouched. It was
corrected to test unrelated labels; 28/28 then passed before three more tests
were added. The initial component run passed 25/26; cold React Native FlatList
lazy import exceeded its timeout. Preloading FlatList corrected the harness and
the focused failing scenario passed. The new rapid-submit test uses the installed
renderer Fiber to capture the same callback twice before React commits disabled
state; its first draft used a removed renderer query API and was corrected. The
roster wait allows five seconds for the asynchronous access/roster bootstrap;
global Jest timeouts are unchanged. These are harness corrections, not evidence
that native rendering or live backend behavior was exercised.

The initial Android export failed during Hermes bytecode generation with exit 6
under the sandbox temporary directory. A retry with process-local `TEMP`/`TMP`
set to `node_modules/.cache/mob-25-temp` passed; the final post-fix export also
passed. This isolates a temporary-path/environment workaround, not an APK or
device result. Logs and generated bundles remain ignored under
`apps/mobile/dist/`. The full Jest run emitted existing invitation-fixture route
and `act` warnings, then an open-handle warning; it subsequently exited 0 without
forcing termination. No invitation/auth refactor was made for these warnings.

Harness coverage includes 320dp/1.6 font-scale inputs, long identities,
light/dark/system changes, keyboard props, Back/draft/pending/confirmation flows,
pagination above 100 members, policy variants, offline/errors, unknown outcomes,
session changes and membership events. The independent finish reviewer reported
no actionable defects within read-only source/harness scope. Neither that review
nor mocked component coverage is visual/native approval.

The screen also has a synchronous pending-request guard in addition to the
mutation lock. It keeps two callback invocations before rerender from replacing
the owning AbortController or unlocking a still-pending form. The reviewer
scored this later fix resolved; the focused regression passed.

Not verified: native screenshots/pixel fidelity, physical 320dp layout, actual
font metrics, motion/gestures, spoken TalkBack/VoiceOver, keyboard geometry,
device/iOS/APK behavior, cross-Web/Mobile synchronization, live backend/PostgreSQL
races or persisted assignment removal. No production service was used. These
remain practical acceptance limits for device and integration QA.

## MOB-26 handoff

Import the typed API/query helpers from the Board members index. Establish a fresh
explicit Board grant with `boardMembershipAccessOptions` and
`hasExplicitBoardMembership` before enabling `useBoardMembers`; a Workspace read
grant is insufficient. Keep roster/picker data under `queryKeys.members` so access
loss, membership removal and logout retire it with the existing fences. Use the
full Board roster DTO, not Workspace Guest data or the smaller assignee catalog.
Fetch deliberate server pages; do not present a local page filter as global
member search. MOB-26 must supply its own scoped mention UX and verification.

## Review follow-up: unresolved command outcomes

The unresolved-write guard now lives beside the command lock, outside React,
keyed by data-layer lifetime, session user/generation and Board ID. An uncertain
started command records the guard even if its screen has already unmounted.
Remounts, background reads and Board resource fences do not clear it. New
commands are rejected before dispatch until the user explicitly completes both
the access and roster review. Session teardown clears the in-memory state;
confirmed commands retain their existing behavior.

Regression coverage includes remount after an uncertain response, failed review,
successful explicit review, route cancellation while a command is in flight,
late responses, Board/session isolation and confirmed writes. The focused Board
membership Node file passed all 32 cases; Members and Board Settings component
files passed all 48 cases (29 Members, 19 Settings). Native/live verification
limits above still apply.

## Review follow-up: initial effective-policy refresh

Workspace policy updates now identify in-flight Board policy queries that have
no cached data. After aborting the superseded HTTP requests, they await those
queries' cancellation before invalidating the policy keys. This starts a fresh
request instead of reusing an initial fetch that is about to reject. Queries
with cached policy data keep the existing invalidation/refetch path and retain
their previous snapshot until the new response arrives. The session is checked
again after cancellation settles.

The new initial-read regression failed before the fix (one request instead of
the required fresh second request), while the cached-read case already passed.
After the fix, both cases pass and late cancelled responses cannot overwrite the
new policy. Follow-up verification, all exit 0:

- `pnpm --filter @kanban/mobile exec node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/workspaces/membership.test.ts test/board-members/membership.test.ts`: 37/37 PASS.
- `pnpm --filter @kanban/mobile exec jest --runInBand test/board-members.component.test.js test/board-settings.component.test.js`: 48/48 PASS.
- `pnpm --filter @kanban/mobile lint` and `pnpm --filter @kanban/mobile typecheck`: PASS.
- `pnpm --filter @kanban/mobile bundle:android`, with the existing workspace TEMP/TMP workaround: PASS, including Hermes/source-map verification of 1,472 native sources.
- Changed-file Prettier with `--end-of-line auto` and `git diff --check`: PASS.

Backend, Web and root application suites were not run for these Mobile-only
fixes. The native/live QA limits above remain unchanged.
